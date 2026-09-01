import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { google } from "googleapis";
import { SCOPES } from "../src/google.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;

const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();

if (!clientId || !clientSecret) {
  console.error("Définis GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans .env (voir .env.example).");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
const url = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

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
        "Google n'a pas renvoyé de refresh_token. Révoque l'accès de l'appli sur https://myaccount.google.com/permissions puis relance npm run auth."
      );
    }

    const envPath = path.join(root, ".env");
    upsertEnv(envPath, "GOOGLE_REFRESH_TOKEN", tokens.refresh_token);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>OK — autorisation enregistrée</h1><p>Tu peux fermer cet onglet et revenir au terminal.</p>"
    );

    console.log("\n✓ Refresh token enregistré dans .env");
    console.log("\nAjoute aussi ce secret dans GitHub Actions :");
    console.log("  GOOGLE_REFRESH_TOKEN");
    console.log("\nValeur :\n");
    console.log(tokens.refresh_token);
    console.log("");
    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err.message);
    console.error(err);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("\n1. Ouvre cette URL dans le navigateur (compte Google de ta chaîne YouTube) :\n");
  console.log(url);
  console.log(`\n2. Autorise l'application — tu seras redirigé vers ${REDIRECT}`);
  console.log("   (si tu lances ce script en local, ça marche tout seul)\n");
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
