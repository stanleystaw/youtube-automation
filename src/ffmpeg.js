import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function extractLastFrame(videoPath, jpgPath) {
  fs.mkdirSync(path.dirname(jpgPath), { recursive: true });
  return run("ffmpeg", [
    "-y",
    "-sseof",
    "-0.3",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    jpgPath,
  ]);
}

export async function concatVideos(inputs, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const list = path.join(path.dirname(outPath), `concat-${Date.now()}.txt`);
  fs.writeFileSync(
    list,
    inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
  );
  try {
    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      outPath,
    ]);
  } catch {
    const args = ["-y"];
    inputs.forEach((p) => args.push("-i", p));
    args.push(
      "-filter_complex",
      `concat=n=${inputs.length}:v=1:a=1[v][a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      outPath
    );
    await run("ffmpeg", args);
  } finally {
    try {
      fs.unlinkSync(list);
    } catch {
      /* ignore */
    }
  }
}

export async function kenBurnsWithAudio(jpgPath, audioPath, outPath, seconds = 10) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const silent = outPath.replace(/\.mp4$/i, "-silent.mp4");
  await run("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-i",
    jpgPath,
    "-t",
    String(seconds),
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0012,1.12)':d=250:s=1080x1920:fps=25",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    silent,
  ]);
  await run("ffmpeg", [
    "-y",
    "-i",
    silent,
    "-i",
    audioPath,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    outPath,
  ]);
  try {
    fs.unlinkSync(silent);
  } catch {
    /* ignore */
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${err.slice(-400)}`));
    });
  });
}
