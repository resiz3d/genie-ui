#!/usr/bin/env node
// One-time migration for the images→input / video→output rename.
//
// Run this ONCE, with the app stopped, if you're updating a copy that still has
// the old `images/` and `video/` folders:
//
//     node migrate-folders.cjs
//
// It renames the data folders and rewrites the stored URL prefixes in
// history.json / images.json (backing each JSON up first). Safe to re-run — a
// second run finds nothing to do. Files kept in a custom OUTPUT_DIR/INPUT_DIR (or
// legacy VIDEO_DIR/IMAGES_DIR) location are left where they are; only the JSON
// prefixes are rewritten in that case.
const fs = require("fs");
const path = require("path");

const root = __dirname;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

// 1) Rename the default data folders (only when the new name doesn't already exist).
function renameFolder(legacy, current) {
  const from = path.join(root, legacy);
  const to = path.join(root, current);
  if (fs.existsSync(to)) {
    console.log(`skip  ${legacy}/ (already have ${current}/)`);
    return;
  }
  if (!fs.existsSync(from)) {
    console.log(`skip  ${legacy}/ (not found)`);
    return;
  }
  fs.renameSync(from, to);
  console.log(`ok    ${legacy}/ → ${current}/`);
}

// 2) Rewrite stored URL prefixes, backing the file up first.
function rewritePrefix(file, from, to) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) {
    console.log(`skip  ${file} (not found)`);
    return;
  }
  const text = fs.readFileSync(p, "utf8");
  const count = text.split(from).length - 1;
  if (!count) {
    console.log(`skip  ${file} (no "${from}" occurrences)`);
    return;
  }
  fs.writeFileSync(`${p}.${stamp}.bak`, text);
  const out = text.split(from).join(to);
  JSON.parse(out); // sanity: still valid JSON
  fs.writeFileSync(p, out);
  console.log(`ok    ${file}: ${count} × "${from}" → "${to}"  (backup written)`);
}

renameFolder("video", "output");
renameFolder("images", "input");
rewritePrefix("history.json", '"/video/', '"/output/');
rewritePrefix("images.json", '"/images/', '"/input/');
console.log("done");
