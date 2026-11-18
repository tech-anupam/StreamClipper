import { execa, type ResultPromise } from "execa";
import { mkdir, readdir, stat, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { BufferHealth } from "@streamclipper/shared";

const log = logger.child({ module: "buffer" });

export interface BufferProcess {
  streamId: string;
  hlsUrl: string;
  bufferDir: string;
  process: ResultPromise | null;
  startedAt: number;
  restartCount: number;
  healthy: boolean;
}

const activeBuffers = new Map<string, BufferProcess>();

/**
 * Start the ffmpeg buffer process for a stream.
 */
export async function startBuffer(
  streamId: string,
  hlsUrl: string
): Promise<BufferProcess> {
  if (activeBuffers.has(streamId)) {
    throw new Error(`Buffer already running for stream ${streamId}`);
  }

  const bufferDir = join(config.BUFFER_DIR, streamId);
  await mkdir(bufferDir, { recursive: true });

  const outputPath = join(bufferDir, "live.m3u8");

  const hlsListSize = Math.ceil(config.BUFFER_SECONDS / 2); // 2-second segments

  const proc = execa(config.FFMPEG_PATH, [
    "-i",
    hlsUrl,
    "-c",
    "copy",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    String(hlsListSize),
    "-hls_flags",
    "delete_segments+append_list",
    "-hls_segment_filename",
    join(bufferDir, "seg_%05d.ts"),
    outputPath,
  ]);

  const bufferProcess: BufferProcess = {
    streamId,
    hlsUrl,
    bufferDir,
    process: proc,
    startedAt: Date.now(),
    restartCount: 0,
    healthy: true,
  };

  activeBuffers.set(streamId, bufferProcess);

  // Monitor the process
  proc.catch((err) => {
    log.error({ streamId, err: err.message }, "Buffer process exited");
    bufferProcess.healthy = false;
    bufferProcess.process = null;
  });

  log.info({ streamId, bufferDir }, "Buffer started");
  return bufferProcess;
}

/**
 * Stop the buffer process for a stream.
 */
export async function stopBuffer(streamId: string): Promise<void> {
  const buf = activeBuffers.get(streamId);
  if (!buf) return;

  if (buf.process) {
    buf.process.kill("SIGTERM");
    // Give it 5 seconds then force kill
    setTimeout(() => {
      if (buf.process) {
        buf.process.kill("SIGKILL");
      }
    }, 5000);
  }

  activeBuffers.delete(streamId);
  log.info({ streamId }, "Buffer stopped");
}

/**
 * Restart a buffer (e.g., after HLS URL expiry).
 */
export async function restartBuffer(
  streamId: string,
  newHlsUrl?: string
): Promise<BufferProcess> {
  const existing = activeBuffers.get(streamId);
  const restartCount = existing ? existing.restartCount + 1 : 0;

  await stopBuffer(streamId);

  const hlsUrl = newHlsUrl ?? existing?.hlsUrl;
  if (!hlsUrl) {
    throw new Error(`No HLS URL available for stream ${streamId}`);
  }

  const bp = await startBuffer(streamId, hlsUrl);
  bp.restartCount = restartCount;
  return bp;
}

/**
 * Get the health of a buffer.
 */
export async function getBufferHealth(
  streamId: string
): Promise<BufferHealth | null> {
  const buf = activeBuffers.get(streamId);
  if (!buf) return null;

  try {
    const files = await readdir(buf.bufferDir);
    const tsFiles = files.filter((f) => f.endsWith(".ts"));

    if (tsFiles.length === 0) {
      return {
        streamId,
        segmentCount: 0,
        oldestSegmentAge: 0,
        newestSegmentAge: 0,
        totalSizeBytes: 0,
        healthy: false,
      };
    }

    let totalSize = 0;
    let oldestMtime = Infinity;
    let newestMtime = 0;

    for (const f of tsFiles) {
      const s = await stat(join(buf.bufferDir, f));
      totalSize += s.size;
      oldestMtime = Math.min(oldestMtime, s.mtimeMs);
      newestMtime = Math.max(newestMtime, s.mtimeMs);
    }

    const now = Date.now();
    const health: BufferHealth = {
      streamId,
      segmentCount: tsFiles.length,
      oldestSegmentAge: (now - oldestMtime) / 1000,
      newestSegmentAge: (now - newestMtime) / 1000,
      totalSizeBytes: totalSize,
      healthy: (now - newestMtime) / 1000 < 10, // healthy if newest segment < 10s old
    };

    buf.healthy = health.healthy;
    return health;
  } catch (err) {
    log.error({ streamId, err }, "Failed to check buffer health");
    return null;
  }
}

/**
 * Get the buffer directory path for a stream.
 */
export function getBufferDir(streamId: string): string {
  return join(config.BUFFER_DIR, streamId);
}

/**
 * Get all active buffer stream IDs.
 */
export function getActiveBufferIds(): string[] {
  return Array.from(activeBuffers.keys());
}

/**
 * Check if a buffer is active for a stream.
 */
export function isBufferActive(streamId: string): boolean {
  const buf = activeBuffers.get(streamId);
  return buf !== undefined && buf.process !== null;
}

/**
 * Clean up the buffer directory for a stream.
 */
export async function cleanupBuffer(streamId: string): Promise<void> {
  const bufferDir = join(config.BUFFER_DIR, streamId);
  try {
    await access(bufferDir);
    await rm(bufferDir, { recursive: true, force: true });
    log.info({ streamId }, "Buffer directory cleaned up");
  } catch {
    // Directory doesn't exist, nothing to clean
  }
}
