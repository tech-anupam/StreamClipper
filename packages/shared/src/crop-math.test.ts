import { describe, it, expect } from "vitest";
import {
  toEven,
  clamp,
  validateNormalizedRect,
  normalizedToPixel,
  pixelToNormalized,
  constrainTo9x16,
  buildFilterComplex,
  buildMultiClipFfmpegArgs,
} from "./crop-math.js";
import type { NormalizedRect } from "./types.js";

describe("toEven", () => {
  it("returns even numbers unchanged", () => {
    expect(toEven(100)).toBe(100);
    expect(toEven(0)).toBe(0);
  });

  it("rounds odd numbers down to even", () => {
    expect(toEven(101)).toBe(100);
    expect(toEven(99)).toBe(98);
  });

  it("rounds fractional numbers to nearest even", () => {
    expect(toEven(100.6)).toBe(100);
    expect(toEven(101.6)).toBe(102);
    expect(toEven(99.5)).toBe(100);
  });
});

describe("clamp", () => {
  it("clamps below min", () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it("passes through values in range", () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
});

describe("validateNormalizedRect", () => {
  it("accepts a valid rect", () => {
    const result = validateNormalizedRect({ x: 0, y: 0, w: 1, h: 1 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects negative x", () => {
    const result = validateNormalizedRect({ x: -0.1, y: 0, w: 0.5, h: 0.5 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects rect extending beyond 1", () => {
    const result = validateNormalizedRect({ x: 0.6, y: 0, w: 0.5, h: 0.5 });
    expect(result.valid).toBe(false);
  });

  it("rejects zero width", () => {
    const result = validateNormalizedRect({ x: 0, y: 0, w: 0, h: 0.5 });
    expect(result.valid).toBe(false);
  });
});

describe("normalizedToPixel", () => {
  it("converts full-frame rect to source dimensions", () => {
    const pixel = normalizedToPixel({ x: 0, y: 0, w: 1, h: 1 }, 1920, 1080);
    expect(pixel).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("produces even numbers", () => {
    const pixel = normalizedToPixel(
      { x: 0.11, y: 0.13, w: 0.33, h: 0.37 },
      1920,
      1080
    );
    expect(pixel.x % 2).toBe(0);
    expect(pixel.y % 2).toBe(0);
    expect(pixel.w % 2).toBe(0);
    expect(pixel.h % 2).toBe(0);
  });

  it("clamps to source dimensions", () => {
    const pixel = normalizedToPixel(
      { x: 0.9, y: 0.9, w: 0.5, h: 0.5 },
      1920,
      1080
    );
    expect(pixel.x + pixel.w).toBeLessThanOrEqual(1920);
    expect(pixel.y + pixel.h).toBeLessThanOrEqual(1080);
  });

  it("handles typical 1920x1080 content crop", () => {
    // Center 80% of the frame
    const pixel = normalizedToPixel(
      { x: 0.1, y: 0.05, w: 0.8, h: 0.9 },
      1920,
      1080
    );
    expect(pixel.x).toBe(192);
    expect(pixel.y).toBe(54);
    expect(pixel.w).toBe(1536);
    expect(pixel.h).toBe(972);
  });

  it("minimum crop is 2x2", () => {
    const pixel = normalizedToPixel(
      { x: 0, y: 0, w: 0.001, h: 0.001 },
      1920,
      1080
    );
    expect(pixel.w).toBeGreaterThanOrEqual(2);
    expect(pixel.h).toBeGreaterThanOrEqual(2);
  });
});

describe("pixelToNormalized", () => {
  it("roundtrips a full-frame rect", () => {
    const norm = pixelToNormalized(
      { x: 0, y: 0, w: 1920, h: 1080 },
      1920,
      1080
    );
    expect(norm.x).toBeCloseTo(0);
    expect(norm.y).toBeCloseTo(0);
    expect(norm.w).toBeCloseTo(1);
    expect(norm.h).toBeCloseTo(1);
  });

  it("roundtrips a partial rect (within even-number tolerance)", () => {
    const original: NormalizedRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const pixel = normalizedToPixel(original, 1920, 1080);
    const back = pixelToNormalized(pixel, 1920, 1080);
    expect(back.x).toBeCloseTo(original.x, 2);
    expect(back.y).toBeCloseTo(original.y, 2);
    expect(back.w).toBeCloseTo(original.w, 2);
    expect(back.h).toBeCloseTo(original.h, 2);
  });
});

describe("constrainTo9x16", () => {
  it("constrains a square rect to 9:16 (fit mode)", () => {
    // Square in pixel space for a 1920x1080 source
    const result = constrainTo9x16(
      { x: 0.25, y: 0.1, w: 0.5, h: 0.5 },
      1920,
      1080,
      "fit"
    );
    // The pixel ratio should be ~9/16
    const pxW = result.w * 1920;
    const pxH = result.h * 1080;
    expect(pxW / pxH).toBeCloseTo(9 / 16, 1);
  });

  it("keeps rect within bounds", () => {
    const result = constrainTo9x16(
      { x: 0, y: 0, w: 1, h: 1 },
      1920,
      1080,
      "fit"
    );
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + result.w).toBeLessThanOrEqual(1.001);
    expect(result.y + result.h).toBeLessThanOrEqual(1.001);
  });
});

describe("buildFilterComplex", () => {
  it("produces a valid filter string", () => {
    const { filterComplex, outputWidth, outputHeight } = buildFilterComplex({
      content: { x: 192, y: 54, w: 1536, h: 972 },
      webcam: { x: 0, y: 810, w: 480, h: 270 },
    });

    expect(filterComplex).toContain("crop=1536:972:192:54");
    expect(filterComplex).toContain("crop=480:270:0:810");
    expect(filterComplex).toContain("scale=1080:1344");
    expect(filterComplex).toContain("scale=1080:576");
    expect(filterComplex).toContain("vstack=inputs=2");
    expect(outputWidth).toBe(1080);
    expect(outputHeight).toBe(1920);
  });

  it("respects custom layout sizes", () => {
    const { filterComplex, outputHeight } = buildFilterComplex({
      content: { x: 0, y: 0, w: 1920, h: 1080 },
      webcam: { x: 0, y: 0, w: 480, h: 270 },
      outputWidth: 720,
      contentHeight: 896,
      webcamHeight: 384,
    });

    expect(filterComplex).toContain("scale=720:896");
    expect(filterComplex).toContain("scale=720:384");
    expect(outputHeight).toBe(1280);
  });
});

describe("buildMultiClipFfmpegArgs", () => {
  it("builds multi-output args for both 9:16 center video and webcam clip", () => {
    const args = buildMultiClipFfmpegArgs({
      inputPath: "input.ts",
      contentOutputPath: "content.mp4",
      webcamOutputPath: "webcam.mp4",
      stackedOutputPath: "stacked.mp4",
      content: { x: 656, y: 0, w: 608, h: 1080 },
      webcam: { x: 1400, y: 50, w: 400, h: 300 },
      encoder: "libx264",
    });

    const cmd = args.join(" ");
    expect(cmd).toContain("crop=608:1080:656:0,scale=1080:1920");
    expect(cmd).toContain("crop=400:300:1400:50,scale=1080:-2");
    expect(cmd).toContain("content.mp4");
    expect(cmd).toContain("webcam.mp4");
    expect(cmd).toContain("stacked.mp4");
  });
});
