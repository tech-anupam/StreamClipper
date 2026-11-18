import { createMiddleware } from "hono/factory";

/**
 * Simple in-memory rate limiter for Cloudflare Workers.
 * In production, use Cloudflare Workers KV or Durable Objects for distributed rate limiting.
 */
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(opts: {
  windowMs?: number;
  max?: number;
} = {}) {
  const windowMs = opts.windowMs ?? 60_000; // 1 minute
  const max = opts.max ?? 60; // 60 requests per minute

  return createMiddleware(async (c, next) => {
    const key =
      c.req.header("CF-Connecting-IP") ??
      c.req.header("X-Forwarded-For") ??
      "unknown";

    const now = Date.now();
    let entry = requestCounts.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      requestCounts.set(key, entry);
    }

    entry.count++;

    if (entry.count > max) {
      return c.json(
        { error: "Rate limit exceeded. Try again later." },
        429
      );
    }

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(max - entry.count));
    c.header("X-RateLimit-Reset", String(entry.resetAt));

    await next();
  });
}
