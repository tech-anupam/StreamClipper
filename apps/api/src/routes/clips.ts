import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { clips, streams, jobs } from "../db/schema.js";
import { authMiddleware, workerAuthMiddleware } from "../middleware/auth.js";
import type { Env, Database } from "../db/client.js";

type ClipEnv = {
  Bindings: Env;
  Variables: {
    userId: string;
    clerkId: string;
    db: Database;
  };
};

const app = new Hono<ClipEnv>();

// User routes - require Clerk auth
const userRoutes = new Hono<ClipEnv>();
userRoutes.use("/*", authMiddleware);

// GET /clips - List user's clips
userRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");

  const userStreams = await db.query.streams.findMany({
    where: eq(streams.userId, userId),
    columns: { id: true },
  });

  const streamIds = userStreams.map((s) => s.id);

  if (streamIds.length === 0) {
    return c.json({ clips: [] });
  }

  const allClips = [];
  for (const streamId of streamIds) {
    const streamClips = await db.query.clips.findMany({
      where: eq(clips.streamId, streamId),
      orderBy: [desc(clips.createdAt)],
    });
    allClips.push(...streamClips);
  }

  allClips.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return c.json({ clips: allClips });
});

// GET /clips/:id/url - Get download/view URLs for a clip
userRoutes.get("/:id/url", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const clipId = c.req.param("id");

  const clip = await db.query.clips.findFirst({
    where: eq(clips.id, clipId),
  });

  if (!clip) {
    return c.json({ error: "Clip not found" }, 404);
  }

  // Verify ownership
  const stream = await db.query.streams.findFirst({
    where: and(eq(streams.id, clip.streamId), eq(streams.userId, userId)),
  });

  if (!stream) {
    return c.json({ error: "Clip not found" }, 404);
  }

  if (clip.status !== "done") {
    return c.json({ error: "Clip is not ready" }, 400);
  }

  // Google Drive link
  if (clip.gdriveFileId) {
    return c.json({
      viewUrl: clip.gdriveWebLink ?? `https://drive.google.com/file/d/${clip.gdriveFileId}/view`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${clip.gdriveFileId}`,
      gdriveFileId: clip.gdriveFileId,
    });
  }

  // Local path fallback
  if (clip.localPath) {
    return c.json({ url: clip.localPath });
  }

  return c.json({ error: "No download available" }, 404);
});

// Worker callback routes - require worker token
const workerRoutes = new Hono<ClipEnv>();
workerRoutes.use("/*", workerAuthMiddleware);

// PUT /clips/internal/:id - Worker updates clip status after processing
workerRoutes.put("/:id", async (c) => {
  const db = c.get("db");
  const clipId = c.req.param("id");
  const body = (await c.req.json()) as {
    status?: string;
    gdriveFileId?: string;
    gdriveWebLink?: string;
    localPath?: string;
    sizeBytes?: number;
    jobState?: string;
    jobError?: string;
    progress?: number;
  };

  if (body.status) {
    const updateData: Record<string, unknown> = { status: body.status };
    if (body.gdriveFileId) updateData.gdriveFileId = body.gdriveFileId;
    if (body.gdriveWebLink) updateData.gdriveWebLink = body.gdriveWebLink;
    if (body.localPath) updateData.localPath = body.localPath;
    if (body.sizeBytes) updateData.sizeBytes = body.sizeBytes;

    await db.update(clips).set(updateData).where(eq(clips.id, clipId));
  }

  // Update associated job
  if (body.jobState) {
    const clipJobs = await db.query.jobs.findMany({
      where: eq(jobs.clipId, clipId),
    });

    for (const job of clipJobs) {
      const jobUpdate: Record<string, unknown> = {
        state: body.jobState,
        updatedAt: new Date().toISOString(),
      };
      if (body.jobError) jobUpdate.error = body.jobError;
      if (body.progress !== undefined) jobUpdate.progress = body.progress;
      await db.update(jobs).set(jobUpdate).where(eq(jobs.id, job.id));
    }
  }

  return c.json({ ok: true });
});

// Mount routes
app.route("/internal", workerRoutes);
app.route("/", userRoutes);

export default app;
