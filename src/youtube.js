import fs from "node:fs";
import { google } from "googleapis";
import { titleFromIdea, truncate } from "./utils.js";

export async function uploadToYoutube({
  auth,
  filePath,
  idea,
  title,
  description,
  tags,
  settings,
}) {
  const youtube = google.youtube({ version: "v3", auth });
  const finalTitle = truncate(title || titleFromIdea(idea), 100);
  const finalDescription = truncate(
    description ||
      (settings.descriptionTemplate || "{{title}}\n\n{{idea}}")
        .replaceAll("{{title}}", finalTitle)
        .replaceAll("{{idea}}", idea || ""),
    4900
  );

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: finalTitle,
        description: finalDescription,
        tags: tags?.length ? tags : settings.youtube.tags || [],
        categoryId: String(settings.youtube.categoryId || "25"),
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
    description: finalDescription,
    raw: res.data,
  };
}

export async function fetchVideoStats(auth, videoIds) {
  const ids = [...new Set((videoIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const youtube = google.youtube({ version: "v3", auth });
  const items = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await youtube.videos.list({
      part: ["statistics", "snippet"],
      id: chunk,
    });
    items.push(...(res.data.items || []));
  }
  return items;
}
