import type { NormalizedRect, PixelRect } from "./types.js";

/**
 * Force a number to the nearest even integer (required by most video codecs).
 */
export function toEven(n: number): number {
  const rounded = Math.round(n);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

/**
 * Clamp a value between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Validate a NormalizedRect: all values must be in [0, 1] and the rect
 * must not extend beyond the frame.
 */
export function validateNormalizedRect(rect: NormalizedRect): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (rect.x < 0 || rect.x > 1) errors.push(`x=${rect.x} out of [0,1]`);
  if (rect.y < 0 || rect.y > 1) errors.push(`y=${rect.y} out of [0,1]`);
  if (rect.w <= 0 || rect.w > 1) errors.push(`w=${rect.w} out of (0,1]`);
  if (rect.h <= 0 || rect.h > 1) errors.push(`h=${rect.h} out of (0,1]`);
  if (rect.x + rect.w > 1.0001)
    errors.push(`x+w=${rect.x + rect.w} exceeds 1`);
  if (rect.y + rect.h > 1.0001)
    errors.push(`y+h=${rect.y + rect.h} exceeds 1`);

  return { valid: errors.length === 0, errors };
}

/**
 * Convert a NormalizedRect to pixel coordinates for a given source resolution.
 * All values are clamped and forced to even numbers.
 */
export function normalizedToPixel(
  rect: NormalizedRect,
  sourceWidth: number,
  sourceHeight: number
): PixelRect {
  const rawX = rect.x * sourceWidth;
  const rawY = rect.y * sourceHeight;
  const rawW = rect.w * sourceWidth;
  const rawH = rect.h * sourceHeight;

  // Clamp so crop doesn't exceed source dimensions
  let x = toEven(clamp(rawX, 0, sourceWidth - 2));
  let y = toEven(clamp(rawY, 0, sourceHeight - 2));
  let w = toEven(clamp(rawW, 2, sourceWidth - x));
  let h = toEven(clamp(rawH, 2, sourceHeight - y));

  // Final safety: ensure x+w and y+h don't exceed source
  if (x + w > sourceWidth) {
    w = toEven(sourceWidth - x);
  }
  if (y + h > sourceHeight) {
    h = toEven(sourceHeight - y);
  }

  return { x, y, w, h };
}

/**
 * Convert a PixelRect back to normalized coordinates.
 */
export function pixelToNormalized(
  rect: PixelRect,
  sourceWidth: number,
  sourceHeight: number
): NormalizedRect {
  return {
    x: clamp(rect.x / sourceWidth, 0, 1),
    y: clamp(rect.y / sourceHeight, 0, 1),
    w: clamp(rect.w / sourceWidth, 0, 1),
    h: clamp(rect.h / sourceHeight, 0, 1),
  };
}

/**
 * Constrain a NormalizedRect to a 9:16 aspect ratio (width:height).
 * Keeps the center point and adjusts width or height to match the ratio.
 * Mode "fit" shrinks the larger dimension; "fill" grows the smaller one.
 */
export function constrainTo9x16(
  rect: NormalizedRect,
  sourceWidth: number,
  sourceHeight: number,
  mode: "fit" | "fill" = "fit"
): NormalizedRect {
  const targetRatio = 9 / 16; // w/h in pixel space

  // Convert to pixel space to reason about aspect ratio
  const pxW = rect.w * sourceWidth;
  const pxH = rect.h * sourceHeight;
  const currentRatio = pxW / pxH;

  let newW: number;
  let newH: number;

  if (mode === "fit") {
    if (currentRatio > targetRatio) {
      // Too wide, shrink width
      newH = pxH;
      newW = pxH * targetRatio;
    } else {
      // Too tall, shrink height
      newW = pxW;
      newH = pxW / targetRatio;
    }
  } else {
    if (currentRatio > targetRatio) {
      // Too wide, grow height
      newW = pxW;
      newH = pxW / targetRatio;
    } else {
      // Too tall, grow width
      newH = pxH;
      newW = pxH * targetRatio;
    }
  }

  // Center within the original rect
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;

  let normW = newW / sourceWidth;
  let normH = newH / sourceHeight;
  let normX = cx - normW / 2;
  let normY = cy - normH / 2;

  // Clamp to [0, 1]
  if (normX < 0) normX = 0;
  if (normY < 0) normY = 0;
  if (normX + normW > 1) normX = 1 - normW;
  if (normY + normH > 1) normY = 1 - normH;

  // Final clamp for safety
  normX = clamp(normX, 0, 1);
  normY = clamp(normY, 0, 1);
  normW = clamp(normW, 0, 1 - normX);
  normH = clamp(normH, 0, 1 - normY);

  return { x: normX, y: normY, w: normW, h: normH };
}

/**
 * Build the ffmpeg filter_complex string for the crop-and-stack pipeline.
 *
 * Returns the filter_complex value and the output layout used.
 */
export function buildFilterComplex(opts: {
  content: PixelRect;
  webcam: PixelRect;
  outputWidth?: number;
  contentHeight?: number;
  webcamHeight?: number;
}): {
  filterComplex: string;
  outputWidth: number;
  outputHeight: number;
} {
  const outputWidth = opts.outputWidth ?? 1080;
  const contentHeight = opts.contentHeight ?? 1344;
  const webcamHeight = opts.webcamHeight ?? 576;
  const outputHeight = contentHeight + webcamHeight;

  const { content: g, webcam: c } = opts;

  const filterComplex = [
    `[0:v]crop=${g.w}:${g.h}:${g.x}:${g.y},scale=${outputWidth}:${contentHeight}:force_original_aspect_ratio=disable[g]`,
    `[0:v]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${outputWidth}:${webcamHeight}:force_original_aspect_ratio=disable[c]`,
    `[g][c]vstack=inputs=2[v]`,
  ].join(";");

  return { filterComplex, outputWidth, outputHeight };
}

