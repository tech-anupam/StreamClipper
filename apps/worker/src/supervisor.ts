import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  startBuffer,
  stopBuffer,
  restartBuffer,
  getBufferHealth,
  getActiveBufferIds,
  cleanupBuffer,
} from "./buffer.js";
import { resolveStream, probeResolution } from "./resolver.js";
import type { BufferHealth } from "@streamclipper/shared";

const log = logger.child({ module: "supervisor" });

interface ManagedStream {
  streamId: string;
  url: string;
  hlsUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  title: string;
  channelName: string;
  channelId: string;
  status: "buffering" | "error" | "stopped";
  lastHealthCheck: number;
  consecutiveFailures: number;
}

const managedStreams = new Map<string, ManagedStream>();
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start supervising streams: periodic health checks and auto-restart.
 */
export function startSupervisor(): void {
  if (healthCheckInterval) return;

  healthCheckInterval = setInterval(async () => {
    await checkAllStreams();
  }, 10_000); // Check every 10 seconds

  log.info("Supervisor started");
}

/**
 * Stop the supervisor.
 */
export function stopSupervisor(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  log.info("Supervisor stopped");
}

/**
 * Add and start a new stream.
 */
export async function addStream(
  streamId: string,
  url: string
): Promise<ManagedStream> {
  if (managedStreams.has(streamId)) {
    throw new Error(`Stream ${streamId} already managed`);
  }

  log.info({ streamId, url }, "Resolving stream");

  const resolved = await resolveStream(url);
  const resolution = await probeResolution(resolved.hlsUrl);

  const managed: ManagedStream = {
    streamId,
    url,
    hlsUrl: resolved.hlsUrl,
    sourceWidth: resolution.width,
    sourceHeight: resolution.height,
    title: resolved.title,
    channelName: resolved.channelName,
    channelId: resolved.channelId,
    status: "buffering",
    lastHealthCheck: Date.now(),
    consecutiveFailures: 0,
  };

  managedStreams.set(streamId, managed);

  await startBuffer(streamId, resolved.hlsUrl);

  log.info(
    { streamId, resolution, title: resolved.title },
    "Stream added and buffering"
  );

  return managed;
}

/**
 * Remove and stop a stream.
 */
export async function removeStream(streamId: string): Promise<void> {
  await stopBuffer(streamId);
  managedStreams.delete(streamId);
  log.info({ streamId }, "Stream removed");
}

/**
 * Get information about a managed stream.
 */
export function getStream(streamId: string): ManagedStream | undefined {
  return managedStreams.get(streamId);
}

/**
 * Get all managed streams.
 */
export function getAllStreams(): ManagedStream[] {
  return Array.from(managedStreams.values());
}

/**
 * Run health checks on all managed streams.
 */
async function checkAllStreams(): Promise<void> {
  for (const [streamId, managed] of managedStreams) {
    if (managed.status === "stopped") continue;

    try {
      const health = await getBufferHealth(streamId);

      if (!health || !health.healthy) {
        managed.consecutiveFailures++;
        log.warn(
          { streamId, failures: managed.consecutiveFailures },
          "Buffer unhealthy"
        );

        if (managed.consecutiveFailures >= 3) {
          log.info({ streamId }, "Auto-restarting buffer");
          try {
            // Re-resolve the stream URL (it may have expired)
            const resolved = await resolveStream(managed.url);
            managed.hlsUrl = resolved.hlsUrl;
            await restartBuffer(streamId, resolved.hlsUrl);
            managed.consecutiveFailures = 0;
            managed.status = "buffering";
          } catch (err) {
            log.error({ streamId, err }, "Failed to restart buffer");
            managed.status = "error";
          }
        }
      } else {
        managed.consecutiveFailures = 0;
        managed.status = "buffering";
      }

      managed.lastHealthCheck = Date.now();
    } catch (err) {
      log.error({ streamId, err }, "Health check failed");
    }
  }
}

/**
 * Clean up all streams and buffers.
 */
export async function cleanupAllStreams(): Promise<void> {
  for (const streamId of managedStreams.keys()) {
    await stopBuffer(streamId);
    await cleanupBuffer(streamId);
  }
  managedStreams.clear();
  log.info("All streams cleaned up");
}

/**
 * Enforce disk cap on buffer directories.
 */
export async function enforceDiskCap(): Promise<void> {
  // This would scan buffer directories and remove oldest segments
  // if total size exceeds BUFFER_DISK_CAP_MB
  // Implementation depends on actual disk usage monitoring
  log.debug("Disk cap enforcement check");
}
