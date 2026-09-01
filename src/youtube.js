import fs from "node:fs";
import { google } from "googleapis";
import { titleFromIdea, truncate } from "./utils.js";

export async function uploadToYoutube({
  auth,
  filePath,
  idea,
  title,
  settings,
}) {
  const youtube = google.youtube({ version: "v3", auth });
  const finalTitle = truncate(title || titleFromIdea(idea), 100);
  const description = (settings.descriptionTemplate || "{{title}}\n\n{{idea}}")
    .replaceAll("{{title}}", finalTitle)
    .replaceAll("{{idea}}", idea || "");

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: finalTitle,
        description: truncate(description, 4900),
        tags: settings.youtube.tags || [],
        categoryId: String(settings.youtube.categoryId || "1"),
        defaultLanguage: settings.youtube.defaultLanguage || "fr",
        defaultAudioLanguage: settings.youtube.defaultLanguage || "fr",
      },
      status: {
        privacyStatus: settings.youtube.privacyStatus || "public",
        selfDeclaredMadeForKids: Boolean(settings.youtube.madeForKids),
      },
    },
    media: {
      body: fs.createReadStream(filePath),
    },
  });

  const id = res.data.id;
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: finalTitle,
    raw: res.data,
  };
}
