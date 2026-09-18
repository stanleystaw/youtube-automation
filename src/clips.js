import fs from "node:fs";
import { extractTaskId, extractStatus, extractVideoUrl, isDone, isFailed } from "./magiclight.js";
import { downloadVideo, tmpPath } from "./download.js";
import { concatVideos } from "./ffmpeg.js";
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
  state,
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

  const presenterUrl = resolvePresenterUrl(settings);
  if (presenterUrl) info(`Présentatrice (référence) : ${presenterUrl}`);
  else warn("Pas de photo présentatrice — MagicLight improvisera le visage.");

  info(
    parts.length === 1
      ? `Conseil court (${spokenFull.length} car.) → 1×${duration}s`
      : `Conseil long (${spokenFull.length} car.) → ${parts.length}×${duration}s (dernière frame animée)`
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
      imageUrl: i > 0 ? lastFrame?.url || presenterUrl : presenterUrl || undefined,
    });
    const taskId = extractTaskId(started);
    if (!taskId) throw new Error("Clip sans task_id");
    taskIds.push(taskId);
    const done = await waitClip(ml, taskId, settings);
    const url = extractVideoUrl(done.data) || ml.clipDownloadUrl(taskId);
    const file = tmpPath(`quote-${taskId}.mp4`);
    await downloadVideo(url, file);
    ok(`Clip ${i + 1} : ${file} (${fs.statSync(file).size} o)`);
    files.push(file);

    if (i < spokenParts.length - 1) {
      lastFrame = presenterUrl ? { url: presenterUrl } : null;
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

export function resolvePresenterUrl(settings) {
  const explicit = String(settings.quotes?.presenterImageUrl || "").trim();
  if (explicit) return explicit;
  const img = settings.quotes?.presenterImage || "assets/presenter.jpg";
  const repo = (process.env.GITHUB_REPOSITORY || "").trim();
  const branch = (process.env.GITHUB_REF_NAME || "main").replace(/^refs\/heads\//, "");
  if (repo) return `https://raw.githubusercontent.com/${repo}/${branch}/${img}`;
  return null;
}

async function waitClip(ml, taskId, settings) {
  const maxWait = Math.min(Number(settings.maxWaitMs) > 0 ? settings.maxWaitMs : 2_400_000, 2_400_000);
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


