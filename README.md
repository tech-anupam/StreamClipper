# StreamClipper

Paste a YouTube live URL, define a 9:16 content crop and a webcam crop on a preview frame, then continuously buffer the stream and cut fast clips on demand. Clips are saved to **Google Drive** (organized by channel/stream) or local disk.

> Only clip streams you own or have permission to clip.

## Architecture

```
apps/
  web/       React 19 + Vite + TailwindCSS v4 + react-konva
  api/       Hono.js on Cloudflare Workers
  worker/    Node.js service (ffmpeg + streamlink)
packages/
  shared/    Types, crop math (unit-tested)
```

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- **ffmpeg** and **ffprobe** on PATH
- **streamlink** on PATH (fallback: yt-dlp)
- **Redis** (optional — falls back to in-memory queue)
- **Google Drive OAuth2 credentials** (for clip storage)

### Google Drive Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project, enable the **Google Drive API**
3. Create OAuth 2.0 credentials (Desktop App type)
4. Use the OAuth playground or a script to get a **refresh token** with `https://www.googleapis.com/auth/drive.file` scope
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` in `.env`

Clips are stored in a folder hierarchy on your Google Drive:
```
StreamClipper/
  {Channel Name}/
    {Stream Title}/
      clip_2026-11-18_15-04-30_30s_abc123.mp4
      clip_2026-11-18_15-10-15_20s_def456.mp4
```

## Local Development

```bash
# 1. Clone and install
pnpm install

# 2. Set up environment
cp .env.example .env
# Fill in: Clerk keys, Turso URL/token, Google Drive OAuth, WORKER_TOKEN

# 3. Build shared package
pnpm build:shared

# 4. Run tests
pnpm test:shared

# 5. Generate DB migrations
pnpm db:generate

# 6. Start all services (3 terminals)

# Terminal 1: Worker (ffmpeg + buffer + clip pipeline)
pnpm dev:worker

# Terminal 2: API (Cloudflare Workers local dev)
pnpm dev:api

# Terminal 3: Frontend
pnpm dev:web
```

## CLI Modes & Quick Commands

StreamClipper includes 3 dedicated terminal clipping modes:

### 1. Live Single Clip
Cut a single clip on demand (e.g. last 20 seconds) with visual crop studio:
```bash
pnpm clip "https://www.youtube.com/watch?v=..." 20
```

### 2. Continuous Auto-Clipper (Loop Mode)
Continuously clips every N seconds in real time without stopping. As soon as one clip finishes encoding and saving, it buffers and cuts the next segment automatically:
```bash
pnpm clip:auto "https://www.youtube.com/watch?v=..." 20
```
*(Press `Ctrl+C` at any time to gracefully stop and view your session summary.)*

### 3. Timestamp Range Clipper
Clip any specific timestamp range directly from a stream or VOD:
```bash
# Clip from 00:15:00 to 00:15:30 (or specify duration)
pnpm clip:time "https://www.youtube.com/watch?v=..." 00:15:00 30
```

### Organized File Structure
Clips are automatically organized into clean, channel-isolated folders:
```
clips/
  {Channel_Name}/
    {Stream_Title}_{Date}/
      clip_001_content_9x16_20s.mp4   (Unzoomed 9:16 vertical video)
      clip_001_webcam_20s.mp4         (Isolated webcam clip)
      clip_001_stacked_9x16_20s.mp4   (Stacked vertical combo)
      clip_002_content_9x16_20s.mp4
      clip_002_webcam_20s.mp4
      ...
```

## Docker (Worker)

```bash
docker build -f apps/worker/Dockerfile -t streamclipper-worker .
docker run --env-file .env -p 9090:9090 streamclipper-worker
```

## Stack

| Layer     | Technology                            |
|-----------|---------------------------------------|
| Frontend  | React 19, Vite, TailwindCSS v4, Konva |
| API       | Hono.js on Cloudflare Workers         |
| DB        | Turso (libSQL) via Drizzle ORM        |
| Auth      | Clerk                                 |
| Storage   | Google Drive (OAuth2) / local disk    |
| Worker    | Node.js, ffmpeg, streamlink           |
| Queue     | BullMQ + Redis / in-memory p-queue    |
| Comms     | HTTPS + WebSocket (worker <-> API)    |

## Pipeline

1. **Resolve**: streamlink/yt-dlp -> HLS manifest URL (auto re-resolve on expiry)
2. **Buffer**: ffmpeg `-c copy` HLS rolling window (default 10 min, near-zero CPU)
3. **Clip**: concat segments -> single re-encode pass with crop+stack filter
4. **Upload**: resumable upload to Google Drive (organized folders)
5. **Cleanup**: temp files deleted, disk cap enforced, TTL on old clips

## Encoder Auto-Detection

Tries in order: `h264_nvenc` -> `h264_qsv` -> `h264_videotoolbox` -> `libx264 -preset veryfast -crf 23`

## Crop Math

Crops are stored as normalized coordinates (0-1) so they work at any resolution. The `@streamclipper/shared` package provides unit-tested pure functions:

- `normalizedToPixel()` — convert to pixel coords (always even numbers)
- `constrainTo9x16()` — lock content box to 9:16 aspect
- `buildFilterComplex()` — generate ffmpeg filter string
- `buildClipFfmpegArgs()` — full ffmpeg command builder

## Environment Variables

See `.env.example` for all options. Key ones:

| Variable | Description |
|----------|-------------|
| `STORAGE_MODE` | `gdrive` (default) or `local` |
| `GOOGLE_CLIENT_ID` | Google OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret |
| `GOOGLE_REFRESH_TOKEN` | Google OAuth2 refresh token |
| `GDRIVE_ROOT_FOLDER` | Root folder name in Drive (default: StreamClipper) |
| `WORKER_TOKEN` | Shared secret for API <-> Worker auth |
| `BUFFER_SECONDS` | Rolling buffer window (default: 600) |
| `MAX_CLIP_SECONDS` | Max clip length (default: 120) |
| `RENDER_CONCURRENCY` | Parallel render jobs (default: cpu_cores - 1) |

## Build Order

1. Worker CLI: URL -> buffer -> hardcoded crop -> MP4 (benchmark)
2. Editor UI: Konva crop editor + live preview
3. Queue + Google Drive upload pipeline
4. Multi-stream supervisor with health checks
5. Dashboard polish + hotkeys
