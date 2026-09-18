import fs from "node:fs";
import path from "node:path";
import { env, loadSettings, missingEnv } from "./config.js";
import { MagicLight, extractTaskId, extractStatus, extractProgress, extractVideoUrl, extractTitle, normalizeHistory, isDone, isFailed } from "./magiclight.js";
import { loadState, saveState, findByTask, upsertVideo, publishedToday } from "./state.js";
import { pickNextIdea } from "./ideas.js";
import { googleAuth } from "./google.js";
import { uploadToYoutube } from "./youtube.js";
import { pickBuzzTopic } from "./agents/buzz.js";
import { packForYoutube } from "./agents/seo.js";
import { pickQuote } from "./agents/quotes.js";
import { runLearningLoop } from "./agents/learn.js";
import { produceQuoteClip } from "./clips.js";
import { driveClient, ensureConseilsFolder, uploadVideo, DEFAULT_CONSEILS_FOLDER } from "./drive.js";
import { downloadVideo, tmpPath } from "./download.js";
import { banner, info, ok, warn, fail, step } from "./logger.js";
import { hoursSince, slugify, stamp, sleep, titleFromIdea, zonedClock, isCronRun } from "./utils.js";

const COST = 12;

async function main() {
  banner(`YouTube Automation — ${new Date().toISOString()}`);

  const absent = missingEnv();
  if (absent.length) {
    fail(`Secrets manquants : ${absent.join(", ")}`);
    fail("Ajoute-les dans GitHub → Settings → Secrets and variables → Actions.");
    process.exit(1);
  }

  const settings = loadSettings();
  const cfg = env();
  const ml = new MagicLight(cfg.magiclightKey);
  const youtubeAuthClient = googleAuth({
    clientId: cfg.googleClientId,
    clientSecret: cfg.googleClientSecret,
    refreshToken: cfg.youtubeRefreshToken,
  });
  const driveAuthClient = googleAuth({
    clientId: cfg.googleClientId,
    clientSecret: cfg.googleClientSecret,
    refreshToken: cfg.driveRefreshToken,
  });
  const drive = await driveClient(driveAuthClient);

  const conseilsFolderName = settings.quotes?.driveFolderName || DEFAULT_CONSEILS_FOLDER;
  step("Google Drive — dossier conseils uniquement");
  let folderId = null;
  try {
    folderId = await ensureConseilsFolder(drive, stateFolderHint(), conseilsFolderName);
    ok(`Dossier Drive « ${conseilsFolderName} » (${folderId})`);
  } catch (error) {
    warn(googleAuthError(error).message);
    warn("Drive indisponible — le conseil sera quand même généré (YouTube).");
  }

  let state = loadState();
  if (folderId) state.conseilsFolderId = folderId;

  const persist = async () => {
    saveState({
      videos: state.videos,
      lastStartAt: state.lastStartAt,
      lastQuoteAt: state.lastQuoteAt,
      conseilsFolderId: state.conseilsFolderId || folderId || null,
    });
  };

  await persist();

  try {
    await runLearningLoop({
      apiKey: cfg.geminiKey,
      auth: youtubeAuthClient,
      state,
      settings,
      persist,
    });
  } catch (error) {
    warn(`Agent apprentissage : ${error.message}`);
  }

  step("Compte MagicLight");
  let credits = null;
  try {
    const profile = await ml.me();
    credits = ml.creditsFrom(profile);
    if (credits == null) {
      info(`Profil reçu : ${JSON.stringify(profile).slice(0, 300)}`);
    } else {
      ok(`Crédits disponibles : ${credits} (12 par vidéo complète)`);
    }
  } catch (error) {
    warn(`Impossible de lire le solde : ${error.message}`);
  }

  step("Génération en cours ?");
  let current = await readCurrent(ml);
  if (current?.taskId) {
    info(
      `Tâche ${current.taskId} — statut=${current.status || "?"} progress=${current.progress ?? "?"}%`
    );
    if (!isDone(current.status) && !isFailed(current.status)) {
      current = await waitFor(ml, current.taskId, settings);
    }
  } else {
    info("Aucune génération active.");
  }

  step("Historique des vidéos complètes");
  let history = [];
  try {
    history = normalizeHistory(await ml.history());
    info(`${history.length} entrée(s) dans l'historique.`);
  } catch (error) {
    warn(`Historique indisponible : ${error.message}`);
  }

  const queue = collectPublishQueue({ current, history, state });
  if (!queue.length) {
    info("Rien de nouveau à publier.");
  }

  for (const item of queue) {
    if (!item.taskId) continue;
    if (item.kind === "conseil" || item.kind === "quote" || String(item.taskId).startsWith("vid_")) {
      continue;
    }
    try {
      let fresh = await ml.status(item.taskId);
      let status = extractStatus(fresh) || item.status;
      if (!isDone(status) && !isFailed(status) && !extractVideoUrl(fresh)) {
        info(`Attente de ${item.taskId}…`);
        const waited = await waitFor(ml, item.taskId, settings);
        fresh = waited.data || fresh;
        status = waited.status || status;
      }
      item.videoUrl = extractVideoUrl(fresh) || item.videoUrl;
      item.title = extractTitle(fresh, item.title);
      item.status = status;
      item.idea = item.idea || fresh.idea || fresh.prompt;
    } catch (error) {
      warn(`Statut ${item.taskId} : ${error.message}`);
    }
  }

  for (const item of queue) {
    if (!item.videoUrl && !item.localPath) {
      info(`On attend encore le fichier de ${item.taskId}.`);
      continue;
    }
    try {
      await publishItem({
        item,
        state,
        drive,
        folderId,
        youtubeAuth: youtubeAuthClient,
        settings,
        geminiKey: cfg.geminiKey,
      });
      await persist();
    } catch (error) {
      fail(`Publication ${item.taskId} : ${error.message}`);
      upsertVideo(state, {
        taskId: item.taskId,
        status: "error",
        lastError: error.message,
      });
      await persist();
    }
  }

  current = await readCurrent(ml);
  const newsToday = publishedToday(state, settings.timezone, "news").length;
  const quoteToday =
    publishedToday(state, settings.timezone, "quote").length +
    publishedToday(state, settings.timezone, "conseil").length;
  const clock = zonedClock(settings.timezone);
  info(
    `Aujourd'hui (${settings.timezone}) ${clock.dayName} ${String(clock.hour).padStart(2, "0")}h — actu ${newsToday}/${settings.videosPerDay} · conseils ${quoteToday}/${settings.quotes?.perDay || 2}`
  );

  const category = (process.env.CATEGORY || "auto").trim().toLowerCase();
  const shouldStart = canStart({
    current,
    todayCount: newsToday,
    settings,
    lastStartAt: state.lastStartAt,
    credits,
    forceIdea: Boolean(cfg.ideaOverride),
  });

  if (category === "conseil") {
    info("Catégorie : conseil — pas d’actu sur ce run.");
  } else if (!shouldStart.ok) {
    info(`Pas de nouvelle actu : ${shouldStart.reason}`);
  } else {

  step("Agent buzz — actu MONDIALE (Gemini + Google Search)");
  let topic;
  try {
    topic = await pickBuzzTopic({
      apiKey: cfg.geminiKey,
      settings,
      state,
      override: cfg.ideaOverride,
    });
  } catch (error) {
    warn(`Gemini indisponible (${error.message}) — fallback ideas.json`);
    const fallback = pickNextIdea(state, cfg.ideaOverride);
    topic = {
      id: fallback.id,
      headline: fallback.text,
      magiclightIdea: fallback.text,
      facts: [],
      sources: [],
    };
  }
  info(topic.headline);
  if (topic.whyItWillBuzz) info(topic.whyItWillBuzz);

  try {
    const started = await ml.startFullVideo({
      idea: topic.magiclightIdea,
      ratio: settings.ratio,
      language: settings.language,
    });
    const taskId = extractTaskId(started);
    if (!taskId) {
      warn("Réponse inattendue : task_id manquant.");
    }
    upsertVideo(state, {
      taskId: taskId || `unknown-${Date.now()}`,
      ideaId: topic.id,
      idea: topic.magiclightIdea,
      headline: topic.headline,
      topic,
      kind: "news",
      status: extractStatus(started) || "queued",
      startedAt: new Date().toISOString(),
    });
    state.lastStartAt = new Date().toISOString();
    await persist();
    ok(`Génération lancée (${taskId || "task_id manquant"}) — 12 crédits débités.`);
    info("On attend que MagicLight termine (ça peut prendre plusieurs minutes)…");

    if (taskId) {
      const done = await waitFor(ml, taskId, settings);
      const videoUrl = extractVideoUrl(done.data);
      if (isDone(done.status) && videoUrl) {
        await publishItem({
          item: {
            taskId,
            kind: "news",
            idea: topic.magiclightIdea,
            ideaId: topic.id,
            headline: topic.headline,
            topic,
            title: topic.headline,
            videoUrl,
            status: "done",
          },
          state,
          drive,
          folderId,
          youtubeAuth: youtubeAuthClient,
          settings,
          geminiKey: cfg.geminiKey,
        });
        await persist();
      } else {
        warn("Génération pas encore livrable — le prochain run reprendra.");
      }
    }
  } catch (error) {
    if (error.status === 409) {
      warn(`Une génération est déjà active (${error.taskId || "?"}). On attend le prochain run.`);
      if (error.taskId) {
        upsertVideo(state, { taskId: error.taskId, status: "queued" });
        await persist();
      }
    } else {
      fail(`Lancement impossible : ${error.message}`);
      throw error;
    }
  }
  }

  await maybePublishQuote({
    ml,
    cfg,
    settings,
    state,
    credits,
    drive,
    folderId,
    youtubeAuthClient,
    persist,
  });

  banner("Terminé");
}

