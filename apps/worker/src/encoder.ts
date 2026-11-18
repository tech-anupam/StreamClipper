import { execa } from "execa";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { HwEncoder } from "@streamclipper/shared";

const log = logger.child({ module: "encoder" });

let cachedEncoder: HwEncoder | null = null;

/**
 * Auto-detect the best available H.264 encoder.
 * Order: h264_nvenc -> h264_qsv -> h264_videotoolbox -> libx264
 */
export async function detectEncoder(): Promise<HwEncoder> {
  if (cachedEncoder) return cachedEncoder;

  const candidates: HwEncoder[] = [
    "h264_nvenc",
    "h264_qsv",
    "h264_videotoolbox",
    "libx264",
  ];

  for (const encoder of candidates) {
    if (await testEncoder(encoder)) {
      log.info({ encoder }, "Selected encoder");
      cachedEncoder = encoder;
      return encoder;
    }
  }

  // libx264 should always work
  log.warn("No hardware encoder found, using libx264");
  cachedEncoder = "libx264";
  return "libx264";
}

async function testEncoder(encoder: string): Promise<boolean> {
  try {
    await execa(config.FFMPEG_PATH, [
      "-f",
      "lavfi",
      "-i",
      "nullsrc=s=256x256:d=1",
      "-c:v",
      encoder,
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ]);
    return true;
  } catch {
    return false;
  }
}
