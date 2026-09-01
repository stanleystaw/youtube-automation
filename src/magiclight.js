import { pick, withRetry } from "./utils.js";

const BASE = "https://magiclight-api-gamma.vercel.app";

export class MagicLight {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async me() {
    return this.request("GET", "/stanleystawa/accounts?action=me");
  }

  creditsFrom(profile) {
    const value = pick(profile, [
      "credits",
      "balance",
      "credit",
      "user.credits",
      "account.credits",
      "data.credits",
    ]);
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async startFullVideo({ idea, ratio, language }) {
    return this.request("POST", "/stanleystawa/fullvideo", {
      idea,
      ratio,
      language,
    });
  }

  async status(taskId) {
    return this.request(
      "GET",
      `/stanleystawa/fullvideo?task_id=${encodeURIComponent(taskId)}`
    );
  }

  async current() {
    return this.request("GET", "/stanleystawa/fullvideo?action=current");
  }

  async history() {
    return this.request("GET", "/stanleystawa/fullvideo?action=history");
  }

  async request(method, pathname, body) {
    const url = new URL(pathname, BASE);
    if (method === "GET") url.searchParams.set("key", this.apiKey);

    const payload = body ? { ...body, key: this.apiKey } : null;

    return withRetry(
      async () => {
        const res = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: payload ? JSON.stringify(payload) : undefined,
        });

        const text = await res.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { raw: text };
        }

        if (res.status === 409) {
          const err = new Error("Une vidéo complète est déjà en cours de génération");
          err.status = 409;
          err.data = data;
          err.taskId = extractTaskId(data);
          throw err;
        }

        if (!res.ok) {
          const err = new Error(
            data.error || data.message || data.detail || `HTTP ${res.status}`
          );
          err.status = res.status;
          err.data = data;
          throw err;
        }

        return data;
      },
      { label: `${method} ${pathname.split("?")[0]}` }
    );
  }
}

export function extractTaskId(data) {
  if (!data) return null;
  if (typeof data === "string" && data.startsWith("fv_")) return data;
  return (
    pick(data, [
      "task_id",
      "taskId",
      "id",
      "current.task_id",
      "current.taskId",
      "job.task_id",
      "data.task_id",
      "video.task_id",
    ]) || null
  );
}

export function extractStatus(data) {
  return String(
    pick(data, ["status", "state", "current.status", "data.status"]) || ""
  ).toLowerCase();
}

export function extractProgress(data) {
  const n = Number(pick(data, ["progress", "percent", "current.progress"]));
  return Number.isFinite(n) ? n : null;
}

export function extractVideoUrl(data) {
  return (
    pick(data, [
      "video_url",
      "videoUrl",
      "url",
      "mp4",
      "file_url",
      "result.video_url",
      "data.video_url",
    ]) || null
  );
}

export function extractTitle(data, fallback) {
  return (
    pick(data, ["title", "name", "story.title", "result.title", "data.title"]) ||
    fallback
  );
}

export function normalizeHistory(data) {
  const list =
    (Array.isArray(data) && data) ||
    data?.items ||
    data?.videos ||
    data?.history ||
    data?.results ||
    data?.data ||
    [];
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      raw: item,
      taskId: extractTaskId(item),
      status: extractStatus(item),
      videoUrl: extractVideoUrl(item),
      title: extractTitle(item, null),
      idea: pick(item, ["idea", "prompt", "input"]) || null,
    }))
    .filter((item) => item.taskId);
}

export function isDone(status) {
  return ["done", "completed", "success", "ready", "finished"].includes(status);
}

export function isFailed(status) {
  return ["failed", "error", "cancelled", "canceled", "rejected"].includes(
    status
  );
}

export function isRunning(status) {
  return ["queued", "queue", "pending", "running", "processing", "progress", "started"].includes(
    status
  );
}
