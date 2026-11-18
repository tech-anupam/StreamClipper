import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  addStream,
  removeStream,
  getStream,
  getAllStreams,
} from "./supervisor.js";
import { getBufferHealth, isBufferActive } from "./buffer.js";
import { addClipJob, getQueueSize, setQueueCallbacks } from "./queue.js";
import { grabFrame } from "./resolver.js";
import { getClipDownloadUrl, getClipViewUrl } from "./uploader.js";
import { nanoid } from "nanoid";
import type { WorkerEvent } from "@streamclipper/shared";
import type { ClipJobInput } from "./clipper.js";

const log = logger.child({ module: "server" });

const app = express();
app.use(express.json());

// ── Auth middleware: verify worker token ──────────────
function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== config.WORKER_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.use("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use(authMiddleware);

// ── WebSocket clients for live status ────────────────
const wsClients = new Set<WebSocket>();

function broadcast(event: WorkerEvent): void {
  const msg = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ── Set up queue callbacks to broadcast status ───────
setQueueCallbacks({
  onProgress: (jobId, clipId, progress) => {
    broadcast({
      type: "clip:progress",
      clipId,
      jobId,
      data: { progress },
      timestamp: Date.now(),
    });
  },
  onCompleted: (jobId, clipId, result) => {
    broadcast({
      type: "clip:done",
      clipId,
      jobId,
      data: {
        gdriveFileId: result.gdriveFileId,
        gdriveWebLink: result.gdriveWebLink,
        localPath: result.localPath,
        sizeBytes: result.sizeBytes,
        durationSec: result.durationSec,
      },
      timestamp: Date.now(),
    });
  },
  onFailed: (jobId, clipId, error) => {
    broadcast({
      type: "clip:error",
      clipId,
      jobId,
      data: { error },
      timestamp: Date.now(),
    });
  },
});

// ── Routes ───────────────────────────────────────────

// Start a stream
app.post("/streams/:id/start", async (req, res) => {
  try {
    const { id } = req.params;
    const { url } = req.body;
    const managed = await addStream(id, url);

    broadcast({
      type: "stream:status",
      streamId: id,
      data: {
        status: "buffering",
        title: managed.title,
        channelName: managed.channelName,
        sourceWidth: managed.sourceWidth,
        sourceHeight: managed.sourceHeight,
      },
      timestamp: Date.now(),
    });

    res.json({
      ok: true,
      stream: {
        title: managed.title,
        channelName: managed.channelName,
        channelId: managed.channelId,
        sourceWidth: managed.sourceWidth,
        sourceHeight: managed.sourceHeight,
      },
    });
  } catch (err) {
    log.error({ err }, "Failed to start stream");
    res.status(500).json({ error: (err as Error).message });
  }
});

// Stop a stream
app.post("/streams/:id/stop", async (req, res) => {
  try {
    await removeStream(req.params.id);
    broadcast({
      type: "stream:status",
      streamId: req.params.id,
      data: { status: "stopped" },
      timestamp: Date.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get stream health
app.get("/streams/:id/health", async (req, res) => {
  const health = await getBufferHealth(req.params.id);
  if (!health) {
    res.status(404).json({ error: "Stream not found or not buffering" });
    return;
  }
  res.json(health);
});

// Grab a frame from a stream
app.post("/streams/:id/frame", async (req, res) => {
  try {
    const managed = getStream(req.params.id);
    if (!managed) {
      res.status(404).json({ error: "Stream not found" });
      return;
    }

    const frameBuffer = await grabFrame(managed.hlsUrl);
    const base64 = frameBuffer.toString("base64");

    res.json({
      frame: base64,
      width: managed.sourceWidth,
      height: managed.sourceHeight,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Create a clip job
app.post("/streams/:id/clip", async (req, res) => {
  try {
    const { id } = req.params;
    const { seconds, cropConfig, clipId: providedClipId } = req.body;
    const managed = getStream(id);

    if (!managed) {
      res.status(404).json({ error: "Stream not found" });
      return;
    }

    if (!isBufferActive(id)) {
      res.status(400).json({ error: "Stream is not buffering" });
      return;
    }

    if (seconds > config.MAX_CLIP_SECONDS) {
      res.status(400).json({
        error: `Max clip duration is ${config.MAX_CLIP_SECONDS}s`,
      });
      return;
    }

    const clipId = providedClipId ?? nanoid();
    const jobId = nanoid();

    const jobInput: ClipJobInput = {
      jobId,
      clipId,
      streamId: id,
      seconds,
      cropConfig,
      sourceWidth: managed.sourceWidth,
      sourceHeight: managed.sourceHeight,
      channelName: managed.channelName,
      streamTitle: managed.title,
    };

    await addClipJob(jobInput);

    res.json({ ok: true, clipId, jobId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get clip download URL (from Google Drive)
app.get("/clips/:fileId/url", async (req, res) => {
  try {
    const downloadUrl = await getClipDownloadUrl(req.params.fileId);
    const viewUrl = await getClipViewUrl(req.params.fileId);
    res.json({ downloadUrl, viewUrl });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// List all managed streams
app.get("/streams", (_req, res) => {
  const streams = getAllStreams().map((s) => ({
    streamId: s.streamId,
    url: s.url,
    title: s.title,
    channelName: s.channelName,
    status: s.status,
    sourceWidth: s.sourceWidth,
    sourceHeight: s.sourceHeight,
  }));
  res.json({ streams });
});

// Queue status
app.get("/queue/status", async (_req, res) => {
  const size = await getQueueSize();
  res.json({
    queueSize: size,
    renderConcurrency: config.RENDER_CONCURRENCY,
  });
});

/**
 * Start the HTTP + WebSocket server.
 */
export function startServer(): void {
  const server = createServer(app);

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    // Verify token from query param
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (token !== config.WORKER_TOKEN) {
      ws.close(4001, "Unauthorized");
      return;
    }

    wsClients.add(ws);
    log.info("WebSocket client connected");

    ws.on("close", () => {
      wsClients.delete(ws);
      log.info("WebSocket client disconnected");
    });
  });

  server.listen(config.WORKER_PORT, () => {
    log.info({ port: config.WORKER_PORT }, "Worker server started");
  });
}
