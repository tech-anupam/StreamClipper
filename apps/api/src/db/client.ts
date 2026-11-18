import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.js";

export type Env = {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  CLERK_SECRET_KEY: string;
  WORKER_TOKEN: string;
  WORKER_API_URL: string;
  R2_BUCKET_NAME?: string;
  MAX_STREAMS_PER_USER?: string;
  MAX_CLIP_SECONDS?: string;
};

export function createDb(env: Env) {
  const client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
