import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client.js";
import { createDb, type Database } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

type AuthEnv = {
  Bindings: Env;
  Variables: {
    userId: string;
    clerkId: string;
    db: Database;
  };
};

/**
 * Clerk auth middleware for Hono on CF Workers.
 * Validates the Clerk session token and ensures user exists in DB.
 */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  // For worker-to-API communication, check the worker token
  if (token === c.env.WORKER_TOKEN) {
    // Worker requests don't have a user context — set a system user
    c.set("userId", "system");
    c.set("clerkId", "system");
    c.set("db", createDb(c.env));
    await next();
    return;
  }

  try {
    // Verify Clerk JWT
    // In production, use @clerk/backend to verify
    // For now, decode the JWT payload (Clerk JWTs are verified by their JWKS)
    const { verifyToken } = await import("@clerk/backend");

    const payload = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
    });

    if (!payload?.sub) {
      return c.json({ error: "Invalid token" }, 401);
    }

    const clerkId = payload.sub;
    const db = createDb(c.env);

    // Find or create user
    let user = await db.query.users.findFirst({
      where: eq(users.clerkId, clerkId),
    });

    if (!user) {
      const userId = nanoid();
      await db.insert(users).values({
        id: userId,
        clerkId,
        email: (payload as Record<string, unknown>).email as string ?? null,
      });
      user = { id: userId, clerkId, email: null, maxStreams: 5, maxClipSeconds: 120, createdAt: new Date().toISOString() };
    }

    c.set("userId", user.id);
    c.set("clerkId", clerkId);
    c.set("db", db);

    await next();
  } catch (err) {
    console.error("Auth error:", err);
    return c.json({ error: "Authentication failed" }, 401);
  }
});

/**
 * Worker-only middleware: only allows requests with the worker token.
 */
export const workerAuthMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (token !== c.env.WORKER_TOKEN) {
    return c.json({ error: "Worker authentication required" }, 401);
  }

  c.set("db", createDb(c.env));
  await next();
});
