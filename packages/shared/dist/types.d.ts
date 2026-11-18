export type StreamStatus = "idle" | "resolving" | "buffering" | "error" | "stopped";
export type ClipStatus = "queued" | "processing" | "uploading" | "done" | "failed";
export type JobState = "pending" | "active" | "completed" | "failed";
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
export interface PixelRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
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
export interface CropPreset {
    id: string;
    name: string;
    channelId?: string;
    config: CropConfig;
}
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
export interface Job {
    id: string;
    clipId: string;
    state: JobState;
    progress: number;
    error: string | null;
}
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
export type WorkerEventType = "stream:status" | "stream:health" | "clip:progress" | "clip:done" | "clip:error";
export interface WorkerEvent {
    type: WorkerEventType;
    streamId?: string;
    clipId?: string;
    jobId?: string;
    data: Record<string, unknown>;
    timestamp: number;
}
export interface BufferHealth {
    streamId: string;
    segmentCount: number;
    oldestSegmentAge: number;
    newestSegmentAge: number;
    totalSizeBytes: number;
    healthy: boolean;
}
export type HwEncoder = "h264_nvenc" | "h264_qsv" | "h264_videotoolbox" | "libx264";
export declare const DEFAULT_OUTPUT_WIDTH = 1080;
export declare const DEFAULT_OUTPUT_HEIGHT = 1920;
export declare const DEFAULT_CONTENT_HEIGHT = 1344;
export declare const DEFAULT_WEBCAM_HEIGHT = 576;
export declare const DEFAULT_CROP_CONFIG: CropConfig;
export declare const CLIP_DURATIONS: readonly [10, 20, 30, 60];
export type ClipDuration = (typeof CLIP_DURATIONS)[number];
//# sourceMappingURL=types.d.ts.map