async function maybePublishQuote({
  ml,
  cfg,
  settings,
  state,
  credits,
  drive,
  folderId,
  youtubeAuthClient,
  persist,
}) {
  const q = settings.quotes || {};
  if (q.enabled === false) return;
  const category = (process.env.CATEGORY || "auto").trim().toLowerCase();
  if (category === "news") return;
  const forced = category === "conseil";
  const quoteToday =
    publishedToday(state, settings.timezone, "quote").length +
    publishedToday(state, settings.timezone, "conseil").length;
  const cap = Number(q.perDay || 2);
  const clock = zonedClock(settings.timezone);
  const days = Array.isArray(q.days) && q.days.length ? q.days : null;
  if (!forced && isCronRun() && days && !days.includes(clock.weekday)) {
    info(`Conseils : seulement ${daysLabel(days)} (aujourd'hui ${clock.dayName}).`);
    return;
  }
  if (!forced && quoteToday >= cap) {
    info(`Conseils : quota du jour atteint (${cap}).`);
    return;
  }
  if (!forced && hoursSince(state.lastQuoteAt) < Number(q.minHoursBetween || 4)) {
    info("Conseils : espacement pas encore écoulé.");
    return;
  }
  if (credits != null && credits < 7) {
    info("Conseils : crédits insuffisants.");
    return;
  }
  if (!cfg.geminiKey) {
    warn("Conseils : GEMINI_API_KEY manquante.");
    return;
  }

  step(`Agent conseils — ${clock.dayName}`);
  let quote;
  try {
    quote = await pickQuote({
      apiKey: cfg.geminiKey,
      settings,
      state,
      dayName: clock.dayName,
    });
  } catch (error) {
    warn(`Conseil Gemini : ${error.message}`);
    return;
  }
  info(quote.text);
  let clip;
  try {
    clip = await produceQuoteClip({
      ml,
      quote,
      settings,
      drive,
      folderId,
      state,
    });
  } catch (error) {
    fail(`Clip conseil : ${error.message}`);
    throw error;
  }
  const taskId = clip.taskIds[0];
  upsertVideo(state, {
    taskId,
    kind: "conseil",
    ideaId: quote.id,
    idea: quote.text,
    headline: quote.title,
    topic: { headline: quote.title, facts: [quote.text], angle: quote.theme },
    status: "generated",
    startedAt: new Date().toISOString(),
    localPath: clip.filePath,
    clipTaskIds: clip.taskIds,
    durationSec: clip.durationSec,
  });
  await persist();
  try {
    await publishItem({
      item: {
        taskId,
        kind: "conseil",
        idea: quote.text,
        ideaId: quote.id,
        headline: quote.title,
        topic: { headline: quote.title, facts: [quote.text], angle: quote.theme },
        title: quote.title,
        localPath: clip.filePath,
        videoUrl: "file://local",
        status: "done",
      },
      state,
      drive,
      folderId,
      youtubeAuth: youtubeAuthClient,
      settings,
      geminiKey: cfg.geminiKey,
    });
    state.lastQuoteAt = new Date().toISOString();
    await persist();
  } catch (error) {
    fail(`Publication conseil : ${error.message}`);
    upsertVideo(state, { taskId, status: "error", lastError: error.message });
    await persist();
  }
}

