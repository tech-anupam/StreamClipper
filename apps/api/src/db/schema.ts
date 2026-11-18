import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  maxStreams: integer("max_streams").notNull().default(5),
  maxClipSeconds: integer("max_clip_seconds").notNull().default(120),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const streams = sqliteTable("streams", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  url: text("url").notNull(),
  title: text("title").notNull().default(""),
  channelName: text("channel_name").default(""),
  channelId: text("channel_id").default(""),
  status: text("status", {
    enum: ["idle", "resolving", "buffering", "error", "stopped"],
  })
    .notNull()
    .default("idle"),
  cropConfigJson: text("crop_config_json"),
  bufferSeconds: integer("buffer_seconds").notNull().default(600),
  sourceWidth: integer("source_width"),
  sourceHeight: integer("source_height"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const clips = sqliteTable("clips", {
  id: text("id").primaryKey(),
  streamId: text("stream_id")
    .notNull()
    .references(() => streams.id),
  startTs: real("start_ts").notNull(),
  endTs: real("end_ts").notNull(),
  durationSec: real("duration_sec").notNull(),
  /** Google Drive file ID */
  gdriveFileId: text("gdrive_file_id"),
  /** Google Drive shareable web link */
  gdriveWebLink: text("gdrive_web_link"),
  /** Local filesystem path (STORAGE_MODE=local) */
  localPath: text("local_path"),
  sizeBytes: integer("size_bytes"),
  status: text("status", {
    enum: ["queued", "processing", "uploading", "done", "failed"],
  })
    .notNull()
    .default("queued"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  clipId: text("clip_id")
    .notNull()
    .references(() => clips.id),
  state: text("state", {
    enum: ["pending", "active", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const cropPresets = sqliteTable("crop_presets", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  channelId: text("channel_id"),
  configJson: text("config_json").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
