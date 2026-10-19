// Recover reference media that was deleted from the Gallery, from ComfyUI's input
// folder. GENie uploads every reference into ComfyUI (under the Gallery item's name)
// when a run starts, and ComfyUI writes the run's prompt — with a loader node per
// reference — into the video or PNG it saves. So for a History card whose reference
// is gone, its own output says which file each reference was: GENie adds the loader
// nodes in reference order, so the loaders (by node number) line up with the card's
// references of that kind. A card counts only when the references it still has sit
// where they should, and an id is restored only when every card agrees on its file.
//
// A recovered file goes back into the Gallery under its old id (so every card and
// saved prompt using it sees it again), in the project most of its cards are in;
// cards in other projects then get their own copies, as a move gives them (see
// gallery-refs.js). Skipped: files ComfyUI no longer has, and names that a current
// Gallery item also uses with different content (ComfyUI keeps one file per name,
// so it may now hold the newer one).
//
// Needs ComfyUI running (COMFYUI_URL) and ffprobe on PATH. Idempotent. Pass
// --dry-run (or -n) to see what it would recover without writing anything; a real
// run saves history.json.bak and images.json.bak first.
//
//   node scripts/recover-refs.js --dry-run
//   node scripts/recover-refs.js

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { rehomeEntryRefs } from "../gallery-refs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INPUT_DIR = path.resolve(ROOT, process.env.INPUT_DIR || process.env.IMAGES_DIR || "input");
const OUTPUT_DIR = path.resolve(ROOT, process.env.OUTPUT_DIR || process.env.VIDEO_DIR || "output");
const COMFYUI_URL = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const HISTORY_FILE = path.join(ROOT, "history.json");
const IMAGES_FILE = path.join(ROOT, "images.json");
const PROJECTS_FILE = path.join(ROOT, "projects.json");
const DRY = process.argv.includes("--dry-run") || process.argv.includes("-n");

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return [];
  }
};
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");

const KINDS = ["image", "video", "audio"];
const EXT_KIND = [
  [/\.(png|jpe?g|webp|bmp|gif)$/i, "image"],
  [/\.(mp4|mov|webm|mkv|avi)$/i, "video"],
  [/\.(wav|mp3|flac|ogg|m4a|aac)$/i, "audio"],
];
const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  bmp: "image/bmp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime",
  webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo",
  wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg",
  m4a: "audio/mp4", aac: "audio/aac",
};
const kindOfName = (n) => EXT_KIND.find(([re]) => re.test(n))?.[1] || null;

// The ComfyUI prompt saved in an output: a video's "comment" tag, or a PNG's
// "prompt" text chunk.
function embeddedPrompt(file) {
  try {
    if (/\.png$/i.test(file)) {
      const buf = fs.readFileSync(file);
      for (let at = 8; at + 8 <= buf.length; ) {
        const len = buf.readUInt32BE(at);
        const type = buf.toString("latin1", at + 4, at + 8);
        if (type === "tEXt") {
          const data = buf.subarray(at + 8, at + 8 + len);
          const nul = data.indexOf(0);
          if (data.toString("latin1", 0, nul) === "prompt")
            return JSON.parse(data.toString("utf8", nul + 1));
        }
        if (type === "IEND") break;
        at += 12 + len;
      }
      return null;
    }
    const out = execFileSync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", file],
      { encoding: "utf8" },
    );
    const c = JSON.parse(out).format?.tags?.comment;
    if (!c) return null;
    const o = JSON.parse(c);
    return typeof o.prompt === "string" ? JSON.parse(o.prompt) : o.prompt;
  } catch {
    return null;
  }
}

// Loader files by kind, in node-number order.
function loaderFiles(prompt) {
  const files = { image: [], video: [], audio: [] };
  const nodes = Object.entries(prompt || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [, n] of nodes) {
    if (!/load/i.test(n.class_type || "")) continue;
    for (const v of Object.values(n.inputs || {})) {
      if (typeof v !== "string") continue;
      const k = kindOfName(v);
      if (k) files[k].push(v);
    }
  }
  return files;
}

const history = readJson(HISTORY_FILE);
const images = readJson(IMAGES_FILE);
const projects = readJson(PROJECTS_FILE);
const byId = new Map(images.map((i) => [i.id, i]));
const refsOf = (e) => {
  const m = e.mediaLocalIds || { image: e.imageLocalIds || [] };
  return Object.fromEntries(KINDS.map((k) => [k, m[k] || []]));
};

