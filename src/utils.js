export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function slugify(text, max = 60) {
  return String(text || "video")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "video";
}

export function truncate(text, max) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function todayKey(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function stamp(timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date())
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}`;
}

export function hoursSince(iso) {
  if (!iso) return Infinity;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 3_600_000;
}

export function pick(obj, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export async function withRetry(fn, { attempts = 4, delayMs = 2000, label = "requête" } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error);
      if (!retryable || i === attempts) break;
      const wait = delayMs * i;
      console.warn(`↻ ${label} échouée (${error.message}) — nouvel essai dans ${wait / 1000}s [${i}/${attempts}]`);
      await sleep(wait);
    }
  }
  throw lastError;
}

function isRetryable(error) {
  const status = error.status || error.code;
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  const msg = String(error.message || "").toLowerCase();
  return /network|fetch|econnreset|etimedout|socket|429|temporar/.test(msg);
}

export function titleFromIdea(idea) {
  const clean = String(idea || "")
    .replace(/^["«]+|["»]+$/g, "")
    .trim();
  const first = clean.split(/[.!?…]/)[0] || clean;
  return truncate(first, 95);
}
