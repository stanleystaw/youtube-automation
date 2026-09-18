import fs from "node:fs";
import path from "node:path";
import { extractTaskId, extractStatus, extractVideoUrl, isDone, isFailed } from "./magiclight.js";
import { downloadVideo, tmpPath } from "./download.js";
import { extractLastFrame, concatVideos, kenBurnsWithAudio } from "./ffmpeg.js";
import { splitQuote, clipPrompt } from "./agents/quotes.js";
import { info, ok, step, warn } from "./logger.js";
import { sleep } from "./utils.js";

const CLIP_COST = 7;

export async function produceQuoteClip({
  ml,
  quote,
  settings,
  drive,
  folderId,
}) {
  const maxChars = Number(settings.quotes?.maxCharsFor10s || 140);
  const duration = Number(settings.quotes?.duration || 10);
  const quality = settings.quotes?.quality || "high";
  const parts = splitQuote(quote.text, maxChars);
  const spokenFull = quote.author ? `${quote.text} — ${quote.author}` : quote.text;
  const spokenParts =
    parts.length === 1
      ? [spokenFull]
      : parts.map((p, i) => (i === parts.length - 1 && quote.author ? `${p} — ${quote.author}` : p));

  info(
    parts.length === 1
      ? `Citation courte (${spokenFull.length} car.) → 1×${duration}s`
      : `Citation longue (${spokenFull.length} car.) → ${parts.length}×${duration}s (dernière frame animée)`
  );

  const files = [];
  let lastFrame = null;
  const taskIds = [];

  for (let i = 0; i < spokenParts.length; i += 1) {
    const spoken = spokenParts[i];
    const prompt = clipPrompt({
      visualPrompt: quote.visualPrompt,
      spoken,
      part: i + 1,
      total: spokenParts.length,
    });
    step(`Clip MagicLight ${i + 1}/${spokenParts.length}`);
    const started = await ml.startClip({
      prompt,
      duration,
      quality,
      imageUrl: i > 0 ? lastFrame?.url : undefined,
    });
    const taskId = extractTaskId(started);
    if (!taskId) throw new Error(`Clip sans task_id : ${JSON.stringify(started).slice(0, 300)}`);
    taskIds.push(taskId);
    const done = await waitClip(ml, taskId, settings);
    const url = extractVideoUrl(done.data) || ml.clipDownloadUrl(taskId);
    const file = tmpPath(`quote-${taskId}.mp4`);
    await downloadVideo(url, file);
    ok(`Clip ${i + 1} : ${file} (${fs.statSync(file).size} o)`);
    files.push(file);

    if (i < spokenParts.length - 1) {
      const jpg = tmpPath(`quote-${taskId}-last.jpg`);
      try {
        await extractLastFrame(file, jpg);
        lastFrame = await publishFrame(drive, folderId, jpg);
        ok(`Dernière frame → ${lastFrame.url}`);
      } catch (error) {
        warn(`Frame/imageUrl : ${error.message} — clip suivant sans image de continuité`);
        lastFrame = null;
      }
    }
  }

  let finalPath = files[0];
  if (files.length > 1) {
    step("Montage 20s (concat)");
    try {
      const out = tmpPath(`quote-final-${Date.now()}.mp4`);
      await concatVideos(files, out);
      finalPath = out;
      ok(`Montage : ${out}`);
    } catch (error) {
      warn(`Concat copy a échoué (${error.message}) — recodage`);
      const out = tmpPath(`quote-final-${Date.now()}.mp4`);
      await concatVideos(files, out);
      finalPath = out;
    }
  }

  return {
    filePath: finalPath,
    taskIds,
    parts: spokenParts.length,
    credits: CLIP_COST * spokenParts.length,
    durationSec: duration * spokenParts.length,
  };
}

async function waitClip(ml, taskId, settings) {
  const maxWait = Math.min(settings.maxWaitMs || 600000, 600000);
  const deadline = Date.now() + maxWait;
  let last = -1;
  while (Date.now() < deadline) {
    const data = await ml.clipStatus(taskId);
    const status = extractStatus(data);
    const progress = Number(data.progress ?? data.percent ?? last);
    if (progress !== last) {
      info(`… clip ${taskId} ${status || "?"} ${Number.isFinite(progress) ? progress : 0}%`);
      last = progress;
    }
    if (isDone(status) || extractVideoUrl(data)) return { data, status: status || "done", taskId };
    if (isFailed(status)) throw new Error(`Clip ${taskId} : ${status}`);
    await sleep(settings.pollIntervalMs || 15000);
  }
  throw new Error(`Délai dépassé pour le clip ${taskId}`);
}

async function publishFrame(drive, folderId, jpgPath) {
  const { google } = await import("googleapis");
  const res = await drive.files.create({
    requestBody: {
      name: path.basename(jpgPath),
      parents: folderId ? [folderId] : undefined,
    },
    media: {
      mimeType: "image/jpeg",
      body: fs.createReadStream(jpgPath),
    },
    fields: "id",
  });
  const id = res.data.id;
  try {
    await drive.permissions.create({
      fileId: id,
      requestBody: { type: "anyone", role: "reader" },
    });
  } catch {
    /* drive.file may still allow link */
  }
  return {
    id,
    url: `https://drive.google.com/uc?export=view&id=${id}`,
  };
}

export { kenBurnsWithAudio };
