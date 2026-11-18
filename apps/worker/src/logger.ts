import pino from "pino";

// By default in CLI or development, we format or silence verbose logs
const isCli = process.argv[1]?.includes("cli") || process.env.STREAMCLIPPER_CLI === "true";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isCli ? "silent" : "info"),
  base: { service: "streamclipper-worker" },
});
