// --- ✂ Video editor: cut frame ranges out of clips, join clips, re-encode the result --
// A standalone tool. A clip is either a file the browser uploads to a temp folder or
// one of GENie's own videos (a History result, a Gallery video, an earlier edit),
// which is read where it lies and never changed. An export runs ffmpeg as a job the
// page polls; the result is downloaded, saved as a new file in the project's
// edited_videos folder, or — when the editor was opened from a History card or a
// Gallery video — handed to server.js to add to (or replace) that card's video.
// Effects (PNG overlay layers, colour, a new size) are applied in the same
// re-encode. registerVideoEditor returns the export engine for plugins to drive.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream";
import express from "express";

const MAX_UPLOAD = 8 * 1024 ** 3;
const MAX_CLIPS = 50;
const MAX_SEGMENTS = 200;
const STALE_MS = 12 * 60 * 60 * 1000; // temp files older than this are swept
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const VIDEO_FILE = /\.(mp4|mov|mkv|webm|m4v)$/i;
const SAVE_FOLDER = "edited_videos"; // inside the project's output folder
const OVERLAYS = "overlays"; // inside SAVE_FOLDER: PNGs uploaded as overlay layers
const OVERLAY_FILE = /\.(png|webp|jpe?g)$/i;
const MAX_OVERLAY = 50 * 1024 ** 2;
const MAX_LAYERS = 8;

