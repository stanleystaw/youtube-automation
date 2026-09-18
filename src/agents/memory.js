import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";

const FILE = path.join(ROOT, "data", "learnings.json");

export function loadLearnings() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return {
      playbook: raw.playbook || "",
      notes: Array.isArray(raw.notes) ? raw.notes : [],
    };
  } catch {
    return { playbook: "", notes: [] };
  }
}

export function saveLearnings(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function appendNote(note) {
  const current = loadLearnings();
  current.notes.push(note);
  if (note.playbook) current.playbook = note.playbook;
  if (current.notes.length > 40) current.notes = current.notes.slice(-40);
  saveLearnings(current);
  return current;
}
