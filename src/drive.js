import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { ROOT } from "./config.js";
import { loadState } from "./state.js";

const FOLDER_NAME = "YouTube Automation";
const STATE_NAME = "youtube-automation-state.json";
const MIME_FOLDER = "application/vnd.google-apps.folder";

export async function driveClient(auth) {
  return google.drive({ version: "v3", auth });
}

export async function ensureFolder(drive, folderId) {
  if (folderId) return folderId;

  const found = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='${MIME_FOLDER}' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 5,
    spaces: "drive",
  });

  if (found.data.files?.length) return found.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name: FOLDER_NAME, mimeType: MIME_FOLDER },
    fields: "id",
  });
  return created.data.id;
}

export async function uploadVideo({ drive, folderId, filePath, name, description }) {
  const res = await drive.files.create({
    requestBody: {
      name,
      parents: folderId ? [folderId] : undefined,
      description: description || "",
    },
    media: {
      mimeType: "video/mp4",
      body: fs.createReadStream(filePath),
    },
    fields: "id, name, webViewLink, webContentLink",
  });
  return res.data;
}

export async function pullRemoteState(drive, folderId) {
  const found = await drive.files.list({
    q: `name='${STATE_NAME}' and trashed=false${folderId ? ` and '${folderId}' in parents` : ""}`,
    fields: "files(id, name, modifiedTime)",
    pageSize: 5,
    spaces: "drive",
  });
  const file = found.data.files?.[0];
  if (!file) return { fileId: null, state: null };

  const res = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "text" }
  );
  const parsed = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  return { fileId: file.id, state: parsed };
}

export async function pushRemoteState(drive, folderId, fileId, state) {
  const body = JSON.stringify(state, null, 2);
  const media = {
    mimeType: "application/json",
    body,
  };
  if (fileId) {
    await drive.files.update({ fileId, media });
    return fileId;
  }
  const created = await drive.files.create({
    requestBody: {
      name: STATE_NAME,
      parents: folderId ? [folderId] : undefined,
    },
    media,
    fields: "id",
  });
  return created.data.id;
}

export function mergeStates(local, remote) {
  if (!remote || !Array.isArray(remote.videos)) return local;
  const map = new Map();
  for (const v of [...remote.videos, ...local.videos]) {
    if (!v?.taskId) continue;
    const prev = map.get(v.taskId) || {};
    map.set(v.taskId, { ...prev, ...v });
  }
  const lastStartAt = [local.lastStartAt, remote.lastStartAt]
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  return { videos: [...map.values()], lastStartAt };
}

export function persistLocal(state) {
  const file = path.join(ROOT, "data", "state.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export { loadState };