// ------------------------------------------------------------- effects
// fx: { bright, contrast, sat: -100–100 (0 = as is; -100 = black, flat grey, black &
// white; +100 = twice as much — older projects' desat: 0–100 reads as -desat), hue:
// -180–180 (degrees round the colour wheel), width, height (0 = keep; one of
// them alone keeps the shape), sizeMode: "fit" | "fill" | "stretch" (when both are
// set and the shape changes), layers: [{ url, name, clip (index into the export's
// clips, null = the whole video), pos, scale (% of the frame's width), opacity,
// margin (% of the width) }] }. Anything out of range falls back to "no change".
const POSITIONS = {
  full: null, // stretched over the whole frame
  "top-left": ["l", "t"], top: ["c", "t"], "top-right": ["r", "t"],
  left: ["l", "c"], center: ["c", "c"], right: ["r", "c"],
  "bottom-left": ["l", "b"], bottom: ["c", "b"], "bottom-right": ["r", "b"],
};
export function cleanFx(fx, clipCount = 1) {
  fx = fx && typeof fx === "object" ? fx : {};
  const num = (x, lo, hi, d) => {
    const n = Number(x);
    return x !== "" && x != null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const dim = (x) => {
    const n = Math.round(Number(x));
    return n >= 16 && n <= 8192 ? n : 0;
  };
  const layers = [];
  for (const l of Array.isArray(fx.layers) ? fx.layers.slice(0, MAX_LAYERS) : []) {
    const url = String(l?.url || "");
    if (!url.startsWith("/output/") || !OVERLAY_FILE.test(url.split("?")[0])) continue;
    layers.push({
      url,
      name: String(l.name || "").slice(0, 200),
      clip: Number.isInteger(l.clip) && l.clip >= 0 && l.clip < clipCount ? l.clip : null,
      pos: l.pos in POSITIONS ? l.pos : "full",
      scale: num(l.scale, 1, 100, 25),
      opacity: num(l.opacity, 0, 100, 100),
      margin: num(l.margin, 0, 25, 3),
    });
  }
  return {
    bright: Math.round(num(fx.bright, -100, 100, 0)),
    contrast: Math.round(num(fx.contrast, -100, 100, 0)),
    sat: Math.round(num(fx.sat ?? (fx.desat > 0 ? -fx.desat : 0), -100, 100, 0)),
    hue: Math.round(num(fx.hue, -180, 180, 0)),
    width: dim(fx.width),
    height: dim(fx.height),
    sizeMode: ["fill", "stretch"].includes(fx.sizeMode) ? fx.sizeMode : "fit",
    layers,
  };
}

const even = (n) => Math.max(2, n - (n % 2));

// The size a w×h video comes out at after the resize effect, both even.
function resized(w, h, fx) {
  let W = fx.width;
  let H = fx.height;
  if (W && !H) H = Math.round((h * W) / w);
  else if (H && !W) W = Math.round((w * H) / h);
  else if (!W) [W, H] = [w, h];
  return [even(W), even(H)];
}

// The filter that brings the joined video to that size ("" when there's no resize).
function resizeFilter(w, h, fx) {
  if (!fx.width && !fx.height) return "";
  const [W, H] = resized(w, h, fx);
  if (!(fx.width && fx.height) || fx.sizeMode === "stretch") return `scale=${W}:${H},setsar=1`;
  return (
    `scale=${W}:${H}:force_original_aspect_ratio=` +
    (fx.sizeMode === "fill" ? `increase,crop=${W}:${H}` : `decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`) +
    ",setsar=1"
  );
}

// One overlay layer on an fw×fh frame: how to prepare the image, and where it goes.
function layerFilter(l, fw, fh) {
  const fade = l.opacity < 100 ? `,colorchannelmixer=aa=${(l.opacity / 100).toFixed(3)}` : "";
  if (!POSITIONS[l.pos]) return { prep: `scale=${fw}:${fh},format=rgba${fade}`, at: "0:0" };
  const w = Math.max(2, Math.round((fw * l.scale) / 100));
  const m = Math.round((fw * l.margin) / 100);
  const [px, py] = POSITIONS[l.pos];
  const x = { l: m, c: "(W-w)/2", r: `W-w-${m}` }[px];
  const y = { t: m, c: "(H-h)/2", b: `H-h-${m}` }[py];
  return { prep: `scale=${w}:-1,format=rgba${fade}`, at: `${x}:${y}` };
}

// ffmpeg prints a rounded rate ("23.98 fps"); the NTSC ones are really n·1000/1001.
// Returns the exact rate for the fps filter and its numeric value.
function frameRate(shown) {
  const f = Number(shown);
  if (!(f > 0)) return null;
  const whole = Math.round(f);
  const ntsc = (whole * 1000) / 1001;
  if (Math.abs(f - whole) > 0.001 && Math.abs(f - ntsc) < 0.006)
    return { rate: `${whole * 1000}/1001`, fps: ntsc };
  return { rate: String(f), fps: f };
}

export function registerVideoEditor(
  app,
  { outputDir, inputDir, resolveProject, projects, history, gallery, saveToCard, editsFile },
) {
  // Read here, not at import: server.js loads .env after its imports are evaluated.
  const FFMPEG = (process.env.FFMPEG_PATH || "").trim() || "ffmpeg";
  const dir = path.join(os.tmpdir(), "genie-video-editor");
  fs.mkdirSync(dir, { recursive: true });

  const jobs = new Map(); // jobId → { state, done, total, file, error, proc, sourceIds }
  const probes = new Map(); // sourceId → probe
  const linked = new Map(); // sourceId → path of one of GENie's own videos (read-only)

  const fail = (res, code, msg) => res.status(code).json({ code, msg });
  const MISSING =
    "ffmpeg was not found — install it, or set FFMPEG_PATH in .env to its location";

  // Runs ffmpeg; never rejects. `onLine` gets each stdout line (the -progress feed).
  function ffmpeg(args, { onLine, onSpawn } = {}) {
    return new Promise((resolve) => {
      let head = "";
      let tail = "";
      let buf = "";
      let proc;
      try {
        proc = spawn(FFMPEG, args, { windowsHide: true });
      } catch (err) {
        return resolve({ code: -1, head, tail, missing: err.code === "ENOENT" });
      }
      onSpawn?.(proc);
      proc.stderr.on("data", (d) => {
        if (head.length < 65536) head += d;
        tail = (tail + d).slice(-4000);
      });
      proc.stdout.on("data", (d) => {
        buf += d;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) onLine?.(l);
      });
      proc.on("error", (err) =>
        resolve({ code: -1, head, tail, missing: err.code === "ENOENT" }),
      );
      proc.on("close", (code) => resolve({ code, head, tail }));
    });
  }

  let ffmpegOk = false;
  async function haveFfmpeg() {
    if (!ffmpegOk) ffmpegOk = (await ffmpeg(["-version"])).code === 0;
    return ffmpegOk;
  }

  // Frame rate, frame count, size and whether there's audio, from ffmpeg alone (no
  // ffprobe): the stream header off stderr, and a packet count from copying video to
  // nowhere.
  async function probe(file) {
    let frames = 0;
    const r = await ffmpeg(
      ["-hide_banner", "-nostats", "-progress", "pipe:1", "-i", file,
       "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
      {
        onLine: (l) => {
          const m = /^frame=\s*(\d+)/.exec(l);
          if (m) frames = Number(m[1]);
        },
      },
    );
    if (r.missing) return { error: MISSING };
    const input = r.head.split(/^Output #0/m)[0];
    const video = input
      .split(/\r?\n/)
      .find((l) => /Stream #0:\d+.*: Video: /.test(l) && !l.includes("(attached pic)"));
    const rate = frameRate((/([\d.]+) fps/.exec(video || "") || /([\d.]+) tbr/.exec(video || ""))?.[1]);
    if (r.code !== 0 || !video || !rate || !frames)
      return { error: "Couldn't read this file as a video" };
    const d = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(input);
    // The size as displayed: a phone clip is stored sideways with a rotation flag.
    let [, width = 0, height = 0] = /, (\d{2,5})x(\d{2,5})[\s,[]/.exec(video) || [];
    const turn = /rotation of (-?[\d.]+) degrees/.exec(input);
    if (turn && Math.abs(Math.round(Number(turn[1]))) % 180 === 90)
      [width, height] = [height, width];
    return {
      fps: rate.fps,
      rate: rate.rate,
      frames,
      duration: d ? d[1] * 3600 + d[2] * 60 + Number(d[3]) : frames / rate.fps,
      width: Number(width),
      height: Number(height),
      hasAudio: /Stream #0:\d+.*: Audio: /.test(input),
    };
  }

  function findSource(id) {
    if (!UUID.test(String(id))) return null;
    if (linked.has(id)) return fs.existsSync(linked.get(id)) ? linked.get(id) : null;
    const name = fs.readdirSync(dir).find((f) => f.startsWith(`${id}.`));
    return name ? path.join(dir, name) : null;
  }

  const unlink = (file) => fs.promises.unlink(file).catch(() => {});

  function dropJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;
    jobs.delete(jobId);
    if (job.state === "running") {
      job.state = "cancelled";
      job.proc?.kill();
    } else unlink(job.file);
  }

  // Uploads and exports nobody came back for (a closed tab, a crashed browser).
  function sweep() {
    const cutoff = Date.now() - STALE_MS;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
      } catch {}
    }
    for (const [jobId, job] of jobs)
      if (job.state !== "running" && !fs.existsSync(job.file)) jobs.delete(jobId);
  }
  sweep();
  process.on("exit", () => {
    for (const job of jobs.values()) job.proc?.kill();
  });

  app.get("/api/video-editor/status", async (req, res) => {
    const ok = await haveFfmpeg();
    res.json({ code: 200, msg: "success", data: { ffmpeg: ok, hint: ok ? "" : MISSING } });
  });

  // The request body is the file itself (no base64, no size-limited JSON).
  app.post("/api/video-editor/upload", (req, res) => {
    if (Number(req.headers["content-length"]) > MAX_UPLOAD)
      return fail(res, 413, "That file is too large to edit here (8 GB limit)");
    sweep();
    const ext =
      /^\.[a-z0-9]{1,5}$/.exec(path.extname(String(req.query.name || "")).toLowerCase())?.[0] ||
      ".mp4";
    const id = randomUUID();
    const file = path.join(dir, `${id}${ext}`);
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD) req.destroy(new Error("too large"));
    });
    pipeline(req, fs.createWriteStream(file), async (err) => {
      if (err) {
        await unlink(file);
        if (!res.headersSent) fail(res, size > MAX_UPLOAD ? 413 : 400, "Upload failed");
        return;
      }
      const p = await probe(file);
      if (p.error) {
        await unlink(file);
        return fail(res, 422, p.error);
      }
      probes.set(id, p);
      res.json({ code: 200, msg: "success", data: { id, ...p } });
    });
  });

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

  // A History entry's favorite/draft flags and workflow auto-tags, for the picker's
  // filters.
  const entryTags = (e) => {
    const tags = [];
    if (e.favorite) tags.push("favorite");
    if (e.draft) tags.push("draft");
    for (const t of Array.isArray(e.tags) ? e.tags : [])
      if (!tags.some((x) => x.toLowerCase() === String(t).toLowerCase())) tags.push(String(t));
    return tags;
  };

  // GENie's own videos, newest first: History results, Gallery videos and earlier
  // edits — of one project, or of all of them (projectId "all").
  app.get("/api/video-editor/library", (req, res) => {
    const all = req.query.projectId === "all";
    const proj = resolveProject(req.query.projectId);
    const mine = (e) => all || (e.projectId || "default") === proj.id;
    const out = [];
    for (const e of history()) {
      if (!mine(e)) continue;
      const urls = (e.outputs?.length ? e.outputs.map((o) => o.localVideo) : [e.localVideo]).filter(
        (u) => u && VIDEO_FILE.test(u),
      );
      for (const url of urls)
        out.push({
          url,
          source: "History",
          name: path.basename(url),
          label: String(e.input?.prompt || "").slice(0, 160),
          date: e.createdAt || "",
          tags: entryTags(e),
        });
    }
    for (const g of gallery())
      if (mine(g) && g.kind === "video" && g.localUrl)
        out.push({
          url: g.localUrl,
          source: "Gallery",
          name: g.name || path.basename(g.localUrl),
          label: "",
          date: g.createdAt || "",
          tags: [],
        });
    for (const p of all ? projects() : [proj]) {
      const folder = path.join(outputDir, p.slug, SAVE_FOLDER);
      let names = [];
      try {
        names = fs.readdirSync(folder).filter((n) => VIDEO_FILE.test(n));
      } catch {}
      for (const name of names)
        out.push({
          url: `/output/${p.slug}/${SAVE_FOLDER}/${encodeURIComponent(name)}`,
          source: "Edited",
          name,
          label: "",
          date: fs.statSync(path.join(folder, name)).mtime.toISOString(),
          tags: [],
        });
    }
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json({ code: 200, msg: "success", data: out.filter((v) => mediaFile(v.url)) });
  });

  // Use one of GENie's own videos as a clip: no copy, the export reads it in place.
  app.post("/api/video-editor/import", async (req, res) => {
    const file = mediaFile(req.body?.url);
    if (!file || !VIDEO_FILE.test(file)) return fail(res, 404, "That video is no longer there");
    const p = await probe(file);
    if (p.error) return fail(res, 422, p.error);
    const id = randomUUID();
    linked.set(id, file);
    probes.set(id, p);
    res.json({ code: 200, msg: "success", data: { id, ...p } });
  });

  function dropSource(id) {
    // Only an upload is deleted — a linked video is the user's own file.
    const file = linked.delete(id) ? null : findSource(id);
    if (file) unlink(file);
    probes.delete(id);
    for (const [jobId, job] of jobs) if (job.sourceIds.includes(id)) dropJob(jobId);
  }

  app.delete("/api/video-editor/source/:id", (req, res) => {
    dropSource(req.params.id);
    res.json({ code: 200, msg: "success" });
  });

  // ------------------------------------------------------------- overlay images
  // An overlay layer's image is kept for good in the project's edited_videos/overlays,
  // named after its content so the same PNG uploaded twice is one file.
  const MAGIC = [
    [".png", (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))],
    [".jpg", (b) => b[0] === 0xff && b[1] === 0xd8],
    [".webp", (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP"],
  ];
  app.post(
    "/api/video-editor/overlays",
    express.raw({ type: () => true, limit: MAX_OVERLAY }),
    async (req, res) => {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) return fail(res, 400, "No image was sent");
      const ext = MAGIC.find(([, is]) => is(buf))?.[0];
      if (!ext) return fail(res, 415, "An overlay must be a PNG, WebP or JPEG image");
      const slug = resolveProject(req.query.projectId).slug;
      const folder = path.join(outputDir, slug, SAVE_FOLDER, OVERLAYS);
      const base =
        String(req.query.name || "overlay")
          .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
          .replace(/\.[^.]*$/, "")
          .trim()
          .slice(0, 100) || "overlay";
      const name = `${base}-${createHash("sha1").update(buf).digest("hex").slice(0, 8)}${ext}`;
      try {
        await fs.promises.mkdir(folder, { recursive: true });
        const file = path.join(folder, name);
        if (!fs.existsSync(file)) await fs.promises.writeFile(file, buf);
      } catch (err) {
        console.error("Video editor: saving an overlay failed:", err);
        return fail(res, 500, `Couldn't save the image: ${err.message}`);
      }
      res.json({
        code: 200,
        msg: "success",
        data: { url: `/output/${slug}/${SAVE_FOLDER}/${OVERLAYS}/${encodeURIComponent(name)}`, name: base },
      });
    },
  );

  // Every overlay image kept so far, in every project, newest first.
  app.get("/api/video-editor/overlays", (req, res) => {
    const out = [];
    for (const p of projects()) {
      const folder = path.join(outputDir, p.slug, SAVE_FOLDER, OVERLAYS);
      let names = [];
      try {
        names = fs.readdirSync(folder).filter((n) => OVERLAY_FILE.test(n));
      } catch {}
      for (const name of names)
        out.push({
          url: `/output/${p.slug}/${SAVE_FOLDER}/${OVERLAYS}/${encodeURIComponent(name)}`,
          name: name.replace(/-[0-9a-f]{8}\.[^.]+$/, ""),
          project: p.name,
          date: fs.statSync(path.join(folder, name)).mtime.toISOString(),
        });
    }
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json({ code: 200, msg: "success", data: out });
  });

  // ------------------------------------------------------------- saved edits
  // An edit to come back to and add to: { id, name, projectId, createdAt, updatedAt,
  // clips: [{ url, name, cuts, markIn, markOut, cur }], sizeFrom (clip index | null),
  // fit, fx (the effects, layers' clip an index into clips), exports: [{ url, name,
