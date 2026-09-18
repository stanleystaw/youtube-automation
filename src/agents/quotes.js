import { geminiJson } from "../gemini.js";
import { loadLearnings } from "./memory.js";

export const PRESENTER_LOCK =
  "TOUJOURS la même présentatrice (photo de référence) : jeune femme, cheveux noirs relevés en chignon haut un peu défait, mèches autour du visage, peau mate, sourcils marqués, boucles d'oreilles cadenas or, colliers superposés (rang de perles + chaînes or avec pendentif), top blanc côtelé manches longues encolure en V, elle parle dans un micro podcast noir, studio beige crème, appareils photo Canon sur trépieds en fond, étagères, lumière douce. Ne change PAS son visage, ses vêtements ni le décor.";

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
      ? `Accroche naturelle avec le jour (« C'est ${jour}. ») comme elle le fait souvent.`
      : `Tu PEUX citer le jour (« C'est ${jour}. ») si ça sonne naturel, sans forcer.`;

  const data = await geminiJson({
    apiKey,
    search: false,
    model: settings.strategy?.geminiModel,
    system: `Tu écris des CONSEILS pratiques (pas des citations célèbres) pour YouTube Shorts francophones.
Ton : la présentatrice (jeune femme, micro studio) parle à sa communauté, tutoiement, directe, chaleureuse, comme une grande sœur.
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
- visualPrompt : uniquement un mouvement de caméra (lent push-in, plan poitrine). Ne décris PAS une autre personne.

JSON :
{
  "text": "...",
  "author": "",
  "theme": "discipline|argent|confiance|focus|relations|énergie",
  "title": "titre Short max 70 car",
  "visualPrompt": "mouvement de caméra"
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
    visualPrompt: String(data.visualPrompt || "Plan poitrine, lent push-in, 9:16").trim(),
  };
}

export function clipPrompt({ visualPrompt, spoken, part, total }) {
  const n = total > 1 ? ` Partie ${part}/${total}.` : "";
  return [
    "YouTube Short vertical 9:16, 10 secondes, haute qualité.",
    "Anime la femme de la photo de référence : elle parle, lèvres synchronisées, micro devant elle.",
    PRESENTER_LOCK,
    visualPrompt,
    n,
    "Ton complice, direct, comme une grande sœur qui donne un conseil.",
    "Elle dit EXACTEMENT ce texte, sans rien ajouter :",
    `« ${spoken} »`,
    "Pas de sous-titres inventés. Pas d'autre visage. Pas de changement de tenue.",
  ].join(" ");
}
