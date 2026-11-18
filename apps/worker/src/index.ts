import { config } from "./config.js";
import { logger } from "./logger.js";
import { startServer } from "./server.js";
import { startSupervisor, stopSupervisor, cleanupAllStreams } from "./supervisor.js";
import { initQueue, shutdownQueue } from "./queue.js";
import { startCleanupScheduler } from "./cleanup.js";
import { detectEncoder } from "./encoder.js";
import { mkdir } from "node:fs/promises";

const log = logger.child({ module: "main" });

async function main(): Promise<void> {
  log.info("StreamClipper Worker starting...");

  // Ensure directories exist
  await mkdir(config.BUFFER_DIR, { recursive: true });
  await mkdir(config.TEMP_DIR, { recursive: true });
  await mkdir(config.LOCAL_CLIPS_DIR, { recursive: true });

  // Detect encoder
  const encoder = await detectEncoder();
  log.info({ encoder }, "Encoder detected");

  // Initialize queue
  await initQueue();

  // Start supervisor
  startSupervisor();

  // Start cleanup scheduler
  const cleanupTimer = startCleanupScheduler();

  // Start HTTP + WebSocket server
  startServer();

  log.info(
    {
      port: config.WORKER_PORT,
      storageMode: config.STORAGE_MODE,
      renderConcurrency: config.RENDER_CONCURRENCY,
      bufferSeconds: config.BUFFER_SECONDS,
    },
    "Worker ready"
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down...");
    clearInterval(cleanupTimer);
    stopSupervisor();
    await cleanupAllStreams();
    await shutdownQueue();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  log.fatal({ err }, "Worker failed to start");
  process.exit(1);
});