/**
 * Build the full ffmpeg args for a clip re-encode job.
 */
export function buildClipFfmpegArgs(opts: {
  inputPath: string;
  outputPath: string;
  content: PixelRect;
  webcam: PixelRect;
  encoder: string;
  outputWidth?: number;
  contentHeight?: number;
  webcamHeight?: number;
}): string[] {
  const { filterComplex } = buildFilterComplex(opts);

  const args = [
    "-i",
    opts.inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[v]",
    "-map",
    "0:a?",
  ];

  // Encoder-specific args
  switch (opts.encoder) {
    case "h264_nvenc":
      args.push("-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "23");
      break;
    case "h264_qsv":
      args.push("-c:v", "h264_qsv", "-preset", "faster", "-global_quality", "23");
      break;
    case "h264_videotoolbox":
      args.push("-c:v", "h264_videotoolbox", "-q:v", "60");
      break;
    case "libx264":
    default:
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23");
      break;
  }

  args.push(
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-y",
    opts.outputPath
  );

  return args;
}

/**
 * Build the full ffmpeg args for multi-clip export in a single pass:
 * 1. Content 9:16 vertical video (1080x1920)
 * 2. Webcam video (free-size, scaled to 1080 width with even height)
 * 3. Stacked vertical video (1080x1920 combo)
 */
export function buildMultiClipFfmpegArgs(opts: {
  inputPath: string;
  contentOutputPath: string;
  webcamOutputPath: string;
  stackedOutputPath?: string;
  content: PixelRect;
  webcam: PixelRect;
  encoder: string;
  contentMode?: "fit" | "fill";
  contentHeight?: number;
  webcamHeight?: number;
  sourceWidth?: number;
  sourceHeight?: number;
}): string[] {
  const g = opts.content;
  const c = opts.webcam;
  const mode = opts.contentMode ?? "fit";
  const contentHeight = opts.contentHeight ?? 1344;
  const webcamHeight = opts.webcamHeight ?? 576;

  // Determine if content is full-frame (no crop needed)
  const isFullFrame =
    g.x <= 4 &&
    g.y <= 4 &&
    (!opts.sourceWidth || g.w >= opts.sourceWidth - 8) &&
    (!opts.sourceHeight || g.h >= opts.sourceHeight - 8);

  // In "fit" mode: scale to fit 1080x1920 without ANY zoom/cropping, pad with black
  // In "fill" mode: scale to fill 1080x1920
  const contentFilterStr =
    mode === "fill"
      ? `crop=${g.w}:${g.h}:${g.x}:${g.y},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`
      : isFullFrame
      ? `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`
      : `crop=${g.w}:${g.h}:${g.x}:${g.y},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`;

  const filters: string[] = [
    // 1. Content 9:16 vertical social media video (1080x1920, Unzoomed Fit)
    `[0:v]${contentFilterStr}[v_content]`,
    // 2. Webcam free-size clip (scaled to 1080 width, proportional even height)
    `[0:v]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=1080:-2:force_original_aspect_ratio=disable[v_webcam]`,
  ];

  if (opts.stackedOutputPath) {
    const stackContentFilter = isFullFrame
      ? `scale=1080:${contentHeight}:force_original_aspect_ratio=decrease,pad=1080:${contentHeight}:(ow-iw)/2:(oh-ih)/2:black`
      : `crop=${g.w}:${g.h}:${g.x}:${g.y},scale=1080:${contentHeight}:force_original_aspect_ratio=decrease,pad=1080:${contentHeight}:(ow-iw)/2:(oh-ih)/2:black`;

    filters.push(
      `[0:v]${stackContentFilter}[g_stack]`,
      `[0:v]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=1080:${webcamHeight}:force_original_aspect_ratio=decrease,pad=1080:${webcamHeight}:(ow-iw)/2:(oh-ih)/2:black[c_stack]`,
      `[g_stack][c_stack]vstack=inputs=2[v_stacked]`
    );
  }

  const args: string[] = [
    "-i",
    opts.inputPath,
    "-filter_complex",
    filters.join(";"),
  ];

  const getEncoderArgs = (enc: string): string[] => {
    switch (enc) {
      case "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "23"];
      case "h264_qsv":
        return ["-c:v", "h264_qsv", "-preset", "faster", "-global_quality", "23"];
      case "h264_videotoolbox":
        return ["-c:v", "h264_videotoolbox", "-q:v", "60"];
      case "libx264":
      default:
        return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"];
    }
  };

  const encArgs = getEncoderArgs(opts.encoder);

  // Map 1: Content 9:16 Video
  args.push(
    "-map", "[v_content]",
    "-map", "0:a?",
    ...encArgs,
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y",
    opts.contentOutputPath
  );

  // Map 2: Webcam Free-size Video
  args.push(
    "-map", "[v_webcam]",
    "-map", "0:a?",
    ...encArgs,
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y",
    opts.webcamOutputPath
  );

  // Map 3: Stacked Video (if provided)
  if (opts.stackedOutputPath) {
    args.push(
      "-map", "[v_stacked]",
      "-map", "0:a?",
      ...encArgs,
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-y",
      opts.stackedOutputPath
    );
  }

  return args;
}
