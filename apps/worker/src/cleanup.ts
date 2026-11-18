import { readdir, stat, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "cleanup" });

/**
 * Delete temp files in the temp directory.
 */
export async function cleanupTempFiles(): Promise<void> {
  try {
    await access(config.TEMP_DIR);
    const entries = await readdir(config.TEMP_DIR);

    for (const entry of entries) {
      const entryPath = join(config.TEMP_DIR, entry);
      const entryStat = await stat(entryPath);

      // Delete temp dirs older than 1 hour
      if (
        entryStat.isDirectory() &&
        Date.now() - entryStat.mtimeMs > 3600_000
      ) {
        await rm(entryPath, { recursive: true, force: true });
        log.info({ path: entryPath }, "Cleaned up temp directory");
      }
    }
  } catch {
    // Temp dir doesn't exist yet, nothing to clean
  }
}

/**
 * Enforce clip TTL: delete clips older than CLIP_TTL_DAYS from local disk.
 */
export async function enforceClipTTL(): Promise<void> {
  if (config.STORAGE_MODE !== "local") return;

  const ttlMs = config.CLIP_TTL_DAYS * 24 * 3600_000;
  const clipsDir = config.LOCAL_CLIPS_DIR;

  try {
    await access(clipsDir);
    const entries = await readdir(clipsDir);

    for (const entry of entries) {
      const entryPath = join(clipsDir, entry);
      const entryStat = await stat(entryPath);

      if (Date.now() - entryStat.mtimeMs > ttlMs) {
        await rm(entryPath, { force: true });
        log.info({ path: entryPath }, "Deleted expired clip");
      }
    }
  } catch {
    // Clips dir doesn't exist
  }
}

/**
 * Enforce disk cap on buffer directories.
 */
export async function enforceBufferDiskCap(): Promise<void> {
  const capBytes = config.BUFFER_DISK_CAP_MB * 1024 * 1024;

  try {
    await access(config.BUFFER_DIR);
    const streamDirs = await readdir(config.BUFFER_DIR);
    let totalSize = 0;

    // Collect all segments with timestamps
    const allSegments: { path: string; size: number; mtime: number }[] = [];

    for (const dir of streamDirs) {
      const dirPath = join(config.BUFFER_DIR, dir);
      const dirStat = await stat(dirPath);
      if (!dirStat.isDirectory()) continue;

      const files = await readdir(dirPath);
      for (const file of files) {
        if (!file.endsWith(".ts")) continue;
        const filePath = join(dirPath, file);
        const fileStat = await stat(filePath);
        totalSize += fileStat.size;
        allSegments.push({
          path: filePath,
          size: fileStat.size,
          mtime: fileStat.mtimeMs,
        });
      }
    }

    if (totalSize <= capBytes) return;

    // Sort by mtime (oldest first) and delete until under cap
    allSegments.sort((a, b) => a.mtime - b.mtime);

    let freed = 0;
    for (const seg of allSegments) {
      if (totalSize - freed <= capBytes) break;
      await rm(seg.path, { force: true });
      freed += seg.size;
    }

    log.info(
      { freedMB: (freed / 1024 / 1024).toFixed(1), totalMB: (totalSize / 1024 / 1024).toFixed(1) },
      "Enforced buffer disk cap"
    );
  } catch {
    // Buffer dir doesn't exist
  }
}

/**
 * Run all cleanup tasks.
 */
export async function runCleanupCycle(): Promise<void> {
  await cleanupTempFiles();
  await enforceClipTTL();
  await enforceBufferDiskCap();
}

/**
 * Start periodic cleanup (every 5 minutes).
 */
export function startCleanupScheduler(): ReturnType<typeof setInterval> {
  return setInterval(runCleanupCycle, 5 * 60_000);
}
