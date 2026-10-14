// --- ✂ Video editor: cut frame ranges out of clips, join clips, re-encode the result --
// A standalone tool — nothing here touches the gallery, history or projects. The
// browser uploads each file it picked to a temp folder; an export runs ffmpeg over
// them as a job the page polls, then downloads. Sources are found on disk by their
// id, so a server restart loses only a running export, not the uploads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream";

const MAX_UPLOAD = 8 * 1024 ** 3;
const MAX_CLIPS = 50;
const MAX_SEGMENTS = 200;
const STALE_MS = 12 * 60 * 60 * 1000; // temp files older than this are swept
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

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

export function registerVideoEditor(app) {
  // Read here, not at import: server.js loads .env after its imports are evaluated.
  const FFMPEG = (process.env.FFMPEG_PATH || "").trim() || "ffmpeg";
  const dir = path.join(os.tmpdir(), "genie-video-editor");
  fs.mkdirSync(dir, { recursive: true });

  const jobs = new Map(); // jobId → { state, done, total, file, error, proc, sourceIds }
  const probes = new Map(); // sourceId → probe

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

  app.delete("/api/video-editor/source/:id", (req, res) => {
    const file = findSource(req.params.id);
    if (file) unlink(file);
    probes.delete(req.params.id);
    for (const [jobId, job] of jobs)
      if (job.sourceIds.includes(req.params.id)) dropJob(jobId);
    res.json({ code: 200, msg: "success" });
  });

  // body: { clips: [{ id, keep: [[startFrame, endFrame), …] }, …], base, fit } — the
  // clips in playing order, each with the frame ranges of it to keep; `base` is the id
  // of the clip whose size and frame rate the result takes (default: the first), and
  // `fit` says how the others meet that size: "fit" (bars) or "fill" (crop).
  app.post("/api/video-editor/export", async (req, res) => {
    const clips = req.body?.clips;
    if (!Array.isArray(clips) || !clips.length || clips.length > MAX_CLIPS)
      return fail(res, 400, "Nothing to save");
    const srcs = [];
    const infos = [];
    let segments = 0;
    for (const clip of clips) {
      const src = findSource(clip?.id);
      // 404 names the missing upload so the page can send just that file again.
      if (!src)
        return res
          .status(404)
          .json({ code: 404, msg: "An upload is no longer on the server", id: clip?.id });
      const p = probes.get(clip.id) || (await probe(src));
      if (p.error) return fail(res, 422, p.error);
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
        return fail(res, 400, ok ? "Too many cuts to save in one go" : "A clip has nothing left to keep");
      srcs.push(src);
      infos.push(p);
    }

    // Video is cut by frame number (exact), audio by the matching times. With several
    // clips, every piece is first brought to the base clip's size and frame rate —
    // never stretched: either shrunk inside it with black bars, or grown to cover it
    // and cropped — and to one audio format (silence for a clip that has no sound),
    // because the join needs them all alike.
    const first = infos[clips.findIndex((c) => c.id === req.body.base)] || infos[0];
    const multi = clips.length > 1;
    const audio = infos.some((p) => p.hasAudio);
    const W = first.width - (first.width % 2);
    const H = first.height - (first.height % 2);
    if (multi && !(W && H)) return fail(res, 422, "Couldn't read that clip's size");
    const fit =
      !multi ? ""
      : `,fps=${first.rate},scale=${W}:${H}:force_original_aspect_ratio=` +
        (req.body.fit === "fill" ?
          `increase,crop=${W}:${H}`
        : `decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`) +
        ",setsar=1,format=yuv420p";
    const mix = multi ? ",aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo" : "";
    const graph = [];
    const pieces = [];
    let total = 0;
    clips.forEach((clip, k) => {
      const p = infos[k];
      const t = (f) => (f / p.fps).toFixed(6);
      for (const [s, e] of clip.keep) {
        const n = pieces.length;
        graph.push(`[${k}:v:0]trim=start_frame=${s}:end_frame=${e},setpts=PTS-STARTPTS${fit}[v${n}]`);
        if (audio)
          graph.push(
            p.hasAudio ?
              `[${k}:a:0]atrim=start=${t(s)}:end=${t(e)},asetpts=PTS-STARTPTS${mix}[a${n}]`
            : `anullsrc=r=48000:cl=stereo,atrim=duration=${t(e - s)}${mix}[a${n}]`,
          );
        pieces.push(`[v${n}]${audio ? `[a${n}]` : ""}`);
        total += ((e - s) / p.fps) * first.fps;
      }
    });
    graph.push(
      `${pieces.join("")}concat=n=${pieces.length}:v=1:a=${audio ? 1 : 0}[vc]${audio ? "[a]" : ""}`,
      // back on a constant frame rate; yuv420p needs even dimensions
      `[vc]fps=${first.rate},scale=trunc(iw/2)*2:trunc(ih/2)*2[v]`,
    );

    const jobId = randomUUID();
    const job = {
      state: "running",
      done: 0,
      total: Math.max(1, Math.round(total)),
      file: path.join(dir, `${jobId}.out.mp4`),
      error: "",
      proc: null,
      sourceIds: clips.map((c) => c.id),
    };
    jobs.set(jobId, job);
    res.json({ code: 200, msg: "success", data: { jobId, frames: job.total } });

    const r = await ffmpeg(
      ["-hide_banner", "-y", "-v", "error", "-nostats", "-progress", "pipe:1",
       ...srcs.flatMap((src) => ["-i", src]),
       "-filter_complex", graph.join(";"), "-map", "[v]", ...(audio ? ["-map", "[a]"] : []),
       "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p",
       ...(audio ? ["-c:a", "aac", "-b:a", "192k"] : []),
       "-movflags", "+faststart", job.file],
      {
        onSpawn: (proc) => (job.proc = proc),
        onLine: (l) => {
          const m = /^frame=\s*(\d+)/.exec(l);
          if (m) job.done = Number(m[1]);
        },
      },
    );
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

  app.delete("/api/video-editor/jobs/:id", (req, res) => {
    dropJob(req.params.id);
    res.json({ code: 200, msg: "success" });
  });
}