function canStart({ current, todayCount, settings, lastStartAt, credits, forceIdea }) {
  if (current?.taskId && !isDone(current.status) && !isFailed(current.status)) {
    return { ok: false, reason: `tâche ${current.taskId} encore active` };
  }
  if (todayCount >= settings.videosPerDay) {
    return { ok: false, reason: `quota du jour atteint (${settings.videosPerDay})` };
  }
  if (credits != null && credits < COST) {
    return { ok: false, reason: `crédits insuffisants (${credits} < ${COST})` };
  }
  if (!forceIdea && isCronRun()) {
    const { hour } = zonedClock(settings.timezone);
    const window = Array.isArray(settings.newsHours) && settings.newsHours.length ? settings.newsHours : [19, 20];
    if (!window.includes(hour)) {
      return {
        ok: false,
        reason: `hors créneau actu (${window.join("/")}h ${settings.timezone}, il est ${hour}h)`,
      };
    }
  }
  if (!forceIdea && hoursSince(lastStartAt) < settings.minHoursBetweenStarts) {
    const left = (settings.minHoursBetweenStarts - hoursSince(lastStartAt)).toFixed(1);
    return { ok: false, reason: `espacement : encore ${left} h avant le prochain lancement` };
  }
  return { ok: true };
}

function daysLabel(days) {
  const names = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  return days.map((d) => names[d] || d).join(" et ");
}

