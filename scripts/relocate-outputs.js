// One-time sweep: move each history entry's saved output file(s) into the correct
// subfolder of its project, matching the going-forward behavior in server.js
// (see outputSubfolder / moveHistoryVideo). Files land at:
//
//     output/<project-slug>/favorites/<file> for favorited outputs (image or video)
//     output/<project-slug>/images/<file>    for image outputs
//     output/<project-slug>/draft/<file>     for drafted video outputs
//     output/<project-slug>/<file>           for other (hi-def) video outputs
//
// i.e. always nested inside the project's folder — never a top-level output/images
// or output/draft. Also repairs older layouts, including draft *images* that an
// earlier draft-only sweep put under draft/ (they belong under images/).
//
// Idempotent and best-effort: run it as many times as you like. Pass --dry-run
// (or -n) to preview the moves without touching disk or history.json.
//
//   node scripts/relocate-outputs.js --dry-run
//   node scripts/relocate-outputs.js
//
// OUTPUT_DIR / VIDEO_DIR from .env are honored, same as the server.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.resolve(ROOT, process.env.OUTPUT_DIR || process.env.VIDEO_DIR || "output");
const HISTORY_FILE = path.join(ROOT, "history.json");
const PROJECTS_FILE = path.join(ROOT, "projects.json");

const DRY = process.argv.includes("--dry-run") || process.argv.includes("-n");

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return [];
  }
};

const projects = readJson(PROJECTS_FILE);
// Resolve an entry's project to its folder slug, falling back to Default.
const slugFor = (projectId) => {
  const p = projects.find((x) => x.id === projectId) || projects.find((x) => x.id === "default");
  return p ? p.slug : "default";
};

// --- kept in sync with server.js: entryIsImage / outputSubfolder ----------
const isImageOutputModel = (model) => (model || "").includes("-to-image");
function entryIsImage(entry) {
  const input = entry.input || {};
  if ((input.model || "").startsWith("comfy:")) {
    const out = (entry.localVideo || entry.resultUrl || "").split("?")[0];
    const fromQuery = /[?&]filename=[^&]*\.(png|jpe?g|webp|gif|bmp)/i.test(entry.resultUrl || "");
    return fromQuery || /\.(png|jpe?g|webp|gif|bmp)$/i.test(out);
  }
  return isImageOutputModel(input.model);
}
// Leading-slash fragment ("" for the project root).
function outputSubfolder(entry) {
  if (entry.favorite) return "/favorites";
  if (entryIsImage(entry)) return "/images";
  return entry.draft ? "/draft" : "";
}

let moved = 0;
let alreadyOk = 0;
let missing = 0;

// Move one /output-relative url into <slug><sub>/, returning the new url. Passes
// through nulls and anything not stored under /output/.
function relocate(url, slug, sub) {
  if (!url || !url.startsWith("/output/")) return url;
  const fileName = path.basename(url);
  const rel = url.slice("/output/".length);
  const destRel = `${slug}${sub}/${fileName}`.replace(/^\//, "");
  const newUrl = `/output/${destRel}`;

  if (rel === destRel) {
    alreadyOk++;
    return url;
  }

  const from = path.join(OUTPUT_DIR, rel);
  const to = path.join(OUTPUT_DIR, destRel);

  if (!fs.existsSync(from)) {
    // Source gone: maybe the file is already at the destination but history.json
    // still points at the old path — repair the url without a disk move.
    if (fs.existsSync(to)) {
      console.log(`  repair url (file already in place): ${destRel}`);
      moved++;
      return newUrl;
    }
    console.warn(`  MISSING on disk, leaving url unchanged: ${url}`);
    missing++;
    return url;
  }

  console.log(`  ${DRY ? "[dry] " : ""}${rel}  ->  ${destRel}`);
  if (!DRY) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
  moved++;
  return newUrl;
}

const history = readJson(HISTORY_FILE);
let scanned = 0;
let changed = false;

for (const entry of history) {
  if (!entry.localVideo && !(Array.isArray(entry.outputs) && entry.outputs.length)) continue;
  scanned++;
  const slug = slugFor(entry.projectId || "default");
  const sub = outputSubfolder(entry);
  const before = JSON.stringify([entry.localVideo, entry.outputs]);

  if (Array.isArray(entry.outputs) && entry.outputs.length) {
    for (const o of entry.outputs) o.localVideo = relocate(o.localVideo, slug, sub);
    entry.localVideo = entry.outputs[0]?.localVideo || null;
  } else {
    entry.localVideo = relocate(entry.localVideo, slug, sub);
  }

  if (JSON.stringify([entry.localVideo, entry.outputs]) !== before) changed = true;
}

if (changed && !DRY) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`\nUpdated ${path.relative(ROOT, HISTORY_FILE)}`);
}

console.log(
  `\nDone. entries scanned=${scanned}, files moved/repaired=${moved}, ` +
    `already in place=${alreadyOk}, missing=${missing}` +
    (DRY ? "  (dry run — nothing written)" : "")
);
