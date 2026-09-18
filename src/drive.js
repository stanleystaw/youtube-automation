import fs from "node:fs";
import { google } from "googleapis";

const MIME_FOLDER = "application/vnd.google-apps.folder";
const CONSEILS_FOLDER = "Conseils Histoire Ai";

export async function driveClient(auth) {
  return google.drive({ version: "v3", auth });
}

export async function ensureConseilsFolder(drive, existingId) {
  if (existingId) {
    try {
      const got = await drive.files.get({
        fileId: existingId,
        fields: "id, name, trashed",
      });
      if (got.data?.id && !got.data.trashed) return got.data.id;
    } catch {
      /* recreate */
    }
  }

  const found = await drive.files.list({
    q: `name='${CONSEILS_FOLDER}' and mimeType='${MIME_FOLDER}' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 5,
    spaces: "drive",
  });
  if (found.data.files?.length) return found.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name: CONSEILS_FOLDER, mimeType: MIME_FOLDER },
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

export { CONSEILS_FOLDER };