async function readCurrent(ml) {
  try {
    const data = await ml.current();
    const taskId = extractTaskId(data);
    const status = extractStatus(data);
    if (!taskId && !status) return null;
    if (["none", "idle", "empty"].includes(status) && !taskId) return null;
    return {
      data,
      taskId,
      status,
      progress: extractProgress(data),
      videoUrl: extractVideoUrl(data),
      title: extractTitle(data, null),
      idea: data?.idea || data?.prompt || null,
    };
  } catch (error) {
    if ([401, 402, 403].includes(error.status)) throw error;
    if ([404, 204].includes(error.status)) return null;
    warn(`current : ${error.message}`);
    return null;
  }
}

async function waitFor(ml, taskId, settings) {
  const maxWait = settings.maxWaitMs > 0 ? Math.min(settings.maxWaitMs, 600_000) : 600_000;
  const deadline = Date.now() + maxWait;
  let last = -1;
  while (Date.now() < deadline) {
    const data = await ml.status(taskId);
    const status = extractStatus(data);
    const progress = extractProgress(data);
    if (progress !== last) {
      info(`… ${taskId} ${status || "?"} ${progress ?? 0}%`);
      last = progress;
    }
    if (isDone(status)) return { data, status, taskId, videoUrl: extractVideoUrl(data) };
    if (isFailed(status)) {
      throw new Error(`Génération ${taskId} : ${status}`);
    }
    await sleep(settings.pollIntervalMs || 20000);
  }
  warn(`Délai d'attente dépassé pour ${taskId} — on reprendra au prochain run.`);
  return { data: {}, status: "timeout", taskId };
}

function collectPublishQueue({ current, history, state }) {
  const map = new Map();

  const consider = (row) => {
    if (!row?.taskId) return;
    const known = findByTask(state, row.taskId);
    const kind = row.kind || known?.kind || "news";
    const needDrive = kind === "conseil" || kind === "quote";
    if (known?.youtubeId && (!needDrive || known?.driveFileId)) return;
    const status = row.status || known?.status || "";
    const videoUrl = row.videoUrl || known?.videoUrl;
    if (isFailed(status)) return;
    map.set(row.taskId, {
      taskId: row.taskId,
      kind: row.kind || known?.kind,
      idea: row.idea || known?.idea,
      ideaId: known?.ideaId || row.ideaId,
      headline: row.headline || known?.headline,
      topic: row.topic || known?.topic,
      seo: known?.seo,
      title: row.title || known?.title,
      videoUrl,
      localPath: row.localPath || known?.localPath,
      status: status || "done",
      driveFileId: known?.driveFileId,
      youtubeId: known?.youtubeId,
    });
  };

  if (current && (isDone(current.status) || current.videoUrl)) {
    consider(current);
  }
  for (const item of history) consider(item);
  for (const v of state.videos) {
    if ((v.videoUrl || v.localPath) && !v.youtubeId) consider(v);
  }

  return [...map.values()];
}

