// ── Output layout config ─────────────────────────────
export const DEFAULT_OUTPUT_WIDTH = 1080;
export const DEFAULT_OUTPUT_HEIGHT = 1920;
export const DEFAULT_CONTENT_HEIGHT = 1344;
export const DEFAULT_WEBCAM_HEIGHT = 576;
export const DEFAULT_CROP_CONFIG = {
    // Full video frame by default (fits into 9:16 with zero zoom)
    content: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
    // Free-size webcam crop placed in top-right corner by default
    webcam: { x: 0.72, y: 0.05, w: 0.25, h: 0.30 },
    webcamLockRatio: false,
    contentMode: "fit",
    contentHeight: DEFAULT_CONTENT_HEIGHT,
    webcamHeight: DEFAULT_WEBCAM_HEIGHT,
};
// ── Clip durations available in the UI ───────────────
export const CLIP_DURATIONS = [10, 20, 30, 60];
//# sourceMappingURL=types.js.map