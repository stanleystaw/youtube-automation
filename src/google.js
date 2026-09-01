import { google } from "googleapis";

export function googleAuth({ clientId, clientSecret, refreshToken }) {
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export const REDIRECT_URI = "http://127.0.0.1:53682/callback";

export function authUrl({ clientId, clientSecret, scopes }) {
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });
}
