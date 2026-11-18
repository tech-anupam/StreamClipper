import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { streams, clips, jobs, cropPresets } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  createStreamSchema,
  updateCropSchema,
  clipRequestSchema,
  createPresetSchema,
} from "../lib/validation.js";
import { WorkerClient } from "../lib/worker-client.js";
import type { Env } from "../db/client.js";
import type { Database } from "../db/client.js";

type StreamEnv = {
  Bindings: Env;
  Variables: {
    userId: string;
    clerkId: string;
    db: Database;
  };
};

const app = new Hono<StreamEnv>();

app.use("/*", authMiddleware);

// POST /streams
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createStreamSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      400
    );
  }

  const userId = c.get("userId");
  const db = c.get("db");

  const maxStreams = parseInt(c.env.MAX_STREAMS_PER_USER ?? "5", 10);
  const existingStreams = await db.query.streams.findMany({
    where: and(
      eq(streams.userId, userId),
      eq(streams.status, "buffering")
    ),
  });

  if (existingStreams.length >= maxStreams) {
    return c.json(
      { error: `Maximum ${maxStreams} concurrent streams allowed` },
      429
    );
  }

  const streamId = nanoid();

  await db.insert(streams).values({
    id: streamId,
    userId,
    url: parsed.data.url,
    status: "idle",
  });

  const stream = await db.query.streams.findFirst({
    where: eq(streams.id, streamId),
  });

  return c.json({ stream }, 201);
});

// GET /streams
app.get("/", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");

  const userStreams = await db.query.streams.findMany({
    where: eq(streams.userId, userId),
    orderBy: [desc(streams.createdAt)],
  });

  return c.json({ streams: userStreams });
});

// DELETE /streams/:id
app.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const streamId = c.req.param("id");

  const stream = await db.query.streams.findFirst({
    where: and(eq(streams.id, streamId), eq(streams.userId, userId)),
  });

  if (!stream) {
    return c.json({ error: "Stream not found" }, 404);
  }

  if (stream.status === "buffering") {
    try {
      const worker = new WorkerClient(c.env);
      await worker.stopStream(streamId);
    } catch {
      // Worker might be down
    }
  }

  await db.delete(streams).where(eq(streams.id, streamId));
  return c.json({ ok: true });
});

// POST /streams/:id/frame
app.post("/:id/frame", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const streamId = c.req.param("id");

  const stream = await db.query.streams.findFirst({
    where: and(eq(streams.id, streamId), eq(streams.userId, userId)),
  });

  if (!stream) {
    return c.json({ error: "Stream not found" }, 404);
  }

  if (stream.status !== "buffering") {
    return c.json({ error: "Stream is not buffering" }, 400);
  }

  const worker = new WorkerClient(c.env);
  const frame = await worker.grabFrame(streamId);

  if (!stream.sourceWidth || !stream.sourceHeight) {
    await db
      .update(streams)
      .set({
        sourceWidth: frame.width,
        sourceHeight: frame.height,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(streams.id, streamId));
  }

  return c.json(frame);
});

// PUT /streams/:id/crop
app.put("/:id/crop", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const streamId = c.req.param("id");

  const body = await c.req.json();
  const parsed = updateCropSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid crop config", details: parsed.error.flatten() },
      400
    );
  }

  const stream = await db.query.streams.findFirst({
    where: and(eq(streams.id, streamId), eq(streams.userId, userId)),
  });

  if (!stream) {
    return c.json({ error: "Stream not found" }, 404);
  }

  await db
    .update(streams)
    .set({
      cropConfigJson: JSON.stringify(parsed.data.config),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(streams.id, streamId));

  return c.json({ ok: true, config: parsed.data.config });
});

