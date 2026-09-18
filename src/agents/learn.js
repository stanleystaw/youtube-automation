import { geminiJson } from "../gemini.js";
import { appendNote, loadLearnings } from "./memory.js";
import { fetchVideoStats } from "../youtube.js";
import { info, ok, step, warn } from "../logger.js";

const DAY_MS = 86_400_000;

export async function runLearningLoop({ apiKey, auth, state, settings, persist }) {
  const days = Number(settings.strategy?.learnAfterDays || 3);
  const now = Date.now();
  const due = (state.videos || []).filter((v) => {
    if (!v.youtubeId || v.status !== "published") return false;
    if (v.learnedAt) return false;
    const published = new Date(v.publishedAt || v.startedAt || 0).getTime();
    if (!published) return false;
    return now - published >= days * DAY_MS;
  });

  if (!due.length) {
    info(`Agent apprentissage : aucune vidéo de plus de ${days} jours à analyser.`);
    return null;
  }

  step(`Agent apprentissage — ${due.length} vidéo(s) à J+${days}`);

  let stats = [];
  try {
    stats = await fetchVideoStats(
      auth,
      due.map((v) => v.youtubeId)
    );
  } catch (error) {
    warn(`Stats YouTube : ${error.message}`);
    return null;
  }

  const rows = due.map((v) => {
    const s = stats.find((x) => x.id === v.youtubeId) || {};
    const st = s.statistics || {};
    return {
      youtubeId: v.youtubeId,
      youtubeUrl: v.youtubeUrl,
      title: v.title || v.headline || v.idea,
      headline: v.headline,
      publishedAt: v.publishedAt,
      views: Number(st.viewCount || 0),
      likes: Number(st.likeCount || 0),
      comments: Number(st.commentCount || 0),
      favorites: Number(st.favoriteCount || 0),
    };
  });

  for (const row of rows) {
    const video = state.videos.find((v) => v.youtubeId === row.youtubeId);
    if (video) {
      video.stats = {
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  let analysis = {
    summary: "Analyse automatique sans Gemini.",
    playbook: loadLearnings().playbook,
    rules: [],
  };

  if (apiKey) {
    try {
      analysis = await geminiJson({
        apiKey,
        search: false,
        model: settings.strategy?.geminiModel,
        system: `Tu es un stratège YouTube Shorts. Tu analyses des chiffres RÉELS pour améliorer les prochains prompts.
Pas de blabla. JSON uniquement.`,
        prompt: `Voici les vidéos publiées il y a au moins ${days} jours, avec leurs stats :

${JSON.stringify(rows, null, 2)}

Playbook actuel :
${loadLearnings().playbook || "(vide)"}

Dis ce qui a marché (vues, likes, commentaires), ce qui a flopé, et comment formuler les PROCHAINS sujets / titres / accroches.
Audience : francophone Afrique de l'Ouest, format faits explicatifs (pas de contes).

JSON :
{
  "summary": "5-8 lignes",
  "winners": [{"title": "...", "views": 0, "why": "..."}],
  "losers": [{"title": "...", "views": 0, "why": "..."}],
  "rules": ["règle actionnable 1", "règle 2", "règle 3"],
  "playbook": "consigne unique (15-25 lignes) que l'agent buzz lira avant de choisir le prochain sujet"
}`,
      });
    } catch (error) {
      warn(`Gemini apprentissage : ${error.message}`);
    }
  }

  const note = {
    at: new Date().toISOString(),
    videoIds: rows.map((r) => r.youtubeId),
    stats: rows,
    summary: analysis.summary || "",
    winners: analysis.winners || [],
    losers: analysis.losers || [],
    rules: analysis.rules || [],
    playbook: analysis.playbook || loadLearnings().playbook,
  };
  appendNote(note);

  const learnedAt = new Date().toISOString();
  for (const row of rows) {
    const video = state.videos.find((v) => v.youtubeId === row.youtubeId);
    if (video) video.learnedAt = learnedAt;
  }
  if (persist) await persist();

  ok(`Notes d'apprentissage enregistrées (${rows.length} vidéos).`);
  if (note.summary) info(note.summary.slice(0, 400));
  return note;
}
