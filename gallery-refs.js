// --- A History card's reference media follows the card between projects ---------
// A card names its references by Gallery id (mediaLocalIds, the older imageLocalIds,
// and a reference's tail in input.tails). Those items live in one project's Gallery,
// so a card moved to another project would still depend on the old one: tidy that
// Gallery and the card loses its references. When a card moves, each reference that
// lives in another project is copied into the card's new project and the card is
// pointed at the copy. The original stays — other cards and saved prompts there may
// still use it. A copy records the item it came from (`copiedFrom`), so moving cards
// that share a reference, or moving one back, reuses a copy instead of piling up
// duplicates. Shared by server.js and scripts/rehome-refs.js.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DRY_COPY = Symbol("dry-run copy"); // never written to images.json

// Point `entry`'s references at items in project `proj` ({ id, slug }), copying them
// there as needed. `images` is the parsed images.json array: copies are appended and
// it's the caller's to save. Returns the number of references re-pointed. A
// reference whose item or file is gone is left as it is.
export function rehomeEntryRefs(entry, proj, images, inputDir, { dryRun = false } = {}) {
  const byId = new Map(images.map((i) => [i.id, i]));
  const origin = (i) => i.copiedFrom || i.id;
  const inProject = (i) => (i.projectId || "default") === proj.id;
  const exists = (i) => i[DRY_COPY] || fs.existsSync(path.join(inputDir, i.storedName));
  const remap = new Map();
  let changed = 0;

  const local = (id) => {
    if (remap.has(id)) return remap.get(id);
    const item = byId.get(id);
    let out = id;
    if (item && !inProject(item) && exists(item)) {
      const from = origin(item);
      const have = images.find(
        (i) => inProject(i) && (i.id === from || i.copiedFrom === from) && exists(i),
      );
      if (have) out = have.id;
      else {
        const newId = randomUUID();
        const storedName = `${proj.slug}/${newId}${path.extname(item.storedName)}`;
        if (!dryRun) {
          fs.mkdirSync(path.join(inputDir, proj.slug), { recursive: true });
          fs.copyFileSync(
            path.join(inputDir, item.storedName),
            path.join(inputDir, storedName),
          );
        }
        const copy = {
          ...item,
          id: newId,
          projectId: proj.id,
          storedName,
          localUrl: `/input/${storedName}`,
          copiedFrom: from,
          createdAt: new Date().toISOString(),
        };
        images.push(copy);
        byId.set(newId, copy);
        if (dryRun) copy[DRY_COPY] = true; // not on disk, but reusable by later cards
        out = newId;
      }
    }
    if (out !== id) changed++;
    remap.set(id, out);
    return out;
  };
  const mapIds = (ids) => (Array.isArray(ids) ? ids.map(local) : ids);

  if (entry.mediaLocalIds && typeof entry.mediaLocalIds === "object")
    for (const kind of Object.keys(entry.mediaLocalIds))
      entry.mediaLocalIds[kind] = mapIds(entry.mediaLocalIds[kind]);
  entry.imageLocalIds = mapIds(entry.imageLocalIds);
  for (const spec of Object.values(entry.input?.tails || {}))
    if (spec?.id) spec.id = local(spec.id);
  return changed;
}
