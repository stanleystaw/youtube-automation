import { geminiJson } from "../gemini.js";
import { loadLearnings } from "./memory.js";

export function splitQuote(text, maxChars) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return [clean];

  const mid = Math.floor(clean.length / 2);
  const window = clean.slice(Math.max(0, mid - 40), mid + 40);
  const marks = ["… ", ". ", "? ", "! ", "; ", ", ", " : ", " "];
  let cut = -1;
  for (const m of marks) {
    const idx = window.lastIndexOf(m);
    if (idx >= 0) {
      cut = Math.max(0, mid - 40) + idx + m.length;
      break;
    }
  }
  if (cut < 20 || cut > clean.length - 20) cut = mid;
  const a = clean.slice(0, cut).trim();
  const b = clean.slice(cut).trim();
  return b ? [a, b] : [clean];
}

export async function pickQuote({ apiKey, settings, state }) {
  const recent = (state.videos || [])
    .filter((v) => v.kind === "quote")
    .slice(-20)
    .map((v) => v.headline || v.idea)
    .filter(Boolean);

  const data = await geminiJson({
    apiKey,
    search: false,
    model: settings.strategy?.geminiModel,
    system: `Tu écris des citations et paroles de motivation pour YouTube Shorts francophones, audience mondiale.
Force, clarté, rythme oral. Pas de clichés vides, pas de politique partisane, pas de religion agressive.
Réponds UNIQUEMENT en JSON.`,
    prompt: `Crée UNE citation / parole de motivation puissante, à DIRE à voix haute.

Playbook chaîne :
${loadLearnings().playbook || "Ton inspirant, concret, universel."}

Déjà publiées (ne pas répéter) :
${recent.length ? recent.map((t) => `- ${t}`).join("\n") : "(aucune)"}

Contraintes :
- text : français, 1 à 3 phrases, max 280 caractères, oral (pas un essai)
- Si c'est une citation connue, renseigne author. Sinon author vide (originale).
- visualPrompt : scène cinématique verticale 9:16, lumière forte, métaphore visuelle de la phrase.

JSON :
{
  "text": "...",
  "author": "",
  "theme": "discipline|courage|réussite|focus|résilience",
  "title": "titre Short max 70 car",
  "visualPrompt": "décor + caméra + ambiance"
}`,
  });

  const text = String(data.text || "").replace(/\s+/g, " ").trim();
  if (text.length < 20) throw new Error("Citation trop courte");

  return {
    id: `quote-${Date.now()}`,
    text,
    author: String(data.author || "").trim(),
    theme: data.theme || "motivation",
    title: String(data.title || text.slice(0, 70)).trim(),
    visualPrompt: String(data.visualPrompt || "Portrait cinématique, lumière dorée, Slow push-in, 9:16").trim(),
  };
}

export function clipPrompt({ visualPrompt, spoken, part, total }) {
  const n = total > 1 ? ` Partie ${part}/${total}.` : "";
  return [
    "YouTube Short vertical 9:16, 10 secondes, cinématique, haute qualité.",
    visualPrompt,
    n,
    "Une voix off française claire, posée, dit EXACTEMENT ce texte, sans rien ajouter :",
    `« ${spoken} »`,
    "Pas de sous-titres inventés. Ambiance motivation, lumière cinématographique.",
  ].join(" ");
}
