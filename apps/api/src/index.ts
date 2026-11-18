import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import streamRoutes from "./routes/streams.js";
import clipRoutes from "./routes/clips.js";
import { rateLimit } from "./middleware/rate-limit.js";
import type { Env } from "./db/client.js";

type AppEnv = {
  Bindings: Env;
};

const app = new Hono<AppEnv>();

// Global middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use("*", rateLimit({ windowMs: 60_000, max: 120 }));

// Health check
app.get("/", (c) => {
  return c.json({
    name: "StreamClipper API",
    version: "0.1.0",
    status: "ok",
  });
});

// Routes
app.route("/streams", streamRoutes);
app.route("/clips", clipRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
