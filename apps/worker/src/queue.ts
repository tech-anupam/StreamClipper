import { Queue, Worker, type Job as BullJob } from "bullmq";
import PQueue from "p-queue";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  processClipJob,
  type ClipJobInput,
  type ClipJobResult,
} from "./clipper.js";
import { uploadClip, buildClipFileName, type UploadResult } from "./uploader.js";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";

const log = logger.child({ module: "queue" });

const QUEUE_NAME = "clip-jobs";

type ProgressCallback = (
  jobId: string,
  clipId: string,
  progress: number
) => void;
type CompletedCallback = (
  jobId: string,
  clipId: string,
  result: ClipJobResult & UploadResult
) => void;
type FailedCallback = (
  jobId: string,
  clipId: string,
  error: string
) => void;

let bullQueue: Queue | null = null;
let bullWorker: Worker | null = null;
let memoryQueue: PQueue | null = null;

let onProgress: ProgressCallback = () => {};
let onCompleted: CompletedCallback = () => {};
let onFailed: FailedCallback = () => {};

/**
 * Initialize the job queue (BullMQ if Redis is available, otherwise p-queue).
 */
export async function initQueue(): Promise<void> {
  if (config.REDIS_URL) {
    await initBullMQ();
  } else {
    initMemoryQueue();
  }
}

export function setQueueCallbacks(cbs: {
  onProgress?: ProgressCallback;
  onCompleted?: CompletedCallback;
  onFailed?: FailedCallback;
}): void {
  if (cbs.onProgress) onProgress = cbs.onProgress;
  if (cbs.onCompleted) onCompleted = cbs.onCompleted;
  if (cbs.onFailed) onFailed = cbs.onFailed;
}

async function initBullMQ(): Promise<void> {
  const connection = { url: config.REDIS_URL! };

  bullQueue = new Queue(QUEUE_NAME, { connection });

  bullWorker = new Worker(
    QUEUE_NAME,
    async (job: BullJob<ClipJobInput>) => {
      return processAndUpload(job.data, (pct) => {
        onProgress(job.data.jobId, job.data.clipId, pct);
      });
    },
    {
      connection,
      concurrency: config.RENDER_CONCURRENCY,
    }
  );

  bullWorker.on("completed", (job) => {
    if (job) {
      const result = job.returnvalue;
      onCompleted(job.data.jobId, job.data.clipId, result);
    }
  });

  bullWorker.on("failed", (job, err) => {
    if (job) {
      onFailed(job.data.jobId, job.data.clipId, err.message);
    }
  });

  log.info("Initialized BullMQ queue with Redis");
}

function initMemoryQueue(): void {
  memoryQueue = new PQueue({
    concurrency: config.RENDER_CONCURRENCY,
  });

  log.info(
    { concurrency: config.RENDER_CONCURRENCY },
    "Initialized in-memory p-queue (no Redis)"
  );
}

/**
 * Add a clip job to the queue.
 */
export async function addClipJob(input: ClipJobInput): Promise<void> {
  if (bullQueue) {
    await bullQueue.add("clip", input, {
      removeOnComplete: 100,
      removeOnFail: 50,
    });
    log.info({ jobId: input.jobId }, "Added job to BullMQ");
  } else if (memoryQueue) {
    memoryQueue
      .add(async () => {
        try {
          const result = await processAndUpload(input, (pct) => {
            onProgress(input.jobId, input.clipId, pct);
          });
          onCompleted(input.jobId, input.clipId, result);
        } catch (err) {
          onFailed(
            input.jobId,
            input.clipId,
            err instanceof Error ? err.message : String(err)
          );
        }
      })
      .catch(() => {});
    log.info({ jobId: input.jobId }, "Added job to in-memory queue");
  } else {
    throw new Error("Queue not initialized");
  }
}

/**
 * Process the clip and upload the result to Google Drive or local disk.
 */
async function processAndUpload(
  input: ClipJobInput,
  progressCb: (pct: number) => void
): Promise<ClipJobResult & UploadResult> {
  const result = await processClipJob(input, progressCb);

  // Build a human-readable filename
  const fileName = buildClipFileName(input.clipId, result.durationSec);

  // Upload to Google Drive (organized by channel/stream) or local
  const upload = await uploadClip(
    result.outputPath,
    fileName,
    input.channelName ?? "Unknown Channel",
    input.streamTitle ?? "Untitled Stream"
  );

  // Cleanup temp files
  try {
    const tempDir = dirname(result.outputPath);
    await rm(tempDir, { recursive: true, force: true });
  } catch (err) {
    log.warn({ err }, "Failed to clean up temp files");
  }

  return { ...result, ...upload };
}

/**
 * Get the queue size.
 */
export async function getQueueSize(): Promise<number> {
  if (bullQueue) {
    const counts = await bullQueue.getJobCounts();
    return (counts.waiting ?? 0) + (counts.active ?? 0);
  }
  if (memoryQueue) {
    return memoryQueue.size + memoryQueue.pending;
  }
  return 0;
}

/**
 * Shut down the queue gracefully.
 */
export async function shutdownQueue(): Promise<void> {
  if (bullWorker) {
    await bullWorker.close();
  }
  if (bullQueue) {
    await bullQueue.close();
  }
  if (memoryQueue) {
    memoryQueue.clear();
  }
  log.info("Queue shut down");
}
