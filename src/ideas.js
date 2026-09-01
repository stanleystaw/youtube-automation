import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { usedIdeaIds } from "./state.js";

export function loadIdeas() {
  const file = path.join(ROOT, "config", "ideas.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return data.ideas || [];
}

export function pickNextIdea(state, overrideText) {
  if (overrideText) {
    return {
      id: `custom-${Date.now()}`,
      text: overrideText,
      tags: ["custom"],
    };
  }

  const ideas = loadIdeas();
  if (!ideas.length) {
    throw new Error("Aucune idée dans config/ideas.json — ajoute-en avant de lancer.");
  }

  const used = usedIdeaIds(state);
  const fresh = ideas.filter((idea) => !used.has(idea.id));
  if (fresh.length) return fresh[0];

  console.warn("⚠  Toutes les idées ont déjà été utilisées — on recycle la plus ancienne.");
  const lastUse = new Map();
  for (const video of state.videos) {
    if (video.ideaId) lastUse.set(video.ideaId, video.startedAt || video.publishedAt || "");
  }
  return [...ideas].sort(
    (a, b) => (lastUse.get(a.id) || "").localeCompare(lastUse.get(b.id) || "")
  )[0];
}
