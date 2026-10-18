// --- 🖼 Image editor: crop an image to a chosen shape ---------------------------------
// The browser does the crop itself (a canvas), so the server only lists GENie's own
// images for the picker and stores a finished crop: in the project's edited_images
// folder, or — when the editor was opened from a History card or a Gallery image —
// handed to server.js to add to (or replace) that card's image.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream";

const MAX_IMAGE = 200 * 1024 ** 2;
const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
const SAVE_FOLDER = "edited_images"; // inside the project's output folder
const TYPES = {
  "image/png": { ext: "png", mime: "image/png" },
  "image/jpeg": { ext: "jpg", mime: "image/jpeg" },
  "image/webp": { ext: "webp", mime: "image/webp" },
};

export function registerImageEditor(
  app,
  { outputDir, inputDir, resolveProject, projects, history, gallery, saveToCard },
) {
  const fail = (res, code, msg) => res.status(code).json({ code, msg });

  // A served media URL (/output/… or /input/…) as a path, if it stays inside its folder.
  function mediaFile(url) {
    url = String(url || "").split("?")[0];
    for (const [prefix, base] of [
      ["/output/", outputDir],
      ["/input/", inputDir],
    ]) {
      if (!url.startsWith(prefix)) continue;
      try {
        const full = path.resolve(base, decodeURIComponent(url.slice(prefix.length)));
        return full.startsWith(base + path.sep) && fs.existsSync(full) ? full : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  // GENie's own images, newest first: History results, Gallery images and earlier
  // crops — of one project, or of all of them (projectId "all").
  app.get("/api/image-editor/library", (req, res) => {
    const all = req.query.projectId === "all";
    const proj = resolveProject(req.query.projectId);
    const mine = (e) => all || (e.projectId || "default") === proj.id;
    const out = [];
    for (const e of history()) {
      if (!mine(e)) continue;
      const outs = e.outputs?.length ? e.outputs : [{ localVideo: e.localVideo }];
      outs.forEach((o, index) => {
        if (!o.localVideo || !IMAGE_FILE.test(o.localVideo)) return;
        out.push({
          url: o.localVideo,
          source: "History",
          name: path.basename(o.localVideo),
          label: String(e.input?.prompt || "").slice(0, 160),
          date: e.createdAt || "",
        });
      });
    }
    for (const g of gallery())
      if (mine(g) && (g.kind || "image") === "image" && g.localUrl && IMAGE_FILE.test(g.localUrl))
        out.push({
          url: g.localUrl,
          source: "Gallery",
          name: g.name || path.basename(g.localUrl),
          label: "",
          date: g.createdAt || "",
        });
    for (const p of all ? projects() : [proj]) {
      const folder = path.join(outputDir, p.slug, SAVE_FOLDER);
      let names = [];
      try {
        names = fs.readdirSync(folder).filter((n) => IMAGE_FILE.test(n));
      } catch {}
      for (const name of names)
        out.push({
          url: `/output/${p.slug}/${SAVE_FOLDER}/${encodeURIComponent(name)}`,
          source: "Edited",
          name,
          label: "",
          date: fs.statSync(path.join(folder, name)).mtime.toISOString(),
        });
    }
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json({ code: 200, msg: "success", data: out.filter((v) => mediaFile(v.url)) });
  });

  // The request body is the cropped image itself (Content-Type image/png|jpeg|webp).
  // Query: target (JSON { kind, id, index, overwrite }) to save it to that card, or
  // projectId + name to save it as a new file in the project's edited_images folder.
  app.post("/api/image-editor/save", (req, res) => {
    const type = TYPES[String(req.headers["content-type"] || "").split(";")[0].trim()];
    if (!type) return fail(res, 415, "Send a PNG, JPEG or WebP image");
    if (Number(req.headers["content-length"]) > MAX_IMAGE)
      return fail(res, 413, "That image is too large");
    let target = null;
    if (req.query.target) {
      try {
        target = JSON.parse(String(req.query.target));
      } catch {
        return fail(res, 400, "Bad target");
      }
    }
    const tmp = path.join(os.tmpdir(), `genie-crop-${randomUUID()}.${type.ext}`);
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_IMAGE) req.destroy(new Error("too large"));
    });
    pipeline(req, fs.createWriteStream(tmp), async (err) => {
      const done = () => fs.promises.unlink(tmp).catch(() => {});
      if (err) {
        await done();
        if (!res.headersSent) fail(res, size > MAX_IMAGE ? 413 : 400, "Upload failed");
        return;
      }
      try {
        if (target) {
          const data = saveToCard(target, tmp, req.query.name, { kind: "image", ...type });
          return res.json({ code: 200, msg: "success", data });
        }
        const slug = resolveProject(req.query.projectId).slug;
        const folder = path.join(outputDir, slug, SAVE_FOLDER);
        const base =
          String(req.query.name || "")
            .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
            .replace(/\.[^.]*$/, "")
            .trim()
            .slice(0, 150) || "cropped";
        await fs.promises.mkdir(folder, { recursive: true });
        for (let n = 1; ; n++) {
          const name = `${base}${n > 1 ? `-${n}` : ""}.${type.ext}`;
          try {
            // COPYFILE_EXCL fails rather than replace a file that's already there
            await fs.promises.copyFile(tmp, path.join(folder, name), fs.constants.COPYFILE_EXCL);
          } catch (e) {
            if (e.code === "EEXIST" && n < 10000) continue;
            throw e;
          }
          return res.json({
            code: 200,
            msg: "success",
            data: {
              name,
              url: `/output/${slug}/${SAVE_FOLDER}/${encodeURIComponent(name)}`,
              folder: path.join(path.basename(outputDir), slug, SAVE_FOLDER),
            },
          });
        }
      } catch (e) {
        if (!e.status) console.error("Image editor save failed:", e);
        fail(res, e.status || 500, e.status ? e.message : `Couldn't save: ${e.message}`);
      } finally {
        done();
      }
    });
  });
}
