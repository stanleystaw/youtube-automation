import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { todayKey } from "./utils.js";

const FILE = path.join(ROOT, "data", "state.json");

export function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return {
      videos: Array.isArray(raw.videos) ? raw.videos : [],
      lastStartAt: raw.lastStartAt || null,
    };
  } catch {
    return { videos: [], lastStartAt: null };
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function findByTask(state, taskId) {
  return state.videos.find((v) => v.taskId === taskId);
}

export function upsertVideo(state, patch) {
  const existing = findByTask(state, patch.taskId);
  if (existing) {
    Object.assign(existing, patch, { updatedAt: new Date().toISOString() });
    return existing;
  }
  const row = {
    ...patch,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.videos.push(row);
  return row;
}

export function publishedToday(state, timeZone) {
  const day = todayKey(timeZone);
  return state.videos.filter((v) => {
    if (["failed", "error", "cancelled", "canceled"].includes(v.status)) return false;
    const when = v.startedAt || v.publishedAt || v.createdAt;
    if (!when) return false;
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(when));
    return key === day;
  });
}

export function usedIdeaIds(state) {
  return new Set(state.videos.map((v) => v.ideaId).filter(Boolean));
}

export function usedTaskIds(state) {
  return new Set(state.videos.map((v) => v.taskId).filter(Boolean));
}
