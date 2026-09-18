import { geminiJson } from "../gemini.js";
import { loadLearnings } from "./memory.js";

export async function pickBuzzTopic({ apiKey, settings, state, override }) {
  if (override) {
    return {
      id: `manual-${Date.now()}`,
      headline: override.slice(0, 120),
      magiclightIdea: buildMagiclightIdea({
        headline: override,
        facts: [override],
        angle: "Explication claire des faits, sans fiction.",
      }),
      whyItWillBuzz: "Sujet imposé manuellement",
      facts: [override],
      sources: [],
      manual: true,
    };
  }

  const learnings = loadLearnings();
  const recent = (state.videos || [])
    .slice(-25)
    .map((v) => v.headline || v.title || v.idea)
    .filter(Boolean);

  const data = await geminiJson({
    apiKey,
    search: true,
    model: settings.strategy?.geminiModel,
    system: `Tu es le directeur éditorial d'une chaîne YouTube Shorts francophone (Afrique de l'Ouest, Bénin, diaspora).
Tu ne fais PAS de contes ni de fiction. Uniquement des FAITS d'actualité, expliqués simplement.
Tu t'appuies sur Google Search (événements des dernières 24–48 h).
Tu ne inventes aucun fait. Si tu n'es pas sûr, tu choisis un autre sujet.
Réponds UNIQUEMENT en JSON.`,
    prompt: `Date et fuseau : ${new Date().toISOString()} / ${settings.timezone || "Africa/Porto-Novo"}

Mission : choisir LE sujet du moment le plus susceptible de générer des vues en Shorts francophones.
Priorités : Afrique, Afrique de l'Ouest, Bénin, politique, société, économie, sport, faits surprenants VRAIS, décisions officielles, scandales documentés, records, catastrophes, tech.
Évite : rumeurs, théories du complot, diffamation, contenu pour enfants, horreur gore, NSFW, fiction.

Playbook appris (performances passées) :
${learnings.playbook || "Pas encore de données. Privilégie clarté, un seul fait fort, titre concret."}

Sujets déjà traités (ne pas répéter) :
${recent.length ? recent.map((t) => `- ${t}`).join("\n") : "(aucun)"}

Renvoie ce JSON exact :
{
  "headline": "titre factuel court",
  "whyItWillBuzz": "pourquoi ça va performer aujourd'hui",
  "angle": "angle explicatif en 1 phrase",
  "facts": ["fait 1 vérifiable", "fait 2", "fait 3"],
  "sources": ["url ou média"],
  "hook": "première phrase voix-off qui accroche en 2 secondes",
  "magiclightIdea": "prompt visuel 4-8 phrases pour générer une vidéo EXPLICATIVE (journaliste/documentaire court, pas un conte). Décrire scènes concrètes, cartes, visages anonymisés, infographies, voix off factuelle en français."
}`,
  });

  const headline = String(data.headline || "").trim();
  if (!headline) throw new Error("Gemini n'a pas fourni de sujet");

  const magiclightIdea =
    String(data.magiclightIdea || "").trim() ||
    buildMagiclightIdea({
      headline,
      facts: data.facts || [],
      angle: data.angle,
      hook: data.hook,
    });

  return {
    id: `buzz-${Date.now()}`,
    headline,
    whyItWillBuzz: data.whyItWillBuzz || "",
    angle: data.angle || "",
    facts: Array.isArray(data.facts) ? data.facts : [],
    sources: Array.isArray(data.sources) ? data.sources : [],
    hook: data.hook || "",
    magiclightIdea,
  };
}

function buildMagiclightIdea({ headline, facts, angle, hook }) {
  const list = (facts || []).map((f, i) => `${i + 1}. ${f}`).join(" ");
  return [
    "Vidéo explicative courte en français, style journalistique / documentaire, PAS un conte, PAS de fiction magique.",
    hook ? `Accroche voix-off : ${hook}` : "",
    `Sujet : ${headline}.`,
    angle ? `Angle : ${angle}` : "",
    list ? `Faits à raconter clairement : ${list}` : "",
    "Montrer des scènes concrètes, cartes, journaux, foules, bâtiments officiels, infographies simples.",
    "Ton sérieux, pédagogique, pour YouTube Shorts vertical.",
  ]
    .filter(Boolean)
    .join(" ");
}