const votes = new Map(); // lost id -> Set of file names
const vote = (id, name) => {
  if (!votes.has(id)) votes.set(id, new Set());
  votes.get(id).add(name);
};
const cardsOf = new Map(); // lost id -> [entry]
for (const e of history) {
  const refs = refsOf(e);
  const lost = KINDS.flatMap((k) => refs[k].filter((id) => id && !byId.has(id)));
  if (!lost.length) continue;
  for (const id of lost) cardsOf.set(id, [...(cardsOf.get(id) || []), e]);
  const out = (e.outputs?.length ? e.outputs.map((o) => o.localVideo) : [e.localVideo]).find(
    (u) => u?.startsWith("/output/"),
  );
  if (!out) continue;
  const files = loaderFiles(embeddedPrompt(path.join(OUTPUT_DIR, out.slice("/output/".length))));
  for (const k of KINDS) {
    const ids = refs[k];
    if (!ids.length || ids.every((id) => byId.has(id))) continue;
    const base = (n) => n.split("/").pop();
    if (files[k].length === ids.length) {
      // Positional: trust it only if the references still known sit at their place.
      const fits = ids.every((id, i) => !byId.has(id) || base(byId.get(id).name || "") === base(files[k][i]));
      if (fits) ids.forEach((id, i) => !byId.has(id) && vote(id, files[k][i]));
    } else {
      // Counts differ: settle it only for a single lost reference and a single
      // file no known reference accounts for.
      const known = new Set(ids.filter((id) => byId.has(id)).map((id) => base(byId.get(id).name || "")));
      const left = files[k].filter((f) => !known.has(base(f)));
      const lostK = ids.filter((id) => !byId.has(id));
      if (lostK.length === 1 && left.length === 1) vote(lostK[0], left[0]);
    }
  }
}

const result = { restored: [], missingInComfy: [], conflicting: [], overwritten: [] };
for (const [id, names] of votes) {
  if (names.size !== 1) {
    result.conflicting.push(id);
    continue;
  }
  const name = [...names][0];
  const parts = name.split("/");
  const file = parts.pop();
  const url = `${COMFYUI_URL}/view?type=input&filename=${encodeURIComponent(file)}&subfolder=${encodeURIComponent(parts.join("/"))}`;
  let buf;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    buf = Buffer.from(await r.arrayBuffer());
  } catch {
    result.missingInComfy.push(name);
    continue;
  }
  // A current Gallery item with this name but other content: ComfyUI's copy may be it.
  const hash = sha1(buf);
  const clash = images.some((i) => {
    if ((i.name || "") !== file) return false;
    try {
      return sha1(fs.readFileSync(path.join(INPUT_DIR, i.storedName))) !== hash;
    } catch {
      return false;
    }
  });
  if (clash) {
    result.overwritten.push(name);
    continue;
  }
  // Home: the project most of its cards are in.
  const tally = new Map();
  for (const e of cardsOf.get(id) || []) {
    const pid = e.projectId || "default";
    tally.set(pid, (tally.get(pid) || 0) + 1);
  }
  const pid = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] || "default";
  const proj = projects.find((p) => p.id === pid) || projects.find((p) => p.id === "default");
  const ext = (path.extname(file).slice(1) || "png").toLowerCase();
  const storedName = `${proj.slug}/${id}.${ext}`;
  if (!DRY) {
    fs.mkdirSync(path.join(INPUT_DIR, proj.slug), { recursive: true });
    fs.writeFileSync(path.join(INPUT_DIR, storedName), buf);
  }
  const item = {
    id,
    kind: kindOfName(file) || "image",
    projectId: proj.id,
    storedName,
    name: file,
    mime: MIME[ext] || "application/octet-stream",
    localUrl: `/input/${storedName}`,
    createdAt: new Date().toISOString(),
    recoveredFrom: "comfyui",
  };
  images.push(item);
  byId.set(id, item);
  result.restored.push({ id, name: file, project: proj.name, cards: (cardsOf.get(id) || []).length });
}

// Cards in other projects than a restored item's get their own copy.
let rehomed = 0;
if (result.restored.length) {
  for (const e of history) {
    const proj = projects.find((p) => p.id === (e.projectId || "default"));
    if (proj && rehomeEntryRefs(e, proj, images, INPUT_DIR, { dryRun: DRY })) rehomed++;
  }
}

const lostTotal = cardsOf.size;
const cardsBack = new Set(result.restored.flatMap((r) => (cardsOf.get(r.id) || []).map((e) => e.id))).size;
console.log(
  `${DRY ? "[dry run] would recover" : "Recovered"} ${result.restored.length} of ${lostTotal} lost reference(s), ` +
    `back on ${cardsBack} card(s); ${rehomed} card(s) ${DRY ? "would get" : "got"} a copy in their own project.`,
);
if (result.missingInComfy.length) console.log(`  not in ComfyUI any more: ${result.missingInComfy.length}`);
if (result.overwritten.length) console.log(`  skipped, name reused by another image: ${result.overwritten.join(", ")}`);
if (result.conflicting.length) console.log(`  skipped, cards disagree on the file: ${result.conflicting.length}`);
console.log(`  no clue in any card's output: ${lostTotal - votes.size}`);

if (!DRY && result.restored.length) {
  fs.copyFileSync(HISTORY_FILE, `${HISTORY_FILE}.bak`);
  fs.copyFileSync(IMAGES_FILE, `${IMAGES_FILE}.bak`);
  const fresh = readJson(HISTORY_FILE);
  const changed = new Map(history.map((e) => [e.id, e]));
  for (const e of fresh) {
    const c = changed.get(e.id);
    if (!c) continue;
    e.mediaLocalIds = c.mediaLocalIds;
    e.imageLocalIds = c.imageLocalIds;
    if (c.input?.tails && e.input) e.input.tails = c.input.tails;
  }
  fs.writeFileSync(IMAGES_FILE, JSON.stringify(images, null, 2));
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(fresh, null, 2));
  console.log("Saved (backups: history.json.bak, images.json.bak).");
}
