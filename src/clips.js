import fs from "node:fs";
import { extractTaskId, extractStatus, extractVideoUrl, isDone, isFailed } from "./magiclight.js";
import { downloadVideo, tmpPath } from "./download.js";
import { fitSpoken, clipPrompt } from "./agents/quotes.js";
import { info, ok, step, warn } from "./logger.js";
import { sleep } from "./utils.js";

const CLIP_COST = 7;
const MAX_WAIT_MS = 600_000;

export async function produceQuoteClip({
  ml,
  quote,
  settings,
}) {
  const maxChars = Number(settings.quotes?.maxCharsFor10s || 140);
  const duration = Number(settings.quotes?.duration || 10);
  const quality = settings.quotes?.quality || "high";
  const spoken = fitSpoken(
    quote.author ? `${quote.text} — ${quote.author}` : quote.text,
    maxChars
  );

  const presenterUrl = resolvePresenterUrl(settings);
  if (presenterUrl) info(`Présentatrice (référence) : ${presenterUrl}`);
  else warn("Pas de photo présentatrice — MagicLight improvisera le visage.");

  info(`Conseil 10s (${spoken.length} car.)`);

  const prompt = clipPrompt({
    visualPrompt: quote.visualPrompt,
    spoken,
  });
  step("Clip MagicLight 10s");
  const started = await ml.startClip({
    prompt,
    duration,
    quality,
    imageUrl: presenterUrl || undefined,
  });
  const taskId = extractTaskId(started);
  if (!taskId) throw new Error("Clip sans task_id");
  const done = await waitClip(ml, taskId, settings);
  const url = extractVideoUrl(done.data) || ml.clipDownloadUrl(taskId);
  const file = tmpPath(`quote-${taskId}.mp4`);
  await downloadVideo(url, file);
  ok(`Clip : ${file} (${fs.statSync(file).size} o)`);

  return {
    filePath: file,
    taskIds: [taskId],
    parts: 1,
    credits: CLIP_COST,
    durationSec: duration,
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
  const configured = Number(settings.maxWaitMs);
  const maxWait = configured > 0 ? Math.min(configured, MAX_WAIT_MS) : MAX_WAIT_MS;
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