// at }] — the videos saved from it, newest last }. A clip uploaded from the device is moved out of the temp folder (which is
  // swept) into the project's edited_videos/sources the first time its edit is saved.
  const SOURCES = "sources"; // inside SAVE_FOLDER
  const readEdits = () => {
    try {
      const list = JSON.parse(fs.readFileSync(editsFile, "utf8"));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const writeEdits = (list) => fs.writeFileSync(editsFile, JSON.stringify(list, null, 2));
  const frameNo = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
  const cleanClip = (c) => ({
    url: String(c.url || ""),
    name: String(c.name || "video").slice(0, 200),
    cuts: (Array.isArray(c.cuts) ? c.cuts : [])
      .filter((r) => Array.isArray(r) && frameNo(r[0]) != null && frameNo(r[1]) > r[0])
      .slice(0, MAX_SEGMENTS)
      .map(([s, e]) => [s, e]),
    markIn: frameNo(c.markIn),
    markOut: frameNo(c.markOut),
    cur: frameNo(c.cur) ?? 0,
  });

  // Keep an upload for good: move it into the project's sources folder and link its
  // id there, so the open editor and its exports carry on using it.
  async function keepUpload(id, name, slug) {
    const from = findSource(id);
    if (!from) return null;
    if (linked.has(id)) return null; // already one of GENie's own files
    const folder = path.join(outputDir, slug, SAVE_FOLDER, SOURCES);
    await fs.promises.mkdir(folder, { recursive: true });
    const base =
      String(name || "video")
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
        .replace(/\.[^.]*$/, "")
        .trim()
        .slice(0, 120) || "video";
    const ext = path.extname(from);
    let file;
    for (let n = 1; ; n++) {
      file = path.join(folder, `${base}${n > 1 ? `-${n}` : ""}${ext}`);
      if (!fs.existsSync(file)) break;
    }
    try {
      await fs.promises.rename(from, file);
    } catch (err) {
      if (err.code !== "EXDEV") throw err;
      await fs.promises.copyFile(from, file); // temp folder on another drive
      await unlink(from);
    }
    linked.set(id, file);
    return `/output/${slug}/${SAVE_FOLDER}/${SOURCES}/${encodeURIComponent(path.basename(file))}`;
  }

  // A kept upload no saved edit uses any more goes with the last edit that did.
  async function dropUnusedSources(urls, edits) {
    const used = new Set(edits.flatMap((e) => e.clips.map((c) => c.url)));
    for (const url of urls) {
      if (used.has(url) || !url.includes(`/${SAVE_FOLDER}/${SOURCES}/`)) continue;
      const file = mediaFile(url);
      if (file) await unlink(file);
    }
  }

  app.get("/api/video-editor/edits", (req, res) => {
    const names = new Map(projects().map((p) => [p.id, p.name]));
    const data = readEdits()
      .map((e) => ({
        id: e.id,
        name: e.name,
        projectId: e.projectId,
        projectName: names.get(e.projectId) || "",
        clips: e.clips.length,
        exports: (e.exports || []).length,
        firstUrl: e.clips[0]?.url || "",
        updatedAt: e.updatedAt,
      }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    res.json({ code: 200, msg: "success", data });
  });

  app.get("/api/video-editor/edits/:id", (req, res) => {
    const edit = readEdits().find((e) => e.id === req.params.id);
    if (!edit) return fail(res, 404, "That saved edit is gone");
    // Say which clips' files have gone missing since it was saved.
    const clips = edit.clips.map((c) => ({ ...c, missing: !mediaFile(c.url) }));
    const exports = (edit.exports || []).filter((x) => mediaFile(x.url));
    res.json({ code: 200, msg: "success", data: { ...edit, clips, exports } });
  });

  // body: { id? (to update), name, projectId, clips: [{ url | sourceId, name, cuts,
  // markIn, markOut, cur }], sizeFrom, fit, fx } → the saved edit, every clip with a url.
  app.post("/api/video-editor/edits", async (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.clips) || !body.clips.length || body.clips.length > MAX_CLIPS)
      return fail(res, 400, "Nothing to save");
    const edits = readEdits();
    const old = body.id ? edits.find((e) => e.id === body.id) : null;
    if (body.id && !old) return fail(res, 404, "That saved edit is gone");
    const proj = resolveProject(old?.projectId || body.projectId);
    const clips = [];
    const kept = new Map(); // sourceId → url: a split or duplicated clip shares its upload
    try {
      for (const c of body.clips) {
        let url = String(c.url || "");
        const sid = String(c.sourceId || "");
        if (!url && sid) {
          if (!kept.has(sid)) kept.set(sid, (await keepUpload(sid, c.name, proj.slug)) || "");
          url = kept.get(sid);
        }
        if (!mediaFile(url) || !VIDEO_FILE.test(url))
          return res
            .status(404)
            .json({ code: 404, msg: `${c.name || "A clip"} is no longer on the server — add it again`, id: c.sourceId });
        clips.push(cleanClip({ ...c, url }));
      }
    } catch (err) {
      console.error("Video editor: keeping an upload failed:", err);
      return fail(res, 500, `Couldn't keep an uploaded clip: ${err.message}`);
    }
    const now = new Date().toISOString();
    const sizeFrom = Number.isInteger(body.sizeFrom) && body.sizeFrom < clips.length ? body.sizeFrom : null;
    const edit = {
      id: old?.id || randomUUID(),
      name: String(body.name || "").trim().slice(0, 120) || clips[0].name.replace(/\.[^.]+$/, ""),
      projectId: proj.id,
      createdAt: old?.createdAt || now,
      updatedAt: now,
      clips,
      sizeFrom,
      fit: body.fit === "fill" ? "fill" : "fit",
      fx: cleanFx(body.fx, clips.length),
      exports: old?.exports || [],
    };
    // Re-read: an upload being kept can take a while, and other saves may have landed.
    const latest = readEdits();
    const at = latest.findIndex((e) => e.id === edit.id);
    if (at >= 0) latest[at] = { ...edit, exports: latest[at].exports || [] };
    else latest.push(edit);
    writeEdits(latest);
    if (old) await dropUnusedSources(old.clips.map((c) => c.url), latest);
    res.json({ code: 200, msg: "success", data: edit });
  });

  // body: { url, name } — a video just saved from this project (to its edited_videos,
  // a card or the Gallery), listed in it to come back to.
  app.post("/api/video-editor/edits/:id/exports", (req, res) => {
    const edits = readEdits();
    const edit = edits.find((e) => e.id === req.params.id);
    if (!edit) return fail(res, 404, "That saved edit is gone");
    const url = String(req.body?.url || "");
    if (!mediaFile(url) || !VIDEO_FILE.test(url)) return fail(res, 404, "That video isn't on the server");
    edit.exports = (edit.exports || []).filter((x) => x.url !== url);
    edit.exports.push({
      url,
      name: String(req.body?.name || path.basename(url)).slice(0, 200),
      at: new Date().toISOString(),
    });
    writeEdits(edits);
    res.json({ code: 200, msg: "success", data: edit.exports });
  });

  app.put("/api/video-editor/edits/:id", (req, res) => {
    const edits = readEdits();
    const edit = edits.find((e) => e.id === req.params.id);
    if (!edit) return fail(res, 404, "That saved edit is gone");
    const name = String(req.body?.name || "").trim().slice(0, 120);
    if (name) edit.name = name;
    writeEdits(edits);
    res.json({ code: 200, msg: "success", data: { id: edit.id, name: edit.name } });
  });

  app.delete("/api/video-editor/edits/:id", async (req, res) => {
    const edits = readEdits();
    const edit = edits.find((e) => e.id === req.params.id);
    if (!edit) return fail(res, 404, "That saved edit is gone");
    const rest = edits.filter((e) => e !== edit);
    writeEdits(rest);
    await dropUnusedSources(edit.clips.map((c) => c.url), rest);
    res.json({ code: 200, msg: "success" });
  });

  // body: { clips: [{ id, keep: [[startFrame, endFrame), …] }, …], base, fit, fx } —
  // the clips in playing order, each with the frame ranges of it to keep; `base` is
  // the id of the clip whose size and frame rate the result takes (default: the
  // first), `fit` says how the others meet that size: "fit" (bars) or "fill" (crop),
  // and `fx` the effects (see cleanFx). → { args (ffmpeg's, writing to `out`), total
  // (frames), sourceIds } or { error: [status, msg, id?] }.
  async function planExport(body, out) {
    const clips = body?.clips;
    if (!Array.isArray(clips) || !clips.length || clips.length > MAX_CLIPS)
      return { error: [400, "Nothing to save"] };
    const srcs = [];
    const infos = [];
    let segments = 0;
    for (const clip of clips) {
      const src = findSource(clip?.id);
      // The id names the missing upload so the page can send just that file again.
      if (!src) return { error: [404, "An upload is no longer on the server", clip?.id] };
      const p = probes.get(clip.id) || (await probe(src));
      if (p.error) return { error: [422, p.error] };
      probes.set(clip.id, p);
      let last = 0;
      const ok =
        Array.isArray(clip.keep) &&
        clip.keep.length > 0 &&
        clip.keep.every((seg) => {
          const [s, e] = Array.isArray(seg) ? seg : [];
          if (!Number.isInteger(s) || !Number.isInteger(e)) return false;
          if (s < last || e <= s || e > p.frames) return false;
          last = e;
          return true;
        });
      segments += ok ? clip.keep.length : 0;
      if (!ok || segments > MAX_SEGMENTS)
        return { error: [400, ok ? "Too many cuts to save in one go" : "A clip has nothing left to keep"] };
      srcs.push(src);
      infos.push(p);
    }
    const fx = cleanFx(body.fx, clips.length);
    const images = [];
    for (const l of fx.layers) {
      const file = mediaFile(l.url);
      if (!file) return { error: [404, `The overlay image${l.name ? ` ${l.name}` : ""} is no longer there`] };
      images.push(file);
    }

    // Video is cut by frame number (exact), audio by the matching times. With several
    // clips, every piece is first brought to the base clip's size and frame rate —
    // never stretched: either shrunk inside it with black bars, or grown to cover it
    // and cropped — and to one audio format (silence for a clip that has no sound),
    // because the join needs them all alike. The colour effects and a clip's own overlay
    // layers go on each piece; the resize and whole-video layers on the joined result,
    // so a layer is drawn at the size it ends up and never loses its colour.
    const first = infos[clips.findIndex((c) => c.id === body.base)] || infos[0];
    const multi = clips.length > 1;
    const audio = infos.some((p) => p.hasAudio);
    const W = first.width - (first.width % 2);
    const H = first.height - (first.height % 2);
    if ((multi || fx.layers.length || fx.width || fx.height) && !(W && H))
      return { error: [422, "Couldn't read that clip's size"] };
    const fit =
      !multi ? ""
      : `,fps=${first.rate},scale=${W}:${H}:force_original_aspect_ratio=` +
        (body.fit === "fill" ?
          `increase,crop=${W}:${H}`
        : `decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`) +
        ",setsar=1,format=yuv420p";
    // Brightness then contrast, as the preview's CSS filter does them (scale, then
    // stretch round mid-grey), then saturation and hue; back to one format for the join.
    const [b, c] = [1 + fx.bright / 100, 1 + fx.contrast / 100].map((x) => x.toFixed(3));
    const lut = `(val*${b}-maxval/2)*${c}+maxval/2`;
    const tone =
      (fx.bright || fx.contrast ? `,lutrgb=r=${lut}:g=${lut}:b=${lut}` : "") +
      (fx.sat || fx.hue ? `,hue=h=${fx.hue}:s=${(1 + fx.sat / 100).toFixed(3)}` : "") +
      (fx.bright || fx.contrast || fx.sat || fx.hue ? ",format=yuv420p" : "");
    const mix = multi ? ",aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo" : "";
    const [pw, ph] = multi ? [W, H] : [first.width, first.height]; // a piece's size
    const [ow, oh] = resized(W, H, fx); // the result's

    // Each layer's image goes in once, split into as many copies as it's drawn.
    const graph = [];
    const uses = fx.layers.map((l) =>
      l.clip == null ? 1 : clips[l.clip].keep.length,
    );
    const placed = fx.layers.map((l, i) => {
      const at = layerFilter(l, ...(l.clip == null ? [ow, oh] : [pw, ph]));
      graph.push(
        `[${srcs.length + i}:v]${at.prep},split=${uses[i]}${Array.from({ length: uses[i] }, (_, u) => `[o${i}_${u}]`).join("")}`,
      );
      return at.at;
    });
    const next = fx.layers.map(() => 0);
    // Draws the layers `which` picks onto stream `from`, ending in `to`.
    const drawLayers = (from, to, which) => {
      let cur = from;
      fx.layers.forEach((l, i) => {
        if (!which(l)) return;
        const out = `${to}_${i}`;
        graph.push(`[${cur}][o${i}_${next[i]++}]overlay=${placed[i]}[${out}]`);
        cur = out;
      });
      return cur;
    };

    const pieces = [];
    let total = 0;
    clips.forEach((clip, k) => {
      const p = infos[k];
      const t = (f) => (f / p.fps).toFixed(6);
      for (const [s, e] of clip.keep) {
        const n = pieces.length;
        graph.push(`[${k}:v:0]trim=start_frame=${s}:end_frame=${e},setpts=PTS-STARTPTS${fit}${tone}[p${n}]`);
        const vout = drawLayers(`p${n}`, `p${n}`, (l) => l.clip === k);
        if (audio)
          graph.push(
            p.hasAudio ?
              `[${k}:a:0]atrim=start=${t(s)}:end=${t(e)},asetpts=PTS-STARTPTS${mix}[a${n}]`
            : `anullsrc=r=48000:cl=stereo,atrim=duration=${t(e - s)}${mix}[a${n}]`,
          );
        pieces.push(`[${vout}]${audio ? `[a${n}]` : ""}`);
        total += ((e - s) / p.fps) * first.fps;
      }
    });
    graph.push(
      `${pieces.join("")}concat=n=${pieces.length}:v=1:a=${audio ? 1 : 0}[vc]${audio ? "[a]" : ""}`,
      // back on a constant frame rate; yuv420p needs even dimensions
      `[vc]fps=${first.rate},${resizeFilter(W, H, fx) || "scale=trunc(iw/2)*2:trunc(ih/2)*2"}[vr]`,
    );
    const vout = drawLayers("vr", "vg", (l) => l.clip == null);

    return {
      total: Math.max(1, Math.round(total)),
      sourceIds: clips.map((c) => c.id),
      args: [
        "-hide_banner", "-y", "-v", "error", "-nostats", "-progress", "pipe:1",
        ...srcs.flatMap((src) => ["-i", src]),
        ...images.flatMap((img) => ["-i", img]),
        "-filter_complex", graph.join(";"), "-map", `[${vout}]`, ...(audio ? ["-map", "[a]"] : []),
        "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p",
        ...(audio ? ["-c:a", "aac", "-b:a", "192k"] : []),
        "-movflags", "+faststart", out,
      ],
    };
  }

  // Plans and starts an export as a job → { jobId, job } (job.finished settles when
  // it's done, failed or cancelled) or { error: [status, msg, id?] }.
  async function startExport(body) {
    const jobId = randomUUID();
    const file = path.join(dir, `${jobId}.out.mp4`);
    const plan = await planExport(body, file);
    if (plan.error) return plan;
    const job = {
      state: "running",
      done: 0,
      total: plan.total,
      file,
      error: "",
      proc: null,
      sourceIds: plan.sourceIds,
    };
    jobs.set(jobId, job);
    job.finished = (async () => {
      const r = await ffmpeg(plan.args, {
        onSpawn: (proc) => (job.proc = proc),
        onLine: (l) => {
          const m = /^frame=\s*(\d+)/.exec(l);
          if (m) job.done = Number(m[1]);
        },
      });
      job.proc = null;
      if (job.state === "cancelled") return void unlink(job.file);
      if (r.code === 0) {
        job.state = "done";
        return;
      }
      job.state = "error";
      job.error =
        r.missing ? MISSING : (
          r.tail.trim().split(/\r?\n/).slice(-3).join("\n") || "ffmpeg failed"
        );
      console.error("Video editor export failed:", job.error);
      unlink(job.file);
    })();
    return { jobId, job };
  }

  app.post("/api/video-editor/export", async (req, res) => {
    const r = await startExport(req.body);
    if (r.error) {
      const [code, msg, id] = r.error;
      return res.status(code).json({ code, msg, ...(id ? { id } : {}) });
    }
    res.json({ code: 200, msg: "success", data: { jobId: r.jobId, frames: r.job.total } });
  });

  app.get("/api/video-editor/jobs/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return fail(res, 404, "That export is gone — the server may have restarted");
    res.json({
      code: 200,
      msg: "success",
      data: {
        state: job.state,
        progress: job.state === "done" ? 1 : Math.min(1, job.done / job.total),
        error: job.error,
      },
    });
  });

  app.get("/api/video-editor/jobs/:id/file", (req, res) => {
    const job = jobs.get(req.params.id);
    if (job?.state !== "done" || !fs.existsSync(job.file))
      return fail(res, 404, "That export is no longer on the server");
    const name =
      String(req.query.name || "")
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
        .replace(/\.[^.]*$/, "")
        .slice(0, 150) || "edited";
    res.download(job.file, `${name}.mp4`);
  });

  // Copy a finished video into the project's edited_videos folder (or a `folder`
  // inside it) under a name that isn't taken → { name, url, folder }.
  async function saveToProject(file, { projectId, name, folder: sub } = {}) {
    const slug = resolveProject(projectId).slug;
    const clean = (x) => String(x || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
    const parts = [
      SAVE_FOLDER,
      ...String(sub || "").split(/[\\/]+/).map(clean).filter((x) => x && !/^\.+$/.test(x)).slice(0, 3),
    ];
    const folder = path.join(outputDir, slug, ...parts);
    const base = clean(name).replace(/\.[^.]*$/, "").slice(0, 150) || "edited";
    await fs.promises.mkdir(folder, { recursive: true });
    for (let n = 1; ; n++) {
      const name = `${base}${n > 1 ? `-${n}` : ""}.mp4`;
      try {
        // COPYFILE_EXCL fails rather than replace a file that's already there
        await fs.promises.copyFile(file, path.join(folder, name), fs.constants.COPYFILE_EXCL);
      } catch (err) {
        if (err.code === "EEXIST" && n < 10000) continue;
        throw err;
      }
      return {
        name,
        url: `/output/${slug}/${parts.map(encodeURIComponent).join("/")}/${encodeURIComponent(name)}`,
        folder: path.join(path.basename(outputDir), slug, ...parts),
      };
    }
  }

  // Keep a finished export: by default in the project's edited_videos folder, under a
  // name that isn't taken, so an existing file is never overwritten. With `target`
  // ({ kind: "history" | "gallery", id, index, overwrite }) it goes to that History
  // card or Gallery video instead.
  app.post("/api/video-editor/jobs/:id/save", async (req, res) => {
    const job = jobs.get(req.params.id);
    if (job?.state !== "done" || !fs.existsSync(job.file))
      return fail(res, 404, "That export is no longer on the server");
    if (req.body?.target) {
      try {
        const data = saveToCard(req.body.target, job.file, req.body.name);
        dropJob(req.params.id);
        return res.json({ code: 200, msg: "success", data });
      } catch (err) {
        if (!err.status) console.error("Video editor save to card failed:", err);
        return fail(res, err.status || 500, err.status ? err.message : `Couldn't save: ${err.message}`);
      }
    }
    try {
      const data = await saveToProject(job.file, req.body || {});
      dropJob(req.params.id);
      res.json({ code: 200, msg: "success", data });
    } catch (err) {
      console.error("Video editor save failed:", err);
      fail(res, 500, `Couldn't save the file: ${err.message}`);
    }
  });

  app.delete("/api/video-editor/jobs/:id", (req, res) => {
    dropJob(req.params.id);
    res.json({ code: 200, msg: "success" });
  });

  // The export engine, for plugins (see plugins.js).
  return {
    ffmpeg,
    probe,
    haveFfmpeg,
    // A video the editor can use: an upload's id, or one of GENie's own (by url).
    async importUrl(url) {
      const file = mediaFile(url);
      if (!file || !VIDEO_FILE.test(file)) return { error: "That video is no longer there" };
      const p = await probe(file);
      if (p.error) return p;
      const id = randomUUID();
      linked.set(id, file);
      probes.set(id, p);
      return { id, ...p };
    },
    async sourceInfo(id) {
      const src = findSource(id);
      if (!src) return null;
      const p = probes.get(id) || (await probe(src));
      if (!p.error) probes.set(id, p);
      return p;
    },
    dropSource,
    startExport, // (body) → { jobId, job } | { error }
    dropJob,
    saveToProject, // (file, { projectId, name, folder }) → { name, url, folder }
    cleanFx,
  };
}
