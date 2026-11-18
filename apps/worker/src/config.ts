import { config as dotenvConfig } from "dotenv";
import { z } from "zod";
import { resolve } from "node:path";
import os from "node:os";
import { resolveBinary } from "./binaries.js";

// Load .env from project root or parent directories
dotenvConfig({ path: resolve(process.cwd(), ".env") });
dotenvConfig({ path: resolve(process.cwd(), "../../.env") });
dotenvConfig({ path: resolve(import.meta.dirname, "../../../.env") });
dotenvConfig({ path: resolve(import.meta.dirname, "../../.env") });

const envSchema = z.object({
  WORKER_TOKEN: z.string().default("default_local_worker_token_change_in_production"),
  WORKER_API_URL: z.string().url().default("http://localhost:8787"),
  WORKER_PORT: z.coerce.number().default(9090),

  REDIS_URL: z.string().optional(),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  STREAMLINK_PATH: z.string().default("streamlink"),
  YT_DLP_PATH: z.string().default("yt-dlp"),

  // Storage
  STORAGE_MODE: z.enum(["gdrive", "local"]).default("local"),
  LOCAL_CLIPS_DIR: z.string().default("./clips"),

  // Google Drive OAuth2
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GDRIVE_ROOT_FOLDER: z.string().default("StreamClipper"),

  // Limits
  MAX_STREAMS_PER_USER: z.coerce.number().default(5),
  MAX_CLIP_SECONDS: z.coerce.number().default(120),
  BUFFER_SECONDS: z.coerce.number().default(600),
  BUFFER_DISK_CAP_MB: z.coerce.number().default(2048),
  CLIP_TTL_DAYS: z.coerce.number().default(7),
  RENDER_CONCURRENCY: z.coerce.number().default(0),

  BUFFER_DIR: z.string().default("./buffers"),
  TEMP_DIR: z.string().default("./tmp"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid worker environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Validate Google Drive credentials when storage mode is gdrive
if (parsed.data.STORAGE_MODE === "gdrive") {
  if (
    !parsed.data.GOOGLE_CLIENT_ID ||
    !parsed.data.GOOGLE_CLIENT_SECRET ||
    !parsed.data.GOOGLE_REFRESH_TOKEN
  ) {
    console.error(
      "STORAGE_MODE=gdrive requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env"
    );
    process.exit(1);
  }
}

export const config = {
  ...parsed.data,
  // Normalize directories to project root
  BUFFER_DIR: resolve(import.meta.dirname, "../../../buffers"),
  TEMP_DIR: resolve(import.meta.dirname, "../../../tmp"),
  LOCAL_CLIPS_DIR: resolve(import.meta.dirname, "../../../clips"),
  // Automatically resolve full executable paths
  FFMPEG_PATH: resolveBinary("ffmpeg", parsed.data.FFMPEG_PATH),
  FFPROBE_PATH: resolveBinary("ffprobe", parsed.data.FFPROBE_PATH),
  STREAMLINK_PATH: resolveBinary("streamlink", parsed.data.STREAMLINK_PATH),
  YT_DLP_PATH: resolveBinary("yt-dlp", parsed.data.YT_DLP_PATH),
  RENDER_CONCURRENCY:
    parsed.data.RENDER_CONCURRENCY > 0
      ? parsed.data.RENDER_CONCURRENCY
      : Math.max(1, os.cpus().length - 1),
};

export type Config = typeof config;
