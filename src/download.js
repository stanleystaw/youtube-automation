import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { ROOT } from "./config.js";
import { withRetry } from "./utils.js";

export async function downloadVideo(videoUrl, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  await withRetry(
    async () => {
      const url = withDownloadFlag(videoUrl);
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        const err = new Error(`Téléchargement HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      if (!res.body) throw new Error("Réponse vide lors du téléchargement");
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
      const size = fs.statSync(destPath).size;
      if (size < 10_000) {
        throw new Error(`Fichier trop petit (${size} octets) — téléchargement incomplet`);
      }
    },
    { label: "téléchargement MP4", attempts: 3, delayMs: 4000 }
  );

  return destPath;
}

export function tmpPath(filename) {
  const dir = path.join(ROOT, ".tmp");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function withDownloadFlag(url) {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("dl")) u.searchParams.set("dl", "1");
    return u.toString();
  } catch {
    return url.includes("?") ? `${url}&dl=1` : `${url}?dl=1`;
  }
}