// POST /streams/:id/start
app.post("/:id/start", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const streamId = c.req.param("id");

  const stream = await db.query.streams.findFirst({
    where: and(eq(streams.id, streamId), eq(streams.userId, userId)),
  });

  if (!stream) {
    return c.json({ error: "Stream not found" }, 404);
  }

  if (stream.status === "buffering") {
    return c.json({ error: "Stream is already buffering" }, 400);
  }

  await db
    .update(streams)
    .set({ status: "resolving", updatedAt: new Date().toISOString() })
    .where(eq(streams.id, streamId));

  try {
    const worker = new WorkerClient(c.env);
    const result = await worker.startStream(streamId, stream.url);

    await db
      .update(streams)
      .set({
        status: "buffering",
        title: result.stream.title,
        channelName: result.stream.channelName,
        channelId: result.stream.channelId,
        sourceWidth: result.stream.sourceWidth,
        sourceHeight: result.stream.sourceHeight,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(streams.id, streamId));

    return c.json({ ok: true, stream: result.stream });
  } catch (err) {
    await db
      .update(streams)
      .set({ status: "error", updatedAt: new Date().toISOString() })
      .where(eq(streams.id, streamId));

    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST /streams/:id/stop
app.post("/:id/stop", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const streamId = c.req.param("id");

  const stream = await db.query.streams.findFirst({
    where: and(eq(streams.id, streamId), eq(streams.userId, userId)),
  });

  if (!stream) {
    return c.json({ error: "Stream not found" }, 404);
  }

  try {
    const worker = new WorkerClient(c.env);
    await worker.stopStream(streamId);
  } catch {
    // Proceed even if worker is unreachable
  }

  await db
    .update(streams)
    .set({ status: "stopped", updatedAt: new Date().toISOString() })
    .where(eq(streams.id, streamId));

  return c.json({ ok: true });
});

// POST /streams/:id/clip
app.post("/:id/clip", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const streamId = c.req.param("id");

  const body = await c.req.json();
  const parsed = clipRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      400
    );
  }

  const stream = await db.query.streams.findFirst({
    where: and(eq(streams.id, streamId), eq(streams.userId, userId)),
  });

  if (!stream) {
    return c.json({ error: "Stream not found" }, 404);
  }

  if (stream.status !== "buffering") {
    return c.json({ error: "Stream is not buffering" }, 400);
  }

  if (!stream.cropConfigJson) {
    return c.json({ error: "Crop configuration not set" }, 400);
  }

  const maxClipSec = parseInt(c.env.MAX_CLIP_SECONDS ?? "120", 10);
  if (parsed.data.seconds > maxClipSec) {
    return c.json({ error: `Max clip duration is ${maxClipSec}s` }, 400);
  }

  const cropConfig = JSON.parse(stream.cropConfigJson);
  const clipId = nanoid();
  const jobId = nanoid();
  const now = Date.now() / 1000;

  await db.insert(clips).values({
    id: clipId,
    streamId,
    startTs: now - parsed.data.seconds,
    endTs: now,
    durationSec: parsed.data.seconds,
    status: "queued",
  });

  await db.insert(jobs).values({
    id: jobId,
    clipId,
    state: "pending",
  });

  try {
    const worker = new WorkerClient(c.env);
    await worker.createClip(streamId, clipId, parsed.data.seconds, cropConfig);
  } catch (err) {
    await db
      .update(jobs)
      .set({ state: "failed", error: (err as Error).message })
      .where(eq(jobs.id, jobId));
    await db
      .update(clips)
      .set({ status: "failed" })
      .where(eq(clips.id, clipId));
    return c.json({ error: "Failed to queue clip job" }, 500);
  }

  const clip = await db.query.clips.findFirst({
    where: eq(clips.id, clipId),
  });
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });

  return c.json({ clip, job }, 201);
});

// POST /streams/:id/presets
app.post("/:id/presets", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const streamId = c.req.param("id");

  const body = await c.req.json();
  const parsed = createPresetSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid preset", details: parsed.error.flatten() },
      400
    );
  }

  const stream = await db.query.streams.findFirst({
    where: and(eq(streams.id, streamId), eq(streams.userId, userId)),
  });

  if (!stream) {
    return c.json({ error: "Stream not found" }, 404);
  }

  const presetId = nanoid();
  await db.insert(cropPresets).values({
    id: presetId,
    userId,
    name: parsed.data.name,
    channelId: parsed.data.channelId ?? stream.channelId ?? null,
    configJson: JSON.stringify(parsed.data.config),
  });

  return c.json({ id: presetId, ...parsed.data }, 201);
});

// GET /streams/:id/presets
app.get("/:id/presets", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const streamId = c.req.param("id");

  const stream = await db.query.streams.findFirst({
    where: and(eq(streams.id, streamId), eq(streams.userId, userId)),
  });

  if (!stream) {
    return c.json({ error: "Stream not found" }, 404);
  }

  const presets = await db.query.cropPresets.findMany({
    where: eq(cropPresets.userId, userId),
  });

  return c.json({ presets });
});

export default app;
