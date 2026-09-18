import { withRetry } from "./utils.js";

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
];

export async function geminiJson({
  apiKey,
  prompt,
  system,
  search = false,
  model,
}) {
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY manquante");
    err.code = "MISSING_ENV";
    throw err;
  }

  const contents = [];
  if (system) {
    contents.push({ role: "user", parts: [{ text: system }] });
    contents.push({
      role: "model",
      parts: [{ text: "Compris. Je répondrai uniquement en JSON valide." }],
    });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const tried = model ? [model, ...MODELS.filter((m) => m !== model)] : MODELS;
  let lastError;
  for (const id of tried) {
    try {
      const text = await generate({ apiKey, model: id, contents, search });
      return parseJson(text);
    } catch (error) {
      lastError = error;
      if (error.status === 404 || /not found|not supported/i.test(error.message)) {
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("Gemini indisponible");
}

async function generate({ apiKey, model, contents, search }) {
  return withRetry(
    async () => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const body = {
        contents,
        generationConfig: {
          temperature: search ? 0.4 : 0.7,
          maxOutputTokens: 4096,
        },
      };
      if (search) body.tools = [{ google_search: {} }];

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error?.message || data.message || `Gemini HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      const text = (data.candidates || [])
        .flatMap((c) => c.content?.parts || [])
        .map((p) => p.text || "")
        .join("\n")
        .trim();
      if (!text) throw new Error("Réponse Gemini vide");
      return text;
    },
    { label: `gemini ${model}`, attempts: 3, delayMs: 1500 }
  );
}

function parseJson(text) {
  const cleaned = String(text)
    .replace(/```json/gi, "```")
    .trim();
  const fence = cleaned.match(/```([\s\S]*?)```/);
  const raw = (fence ? fence[1] : cleaned).trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("Gemini n'a pas renvoyé de JSON valide");
  }
}
