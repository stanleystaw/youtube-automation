import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

export const ROOT = root;

export function loadSettings() {
  const file = path.join(root, "config", "settings.json");
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));
  const privacy = process.env.YOUTUBE_PRIVACY;
  if (privacy) settings.youtube.privacyStatus = privacy;
  if (process.env.DRIVE_FOLDER_ID) {
    settings.driveFolderId = process.env.DRIVE_FOLDER_ID.trim();
  }
  return settings;
}

export function env() {
  return {
    magiclightKey: required("MAGICLIGHT_API_KEY"),
    googleClientId: required("GOOGLE_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
    googleRefreshToken: required("GOOGLE_REFRESH_TOKEN"),
    driveFolderId: (process.env.DRIVE_FOLDER_ID || "").trim(),
    ideaOverride: (process.env.IDEA || process.env.INPUT_IDEA || "").trim(),
    eventName: process.env.GITHUB_EVENT_NAME || "local",
    scheduleCron: process.env.SCHEDULE_CRON || "",
  };
}

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    const error = new Error(`Variable d'environnement manquante : ${name}`);
    error.code = "MISSING_ENV";
    throw error;
  }
  return value;
}

export function missingEnv() {
  const names = [
    "MAGICLIGHT_API_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
  ];
  return names.filter((name) => !(process.env[name] || "").trim());
}
