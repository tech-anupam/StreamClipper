import { execa } from "execa";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { detectEncoder } from "./encoder.js";
import {
  normalizedToPixel,
  buildClipFfmpegArgs,
  buildMultiClipFfmpegArgs,
  type CropConfig,
} from "@streamclipper/shared";
import { getBufferDir } from "./buffer.js";

const log = logger.child({ module: "clipper" });

export interface ClipJobInput {
  jobId: string;
  clipId: string;
  streamId: string;
  seconds: number;
  cropConfig: CropConfig;
  sourceWidth: number;
  sourceHeight: number;
  /** Channel name — used to organize uploads in Google Drive */
  channelName?: string;
  /** Stream title — used to organize uploads in Google Drive */
  streamTitle?: string;
}

export interface ClipJobResult {
  clipId: string;
  outputPath: string;
  contentPath: string;
  webcamPath: string;
  stackedPath: string;
  durationSec: number;
  sizeBytes: number;
  contentSizeBytes: number;
  webcamSizeBytes: number;
  stackedSizeBytes: number;
}

/**
 * Process a clip job: extract segments, concat, re-encode with crop.
 */
export async function processClipJob(
  input: ClipJobInput,
  onProgress?: (pct: number) => void
): Promise<ClipJobResult> {
  const {
    jobId,
    clipId,
    streamId,
    seconds,
    cropConfig,
    sourceWidth,
    sourceHeight,
  } = input;

  log.info({ jobId, clipId, streamId, seconds }, "Processing clip job");

  const tempDir = join(config.TEMP_DIR, clipId);
  await mkdir(tempDir, { recursive: true });

  // Step 1: Find the segments covering the last N seconds
  const bufferDir = getBufferDir(streamId);
  const segments = await selectSegments(bufferDir, seconds);

  if (segments.length === 0) {
    throw new Error("No buffer segments found for the requested time range");
  }

  log.info({ segmentCount: segments.length }, "Selected segments");
  onProgress?.(10);

  // Step 2: Create a concat file
  const concatPath = join(tempDir, "concat.txt");
  const concatContent = segments
    .map((s) => `file '${resolve(s)}'`)
    .join("\n");
  await writeFile(concatPath, concatContent);

  // Step 3: Concat without re-encode to a temp file
  const rawPath = join(tempDir, "raw.ts");
  await execa(config.FFMPEG_PATH, [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c",
    "copy",
    "-y",
    rawPath,
  ]);

  onProgress?.(30);

  // Step 4: Trim to exact duration
  const trimmedPath = join(tempDir, "trimmed.ts");
  await execa(config.FFMPEG_PATH, [
    "-sseof",
    `-${seconds}`,
    "-i",
    rawPath,
    "-c",
    "copy",
    "-y",
    trimmedPath,
  ]);

  onProgress?.(40);

  // Step 5: Re-encode with crop filter
  const contentPixel = normalizedToPixel(
    cropConfig.content,
    sourceWidth,
    sourceHeight
  );
  const webcamPixel = normalizedToPixel(
    cropConfig.webcam,
    sourceWidth,
    sourceHeight
  );

  const encoder = await detectEncoder();
  const contentOutputPath = join(tempDir, `clip_${clipId}_content_9x16.mp4`);
  const webcamOutputPath = join(tempDir, `clip_${clipId}_webcam.mp4`);
  const stackedOutputPath = join(tempDir, `clip_${clipId}_stacked_9x16.mp4`);

  const ffmpegArgs = buildMultiClipFfmpegArgs({
    inputPath: trimmedPath,
    contentOutputPath,
    webcamOutputPath,
    stackedOutputPath,
    content: contentPixel,
    webcam: webcamPixel,
    encoder,
    contentMode: cropConfig.contentMode ?? "fit",
    contentHeight: cropConfig.contentHeight,
    webcamHeight: cropConfig.webcamHeight,
    sourceWidth,
    sourceHeight,
  });

  log.info({ encoder, args: ffmpegArgs.join(" ") }, "Starting multi-clip re-encode");

  const encodeProc = execa(config.FFMPEG_PATH, ffmpegArgs);

  // Parse progress from stderr
  encodeProc.stderr?.on("data", (data: Buffer) => {
    const line = data.toString();
    const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
    if (timeMatch) {
      const elapsed =
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]);
      const pct = Math.min(95, 40 + Math.round((elapsed / seconds) * 55));
      onProgress?.(pct);
    }
  });

  await encodeProc;

  onProgress?.(95);

  // Step 6: Get output file sizes
  const [contentStat, webcamStat, stackedStat] = await Promise.all([
    stat(contentOutputPath),
    stat(webcamOutputPath),
    stat(stackedOutputPath),
  ]);

  onProgress?.(100);

  const totalBytes = contentStat.size + webcamStat.size + stackedStat.size;

  log.info(
    {
      clipId,
      contentOutputPath,
      webcamOutputPath,
      stackedOutputPath,
      contentSize: contentStat.size,
      webcamSize: webcamStat.size,
    },
    "Multi-clip job completed"
  );

  return {
    clipId,
    outputPath: contentOutputPath,
    contentPath: contentOutputPath,
    webcamPath: webcamOutputPath,
    stackedPath: stackedOutputPath,
    durationSec: seconds,
    sizeBytes: totalBytes,
    contentSizeBytes: contentStat.size,
    webcamSizeBytes: webcamStat.size,
    stackedSizeBytes: stackedStat.size,
  };
}

/**
 * Select the most recent buffer segments covering the last N seconds.
 */
async function selectSegments(
  bufferDir: string,
  seconds: number
): Promise<string[]> {
  const files = await readdir(bufferDir);
  const tsFiles = files
    .filter((f) => f.endsWith(".ts"))
    .sort(); // sorted by name (seg_00001.ts, seg_00002.ts, ...)

  if (tsFiles.length === 0) return [];

  // Each segment is ~2 seconds. We need ceil(seconds/2) + 1 for safety.
  const neededSegments = Math.ceil(seconds / 2) + 1;
  const selected = tsFiles.slice(-neededSegments);

  return selected.map((f) => join(bufferDir, f));
}
