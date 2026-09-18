import { geminiJson } from "../gemini.js";
import { truncate } from "../utils.js";

export async function packForYoutube({ apiKey, settings, topic, idea, kind = "news" }) {
  const isConseil = kind === "conseil" || kind === "quote";
  const fallback = fallbackSeo({ topic, idea, settings, kind });
  if (!apiKey) return fallback;

  try {
    const data = await geminiJson({
      apiKey,
      search: false,
      model: settings.strategy?.geminiModel,
      system: `Tu es un expert YouTube Shorts francophone (Afrique). Tu maximises clics HONNÊTES : pas de clickbait mensonger.
Réponds UNIQUEMENT en JSON.`,
      prompt: isConseil
        ? `Prépare le packaging YouTube d'un Short CONSEIL (jeune femme qui parle à la caméra).

Conseil : ${topic?.headline || idea}
Texte dit : ${(topic?.facts || []).join(" | ") || idea}
Thème : ${topic?.angle || "conseil"}

Contraintes :
- title : max 90 caractères, fort, tutoiement possible, français, pas de ALL CAPS
- description : 4–8 lignes, le conseil + CTA abonne-toi, mention IA obligatoire
- tags : 8 à 15 mots-clés (conseil, motivation, développement personnel)
- hashtags : 5 à 8, dont #shorts #conseil

JSON :
{
  "title": "...",
  "description": "...",
  "tags": ["..."],
  "hashtags": ["#shorts", "#conseil"]
}`
        : `Prépare le packaging YouTube d'une vidéo explicative (faits, pas fiction).

Headline : ${topic?.headline || idea}
Angle : ${topic?.angle || ""}
Faits : ${(topic?.facts || []).join(" | ")}
Pourquoi buzz : ${topic?.whyItWillBuzz || ""}

Contraintes :
- title : max 90 caractères, fort, factuel, français, pas de ALL CAPS
- description : 4–8 lignes, faits + CTA abonne-toi, mention IA obligatoire
- tags : 8 à 15 mots-clés
- hashtags : 5 à 8, dont #shorts, adaptés actu/Afrique si pertinent

JSON :
{
  "title": "...",
  "description": "...",
  "tags": ["..."],
  "hashtags": ["#shorts", "#actu"]
}`,
    });

    const title = truncate(String(data.title || fallback.title), 100);
    const hashtags = normalizeTags(data.hashtags, true);
    let description = String(data.description || fallback.description).trim();
    if (!/#shorts/i.test(description)) {
      description = `${description}\n\n${hashtags.join(" ")}`;
    }
    if (!/intelligence artificielle|généré par ia|contenu.{0,20}ia/i.test(description)) {
      description += "\n\n🎬 Contenu généré par intelligence artificielle.";
    }

    return {
      title,
      description: truncate(description, 4900),
      tags: unique([
        ...normalizeTags(data.tags, false),
        ...hashtags.map((h) => h.replace(/^#/, "")),
        ...(settings.youtube?.tags || []),
      ]).slice(0, 20),
      hashtags,
    };
  } catch (error) {
    console.warn(`⚠  SEO Gemini indisponible (${error.message}) — fallback.`);
    return fallback;
  }
}

function fallbackSeo({ topic, idea, settings, kind = "news" }) {
  const isConseil = kind === "conseil" || kind === "quote";
  const title = truncate(
    topic?.headline || idea || (isConseil ? "Un conseil pour aujourd'hui" : "L'info du jour expliquée"),
    90
  );
  const hashtags = isConseil
    ? ["#shorts", "#conseil", "#motivation", "#developpementpersonnel", "#ia"]
    : ["#shorts", "#actu", "#faits", "#afrique", "#ia"];
  const description = [
    title,
    "",
    topic?.angle || idea || "",
    "",
    ...(topic?.facts || []).map((f) => `• ${f}`),
    "",
    hashtags.join(" "),
    "",
    "🎬 Vidéo générée par intelligence artificielle. Contenu synthétique.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
  return {
    title,
    description: truncate(description, 4900),
    tags: unique([
      ...(settings.youtube?.tags || []),
      ...(isConseil ? ["conseil", "motivation", "shorts"] : ["actu", "faits", "shorts", "afrique"]),
    ]).slice(0, 20),
    hashtags,
  };
}

function normalizeTags(list, hash) {
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => {
      const bare = t.replace(/^#/, "");
      return hash ? `#${bare.replace(/\s+/g, "")}` : bare;
    });
}

function unique(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x).toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
