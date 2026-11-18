// ── Stream status ─────────────────────────────────────
export type StreamStatus =
  | "idle"
  | "resolving"
  | "buffering"
  | "error"
  | "stopped";

// ── Clip status ───────────────────────────────────────
export type ClipStatus =
  | "queued"
  | "processing"
  | "uploading"
  | "done"
  | "failed";

// ── Job state ─────────────────────────────────────────
export type JobState =
  | "pending"
  | "active"
  | "completed"
  | "failed";

// ── Normalized crop rect (0-1 coords) ────────────────
export interface NormalizedRect {
  /** Left edge, 0-1 */
  x: number;
  /** Top edge, 0-1 */
  y: number;
  /** Width, 0-1 */
  w: number;
  /** Height, 0-1 */
  h: number;
}

// ── Pixel crop rect ──────────────────────────────────
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Crop config (stored per stream) ──────────────────
export interface CropConfig {
  content: NormalizedRect;
  webcam: NormalizedRect;
  webcamLockRatio: boolean;
  /** Content scaling mode: "fit" (no zoom, preserve aspect ratio) or "fill" (crop to fill) */
  contentMode?: "fit" | "fill";
  /** Content height in output (px), default 1344 */
  contentHeight: number;
  /** Webcam height in output (px), default 576 */
  webcamHeight: number;
}

// ── Preset ───────────────────────────────────────────
export interface CropPreset {
  id: string;
  name: string;
  channelId?: string;
  config: CropConfig;
}

// ── Stream ───────────────────────────────────────────
export interface Stream {
  id: string;
  userId: string;
  url: string;
  title: string;
  channelName: string;
  channelId: string;
  status: StreamStatus;
  cropConfig: CropConfig | null;
  bufferSeconds: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
  createdAt: string;
  updatedAt: string;
}

// ── Clip ─────────────────────────────────────────────
export interface Clip {
  id: string;
  streamId: string;
  startTs: number;
  endTs: number;
  durationSec: number;
  /** Google Drive file ID (when STORAGE_MODE=gdrive) */
  gdriveFileId: string | null;
  /** Google Drive web view link */
  gdriveWebLink: string | null;
  /** Local filesystem path (when STORAGE_MODE=local) */
  localPath: string | null;
  sizeBytes: number | null;
  status: ClipStatus;
  createdAt: string;
}

// ── Job ──────────────────────────────────────────────
export interface Job {
  id: string;
  clipId: string;
  state: JobState;
  progress: number;
  error: string | null;
}

// ── API request/response types ───────────────────────
export interface CreateStreamRequest {
  url: string;
}

export interface CreateStreamResponse {
  stream: Stream;
}

export interface UpdateCropRequest {
  config: CropConfig;
}

export interface ClipRequest {
  seconds: number;
}

export interface ClipResponse {
  clip: Clip;
  job: Job;
}

export interface StreamFrameResponse {
  /** Base64-encoded JPEG frame */
  frame: string;
  width: number;
  height: number;
}

// ── Worker <-> API messages (WebSocket/SSE) ──────────
export type WorkerEventType =
  | "stream:status"
  | "stream:health"
  | "clip:progress"
  | "clip:done"
  | "clip:error";

export interface WorkerEvent {
  type: WorkerEventType;
  streamId?: string;
  clipId?: string;
  jobId?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

// ── Buffer health ────────────────────────────────────
export interface BufferHealth {
  streamId: string;
  segmentCount: number;
  oldestSegmentAge: number;
  newestSegmentAge: number;
  totalSizeBytes: number;
  healthy: boolean;
}

// ── Encoder detection result ─────────────────────────
export type HwEncoder =
  | "h264_nvenc"
  | "h264_qsv"
  | "h264_videotoolbox"
  | "libx264";

// ── Output layout config ─────────────────────────────
export const DEFAULT_OUTPUT_WIDTH = 1080;
export const DEFAULT_OUTPUT_HEIGHT = 1920;
export const DEFAULT_CONTENT_HEIGHT = 1344;
export const DEFAULT_WEBCAM_HEIGHT = 576;

export const DEFAULT_CROP_CONFIG: CropConfig = {
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
export const CLIP_DURATIONS = [10, 20, 30, 60] as const;
export type ClipDuration = (typeof CLIP_DURATIONS)[number];
