import { readFile, copyFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, basename } from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "uploader" });

// ── Google Drive API helpers (using REST API directly) ────────

interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
  webContentLink: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * Get a valid Google OAuth2 access token using the refresh token.
 */
async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60_000) {
    return cachedAccessToken.token;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID!,
      client_secret: config.GOOGLE_CLIENT_SECRET!,
      refresh_token: config.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to refresh Google access token: ${err}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

/**
 * Find or create a folder in Google Drive.
 */
async function findOrCreateFolder(
  name: string,
  parentId?: string
): Promise<string> {
  const token = await getAccessToken();

  // Search for existing folder
  let query = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!searchRes.ok) {
    throw new Error(`Drive search failed: ${await searchRes.text()}`);
  }

  const searchData = (await searchRes.json()) as {
    files: { id: string; name: string }[];
  };

  if (searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const metadata: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const createRes = await fetch(
    "https://www.googleapis.com/drive/v3/files",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!createRes.ok) {
    throw new Error(`Drive folder creation failed: ${await createRes.text()}`);
  }

  const created = (await createRes.json()) as { id: string };
  log.info({ name, parentId, folderId: created.id }, "Created Drive folder");
  return created.id;
}

/**
 * Build the folder hierarchy:  StreamClipper / {channelName} / {streamTitle}
 * Returns the target folder ID.
 */
async function ensureFolderPath(
  channelName: string,
  streamTitle: string
): Promise<string> {
  const rootName = config.GDRIVE_ROOT_FOLDER ?? "StreamClipper";

  const rootId = await findOrCreateFolder(rootName);
  const channelId = await findOrCreateFolder(
    sanitizeFolderName(channelName || "Unknown Channel"),
    rootId
  );
  const streamId = await findOrCreateFolder(
    sanitizeFolderName(streamTitle || "Untitled Stream"),
    channelId
  );

  return streamId;
}

/**
 * Upload a file to Google Drive using resumable upload (handles large videos).
 */
async function uploadFileToDrive(
  filePath: string,
  fileName: string,
  parentFolderId: string
): Promise<DriveFile> {
  const token = await getAccessToken();
  const fileSize = (await stat(filePath)).size;
  const fileBuffer = await readFile(filePath);

  // Step 1: Initiate resumable upload
  const initRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,webContentLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(fileSize),
      },
      body: JSON.stringify({
        name: fileName,
        parents: [parentFolderId],
        mimeType: "video/mp4",
      }),
    }
  );

  if (!initRes.ok) {
    throw new Error(`Drive upload init failed: ${await initRes.text()}`);
  }

  const uploadUri = initRes.headers.get("Location");
  if (!uploadUri) {
    throw new Error("No upload URI returned from Drive");
  }

  // Step 2: Upload the file content
  // For files under 50 MB, do a single PUT. For larger files,
  // a chunked approach would be used — but most clips are small.
  const uploadRes = await fetch(uploadUri, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(fileSize),
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`Drive file upload failed: ${await uploadRes.text()}`);
  }

  const driveFile = (await uploadRes.json()) as DriveFile;

  log.info(
    { fileId: driveFile.id, name: driveFile.name, sizeBytes: fileSize },
    "Uploaded clip to Google Drive"
  );

  // Step 3: Make the file accessible via link (anyone with link can view)
  await setFilePermission(driveFile.id);

  return driveFile;
}

/**
 * Set the file to "anyone with the link can view" for easy sharing.
 */
async function setFilePermission(fileId: string): Promise<void> {
  const token = await getAccessToken();

  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "reader",
        type: "anyone",
      }),
    }
  );
}

/**
 * Get a direct download link for a Drive file.
 */
export async function getClipDownloadUrl(fileId: string): Promise<string> {
  // Google Drive direct download link
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * Get the web view link for a Drive file.
 */
export async function getClipViewUrl(fileId: string): Promise<string> {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// ── Main upload interface ─────────────────────────────

export interface UploadResult {
  gdriveFileId: string | null;
  gdriveWebLink: string | null;
  localPath: string | null;
}

/**
 * Upload a clip file to Google Drive or local disk depending on STORAGE_MODE.
 */
export async function uploadClip(
  filePath: string,
  fileName: string,
  channelName: string,
  streamTitle: string
): Promise<UploadResult> {
  if (config.STORAGE_MODE === "local") {
    return uploadLocal(filePath, fileName);
  }
  return uploadToGDrive(filePath, fileName, channelName, streamTitle);
}

async function uploadToGDrive(
  filePath: string,
  fileName: string,
  channelName: string,
  streamTitle: string
): Promise<UploadResult> {
  const folderId = await ensureFolderPath(channelName, streamTitle);
  const driveFile = await uploadFileToDrive(filePath, fileName, folderId);

  return {
    gdriveFileId: driveFile.id,
    gdriveWebLink:
      driveFile.webViewLink ??
      `https://drive.google.com/file/d/${driveFile.id}/view`,
    localPath: null,
  };
}

async function uploadLocal(
  filePath: string,
  fileName: string
): Promise<UploadResult> {
  const localDir = config.LOCAL_CLIPS_DIR;
  await mkdir(localDir, { recursive: true });

  const localPath = join(localDir, fileName);
  await copyFile(filePath, localPath);

  log.info({ localPath }, "Saved clip locally");
  return {
    gdriveFileId: null,
    gdriveWebLink: null,
    localPath,
  };
}

// ── Helpers ───────────────────────────────────────────

/**
 * Remove characters that are not allowed in Google Drive folder names.
 */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/**
 * Build a human-readable clip filename.
 * Example: clip_2026-11-18_15-04-30_30s.mp4
 */
export function buildClipFileName(
  clipId: string,
  durationSec: number
): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // 2026-11-18
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "-"); // 15-04-30
  return `clip_${date}_${time}_${durationSec}s_${clipId.slice(0, 8)}.mp4`;
}
