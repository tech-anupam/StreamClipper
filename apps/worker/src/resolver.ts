import { execa } from "execa";
import { config } from "./config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "resolver" });

interface ResolveResult {
  hlsUrl: string;
  title: string;
  channelName: string;
  channelId: string;
  quality: string;
}

/**
 * Resolve a YouTube live stream URL to an HLS manifest URL.
 * Tries yt-dlp first (most reliable on YouTube), falls back to streamlink.
 */
export async function resolveStream(
  url: string,
  retries = 3,
  backoffMs = 1500
): Promise<ResolveResult> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retries; attempt++) {
    // 1. Try yt-dlp first
    try {
      return await resolveWithYtDlp(url);
    } catch (err) {
      lastError = err as Error;
      log.debug({ attempt, err }, "yt-dlp attempt failed, trying streamlink");
    }

    // 2. Try streamlink fallback
    try {
      return await resolveWithStreamlink(url);
    } catch (err2) {
      lastError = err2 as Error;
      log.debug({ attempt, err: err2 }, "streamlink attempt also failed");
    }

    if (attempt < retries) {
      const delay = backoffMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw new Error(
    `Failed to resolve live stream after ${retries} attempts: ${lastError?.message}`
  );
}

async function resolveWithYtDlp(url: string): Promise<ResolveResult> {
  const { stdout } = await execa(
    config.YT_DLP_PATH,
    [
      "-j",
      "--no-download",
      "--no-warnings",
      url,
    ],
    {
      reject: true,
      timeout: 20000,
    }
  );

  const info = JSON.parse(stdout);

  // Find the HLS manifest URL
  let hlsUrl = "";
  if (info.manifest_url) {
    hlsUrl = info.manifest_url;
  } else if (info.url && (info.url.includes(".m3u8") || info.protocol?.includes("m3u8"))) {
    hlsUrl = info.url;
  } else if (info.formats && Array.isArray(info.formats)) {
    // Look for format with manifest_url or m3u8 protocol
    for (const f of info.formats) {
      if (f.manifest_url) {
        hlsUrl = f.manifest_url;
        break;
      }
    }

    if (!hlsUrl) {
      const hlsFormat = info.formats
        .filter(
          (f: Record<string, unknown>) =>
            f.protocol === "m3u8" || f.protocol === "m3u8_native" || (typeof f.url === "string" && f.url.includes(".m3u8"))
        )
        .sort(
          (a: Record<string, unknown>, b: Record<string, unknown>) =>
            ((b.height as number) ?? 0) - ((a.height as number) ?? 0)
        )[0];

      if (hlsFormat) {
        hlsUrl = (hlsFormat.manifest_url ?? hlsFormat.url) as string;
      }
    }
  }

  if (!hlsUrl) {
    throw new Error("No live HLS manifest found. Ensure the stream is currently LIVE.");
  }

  return {
    hlsUrl,
    title: info.title ?? "Live Stream",
    channelName: info.channel ?? info.uploader ?? "Live Channel",
    channelId: info.channel_id ?? info.uploader_id ?? "",
    quality: `${info.height ?? "1080"}p`,
  };
}

async function resolveWithStreamlink(url: string): Promise<ResolveResult> {
  const { stdout: streamUrl } = await execa(
    config.STREAMLINK_PATH,
    [url, "best", "--stream-url"],
    { timeout: 15000 }
  );

  let title = "Live Stream";
  let channelName = "Live Channel";
  let channelId = "";

  try {
    const { stdout: infoJson } = await execa(
      config.STREAMLINK_PATH,
      [url, "--json"],
      { timeout: 10000 }
    );
    const info = JSON.parse(infoJson);
    title = info.metadata?.title ?? title;
    channelName = info.metadata?.author ?? channelName;
    channelId = info.metadata?.channel ?? channelId;
  } catch {
    // Info extraction is optional
  }

  return {
    hlsUrl: streamUrl.trim(),
    title,
    channelName,
    channelId,
    quality: "best",
  };
}

/**
 * Validate that a URL looks like a YouTube stream URL.
 */
export function isValidYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "youtu.be" ||
      parsed.hostname === "m.youtube.com"
    );
  } catch {
    return false;
  }
}

/**
 * Probe a stream to get its resolution.
 */
export async function probeResolution(
  hlsUrl: string
): Promise<{ width: number; height: number }> {
  const { stdout } = await execa(
    config.FFPROBE_PATH,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      hlsUrl,
    ],
    { timeout: 15000 }
  );

  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];

  if (!stream?.width || !stream?.height) {
    // Default fallback to 1920x1080
    return { width: 1920, height: 1080 };
  }

  return { width: stream.width, height: stream.height };
}

/**
 * Grab a single frame from the stream as a JPEG buffer.
 */
export async function grabFrame(hlsUrl: string): Promise<Buffer> {
  const { stdout } = await execa(
    config.FFMPEG_PATH,
    [
      "-i",
      hlsUrl,
      "-vframes",
      "1",
      "-f",
      "image2",
      "-c:v",
      "mjpeg",
      "-q:v",
      "2",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 15000 }
  );

  return Buffer.from(stdout);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