async function publishItem({ item, state, drive, folderId, youtubeAuth, settings, geminiKey }) {
  banner(`Publication ${item.taskId}`);
  const idea = item.idea || item.headline || "Vidéo IA";
  const known = findByTask(state, item.taskId) || {};
  const topic = item.topic || known.topic || { headline: item.headline || known.headline || idea };

  const kind = item.kind || known.kind || "news";
  step("Agent SEO — titre, description, hashtags");
  const seo =
    item.seo ||
    known.seo ||
    (await packForYoutube({ apiKey: geminiKey, settings, topic, idea, kind }));
  const title = seo.title || item.title || titleFromIdea(idea);
  const fileName = `${stamp(settings.timezone)}_${slugify(title)}.mp4`;
  const filePath = tmpPath(fileName);

  const localPath =
    (item.localPath && fs.existsSync(item.localPath) && item.localPath) ||
    (known.localPath && fs.existsSync(known.localPath) && known.localPath) ||
    null;

  if (localPath) {
    step("Fichier local (clip conseil)");
    if (path.resolve(localPath) !== path.resolve(filePath)) {
      fs.copyFileSync(localPath, filePath);
    }
  } else {
    if (!item.videoUrl || String(item.videoUrl).startsWith("file:")) {
      throw new Error("Pas d'URL vidéo — génération pas encore prête");
    }
    step("Téléchargement");
    await downloadVideo(item.videoUrl, filePath);
  }
  ok(`Fichier : ${filePath} (${fs.statSync(filePath).size} octets)`);

  const isConseil = kind === "conseil" || kind === "quote";
  let driveFileId = item.driveFileId || known.driveFileId;
  let driveUrl = item.driveUrl || known.driveUrl;
  if (isConseil && !driveFileId && folderId) {
    step(`Upload Drive « ${settings.quotes?.driveFolderName || DEFAULT_CONSEILS_FOLDER} »`);
    try {
      const uploaded = await uploadVideo({
        drive,
        folderId,
        filePath,
        name: fileName,
        description: idea,
      });
      driveFileId = uploaded.id;
      driveUrl = uploaded.webViewLink;
      ok(`Drive : ${driveUrl || driveFileId}`);
      upsertVideo(state, {
        taskId: item.taskId,
        kind,
        idea,
        ideaId: item.ideaId,
        headline: topic.headline,
        topic,
        seo,
        title,
        videoUrl: item.videoUrl,
        driveFileId,
        driveUrl,
        status: "uploaded_drive",
      });
    } catch (error) {
      warn(`Drive : ${googleAuthError(error).message}`);
    }
  } else if (isConseil && !driveFileId) {
    warn("Pas de dossier Drive — YouTube uniquement.");
  } else if (!isConseil) {
    info("Actu : YouTube uniquement — pas de copie sur Drive.");
  } else {
    info("Déjà présent sur Drive.");
  }

  if (!item.youtubeId) {
    step("Upload YouTube");
    const yt = await uploadToYoutube({
      auth: youtubeAuth,
      filePath,
      idea,
      title,
      description: seo.description,
      tags: seo.tags,
      settings,
    });
    ok(`YouTube : ${yt.url}`);
    upsertVideo(state, {
      taskId: item.taskId,
      kind,
      idea,
      ideaId: item.ideaId,
      headline: topic.headline,
      topic,
      seo,
      title: yt.title,
      videoUrl: item.videoUrl,
      driveFileId,
      driveUrl,
      youtubeId: yt.id,
      youtubeUrl: yt.url,
      publishedAt: new Date().toISOString(),
      status: "published",
    });
  } else {
    info("Déjà publié sur YouTube.");
    upsertVideo(state, {
      taskId: item.taskId,
      driveFileId,
      driveUrl,
      youtubeId: item.youtubeId,
      status: "published",
    });
  }

  try {
    fs.unlinkSync(filePath);
  } catch {
  }
}

function stateFolderHint() {
  try {
    return loadState().conseilsFolderId || null;
  } catch {
    return null;
  }
}

function googleAuthError(error) {
  const msg = String(error.message || error);
  if (/invalid_grant/i.test(msg)) {
    const wrapped = new Error(
      "invalid_grant : relance YouTube puis Drive (npm run auth) et mets à jour les secrets GOOGLE_REFRESH_TOKEN_*."
    );
    wrapped.cause = error;
    return wrapped;
  }
  return error;
}

main().catch((error) => {
  fail(googleAuthError(error).message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
