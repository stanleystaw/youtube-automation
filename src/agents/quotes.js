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

export async function pickQuote({ apiKey, settings, state, dayName }) {
  const recent = (state.videos || [])
    .filter((v) => v.kind === "quote" || v.kind === "conseil")
    .slice(-20)
    .map((v) => v.headline || v.idea)
    .filter(Boolean);

  const jour = dayName || "aujourd'hui";
  const hookJour =
    jour === "mardi" || jour === "jeudi"
      ? `Accroche naturelle avec le jour (« C'est ${jour}. » / « ${jour[0].toUpperCase()}${jour.slice(1)}. ») comme une coach qui parle à sa communauté.`
      : `Pas besoin de citer le jour.`;

  const data = await geminiJson({
    apiKey,
    search: false,
    model: settings.strategy?.geminiModel,
    system: `Tu écris des CONSEILS pratiques (pas des citations célèbres) pour YouTube Shorts francophones.
Ton : jeune femme qui parle à la caméra, tutoiement, directe, chaleureuse, comme une grande sœur.
Un vrai conseil actionnable — pas un slogan vide, pas de politique, pas de religion agressive, pas de citation d'auteur connu.
Réponds UNIQUEMENT en JSON.`,
    prompt: `Crée UN conseil à DIRE à voix haute. Aujourd'hui on est ${jour}.

${hookJour}

Playbook chaîne :
${loadLearnings().playbook || "Concret, oral, utile tout de suite."}

Déjà publiés (ne pas répéter) :
${recent.length ? recent.map((t) => `- ${t}`).join("\n") : "(aucun)"}

Contraintes :
- text : français, tutoiement, 1 à 3 phrases, max 260 caractères, rythme oral
- Ce n'est PAS une citation. C'est UN conseil (travail, argent, discipline, confiance, focus, relations respectueuses)
- author : toujours vide
- visualPrompt : jeune femme francophone, 25-30 ans, plan poitrine, parle à la caméra, lumière naturelle, fond simple et chaleureux, vertical 9:16

JSON :
{
  "text": "...",
  "author": "",
  "theme": "discipline|argent|confiance|focus|relations|énergie",
  "title": "titre Short max 70 car",
  "visualPrompt": "décor + caméra + ambiance"
}`,
  });

  const text = String(data.text || "").replace(/\s+/g, " ").trim();
  if (text.length < 20) throw new Error("Conseil trop court");

  return {
    id: `conseil-${Date.now()}`,
    text,
    author: "",
    theme: data.theme || "conseil",
    title: String(data.title || text.slice(0, 70)).trim(),
    visualPrompt: String(
      data.visualPrompt ||
        "Jeune femme francophone, plan poitrine, parle à la caméra, lumière naturelle, fond chaleureux, 9:16"
    ).trim(),
  };
}

export function clipPrompt({ visualPrompt, spoken, part, total }) {
  const n = total > 1 ? ` Partie ${part}/${total}.` : "";
  return [
    "YouTube Short vertical 9:16, 10 secondes, cinématique, haute qualité.",
    "Jeune femme francophone, 25-30 ans, parle DIRECTEMENT à la caméra (plan poitrine), lumière naturelle, fond simple et chaleureux.",
    visualPrompt,
    n,
    "Ton complice, direct, comme une grande sœur qui donne un conseil.",
    "Elle dit EXACTEMENT ce texte, sans rien ajouter :",
    `« ${spoken} »`,
    "Pas de sous-titres inventés. Pas de citation célèbre à l'écran.",
  ].join(" ");
}
