import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";

export interface BinaryLocations {
  ffmpeg: string;
  ffprobe: string;
  streamlink: string;
  ytDlp: string;
}

/**
 * Find an executable on the system, checking common locations on Windows/Linux/macOS
 */
export function resolveBinary(name: string, envVal?: string): string {
  // 1. If explicit env path is provided and exists, use it
  if (envVal && envVal !== name && fs.existsSync(envVal)) {
    return envVal;
  }

  // 2. Common search locations
  const home = os.homedir();
  const isWin = process.platform === "win32";
  const ext = isWin ? ".exe" : "";

  const candidates: string[] = [
    name, // check bare PATH
  ];

  if (isWin) {
    candidates.push(
      path.join("C:\\ffmpeg\\bin", `${name}${ext}`),
      path.join(home, "AppData\\Roaming\\Python\\Python313\\Scripts", `${name}${ext}`),
      path.join(home, "AppData\\Roaming\\Python\\Python314\\Scripts", `${name}${ext}`),
      path.join(home, "AppData\\Roaming\\Python\\Python312\\Scripts", `${name}${ext}`),
      path.join(home, "AppData\\Roaming\\Python\\Python311\\Scripts", `${name}${ext}`),
      path.join(home, "AppData\\Local\\Programs\\Python\\Python313\\Scripts", `${name}${ext}`),
      path.join(home, "AppData\\Local\\Programs\\Python\\Python314\\Scripts", `${name}${ext}`),
      path.join(home, "AppData\\Local\\Microsoft\\WindowsApps", `${name}${ext}`),
      path.join(home, "scoop\\shims", `${name}${ext}`),
      path.join("C:\\ProgramData\\chocolatey\\bin", `${name}${ext}`)
    );
  } else {
    candidates.push(
      `/usr/local/bin/${name}`,
      `/usr/bin/${name}`,
      `${home}/.local/bin/${name}`
    );
  }

  for (const cand of candidates) {
    if (cand !== name && fs.existsSync(cand)) {
      return cand;
    }
  }

  return name;
}

/**
 * Check if a command is executable
 */
export async function testCommand(binPath: string, args: string[] = ["--version"]): Promise<boolean> {
  try {
    await execa(binPath, args, { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pre-flight check and auto-installation of yt-dlp & streamlink if missing
 */
export async function ensureBinaries(
  customEnv?: Partial<{
    FFMPEG_PATH: string;
    FFPROBE_PATH: string;
    STREAMLINK_PATH: string;
    YT_DLP_PATH: string;
  }>,
  onLog?: (msg: string) => void
): Promise<BinaryLocations> {
  let ffmpeg = resolveBinary("ffmpeg", customEnv?.FFMPEG_PATH);
  let ffprobe = resolveBinary("ffprobe", customEnv?.FFPROBE_PATH);
  let ytDlp = resolveBinary("yt-dlp", customEnv?.YT_DLP_PATH);
  let streamlink = resolveBinary("streamlink", customEnv?.STREAMLINK_PATH);

  // Check yt-dlp
  let ytOk = await testCommand(ytDlp);
  let slOk = await testCommand(streamlink);

  if (!ytOk || !slOk) {
    onLog?.("⚡ Missing video stream tools. Starting auto-installation phase...");

    // Try pip install
    try {
      onLog?.("📦 Running: pip install --user yt-dlp streamlink");
      await execa("pip", ["install", "--user", "yt-dlp", "streamlink"]);
      onLog?.("✓ Packages installed successfully!");
      
      // Re-resolve
      ytDlp = resolveBinary("yt-dlp");
      streamlink = resolveBinary("streamlink");
      ytOk = await testCommand(ytDlp);
      slOk = await testCommand(streamlink);
    } catch (err) {
      onLog?.(`! Note: Automatic pip install skipped: ${(err as Error).message}`);
    }
  }

  return {
    ffmpeg,
    ffprobe,
    streamlink,
    ytDlp,
  };
}
