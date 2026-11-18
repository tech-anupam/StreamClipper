/**
 * StreamClipper CLI — High-density terminal stream buffer & fast clipper
 *
 * MODES:
 *   1. Live Single Clip:
 *      pnpm clip "<url>" [durationSec]
 *
 *   2. Continuous Auto-Clipper (cuts every N seconds continuously):
 *      pnpm clip:auto "<url>" [intervalSec]
 *      or: pnpm clip "<url>" 20 --continuous
 *
 *   3. Timestamp Range Clipper:
 *      pnpm clip:time "<url>" <start> <end_or_duration>
 *      or: pnpm clip "<url>" --start 00:05:00 --duration 20
 */

import { config } from "./config.js";
import { resolveStream, probeResolution, isValidYouTubeUrl, grabFrame } from "./resolver.js";
import { startBuffer, stopBuffer, getBufferHealth } from "./buffer.js";
import { processClipJob } from "./clipper.js";
import { detectEncoder } from "./encoder.js";
import { ensureBinaries } from "./binaries.js";
import { launchPreviewWindow } from "./preview-window.js";
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CROP_CONFIG, normalizedToPixel, type CropConfig, buildMultiClipFfmpegArgs } from "@streamclipper/shared";
import { nanoid } from "nanoid";
import { execa } from "execa";

// ── Terminal Styling (ANSI Colors) ────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  green: "\x1b[32m",
  brightGreen: "\x1b[92m",
  yellow: "\x1b[33m",
  brightYellow: "\x1b[93m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  brightMagenta: "\x1b[95m",
  brightWhite: "\x1b[97m",
  bgCyan: "\x1b[46m\x1b[30m",
  bgGreen: "\x1b[42m\x1b[30m",
  bgYellow: "\x1b[43m\x1b[30m",
  bgMagenta: "\x1b[45m\x1b[30m",
};

function ts(): string {
  const now = new Date();
  return `${c.dim}[${now.toTimeString().slice(0, 8)}]${c.reset}`;
}

