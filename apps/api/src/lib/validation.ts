import { z } from "zod";

export const createStreamSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (url) => {
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
      },
      { message: "Must be a valid YouTube URL" }
    ),
});

const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

export const cropConfigSchema = z.object({
  content: normalizedRectSchema,
  webcam: normalizedRectSchema,
  webcamLockRatio: z.boolean(),
  contentHeight: z.number().int().min(100).max(1800).default(1344),
  webcamHeight: z.number().int().min(100).max(1800).default(576),
});

export const updateCropSchema = z.object({
  config: cropConfigSchema,
});

export const clipRequestSchema = z.object({
  seconds: z.number().int().min(5).max(120),
});

export const createPresetSchema = z.object({
  name: z.string().min(1).max(100),
  channelId: z.string().optional(),
  config: cropConfigSchema,
});
