import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { REDIRECT_URI } from "../src/google.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const which = (process.argv[2] || "").toLowerCase();
const raw = process.argv.slice(3).join(" ").trim();

if (!["youtube", "drive"].includes(which) || !raw) {
  console.error("Usage : node scripts/exchange-code.js youtube|drive <code ou URL>");
  process.exit(1);
}

let code = raw;
try {
  if (raw.includes("http")) {
    const url = new URL(raw.replace(/^.*?(https?:)/, "$1"));
    code = url.searchParams.get("code") || "";
  } else if (raw.includes("code=")) {
    code = new URLSearchParams(raw.includes("?") ? raw.split("?")[1] : raw).get("code") || "";
  }
} catch {
  /* keep raw */
}

if (!code) {
  console.error("Impossible de lire le code OAuth.");
  process.exit(1);
}

const body = new URLSearchParams({
  code,
  client_id: process.env.GOOGLE_CLIENT_ID,
  client_secret: process.env.GOOGLE_CLIENT_SECRET,
  redirect_uri: REDIRECT_URI,
  grant_type: "authorization_code",
});

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});
const data = await res.json();
if (!res.ok) {
  console.error(data);
  process.exit(1);
}
if (!data.refresh_token) {
  console.error(
    "Pas de refresh_token. Révoque l'appli sur https://myaccount.google.com/permissions puis recommence."
  );
  process.exit(1);
}

const key = which === "youtube" ? "GOOGLE_REFRESH_TOKEN_YOUTUBE" : "GOOGLE_REFRESH_TOKEN_DRIVE";
upsertEnv(path.join(root, ".env"), key, data.refresh_token);
console.log(data.refresh_token);

function upsertEnv(file, envKey, value) {
  let text = fs.readFileSync(file, "utf8");
  const line = `${envKey}=${value}`;
  const re = new RegExp(`^${envKey}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, line);
  else text = `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, text, "utf8");
}