function progressBar(pct: number, length = 24): string {
  const filled = Math.round((pct / 100) * length);
  const empty = length - filled;
  return `${c.brightGreen}${"█".repeat(filled)}${c.dim}${"░".repeat(empty)}${c.reset} ${c.brightWhite}${pct.toFixed(0)}%${c.reset}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Format time string (01:23:45 or 12:30 or 45s) into total seconds.
 */
function parseTimeToSeconds(input: string): number {
  const clean = input.replace(/s$/i, "").trim();
  const parts = clean.split(":").map(Number);
  if (parts.some(isNaN)) return 20;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0];
  }
  return 20;
}

/**
 * Get organized folder path: ./clips/<ChannelName>/<StreamTitle>_<Date>/
 */
function getStreamClipsDir(channelName: string, streamTitle: string): string {
  const cleanChannel = channelName.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "Channel";
  const cleanTitle = streamTitle.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 35) || "Stream";
  const dateStr = new Date().toISOString().slice(0, 10);
  return join(config.LOCAL_CLIPS_DIR, cleanChannel, `${cleanTitle}_${dateStr}`);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Flags detection
  const isContinuous = rawArgs.includes("--continuous") || rawArgs.includes("-c") || rawArgs.includes("--auto");
  const isTimestamp = rawArgs.includes("--timestamp") || rawArgs.includes("-t");
  const skipPreview = rawArgs.includes("--no-preview") || rawArgs.includes("-y");

  // Filter out flag tokens
  const nonFlagArgs = rawArgs.filter(
    (a) => !["--continuous", "-c", "--auto", "--timestamp", "-t", "--no-preview", "-y"].includes(a)
  );

  console.log(`
${c.cyan}┌──────────────────────────────────────────────────────────────┐
│  ${c.brightWhite}${c.bold}STREAMCLIPPER v0.2.0${c.reset}${c.cyan} — High-Density Multi-Mode Studio       │
│  9:16 Video + Webcam • Continuous Loop • Timestamp Clipping   │
└──────────────────────────────────────────────────────────────┘${c.reset}
`);

  if (nonFlagArgs.length < 1) {
    console.log(`${c.yellow}Usage & Available Modes:${c.reset}`);
    console.log(`  ${c.brightCyan}1. Live Single Clip:${c.reset}`);
    console.log(`     pnpm clip "<youtube-url>" [durationSec] [--no-preview]`);
    console.log(`  ${c.brightGreen}2. Continuous Auto-Clipper (Repeated 20s clips):${c.reset}`);
    console.log(`     pnpm clip:auto "<youtube-url>" [intervalSec]`);
    console.log(`     pnpm clip "<youtube-url>" 20 --continuous`);
    console.log(`  ${c.brightYellow}3. Timestamp Range Clipper:${c.reset}`);
    console.log(`     pnpm clip:time "<youtube-url>" <start-time> <end-or-duration>`);
    console.log(`     pnpm clip "<youtube-url>" --timestamp 00:15:00 20\n`);
    process.exit(0);
  }

  const rawUrl = nonFlagArgs[0].replace(/^"|"$/g, "");

  if (!isValidYouTubeUrl(rawUrl)) {
    console.log(`${ts()} ${c.red}✖ Invalid YouTube URL:${c.reset} ${rawUrl}`);
    process.exit(1);
  }

  // Ensure workspace directories exist
  await mkdir(config.BUFFER_DIR, { recursive: true });
  await mkdir(config.TEMP_DIR, { recursive: true });
  await mkdir(config.LOCAL_CLIPS_DIR, { recursive: true });

  // ── PHASE 0: Pre-flight Verification ──────────────────────
  console.log(`${ts()} ${c.bold}${c.brightCyan}PHASE 0: Pre-flight System Verification${c.reset}`);
  const binaries = await ensureBinaries(
    {
      FFMPEG_PATH: config.FFMPEG_PATH,
      FFPROBE_PATH: config.FFPROBE_PATH,
      STREAMLINK_PATH: config.STREAMLINK_PATH,
      YT_DLP_PATH: config.YT_DLP_PATH,
    },
    (msg) => console.log(`${ts()}   ${c.yellow}${msg}${c.reset}`)
  );

  console.log(`  ${c.green}✓${c.reset} ffmpeg:     ${c.dim}${binaries.ffmpeg}${c.reset}`);
  console.log(`  ${c.green}✓${c.reset} yt-dlp:     ${c.dim}${binaries.ytDlp}${c.reset}`);

  const encoder = await detectEncoder();
  console.log(`  ${c.green}✓${c.reset} Video Codec: ${c.bold}${c.brightGreen}${encoder}${c.reset} ${c.dim}(auto-detected)${c.reset}\n`);

  // ── PHASE 1: Channel Connection & Live Resolution ─────────
  console.log(`${ts()} ${c.bold}${c.brightCyan}PHASE 1: Connecting to YouTube Stream${c.reset}`);
  console.log(`${ts()}   Target: ${c.brightWhite}${rawUrl}${c.reset}`);

  let resolved;
  try {
    resolved = await resolveStream(rawUrl, 3, 1500);
  } catch (err) {
    console.log(`${ts()} ${c.red}✖ Stream resolution failed:${c.reset} ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`\n  ${c.bgGreen} STREAM CONNECTED ${c.reset}`);
  console.log(`  ${c.bold}CHANNEL:${c.reset}     ${c.brightGreen}${c.bold}${resolved.channelName}${c.reset}`);
  console.log(`  ${c.bold}TITLE:${c.reset}       ${c.brightWhite}${resolved.title}${c.reset}`);

  // Target organized directory for this stream session
  const streamClipsDir = getStreamClipsDir(resolved.channelName, resolved.title);
  await mkdir(streamClipsDir, { recursive: true });

  console.log(`  ${c.bold}FOLDER:${c.reset}      ${c.brightCyan}${streamClipsDir}${c.reset}\n`);

  // Probe Stream Dimensions
  console.log(`${ts()}   Probing stream geometry...`);
  const resolution = await probeResolution(resolved.hlsUrl);
  console.log(`  ${c.bold}SOURCE RES:${c.reset}   ${c.cyan}${resolution.width}x${resolution.height}${c.reset} pixels\n`);

  // ── PHASE 2: Crop & Preview Studio ────────────────────────
  let activeCrop: CropConfig = DEFAULT_CROP_CONFIG;

  if (!skipPreview) {
    console.log(`${ts()} ${c.bold}${c.brightCyan}PHASE 2: Interactive Studio (9:16 Video + Webcam)${c.reset}`);
    process.stdout.write(`${ts()}   Grabbing live preview frame... `);
    const frameBuf = await grabFrame(resolved.hlsUrl);
    const frameBase64 = frameBuf.toString("base64");
    console.log(`${c.green}✓ Captured!${c.reset}`);

    console.log(`\n  ${c.bgYellow} STUDIO READY ${c.reset}`);
    console.log(`  ${c.brightYellow}Opening preview studio at http://localhost:4444 ...${c.reset}`);
    console.log(`  ${c.dim}Preview both unzoomed 9:16 video & webcam, then click CONFIRM.${c.reset}`);

    activeCrop = await launchPreviewWindow({
      frameBase64,
      sourceWidth: resolution.width,
      sourceHeight: resolution.height,
      initialConfig: DEFAULT_CROP_CONFIG,
    });

    const isFull = activeCrop.content.w >= 0.98 && activeCrop.content.h >= 0.98;
    console.log(`\n${ts()}   ${c.brightGreen}✓ Configuration confirmed!${c.reset}`);
    console.log(`      Video:   ${c.bold}${isFull ? "Full Stream (100% unzoomed fit)" : `${Math.round(activeCrop.content.w * 100)}% custom crop`}${c.reset}`);
    console.log(`      Webcam:  ${c.bold}${Math.round(activeCrop.webcam.w * resolution.width)}x${Math.round(activeCrop.webcam.h * resolution.height)} px${c.reset} at (${Math.round(activeCrop.webcam.x * 100)}%, ${Math.round(activeCrop.webcam.y * 100)}%)\n`);
  } else {
    console.log(`${ts()}   Using default unzoomed preset (--no-preview mode).\n`);
  }

  // ── BRANCH: TIMESTAMP CLIPPING MODE ───────────────────────
  if (isTimestamp || (nonFlagArgs.length >= 3 && nonFlagArgs[1].includes(":"))) {
    await handleTimestampMode({
      resolved,
      resolution,
      activeCrop,
      encoder,
      streamClipsDir,
      args: nonFlagArgs.slice(1),
    });
    return;
  }

  // ── BRANCH: CONTINUOUS / SINGLE CLIP PIPELINE ─────────────
  const clipDuration = parseInt(nonFlagArgs[1] ?? "20", 10);
  const streamId = `cli_${Date.now().toString(36)}`;

  console.log(`${ts()} ${c.bold}${c.brightCyan}PHASE 3: Buffering Live Stream (Rolling HLS Window)${c.reset}`);
  console.log(`${ts()}   Starting ffmpeg copy pipeline... target cache: ${c.bold}${clipDuration + 4}s${c.reset}`);

  await startBuffer(streamId, resolved.hlsUrl);

  // Graceful Ctrl+C shutdown
  let keepRunning = true;
  let totalSessionClips = 0;

  process.on("SIGINT", async () => {
    console.log(`\n\n${ts()} ${c.yellow}Gracefully stopping clipping session...${c.reset}`);
    keepRunning = false;
    await stopBuffer(streamId);
    console.log(`${ts()} ${c.brightGreen}✓ Session complete! Total clips produced: ${totalSessionClips}${c.reset}`);
    console.log(`${ts()}   All clips saved in: ${c.brightCyan}${streamClipsDir}${c.reset}\n`);
    process.exit(0);
  });

  // Wait for initial buffer threshold
  const targetBufferSec = clipDuration + 4;
  let ready = false;

  while (!ready) {
    await sleep(2000);
    const health = await getBufferHealth(streamId);
    if (health) {
      const bufferedSec = health.segmentCount * 2;
      const pct = Math.min(100, (bufferedSec / targetBufferSec) * 100);
      const sizeMb = (health.totalSizeBytes / 1024 / 1024).toFixed(1);

      process.stdout.write(
        `\r${ts()}   Buffering: ${progressBar(pct)} [${bufferedSec}s / ${targetBufferSec}s] • ${health.segmentCount} segments • ${sizeMb} MB  `
      );

      if (bufferedSec >= targetBufferSec) {
        ready = true;
        console.log(`\n${ts()}   ${c.brightGreen}✓ Buffer threshold reached! Ready to cut clips.${c.reset}\n`);
      }
    }
  }

  // ── LOOP FOR CLIPPING ─────────────────────────────────────
  let clipIndex = 1;

  if (isContinuous) {
    console.log(`  ${c.bgMagenta} CONTINUOUS CLIPPING MODE ACTIVE ${c.reset}`);
    console.log(`  Interval: ${c.bold}${clipDuration}s${c.reset} per clip cycle`);
    console.log(`  Destination: ${c.brightCyan}${streamClipsDir}${c.reset}`);
    console.log(`  ${c.dim}Clips will cut automatically every ${clipDuration}s. Press Ctrl+C to stop.${c.reset}\n`);
  }

  while (keepRunning) {
    const cutStartTime = Date.now();
    const clipId = `clip_${String(clipIndex).padStart(3, "0")}`;

    console.log(`${ts()} ${c.bold}${c.brightCyan}Cutting Clip #${clipIndex} (${clipDuration}s)...${c.reset}`);

    const result = await processClipJob(
      {
        jobId: `job_${clipId}_${Date.now()}`,
        clipId,
        streamId,
        seconds: clipDuration,
        cropConfig: activeCrop,
        sourceWidth: resolution.width,
        sourceHeight: resolution.height,
        channelName: resolved.channelName,
        streamTitle: resolved.title,
      },
      (pct) => {
        process.stdout.write(`\r${ts()}   Re-encoding pass: ${progressBar(pct, 20)}  `);
      }
    );

    const cutElapsed = ((Date.now() - cutStartTime) / 1000).toFixed(1);
    process.stdout.write(`\r${ts()}   Re-encoding pass: ${progressBar(100, 20)} (${cutElapsed}s)  \n`);

    // Copy to organized stream folder
    const contentName = `clip_${String(clipIndex).padStart(3, "0")}_content_9x16_${clipDuration}s.mp4`;
    const webcamName = `clip_${String(clipIndex).padStart(3, "0")}_webcam_${clipDuration}s.mp4`;
    const stackedName = `clip_${String(clipIndex).padStart(3, "0")}_stacked_9x16_${clipDuration}s.mp4`;

    const destContent = join(streamClipsDir, contentName);
    const destWebcam = join(streamClipsDir, webcamName);
    const destStacked = join(streamClipsDir, stackedName);

    try {
      await copyFile(result.contentPath, destContent);
      await copyFile(result.webcamPath, destWebcam);
      await copyFile(result.stackedPath, destStacked);

      // Clean temp folder for this job to save disk
      const tempJobDir = join(config.TEMP_DIR, clipId);
      await rm(tempJobDir, { recursive: true, force: true }).catch(() => {});
    } catch {
      // Best-effort copy & clean
    }

    clipIndex++;
    totalSessionClips++;

    console.log(`\n  ${c.bgGreen} CLIP #${totalSessionClips} SAVED ${c.reset}`);
    console.log(`  ${c.bold}CONTENT 9:16:${c.reset}  ${c.brightGreen}${destContent}${c.reset} (${(result.contentSizeBytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  ${c.bold}WEBCAM:${c.reset}        ${c.brightYellow}${destWebcam}${c.reset} (${(result.webcamSizeBytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  ${c.bold}STACKED COMBO:${c.reset} ${c.brightMagenta}${destStacked}${c.reset} (${(result.stackedSizeBytes / 1024 / 1024).toFixed(2)} MB)\n`);

    if (!isContinuous) {
      // One-shot mode finishes here
      break;
    }

    // Continuous mode: countdown to next cut
    console.log(`${ts()}   ${c.dim}Buffer accumulating next ${clipDuration}s stream slice...${c.reset}`);
    for (let remaining = clipDuration; remaining > 0; remaining -= 2) {
      process.stdout.write(`\r${ts()}   Next cut in: ${c.bold}${remaining}s${c.reset}  (Press Ctrl+C to stop)    `);
      await sleep(2000);
    }
    console.log("");
  }

  // Cleanup buffer on exit
  await stopBuffer(streamId);
  console.log(`${ts()}   ${c.green}✓ Pipeline finished! Total clips: ${totalSessionClips}${c.reset}\n`);
}

