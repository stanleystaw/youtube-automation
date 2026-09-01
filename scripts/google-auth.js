import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { google } from "googleapis";
import { YOUTUBE_SCOPES, DRIVE_SCOPES, REDIRECT_URI } from "../src/google.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const PORT = 53682;
const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();

if (!clientId || !clientSecret) {
  console.error("Définis GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans .env");
  process.exit(1);
}

const steps = [
  { name: "YouTube", envKey: "GOOGLE_REFRESH_TOKEN_YOUTUBE", scopes: YOUTUBE_SCOPES },
  { name: "Drive", envKey: "GOOGLE_REFRESH_TOKEN_DRIVE", scopes: DRIVE_SCOPES },
];

let stepIndex = 0;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

function urlFor(scopes) {
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });
}

function printStep() {
  const step = steps[stepIndex];
  console.log(`\n—— Étape ${stepIndex + 1}/2 : autorise ${step.name} ——`);
  console.log("Ouvre cette URL (compte Gmail de la chaîne) :\n");
  console.log(urlFor(step.scopes));
  console.log("");
}

const server = http.createServer(async (req, res) => {
  try {
    const incoming = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (incoming.pathname !== "/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const error = incoming.searchParams.get("error");
    if (error) throw new Error(error);
    const code = incoming.searchParams.get("code");
    if (!code) throw new Error("code OAuth manquant");

    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "Pas de refresh_token. Révoque l'appli sur https://myaccount.google.com/permissions puis relance."
      );
    }

    const step = steps[stepIndex];
    upsertEnv(path.join(root, ".env"), step.envKey, tokens.refresh_token);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (stepIndex === 0) {
      res.end(
        `<h1>YouTube OK</h1><p>Reviens au terminal et ouvre le 2ᵉ lien (Drive).</p>`
      );
      stepIndex += 1;
      printStep();
    } else {
      res.end("<h1>Drive OK</h1><p>Tu peux fermer cet onglet.</p>");
      console.log("\n✓ Les deux refresh tokens sont dans .env");
      console.log("  GOOGLE_REFRESH_TOKEN_YOUTUBE");
      console.log("  GOOGLE_REFRESH_TOKEN_DRIVE\n");
      server.close();
      process.exit(0);
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err.message);
    console.error(err);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Serveur local ${REDIRECT_URI}`);
  printStep();
});

function upsertEnv(file, key, value) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, line);
  else text = `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, text, "utf8");
}
