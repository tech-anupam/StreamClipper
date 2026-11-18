import type { NormalizedRect, PixelRect } from "./types.js";
/**
 * Force a number to the nearest even integer (required by most video codecs).
 */
export declare function toEven(n: number): number;
/**
 * Clamp a value between min and max (inclusive).
 */
export declare function clamp(value: number, min: number, max: number): number;
/**
 * Validate a NormalizedRect: all values must be in [0, 1] and the rect
 * must not extend beyond the frame.
 */
export declare function validateNormalizedRect(rect: NormalizedRect): {
    valid: boolean;
    errors: string[];
};
/**
 * Convert a NormalizedRect to pixel coordinates for a given source resolution.
 * All values are clamped and forced to even numbers.
 */
export declare function normalizedToPixel(rect: NormalizedRect, sourceWidth: number, sourceHeight: number): PixelRect;
/**
 * Convert a PixelRect back to normalized coordinates.
 */
export declare function pixelToNormalized(rect: PixelRect, sourceWidth: number, sourceHeight: number): NormalizedRect;
/**
 * Constrain a NormalizedRect to a 9:16 aspect ratio (width:height).
 * Keeps the center point and adjusts width or height to match the ratio.
 * Mode "fit" shrinks the larger dimension; "fill" grows the smaller one.
 */
export declare function constrainTo9x16(rect: NormalizedRect, sourceWidth: number, sourceHeight: number, mode?: "fit" | "fill"): NormalizedRect;
/**
 * Build the ffmpeg filter_complex string for the crop-and-stack pipeline.
 *
 * Returns the filter_complex value and the output layout used.
 */
export declare function buildFilterComplex(opts: {
    content: PixelRect;
    webcam: PixelRect;
    outputWidth?: number;
    contentHeight?: number;
    webcamHeight?: number;
}): {
    filterComplex: string;
    outputWidth: number;
    outputHeight: number;
};
/**
 * Build the full ffmpeg args for a clip re-encode job.
 */
export declare function buildClipFfmpegArgs(opts: {
    inputPath: string;
    outputPath: string;
    content: PixelRect;
    webcam: PixelRect;
    encoder: string;
    outputWidth?: number;
    contentHeight?: number;
    webcamHeight?: number;
}): string[];
/**
 * Build the full ffmpeg args for multi-clip export in a single pass:
 * 1. Content 9:16 vertical video (1080x1920)
 * 2. Webcam video (free-size, scaled to 1080 width with even height)
 * 3. Stacked vertical video (1080x1920 combo)
 */
export declare function buildMultiClipFfmpegArgs(opts: {
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
}): string[];
//# sourceMappingURL=crop-math.d.ts.map