/**
 * Handle Timestamp Clipping (cuts specific time range from stream or VOD).
 */
async function handleTimestampMode(opts: {
  resolved: { hlsUrl: string; title: string; channelName: string };
  resolution: { width: number; height: number };
  activeCrop: CropConfig;
  encoder: string;
  streamClipsDir: string;
  args: string[];
}): Promise<void> {
  const { resolved, resolution, activeCrop, encoder, streamClipsDir, args } = opts;

  const startStr = args[0] ?? "00:00:00";
  const endOrDurationStr = args[1] ?? "20";

  let durationSec = 20;
  if (endOrDurationStr.includes(":")) {
    const startSec = parseTimeToSeconds(startStr);
    const endSec = parseTimeToSeconds(endOrDurationStr);
    durationSec = Math.max(2, endSec - startSec);
  } else {
    durationSec = parseTimeToSeconds(endOrDurationStr);
  }

  console.log(`  ${c.bgYellow} TIMESTAMP CLIPPING MODE ${c.reset}`);
  console.log(`  Start Time:  ${c.brightWhite}${startStr}${c.reset}`);
  console.log(`  Duration:    ${c.brightWhite}${durationSec} seconds${c.reset}`);
  console.log(`  Saving To:   ${c.brightCyan}${streamClipsDir}${c.reset}\n`);

  const clipId = `ts_${Date.now().toString(36)}`;
  const tempDir = join(config.TEMP_DIR, clipId);
  await mkdir(tempDir, { recursive: true });

  const rawSegmentPath = join(tempDir, "segment.ts");

  console.log(`${ts()}   Seeking & extracting ${durationSec}s at ${startStr}...`);
  await execa(config.FFMPEG_PATH, [
    "-ss",
    startStr,
    "-i",
    resolved.hlsUrl,
    "-t",
    String(durationSec),
    "-c",
    "copy",
    "-y",
    rawSegmentPath,
  ]);

  console.log(`${ts()}   ${c.green}✓ Segment extracted! Re-encoding with crop layout...${c.reset}`);

  const contentPixel = normalizedToPixel(activeCrop.content, resolution.width, resolution.height);
  const webcamPixel = normalizedToPixel(activeCrop.webcam, resolution.width, resolution.height);

  const cleanStart = startStr.replace(/[^0-9]/g, "-");
  const destContent = join(streamClipsDir, `clip_ts_${cleanStart}_content_9x16_${durationSec}s.mp4`);
  const destWebcam = join(streamClipsDir, `clip_ts_${cleanStart}_webcam_${durationSec}s.mp4`);
  const destStacked = join(streamClipsDir, `clip_ts_${cleanStart}_stacked_9x16_${durationSec}s.mp4`);

  const ffmpegArgs = buildMultiClipFfmpegArgs({
    inputPath: rawSegmentPath,
    contentOutputPath: destContent,
    webcamOutputPath: destWebcam,
    stackedOutputPath: destStacked,
    content: contentPixel,
    webcam: webcamPixel,
    encoder,
    contentMode: activeCrop.contentMode ?? "fit",
    contentHeight: activeCrop.contentHeight,
    webcamHeight: activeCrop.webcamHeight,
    sourceWidth: resolution.width,
    sourceHeight: resolution.height,
  });

  await execa(config.FFMPEG_PATH, ffmpegArgs);

  // Clean temp files
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});

  console.log(`\n  ${c.bgGreen} TIMESTAMP CLIP SAVED ${c.reset}`);
  console.log(`  ${c.bold}CONTENT 9:16:${c.reset}  ${c.brightGreen}${destContent}${c.reset}`);
  console.log(`  ${c.bold}WEBCAM:${c.reset}        ${c.brightYellow}${destWebcam}${c.reset}`);
  console.log(`  ${c.bold}STACKED COMBO:${c.reset} ${c.brightMagenta}${destStacked}${c.reset}`);
  console.log(`  ${c.bold}DIRECTORY:${c.reset}     ${c.dim}${streamClipsDir}${c.reset}\n`);
}

main().catch((err) => {
  console.error(`\n${ts()} ${c.red}✖ Pipeline Error:${c.reset}`, err.message);
  process.exit(1);
});
