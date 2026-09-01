import fs from "node:fs";
import { env, loadSettings, missingEnv } from "./config.js";
import { MagicLight, extractTaskId, extractStatus, extractProgress, extractVideoUrl, extractTitle, normalizeHistory, isDone, isFailed } from "./magiclight.js";
import { loadState, saveState, findByTask, upsertVideo, publishedToday } from "./state.js";
import { pickNextIdea } from "./ideas.js";
import { googleAuth } from "./google.js";
import { uploadToYoutube } from "./youtube.js";
import { driveClient, ensureFolder, uploadVideo, pullRemoteState, pushRemoteState, mergeStates } from "./drive.js";
import { downloadVideo, tmpPath } from "./download.js";
import { banner, info, ok, warn, fail, step } from "./logger.js";
import { hoursSince, slugify, stamp, sleep, titleFromIdea } from "./utils.js";

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
  const auth = googleAuth(cfg);
  const drive = await driveClient(auth);

  step("Connexion Google Drive");
  const folderId = await ensureFolder(drive, cfg.driveFolderId || settings.driveFolderId);
  ok(`Dossier Drive prêt (${folderId})`);

  let state = loadState();
  try {
    const remote = await pullRemoteState(drive, folderId);
    state = mergeStates(state, remote.state);
    state._driveStateId = remote.fileId;
  } catch (error) {
    warn(`État Drive illisible (${error.message}) — on continue avec l'état local.`);
  }

  const persist = async () => {
    saveState({ videos: state.videos, lastStartAt: state.lastStartAt });
    try {
      state._driveStateId = await pushRemoteState(
        drive,
        folderId,
        state._driveStateId || null,
        { videos: state.videos, lastStartAt: state.lastStartAt }
      );
    } catch (error) {
      warn(`Sauvegarde Drive de l'état : ${error.message}`);
    }
  };

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
    if (settings.maxWaitMs > 0 && isRunning(current.status)) {
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
    if (!item.videoUrl && item.taskId) {
      try {
        const fresh = await ml.status(item.taskId);
        item.videoUrl = extractVideoUrl(fresh) || item.videoUrl;
        item.title = extractTitle(fresh, item.title);
        item.status = extractStatus(fresh) || item.status;
        item.idea = item.idea || fresh.idea || fresh.prompt;
      } catch (error) {
        warn(`Statut ${item.taskId} : ${error.message}`);
      }
    }
  }

  for (const item of queue) {
    if (!item.videoUrl) {
      info(`On attend encore le fichier de ${item.taskId}.`);
      continue;
    }
    try {
      await publishItem({ item, state, drive, folderId, auth, settings });
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
  const today = publishedToday(state, settings.timezone);
  const todayCount = today.length;
  info(`Vidéos du jour (${settings.timezone}) : ${todayCount}/${settings.videosPerDay}`);

  const shouldStart = canStart({
    current,
    todayCount,
    settings,
    lastStartAt: state.lastStartAt,
    credits,
    forceIdea: Boolean(cfg.ideaOverride),
  });

  if (!shouldStart.ok) {
    info(`Pas de nouvelle génération : ${shouldStart.reason}`);
    banner("Terminé");
    return;
  }

  const idea = pickNextIdea(state, cfg.ideaOverride);
  step(`Lancement — ${idea.id}`);
  info(idea.text);

  try {
    const started = await ml.startFullVideo({
      idea: idea.text,
      ratio: settings.ratio,
      language: settings.language,
    });
    const taskId = extractTaskId(started);
    if (!taskId) {
      warn(`Réponse inattendue : ${JSON.stringify(started).slice(0, 500)}`);
    }
    upsertVideo(state, {
      taskId: taskId || `unknown-${Date.now()}`,
      ideaId: idea.id,
      idea: idea.text,
      status: extractStatus(started) || "queued",
      startedAt: new Date().toISOString(),
      magiclight: started,
    });
    state.lastStartAt = new Date().toISOString();
    await persist();
    ok(`Génération lancée (${taskId || "task_id manquant"}) — 12 crédits débités.`);
    info("Le serveur continue tout seul. Le prochain run GitHub Actions publiera la vidéo.");

    if (settings.maxWaitMs > 0 && taskId) {
      const done = await waitFor(ml, taskId, settings);
      if (isDone(done.status) && extractVideoUrl(done.data)) {
        await publishItem({
          item: {
            taskId,
            idea: idea.text,
            ideaId: idea.id,
            title: extractTitle(done.data, titleFromIdea(idea.text)),
            videoUrl: extractVideoUrl(done.data),
            status: "done",
          },
          state,
          drive,
          folderId,
          auth,
          settings,
        });
        await persist();
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

  banner("Terminé");
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
  if (!forceIdea && hoursSince(lastStartAt) < settings.minHoursBetweenStarts) {
    const left = (settings.minHoursBetweenStarts - hoursSince(lastStartAt)).toFixed(1);
    return { ok: false, reason: `espacement : encore ${left} h avant le prochain lancement` };
  }
  return { ok: true };
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
  const deadline = Date.now() + settings.maxWaitMs;
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
    if (known?.youtubeId && known?.driveFileId) return;
    const status = row.status || known?.status || "";
    const videoUrl = row.videoUrl || known?.videoUrl;
    if (!videoUrl && !isDone(status)) return;
    if (isFailed(status)) return;
    map.set(row.taskId, {
      taskId: row.taskId,
      idea: row.idea || known?.idea,
      ideaId: known?.ideaId,
      title: row.title || known?.title,
      videoUrl,
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
    if (v.videoUrl && !v.youtubeId) consider(v);
  }

  return [...map.values()];
}

async function publishItem({ item, state, drive, folderId, auth, settings }) {
  banner(`Publication ${item.taskId}`);
  const idea = item.idea || "Vidéo IA";
  const title = item.title || titleFromIdea(idea);
  const fileName = `${stamp(settings.timezone)}_${slugify(title)}.mp4`;
  const filePath = tmpPath(fileName);

  if (!item.videoUrl) {
    throw new Error("Pas d'URL vidéo — génération pas encore prête");
  }

  step("Téléchargement");
  await downloadVideo(item.videoUrl, filePath);
  ok(`Fichier : ${filePath} (${fs.statSync(filePath).size} octets)`);

  let driveFileId = item.driveFileId;
  let driveUrl = item.driveUrl;
  if (!driveFileId) {
    step("Upload Google Drive");
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
      idea,
      ideaId: item.ideaId,
      title,
      videoUrl: item.videoUrl,
      driveFileId,
      driveUrl,
      status: "uploaded_drive",
    });
  } else {
    info("Déjà présent sur Drive.");
  }

  if (!item.youtubeId) {
    step("Upload YouTube");
    const yt = await uploadToYoutube({
      auth,
      filePath,
      idea,
      title,
      settings,
    });
    ok(`YouTube : ${yt.url}`);
    upsertVideo(state, {
      taskId: item.taskId,
      idea,
      ideaId: item.ideaId,
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
    /* ignore */
  }
}

main().catch((error) => {
  fail(error.stack || error.message);
  process.exit(1);
});
