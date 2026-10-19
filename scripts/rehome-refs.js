// One-time repair: give every History card its own copy of the reference media it
// uses, in its own project's Gallery — what moving a card does from 1.5.1 on (see
// gallery-refs.js). Cards moved before that still point at the old project's
// Gallery, and lose their references if that Gallery is tidied up. The originals
// stay where they are. References whose Gallery item or file is already gone can't
// be recovered and are reported.
//
// Idempotent: run it as many times as you like. Pass --dry-run (or -n) to see what
// it would copy without touching disk, images.json or history.json. Before writing
// it saves history.json.bak and images.json.bak beside them.
//
//   node scripts/rehome-refs.js --dry-run
//   node scripts/rehome-refs.js
//
// INPUT_DIR / IMAGES_DIR from .env are honored, same as the server.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { rehomeEntryRefs } from "../gallery-refs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INPUT_DIR = path.resolve(ROOT, process.env.INPUT_DIR || process.env.IMAGES_DIR || "input");
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

const history = readJson(HISTORY_FILE);
const images = readJson(IMAGES_FILE);
const projects = readJson(PROJECTS_FILE);
const byProjectId = new Map(projects.map((p) => [p.id, p]));
const knownIds = new Set(images.map((i) => i.id));
const before = images.length;

let cards = 0;
let missing = 0;
const perProject = new Map();
for (const entry of history) {
  const proj = byProjectId.get(entry.projectId || "default");
  if (!proj) continue;
  const m = entry.mediaLocalIds || { image: entry.imageLocalIds || [] };
  missing += Object.values(m)
    .flat()
    .filter((id) => id && !knownIds.has(id)).length;
  if (rehomeEntryRefs(entry, proj, images, INPUT_DIR, { dryRun: DRY })) {
    cards++;
    perProject.set(proj.name, (perProject.get(proj.name) || 0) + 1);
  }
}
const copies = images.length - before;

for (const [name, n] of [...perProject].sort((a, b) => b[1] - a[1]))
  console.log(`  ${name}: ${n} card(s)`);
console.log(
  `${DRY ? "[dry run] would re-point" : "Re-pointed"} ${cards} card(s), ` +
    `${DRY ? "copying" : "copied"} ${copies} Gallery item(s).`,
);
if (missing)
  console.log(`${missing} reference(s) point at Gallery items that were deleted — nothing to copy.`);

if (!DRY && cards) {
  fs.copyFileSync(HISTORY_FILE, `${HISTORY_FILE}.bak`);
  fs.copyFileSync(IMAGES_FILE, `${IMAGES_FILE}.bak`);
  // Re-read history and apply only the reference changes, so a run that finished
  // while this was working isn't overwritten.
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
