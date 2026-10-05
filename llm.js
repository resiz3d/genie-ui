// --- Local LLM: prompt building with a vision model --------------------------
// GENie talks to any OpenAI-compatible server (LM Studio, text-generation-webui,
// Ollama, or a cloud endpoint) through /v1/chat/completions, and — for the local
// ones — loads and unloads the model itself through each server's own management
// API, so the LLM and ComfyUI take turns on the GPU:
//
//   • Before loading, GENie waits for ComfyUI's queue to empty (plus a short grace
//     period, so back-to-back generations don't make it thrash), checks free VRAM,
//     and — when there isn't enough — asks ComfyUI to unload its models first.
//   • When a generation starts (from GENie, or from ComfyUI's own UI), GENie aborts
//     the request in flight and unloads the LLM before the video model loads. The
//     build then waits and picks up where it left off once ComfyUI is idle again.
//
// Builds run as server-side jobs, so they keep going with the browser closed (or
// from the phone). Each prompt is saved to the project's Saved Prompts the moment
// it's written, with the images it was built from as its references.
//
// Settings (sources, API keys, options) live in settings/llm.json — git-ignored,
// and the keys are never sent to the browser.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const SOURCE_KINDS = {
  lmstudio: { label: "LM Studio", port: 1234, managed: true },
  textgen: { label: "text-generation-webui", port: 5000, managed: true },
  ollama: { label: "Ollama", port: 11434, managed: true },
  openai: { label: "Other OpenAI-compatible", port: null, managed: false },
};

export const DEFAULT_INSTRUCTIONS = `You write prompts for AI video generation (image-to-video and reference-to-video models such as Seedance, MiniMax Hailuo and LTX Video).

You are shown the reference images the video will be made from. Refer to each one exactly by its label, like <Picture 1>, and to a named subject by its <key> label when one is given. Look closely at what the images actually show — the people or characters, their build, clothing, hair and expressions, the setting, lighting and colours — and keep that continuity unless the request asks for a change.

Write concrete, filmable action in the present tense: who is on screen, what they do and in what order, how the camera moves and frames them, and the lighting and mood. Pace the action to fit the clip's duration. For a cut to a new shot, start a new paragraph with "At 00:05.000, cut to …" using the time it happens.

Write the prompt as plain prose paragraphs — no markdown, no bullet points, no notes to the reader.

Reply with only a JSON object and nothing else:
{"title": "a short title, at most 8 words", "prompt": "the full prompt text"}`;

// The formats ✨ Build with AI can save as. "default" uses the editable instructions
// above; the MiniMax formats have their own (their JSON reply fills a structured
// prompt's fields, so it can't be edited away).
export const BUILD_FORMATS = new Set(["default", "minimax", "minimax_t2v"]);

export const MINIMAX_INSTRUCTIONS = `You write structured prompts for MiniMax Hailuo H3 reference-to-video. The video model receives the reference images as <Picture 1>, <Picture 2> … and a prompt made of labelled sections, which you fill in as JSON fields.

Subjects: every person, character, creature, object or place the video keeps from the references is a subject with a <key> label — one short lowercase word (underscores allowed), like <hulk> or <stall>. When an image is given with a subject key, use exactly that key. Otherwise invent one, and start that subject's definition with the images it comes from, e.g. "seen in <Picture 1> and <Picture 2>, a tall green woman with long black hair …". In every other field, refer to subjects only by their <key> label, never by picture number or by a name.

Look closely at what the images actually show — build, clothing, hair, expression, setting, lighting and colours — and keep that continuity unless the request asks for a change.

Fields:
- subjects: one entry per subject: {"key": "hulk", "definition": "one or two sentences describing how the subject looks"}.
- summary: the task type in square brackets, then one short paragraph on what the video shows and what each reference is for, e.g. "[reference generation] <hulk> strides down a desert road toward the camera …".
- retention: for each subject key, how closely the video must match its references: a marker, " - ", then what is kept, e.g. {"hulk": "fully_preserved - face, hair, build and skin colour"}. Markers: fully_preserved, partially_preserved, attribute_transfer, weak_reference.
- style: one sentence opening the description with the visual style, e.g. "The target video uses a live action cinematic style."
- shots: the shots in order, each with "seconds": how many seconds it lasts. The seconds of all the shots add up to the clip's length. Each "text" is concrete, filmable action in the present tense: who does what and in what order, how the camera moves and frames them, the lighting and mood. Pace the action to fit the clip's length; use one shot unless the action needs a cut.
- soundscape: the diegetic sound — ambience, footsteps, voices, effects.
- music: the non-diegetic music, or "None".

Plain text in every field — no markdown, no bullet points, no notes to the reader.

Reply with only a JSON object and nothing else:
{"title": "a short title, at most 8 words", "subjects": [{"key": "…", "definition": "…"}], "summary": "…", "retention": {"key": "…"}, "style": "…", "shots": [{"seconds": 5, "text": "…"}], "soundscape": "…", "music": "…"}`;

export const MINIMAX_T2V_INSTRUCTIONS = `You write structured prompts for MiniMax Hailuo H3 text-to-video. There are no reference images: the prompt alone describes everything on screen, so describe each person, character and place fully the first time it appears — build, clothing, hair, expression, setting, lighting and colours.

Fields:
- style: one sentence with the visual style, e.g. "The target video uses a live action cinematic style."
- shots: the shots in order, each with "seconds": how many seconds it lasts. The seconds of all the shots add up to the clip's length. Each "text" is concrete, filmable action in the present tense: who does what and in what order, how the camera moves and frames them, the lighting and mood. Pace the action to fit the clip's length; use one shot unless the action needs a cut.
- soundscape: the diegetic sound — ambience, footsteps, voices, effects.
- music: the non-diegetic music, or "None".

Plain text in every field — no markdown, no bullet points, no notes to the reader.

Reply with only a JSON object and nothing else:
{"title": "a short title, at most 8 words", "style": "…", "shots": [{"seconds": 5, "text": "…"}], "soundscape": "…", "music": "…"}`;

const DEFAULT_SETTINGS = {
  activeSourceId: "lmstudio",
  sources: [
    {
      id: "lmstudio",
      name: "LM Studio",
      kind: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      apiKey: "",
      model: "",
      vramGb: 0,
      contextLength: 8192,
      loadArgs: "",
    },
    {
      id: "textgen",
      name: "text-generation-webui",
      kind: "textgen",
      baseUrl: "http://127.0.0.1:5000",
      apiKey: "",
      model: "",
      vramGb: 0,
      contextLength: 8192,
      loadArgs: "",
    },
    {
      id: "ollama",
      name: "Ollama",
      kind: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      apiKey: "",
      model: "",
      vramGb: 0,
      contextLength: 8192,
      loadArgs: "",
    },
  ],
  options: {
    freeComfyVram: true, // unload ComfyUI's models when the LLM doesn't fit
    headroomGb: 1.5, // on top of the model file size, for context + vision projector
    resumeDelaySec: 30, // ComfyUI must be idle this long before the LLM reloads
    vramWaitMin: 15, // give up waiting for VRAM after this long
    unloadWhenDone: true, // unload the LLM when a build finishes
    temperature: 0.8,
    maxTokens: 2048,
    instructions: DEFAULT_INSTRUCTIONS,
  },
};

const MAX_IMAGES = 10;
const MAX_COUNT = 20;
const MAX_RULES = 12000;
const MAX_RECENT = 20;
const JOB_KEEP = 30; // finished jobs remembered (in memory) for the UI

export function createLlm(deps) {
  const {
    settingsFile,
    comfyUrl,
    inputDir,
    readJson,
    imagesFile,
    findProject,
    readPrompts,
    writePrompts,
    sanitizePromptFields,
    withRefDetails,
    gpuMemory, // async () => { freeMiB, totalMiB } | null
    builderFile = null, // (project) => path of its projects/<slug>/llm-builder.json
    ensureComfyWs = () => {},
    log = console,
  } = deps;

  // ---------------------------------------------------------------- settings
  function readSettings() {
    let s = {};
    try {
      s = JSON.parse(fs.readFileSync(settingsFile, "utf8")) || {};
    } catch {
      /* first run */
    }
    const sources =
      Array.isArray(s.sources) && s.sources.length ?
        s.sources.map(normalizeSource)
      : DEFAULT_SETTINGS.sources.map((x) => ({ ...x }));
    const options = { ...DEFAULT_SETTINGS.options, ...(s.options || {}) };
    if (!String(options.instructions || "").trim())
      options.instructions = DEFAULT_INSTRUCTIONS;
    const activeSourceId =
      sources.some((x) => x.id === s.activeSourceId) ?
        s.activeSourceId
      : sources[0]?.id || null;
    return { activeSourceId, sources, options };
  }

  function writeSettings(s) {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
  }

  function normalizeSource(x = {}) {
    const kind = SOURCE_KINDS[x.kind] ? x.kind : "openai";
    const num = (v, d, min = 0, max = Infinity) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
    };
    return {
      id: String(x.id || randomUUID()).slice(0, 60),
      name: String(x.name || SOURCE_KINDS[kind].label)
        .trim()
        .slice(0, 80),
      kind,
      baseUrl: String(x.baseUrl || "")
        .trim()
        .replace(/\/+$/, "")
        .slice(0, 300),
      apiKey: String(x.apiKey || "").slice(0, 500),
      model: String(x.model || "")
        .trim()
        .slice(0, 300),
      vramGb: num(x.vramGb, 0, 0, 1024),
      contextLength: Math.round(num(x.contextLength, 8192, 0, 1048576)),
      loadArgs: String(x.loadArgs || "").slice(0, 4000),
    };
  }

  // What the browser sees: no API keys, just whether one is set.
  function publicSettings(s = readSettings()) {
    return {
      activeSourceId: s.activeSourceId,
      sources: s.sources.map(({ apiKey, ...rest }) => ({
        ...rest,
        hasApiKey: !!apiKey,
        managed: SOURCE_KINDS[rest.kind].managed,
      })),
      options: s.options,
      kinds: Object.fromEntries(
        Object.entries(SOURCE_KINDS).map(([k, v]) => [k, v]),
      ),
      defaultInstructions: DEFAULT_INSTRUCTIONS,
    };
  }

  // A PUT from the browser. A source's key is replaced only when `apiKey` is sent
  // non-empty, and removed when `clearApiKey` is true — otherwise the saved one stays.
  function updateSettings(body = {}) {
    const cur = readSettings();
    const next = { ...cur };
    if (Array.isArray(body.sources)) {
      next.sources = body.sources.slice(0, 20).map((b) => {
        const old = cur.sources.find((x) => x.id === b.id);
        let apiKey = old?.apiKey || "";
        if (b.clearApiKey) apiKey = "";
        else if (typeof b.apiKey === "string" && b.apiKey.trim())
          apiKey = b.apiKey.trim();
        return normalizeSource({ ...b, apiKey });
      });
    }
    if (body.activeSourceId !== undefined)
      next.activeSourceId = String(body.activeSourceId || "");
    if (body.options && typeof body.options === "object") {
      const o = { ...cur.options };
      const b = body.options;
      const num = (v, d, min, max) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
      };
      if (b.freeComfyVram !== undefined) o.freeComfyVram = !!b.freeComfyVram;
      if (b.unloadWhenDone !== undefined) o.unloadWhenDone = !!b.unloadWhenDone;
      if (b.headroomGb !== undefined)
        o.headroomGb = num(b.headroomGb, o.headroomGb, 0, 64);
      if (b.resumeDelaySec !== undefined)
        o.resumeDelaySec = num(b.resumeDelaySec, o.resumeDelaySec, 0, 3600);
      if (b.vramWaitMin !== undefined)
        o.vramWaitMin = num(b.vramWaitMin, o.vramWaitMin, 1, 24 * 60);
      if (b.temperature !== undefined)
        o.temperature = num(b.temperature, o.temperature, 0, 2);
      if (b.maxTokens !== undefined)
        o.maxTokens = Math.round(num(b.maxTokens, o.maxTokens, 64, 65536));
      if (b.instructions !== undefined)
        o.instructions =
          String(b.instructions || "").trim() ?
            String(b.instructions).slice(0, 20000)
          : DEFAULT_INSTRUCTIONS;
      next.options = o;
    }
    if (!next.sources.some((x) => x.id === next.activeSourceId))
      next.activeSourceId = next.sources[0]?.id || null;
    writeSettings(next);
    return next;
  }

  function getSource(id, s = readSettings()) {
    return s.sources.find((x) => x.id === (id || s.activeSourceId)) || null;
  }

  // ------------------------------------------------------------ HTTP helpers
  // "http://host:1234/v1" and "http://host:1234" both mean the server root.
  const rootUrl = (src) => src.baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");

  function headers(src) {
    const h = { "Content-Type": "application/json" };
    if (src.apiKey) h.Authorization = `Bearer ${src.apiKey}`;
    return h;
  }

  async function call(src, method, p, body, { timeoutMs = 15000, signal } = {}) {
    if (!src.baseUrl) throw new Error(`${src.name}: no server URL set`);
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    let r;
    try {
      r = await fetch(rootUrl(src) + p, {
        method,
        headers: headers(src),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      if (signal?.aborted) throw signal.reason || err;
      if (err.name === "TimeoutError")
        throw new Error(`${src.name} didn't answer ${p} in ${Math.round(timeoutMs / 1000)}s`);
      throw new Error(`Can't reach ${src.name} at ${rootUrl(src)} (${err.cause?.code || err.message})`);
    }
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* not JSON */
    }
    if (!r.ok) {
      const msg =
        json?.error?.message ||
        (typeof json?.error === "string" ? json.error : null) ||
        json?.detail ||
        json?.message ||
        text.slice(0, 300) ||
        r.statusText;
      // An HTML error page means some other program owns this port (e.g. another
      // app on 5000 pushed text-generation-webui to 5001).
      const wrongServer =
        r.status === 404 && /<html|Cannot GET/i.test(text) ?
          ` — something other than ${src.name} is answering at ${rootUrl(src)}. ` +
          `Check the server's console for its real API address (the port may have moved).`
        : null;
      const e = new Error(
        wrongServer ?
          `${src.name} ${p}: HTTP 404${wrongServer}`
        : `${src.name} ${p}: HTTP ${r.status} — ${msg}`,
      );
      e.status = r.status;
      throw e;
    }
    return json ?? {};
  }

  function parseLoadArgs(src) {
    const t = String(src.loadArgs || "").trim();
    if (!t) return {};
    try {
      const o = JSON.parse(t);
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch {
      throw new Error(`${src.name}: "Load options" isn't valid JSON`);
    }
  }

  // ------------------------------------------------ per-server model management
  // listModels → [{ id, name, vision (true/false/null), sizeBytes, loaded, instances }]
  async function listModels(src) {
    if (src.kind === "lmstudio") {
      try {
        const d = await call(src, "GET", "/api/v1/models");
        return (d.models || [])
          .filter((m) => (m.type || "llm") === "llm")
          .map((m) => ({
            id: m.key,
            name: m.display_name || m.key,
            vision:
              m.capabilities ?
                !!(m.capabilities.vision === true || m.capabilities.vision?.supported)
              : null,
            sizeBytes: Number(m.size_bytes) || null,
            loaded: (m.loaded_instances || []).length > 0,
            instances: (m.loaded_instances || [])
              .map((i) => i.id || i.instance_id || i.identifier)
              .filter(Boolean),
          }));
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      // Older LM Studio (before 0.4): the beta REST API.
      try {
        const d = await call(src, "GET", "/api/v0/models");
        return (d.data || [])
          .filter((m) => m.type === "llm" || m.type === "vlm")
          .map((m) => ({
            id: m.id,
            name: m.id,
            vision: m.type === "vlm",
            sizeBytes: null,
            loaded: m.state === "loaded",
            instances: m.state === "loaded" ? [m.id] : [],
          }));
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      return openAiModels(src);
    }
    if (src.kind === "textgen") {
      const [list, info] = await Promise.all([
        call(src, "GET", "/v1/internal/model/list"),
        call(src, "GET", "/v1/internal/model/info").catch(() => ({})),
      ]);
      const current = info.model_name && info.model_name !== "None" ? info.model_name : null;
      return (list.model_names || []).map((n) => ({
        id: n,
        name: n,
        vision: null,
        sizeBytes: null,
        loaded: n === current,
        instances: n === current ? [n] : [],
      }));
    }
    if (src.kind === "ollama") {
      const [tags, ps] = await Promise.all([
        call(src, "GET", "/api/tags"),
        call(src, "GET", "/api/ps").catch(() => ({ models: [] })),
      ]);
      const loaded = new Set((ps.models || []).map((m) => m.name || m.model));
      return (tags.models || []).map((m) => {
        const id = m.name || m.model;
        return {
          id,
          name: id,
          vision: null,
          sizeBytes: Number(m.size) || null,
          loaded: loaded.has(id),
          instances: loaded.has(id) ? [id] : [],
        };
      });
    }
    return openAiModels(src);
  }

  async function openAiModels(src) {
    const d = await call(src, "GET", "/v1/models");
    return (d.data || []).map((m) => ({
      id: m.id,
      name: m.id,
      vision: null,
      sizeBytes: null,
      loaded: null, // unknown: the server loads on demand
      instances: [],
    }));
  }

  async function modelInfo(src, model) {
    const list = await listModels(src);
    return list.find((m) => m.id === model) || null;
  }

  async function loadModel(src, model, signal) {
    const extra = parseLoadArgs(src);
    if (src.kind === "lmstudio") {
      const body = { model, ...extra };
      if (src.contextLength > 0 && body.context_length === undefined)
        body.context_length = src.contextLength;
      try {
        await call(src, "POST", "/api/v1/models/load", body, {
          timeoutMs: 10 * 60 * 1000,
          signal,
        });
      } catch (err) {
        // Older LM Studio has no load endpoint: it loads on the first request (JIT).
        if (err.status !== 404) throw err;
      }
    } else if (src.kind === "textgen") {
      const body = { model_name: model };
      if (Object.keys(extra).length) body.args = extra;
      else if (src.contextLength > 0) body.args = { ctx_size: src.contextLength };
      await call(src, "POST", "/v1/internal/model/load", body, {
        timeoutMs: 10 * 60 * 1000,
        signal,
      });
    } else if (src.kind === "ollama") {
      const body = { model, keep_alive: "60m" };
      const opts = { ...extra };
      if (src.contextLength > 0 && opts.num_ctx === undefined)
        opts.num_ctx = src.contextLength;
      if (Object.keys(opts).length) body.options = opts;
      await call(src, "POST", "/api/generate", body, {
        timeoutMs: 10 * 60 * 1000,
        signal,
      });
    }
    // openai: nothing to do — the server serves what it serves.
  }

  async function unloadModel(src, model) {
    if (src.kind === "lmstudio") {
      let info = null;
      try {
        info = await modelInfo(src, model);
      } catch {
        /* fall through */
      }
      const ids = info?.instances?.length ? info.instances : [model];
      for (const id of ids) {
        try {
          await call(src, "POST", "/api/v1/models/unload", { instance_id: id }, { timeoutMs: 60000 });
        } catch (err) {
          // 404: no such instance (already gone) — or an LM Studio older than 0.4,
          // which can't unload over its API at all.
          if (err.status === 404) continue;
          throw err;
        }
      }
      return true;
    }
    if (src.kind === "textgen") {
      // Only unload what we're using — someone may be chatting with another model.
      const info = await call(src, "GET", "/v1/internal/model/info").catch(() => ({}));
      if (info.model_name && info.model_name !== "None" && info.model_name !== model)
        return true;
      await call(src, "POST", "/v1/internal/model/unload", {}, { timeoutMs: 60000 });
      return true;
    }
    if (src.kind === "ollama") {
      await call(src, "POST", "/api/generate", { model, keep_alive: 0 }, { timeoutMs: 60000 });
      return true;
    }
    return true;
  }

  // ------------------------------------------------------------ ComfyUI + GPU
  async function comfyQueueBusy() {
    try {
      const r = await fetch(`${comfyUrl}/queue`, { signal: AbortSignal.timeout(4000) });
      const q = await r.json();
      return (q.queue_running || []).length + (q.queue_pending || []).length > 0;
    } catch {
      return false; // ComfyUI not running — nothing to wait for
    }
  }

  async function comfyFree() {
    try {
      const r = await fetch(`${comfyUrl}/free`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------- state
  // `inUse`: the model GENie has loaded (or found loaded and is using). A
  // generation unloads it. `lastComfyActivity`: when ComfyUI was last seen busy.
  const state = {
    inUse: null, // { sourceId, model }
    loading: null, // { sourceId, model, controller }
    request: null, // AbortController of the chat request in flight
    lastComfyActivity: 0,
    yieldSeq: 0, // bumps every time a generation takes the GPU back
  };
  const jobs = new Map();
  const queue = [];
  let runner = null;

  function touchComfy() {
    state.lastComfyActivity = Date.now();
  }

  // A generation is about to start (or just did): get the LLM off the GPU.
  // Called by /api/comfy/generate before queueing, and by the ComfyUI websocket
  // on execution_start (runs started from ComfyUI's own UI).
  async function yieldForGeneration(reason = "a generation started") {
    touchComfy();
    const busy = state.inUse || state.loading;
    if (!busy) return false;
    state.yieldSeq++;
    const abort = new Error(`Paused — ${reason}`);
    abort.yielded = true;
    state.request?.abort(abort);
    state.loading?.controller.abort(abort);
    const target = state.inUse || state.loading;
    state.inUse = null;
    const src = getSource(target.sourceId);
    if (src && SOURCE_KINDS[src.kind].managed) {
      try {
        await unloadModel(src, target.model);
        log.log?.(`LLM: unloaded ${target.model} — ${reason}.`);
      } catch (err) {
        log.error?.(`LLM: couldn't unload ${target.model}:`, err.message);
      }
    }
    for (const j of jobs.values())
      if (j.status === "generating" || j.status === "loading")
        setJob(j, "waiting", `Paused — ${reason}. Resumes when ComfyUI is idle.`);
    return true;
  }

  // After an aborted load, the server can still complete it in the background and
  // leave the model sitting in VRAM next to the video model. Check a few times.
  function sweepStrayLoad(src, model) {
    if (!SOURCE_KINDS[src.kind].managed) return;
    for (const delay of [5000, 20000, 60000, 120000]) {
      setTimeout(async () => {
        if (state.inUse || state.loading) return; // we're using it again on purpose
        try {
          const info = await modelInfo(src, model);
          if (info?.loaded) {
            await unloadModel(src, model);
            log.log?.(`LLM: unloaded ${model} (it finished loading after the build paused).`);
          }
        } catch {
          /* server gone — nothing to clean up */
        }
      }, delay);
    }
  }

  function onComfyEvent(type) {
    if (type === "execution_start") {
      touchComfy();
      if (state.inUse || state.loading)
        yieldForGeneration("ComfyUI started a run").catch(() => {});
    } else if (type === "progress" || type === "executing") touchComfy();
  }

  // --------------------------------------------------------------- the jobs
  function setJob(job, status, message) {
    if (status) job.status = status;
    if (message !== undefined) job.message = message;
    job.updatedAt = new Date().toISOString();
  }

  function publicJob(j) {
    const { images, current, ...rest } = j;
    return rest;
  }

  function listJobs() {
    return [...jobs.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(publicJob);
  }

  function status() {
    return {
      inUse: state.inUse,
      loading: state.loading ? { sourceId: state.loading.sourceId, model: state.loading.model } : null,
      jobs: listJobs(),
    };
  }

  // ------------------------------------------------ the builder form, remembered
  // Per project, on the server (so every browser and the phone see the same thing):
  // `draft` is the form as last left, `recent` the inputs of the last builds started.
  // A project with no rules of its own starts from the rules used most recently
  // anywhere (options.lastRules), since rules tend to carry across projects.
  function readBuilder(proj) {
    let d = {};
    if (builderFile) {
      try {
        d = JSON.parse(fs.readFileSync(builderFile(proj), "utf8")) || {};
      } catch {
        /* none yet */
      }
    }
    const draft = d.draft ? cleanForm(d.draft) : null;
    return {
      draft,
      recent: Array.isArray(d.recent) ? d.recent.map(cleanForm).slice(0, MAX_RECENT) : [],
      lastRules: readSettings().options.lastRules || "",
    };
  }

  function writeBuilder(proj, data) {
    if (!builderFile) return;
    const file = builderFile(proj);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  // The fields worth remembering, validated.
  function cleanForm(f = {}) {
    const str = (v, n) => String(v ?? "").slice(0, n);
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    return {
      format: BUILD_FORMATS.has(f.format) ? f.format : "default",
      description: str(f.description, 8000),
      theme: str(f.theme, 2000),
      rules: str(f.rules, MAX_RULES),
      count: Math.max(1, Math.min(MAX_COUNT, Math.round(Number(f.count) || 1))),
      duration: num(f.duration),
      titlePrefix: str(f.titlePrefix, 100),
      imageIds: (Array.isArray(f.imageIds) ? f.imageIds : []).map(String).slice(0, MAX_IMAGES),
      at: typeof f.at === "string" ? f.at.slice(0, 40) : undefined,
    };
  }

  function saveDraft(projectId, form) {
    const proj = findProject(projectId);
    if (!proj) throw new Error("unknown projectId");
    const cur = readBuilder(proj);
    const draft = cleanForm(form);
    delete draft.at;
    writeBuilder(proj, { draft, recent: cur.recent });
    rememberRules(draft.rules);
    return draft;
  }

  function rememberRules(rules) {
    if (!rules.trim()) return;
    const s = readSettings();
    if (s.options.lastRules === rules) return;
    s.options = { ...s.options, lastRules: rules };
    writeSettings(s);
  }

  // A build started: its inputs become the draft and go on top of `recent`
  // (an identical earlier entry moves up rather than repeating).
  function rememberBuild(proj, body, job) {
    try {
      const form = cleanForm({ ...body, imageIds: job.imageIds, format: job.format });
      const key = (f) => JSON.stringify({ ...f, at: undefined });
      const cur = readBuilder(proj);
      const recent = [
        { ...form, at: new Date().toISOString() },
        ...cur.recent.filter((r) => key(r) !== key(form)),
      ].slice(0, MAX_RECENT);
      const draft = { ...form };
      delete draft.at;
      writeBuilder(proj, { draft, recent });
      rememberRules(form.rules);
    } catch (err) {
      log.error?.("LLM: couldn't save the builder form:", err.message);
    }
  }

  function startBuild(body = {}) {
    const settings = readSettings();
    const src = getSource(body.sourceId, settings);
    if (!src) throw new Error("No LLM source is set up — open ⚙ LLM settings.");
    const model = String(body.model || src.model || "").trim();
    if (!model && src.kind !== "openai")
      throw new Error(`Pick a model for ${src.name} in ⚙ LLM settings.`);
    const proj = findProject(body.projectId);
    if (!proj) throw new Error("unknown projectId");

    const gallery = readJson(imagesFile);
    const ids = (Array.isArray(body.imageIds) ? body.imageIds : [])
      .map(String)
      .slice(0, MAX_IMAGES);
    const images = [];
    for (const id of ids) {
      const g = gallery.find((x) => x.id === id);
      if (!g) throw new Error("One of the chosen images is no longer in the gallery.");
      const mime = g.mime || "";
      if (!(g.kind === "image" || mime.startsWith("image/")))
        throw new Error(`"${g.name}" isn't an image.`);
      images.push(g);
    }
    const description = String(body.description || "").trim().slice(0, 8000);
    const format = BUILD_FORMATS.has(body.format) ? body.format : "default";
    if (format === "minimax_t2v") {
      images.length = 0; // text-to-video takes no references
      if (!description) throw new Error("MiniMax T2V needs a description (it takes no images).");
    }
    if (!description && !images.length)
      throw new Error("Add a description, an image, or both.");
    const variations = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(body.count) || 1)));
    const d = Number(body.duration);
    const duration = Number.isFinite(d) && d > 0 ? d : null;
    // A MiniMax video longer than one clip is written as a prompt group: one whole
    // prompt per clip, each with its own summary, subjects and images.
    const clips = format !== "default" ? clipLengths(duration) : [];
    const job = {
      id: randomUUID(),
      projectId: proj.id,
      sourceId: src.id,
      sourceName: src.name,
      model,
      format,
      variations, // what was asked for; `count` is the prompts that makes
      clips, // [] for one prompt per variation, else each clip's seconds
      group: null, // the group the clips being written go into
      clipsDone: [], // the current variation's clips so far, for the next one's context
      imageIds: images.map((g) => g.id),
      images, // gallery entries (stripped from the public view)
      description,
      theme: String(body.theme || "").trim().slice(0, 2000),
      rules: String(body.rules || "").trim().slice(0, MAX_RULES),
      titlePrefix: String(body.titlePrefix || "").trim().slice(0, 100),
      duration,
      count: variations * Math.max(1, clips.length),
      done: 0,
      created: [], // [{ id, title }]
      status: "queued",
      message: "Queued",
      error: null,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    rememberBuild(proj, { ...body, count: variations }, job);
    jobs.set(job.id, job);
    queue.push(job);
    pruneJobs();
    pump();
    return publicJob(job);
  }

  // ✏️ Revise: rewrite one saved prompt (as it currently stands in the editor, saved
  // or not) following the user's instruction. Runs through the same queue and GPU
  // turn-taking as a build, but saves nothing: the result waits on the job for the
  // editor to show, and the user decides whether to apply it.
  function startRevise(body = {}) {
    const settings = readSettings();
    const src = getSource(body.sourceId, settings);
    if (!src) throw new Error("No LLM source is set up — open ⚙ LLM settings.");
    const model = String(body.model || src.model || "").trim();
    if (!model && src.kind !== "openai")
      throw new Error(`Pick a model for ${src.name} in ⚙ LLM settings.`);
    const proj = findProject(body.projectId);
    if (!proj) throw new Error("unknown projectId");
    const instruction = String(body.instruction || "").trim().slice(0, 8000);
    if (!instruction) throw new Error("Say what to change.");
    const format = BUILD_FORMATS.has(body.format) ? body.format : "default";
    const structured = format !== "default";
    const prompt = String(body.prompt || "").slice(0, 50000);
    const mm = body.minimax && typeof body.minimax === "object" ? body.minimax : null;
    if (structured && !mm) throw new Error("This prompt has no MiniMax fields to revise.");
    if (!structured && !prompt.trim()) throw new Error("The prompt is empty — nothing to revise.");

    // The references as the editor has them (keys/definitions may be unsaved edits);
    // the image files themselves come from the gallery so the model can see them.
    const gallery = readJson(imagesFile);
    const refs = [];
    const images = [];
    for (const r of (Array.isArray(body.refs) ? body.refs : []).slice(0, 50)) {
      const g = gallery.find((x) => x.id === String(r?.id));
      if (!g) continue;
      const kind = g.kind || (String(g.mime || "").startsWith("image/") ? "image" : r.kind);
      const ref = {
        kind,
        key: String(r.key ?? g.key ?? "").slice(0, 40),
        definition: String(r.definition ?? g.definition ?? "").slice(0, 4000),
      };
      if (kind === "image" && format !== "minimax_t2v" && images.length < MAX_IMAGES) {
        images.push(g);
        ref.picture = images.length;
      }
      refs.push(ref);
    }
    let rules = "";
    if (body.useRules) {
      const b = readBuilder(proj);
      rules = (b.draft?.rules || b.lastRules || "").trim();
    }
    const d = Number(body.duration);
    const job = {
      id: randomUUID(),
      kind: "revise",
      projectId: proj.id,
      promptId: String(body.promptId || "").slice(0, 100) || null,
      sourceId: src.id,
      sourceName: src.name,
      model,
      format,
      title: String(body.title || "").slice(0, 200),
      current: structured ? mm : prompt,
      refs,
      imageIds: images.map((g) => g.id),
      images,
      description: instruction, // what the job list shows
      instruction,
      theme: "",
      rules,
      titlePrefix: "",
      duration: Number.isFinite(d) && d > 0 ? d : null,
      count: 1,
      done: 0,
      created: [],
      result: null,
      status: "queued",
      message: "Queued",
      error: null,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    jobs.set(job.id, job);
    queue.push(job);
    pruneJobs();
    pump();
    return publicJob(job);
  }

  function cancelJob(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (["done", "failed", "cancelled"].includes(job.status)) return publicJob(job);
    job.cancelled = true;
    const i = queue.indexOf(job);
    if (i >= 0) queue.splice(i, 1);
    if (runner?.job === job) {
      const e = new Error("Cancelled");
      e.cancelled = true;
      state.request?.abort(e);
      state.loading?.controller.abort(e);
    }
    setJob(job, "cancelled", `Cancelled after ${job.done} of ${job.count}.`);
    return publicJob(job);
  }

  function pruneJobs() {
    const finished = [...jobs.values()]
      .filter((j) => ["done", "failed", "cancelled"].includes(j.status))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    for (const j of finished.slice(JOB_KEEP)) jobs.delete(j.id);
  }

  function pump() {
    if (runner || !queue.length) return;
    const job = queue.shift();
    runner = { job };
    runJob(job)
      .catch((err) => {
        if (!job.cancelled) {
          job.error = err.message || String(err);
          setJob(job, "failed", job.error);
          log.error?.("LLM build failed:", job.error);
        }
      })
      .finally(async () => {
        runner = null;
        if (!queue.length) {
          const s = readSettings();
          if (s.options.unloadWhenDone && state.inUse) {
            const t = state.inUse;
            state.inUse = null;
            const src = getSource(t.sourceId, s);
            if (src && SOURCE_KINDS[src.kind].managed)
              await unloadModel(src, t.model)
                .then(() => log.log?.(`LLM: unloaded ${t.model} — build finished.`))
                .catch((err) =>
                  log.error?.("LLM: unload after build failed:", err.message),
                );
          }
        }
        pump();
      });
  }

  const checkCancel = (job) => {
    if (job.cancelled) {
      const e = new Error("Cancelled");
      e.cancelled = true;
      throw e;
    }
  };

  // Wait until the GPU is ours: ComfyUI idle (for the grace period), enough free
  // VRAM (freeing ComfyUI's models if allowed), then the model loaded.
  async function acquire(job, src) {
    const managed = SOURCE_KINDS[src.kind].managed;
    let vramSince = null;
    let freedAt = 0;
    for (;;) {
      checkCancel(job);
      const opts = readSettings().options;
      if (state.inUse && state.inUse.sourceId === src.id && state.inUse.model === job.model)
        return; // already loaded and ours

      // 1. ComfyUI idle, and idle for long enough.
      if (await comfyQueueBusy()) {
        touchComfy();
        setJob(job, "waiting", "Waiting for ComfyUI to finish its queue…");
        await sleep(3000);
        continue;
      }
      const quiet = (Date.now() - state.lastComfyActivity) / 1000;
      if (quiet < opts.resumeDelaySec) {
        const left = Math.ceil(opts.resumeDelaySec - quiet);
        setJob(job, "waiting", `ComfyUI was just busy — resuming in ${left}s…`);
        await sleep(Math.min(3000, left * 1000));
        continue;
      }
      if (!managed) return; // a remote/cloud server — no GPU of ours to manage

      // 2. Already loaded (by us earlier, or by hand)? Then just use it.
      let info = null;
      try {
        info = await modelInfo(src, job.model);
      } catch (err) {
        throw new Error(`${err.message}${src.kind === "lmstudio" ? " — is LM Studio's server running? (Developer tab → Start server, or `lms server start`)" : ""}`);
      }
      if (!info)
        throw new Error(`${src.name} has no model "${job.model}". Pick another in ⚙ LLM settings.`);
      if (info?.loaded) {
        state.inUse = { sourceId: src.id, model: job.model };
        return;
      }

      // 3. Enough VRAM?
      const needGb =
        src.vramGb > 0 ? src.vramGb
        : info?.sizeBytes ? info.sizeBytes / GiB + opts.headroomGb
        : null;
      const gpu = await gpuMemory();
      if (needGb && gpu) {
        const freeGb = gpu.freeMiB / 1024;
        if (freeGb < needGb) {
          vramSince ||= Date.now();
          if (opts.freeComfyVram && Date.now() - freedAt > 60000) {
            freedAt = Date.now();
            setJob(job, "waiting", `Need ~${needGb.toFixed(1)} GB VRAM, ${freeGb.toFixed(1)} GB free — asking ComfyUI to unload its models…`);
            await comfyFree();
            await sleep(4000);
            continue;
          }
          if (Date.now() - vramSince > opts.vramWaitMin * 60000)
            throw new Error(
              `Gave up after ${opts.vramWaitMin} min waiting for VRAM: the model needs ~${needGb.toFixed(1)} GB, only ${freeGb.toFixed(1)} GB is free. ` +
                `Close whatever else is using the GPU, or lower "VRAM needed" in ⚙ LLM settings.`,
            );
          setJob(job, "waiting", `Waiting for VRAM: need ~${needGb.toFixed(1)} GB, ${freeGb.toFixed(1)} GB free…`);
          await sleep(5000);
          continue;
        }
      } else if (opts.freeComfyVram && !freedAt) {
        // Size unknown (or no GPU reading): clear ComfyUI's cache once, to be safe.
        freedAt = Date.now();
        await comfyFree();
        await sleep(2000);
      }

      // 4. Load it — unless a generation grabbed the GPU meanwhile.
      const seq = state.yieldSeq;
      const controller = new AbortController();
      state.loading = { sourceId: src.id, model: job.model, controller };
      setJob(job, "loading", `Loading ${job.model} in ${src.name}…`);
      const t0 = Date.now();
      try {
        await loadModel(src, job.model, controller.signal);
      } catch (err) {
        if (err.yielded || controller.signal.aborted) {
          // The server may finish loading anyway after we hang up — catch that.
          sweepStrayLoad(src, job.model);
          if (job.cancelled) checkCancel(job);
          continue; // a generation started — back to waiting
        }
        throw new Error(`Couldn't load ${job.model}: ${err.message}`);
      } finally {
        state.loading = null;
      }
      if (seq !== state.yieldSeq || (await comfyQueueBusy())) {
        // A run started while we were loading: step aside again.
        state.inUse = { sourceId: src.id, model: job.model };
        await yieldForGeneration("a generation started while the LLM was loading");
        continue;
      }
      state.inUse = { sourceId: src.id, model: job.model };
      log.log?.(`LLM: loaded ${job.model} in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
      return;
    }
  }

  async function runJob(job) {
    const src = getSource(job.sourceId);
    if (!src) throw new Error("That LLM source was removed from settings.");
    const imageParts = job.images.map((g) => {
      const file = path.join(inputDir, g.storedName);
      let buf;
      try {
        buf = fs.readFileSync(file);
      } catch {
        throw new Error(`Can't read "${g.name}" from the gallery folder.`);
      }
      return {
        g,
        url: `data:${g.mime || "image/png"};base64,${buf.toString("base64")}`,
      };
    });

    // While a request is in flight, watch ComfyUI's queue too (the websocket may
    // not be connected) so a run started elsewhere still takes the GPU back.
    ensureComfyWs();
    const watch = setInterval(async () => {
      if (state.request && (await comfyQueueBusy()))
        yieldForGeneration("ComfyUI started a run").catch(() => {});
    }, 3000);

    let failures = 0;
    try {
      while (job.done < job.count) {
        checkCancel(job);
        await acquire(job, src);
        checkCancel(job);
        const n = job.done + 1;
        const doing =
          job.kind === "revise" ? "Revising"
          : job.clips?.length ?
            `Writing ${job.variations > 1 ? `video ${variationOf(job) + 1} of ${job.variations}, ` : ""}clip ${clipOf(job) + 1} of ${job.clips.length}`
          : `Writing prompt ${n} of ${job.count}`;
        setJob(job, "generating", `${doing}…`);
        const controller = new AbortController();
        state.request = controller;
        let result;
        try {
          result = await writePrompt(job, src, imageParts, controller.signal, (chars, fix) =>
            setJob(
              job,
              undefined,
              fix ?
                `${doing}… fixing the reply's JSON, attempt ${fix} of ${REPAIR_ATTEMPTS} (${chars} characters)`
              : `${doing}… (${chars} characters)`,
            ),
          );
        } catch (err) {
          const reason = controller.signal.reason;
          if (reason?.cancelled || job.cancelled) checkCancel(job);
          if (reason?.yielded) continue; // resumes after the generation
          failures++;
          log.error?.(`LLM: prompt ${n} failed:`, err.message);
          if (failures >= 3) throw err;
          setJob(job, undefined, `Prompt ${n} failed (${err.message}) — retrying…`);
          await sleep(2000);
          continue;
        } finally {
          state.request = null;
        }
        failures = 0;
        if (job.kind === "revise") {
          job.result = result; // the editor shows it; nothing is saved here
          job.done = 1;
          break;
        }
        const saved = savePrompt(job, result, n);
        job.created.push({ id: saved.id, title: saved.title, llmTitle: result.title });
        if (job.clips?.length) {
          job.clipsDone.push(result);
          if (job.clipsDone.length === job.clips.length) {
            job.clipsDone = []; // the next variation starts a group of its own
            job.group = null;
          }
        }
        job.done++;
      }
      if (job.kind === "revise") {
        setJob(job, "done", "Revision ready — review it in the prompt editor.");
        return;
      }
      setJob(
        job,
        "done",
        job.clips?.length ?
          `Saved ${job.variations} prompt group${job.variations === 1 ? "" : "s"} of ${job.clips.length} clips to Saved Prompts.`
        : `Saved ${job.count} prompt${job.count === 1 ? "" : "s"} to Saved Prompts.`,
      );
    } finally {
      clearInterval(watch);
    }
  }

  // The prompt being revised, in the same JSON shape the model must answer in.
  function currentAsJson(job) {
    if (job.format === "default") return { title: job.title, prompt: job.current };
    const mm = job.current || {};
    const bare = (k) => String(k || "").replace(/^<|>$/g, "");
    const o = { title: job.title };
    if (job.format === "minimax") {
      const subjects = [];
      const seen = new Set();
      for (const r of job.refs) {
        if (!r.key || seen.has(r.key)) continue;
        seen.add(r.key);
        subjects.push({ key: r.key, definition: r.definition || "" });
      }
      for (const x of mm.subjects || []) {
        const k = bare(x?.key);
        const i = subjects.findIndex((y) => y.key === k);
        if (i >= 0 && x.definition) subjects[i].definition = x.definition;
        else if (i < 0 && (k || x?.definition)) subjects.push({ key: k, definition: x?.definition || "" });
      }
      o.subjects = subjects;
      o.summary = mm.summary || "";
      o.retention = Object.fromEntries(
        Object.entries(mm.retention || {}).map(([k, v]) => [bare(k), v]),
      );
    }
    o.style = mm.style || "";
    o.shots = (mm.shots || []).map((x) => ({ seconds: x?.len ?? null, text: x?.text || "" }));
    o.soundscape = mm.soundscape || "";
    o.music = mm.music || "";
    return o;
  }

  function buildReviseMessages(job, imageParts) {
    const opts = readSettings().options;
    const base =
      job.format === "minimax" ? MINIMAX_INSTRUCTIONS
      : job.format === "minimax_t2v" ? MINIMAX_T2V_INSTRUCTIONS
      : opts.instructions || DEFAULT_INSTRUCTIONS;
    const system =
      base +
      "\n\nYou are now EDITING an existing prompt, not writing a new one. Make the changes the user asks for and keep everything else as it is — the same subjects and keys, wording, structure and details — unless a change requires otherwise. Reply with the complete revised prompt in the same JSON format: every field, not just the ones you changed." +
      (job.rules ?
        "\n\nRULES — the user's own rules. Follow every one of them; where one conflicts with the guidance above, the rule wins (but still reply in the JSON format asked for):\n" +
        job.rules
      : "");
    const lines = [];
    if (imageParts.length) {
      lines.push("Reference images, in order:");
      for (const r of job.refs) {
        if (!r.picture) continue;
        let l = `- <Picture ${r.picture}>`;
        if (r.key) l += ` — the subject <${r.key}>`;
        if (r.definition) l += `: ${r.definition}`;
        lines.push(l);
      }
      lines.push("");
    }
    if (job.duration) lines.push(`Clip length: ${job.duration} seconds.`, "");
    lines.push("The current prompt:", "```json", JSON.stringify(currentAsJson(job), null, 2), "```", "");
    lines.push(`Changes to make: ${job.instruction}`, "");
    lines.push("Reply with only the complete revised JSON object.");
    const text = lines.join("\n");
    const content = [{ type: "text", text }];
    imageParts.forEach(({ url }, i) => {
      content.push({ type: "text", text: `<Picture ${i + 1}>:` });
      content.push({ type: "image_url", image_url: { url } });
    });
    return [
      { role: "system", content: system },
      { role: "user", content: imageParts.length ? content : text },
    ];
  }

  function buildMessages(job, imageParts, n) {
    if (job.kind === "revise") return buildReviseMessages(job, imageParts);
    const opts = readSettings().options;
    const lines = [];
    if (imageParts.length) {
      lines.push(
        `Reference images, in order (the video model receives them as ${imageParts
          .map((_, i) => `<Picture ${i + 1}>`)
          .join(", ")}):`,
      );
      imageParts.forEach(({ g }, i) => {
        let l = `- <Picture ${i + 1}>`;
        if (g.key) l += ` — the subject <${g.key}>`;
        if (g.definition) l += `: ${g.definition}`;
        lines.push(l);
      });
      lines.push("");
    }
    if (job.description) lines.push(`What should happen: ${job.description}`);
    if (job.theme) lines.push(`Theme / style: ${job.theme}`);
    if (job.rules) lines.push("", "Follow the rules in the system prompt.");
    const clips = job.clips || [];
    const k = clipOf(job);
    if (clips.length) {
      // One clip of a longer video: a whole prompt of its own.
      lines.push(
        "",
        `The video is ${job.duration} seconds long, made as ${clips.length} clips that are generated separately and joined: ${clips
          .map((c, i) => `clip ${i + 1} is ${c} seconds`)
          .join(", ")}.`,
        `Write clip ${k + 1} now — ${clips[k]} seconds; its shots' seconds add up to ${clips[k]}. It covers ${k === 0 ? "the opening" : k === clips.length - 1 ? "the ending" : "the middle"} of what should happen.`,
        "This clip is generated on its own and never sees the other clips, so its prompt stands alone: its own subjects, summary and retention for what is in it, and an opening shot that re-establishes who is where. Keep the subjects (with the same keys), setting and style consistent from clip to clip, and carry on exactly where the previous clip ended.",
      );
      if (job.format === "minimax")
        lines.push(
          `Also give "pictures": the numbers of the reference images this clip needs, e.g. [1, 3] — only those are sent with it. Refer to images by those same numbers.`,
        );
      if (k === 0)
        lines.push(`Also give "video_title": a short title for the whole video, at most 8 words.`);
      if (job.clipsDone.length) {
        lines.push("", "The clips written so far:");
        job.clipsDone.forEach((c, i) => {
          const mm = c.minimax || {};
          lines.push(
            `Clip ${i + 1}: ${mm.summary || ""}`.trim(),
            ...(mm.shots || []).map((x, j) => `  Shot ${j + 1}${x.len ? ` (${x.len}s)` : ""}: ${x.text}`),
          );
        });
      }
    } else if (job.duration) lines.push(`Clip length: ${job.duration} seconds.`);
    const variations = job.variations || job.count;
    if (variations > 1) {
      const v = clips.length ? variationOf(job) : n - 1;
      lines.push("");
      lines.push(
        `This is ${clips.length ? "video" : "prompt"} ${v + 1} of ${variations} variations on the request. Make it clearly different from the others — a different angle, beat, staging or camera approach — while keeping the same subjects and theme.`,
      );
      const others = clips.length ?
          job.created.filter((_, i) => i % clips.length === 0 && Math.floor(i / clips.length) < v)
        : job.created;
      if (others.length && k === 0)
        lines.push(`Already written: ${others.map((c) => `"${c.llmTitle || c.title}"`).join(", ")}.`);
    }
    lines.push("");
    const extra =
      !clips.length ? ""
      : job.format === "minimax" ? (k === 0 ? ", pictures and video_title" : " and pictures")
      : k === 0 ? " and video_title"
      : "";
    lines.push(
      job.format === "minimax" ?
        `Reply with only the JSON object with the fields title, subjects, summary, retention, style, shots, soundscape and music${extra}.`
      : job.format === "minimax_t2v" ?
        `Reply with only the JSON object with the fields title, style, shots, soundscape and music${extra}.`
      : 'Reply with only the JSON object: {"title": "…", "prompt": "…"}',
    );

    const content = [{ type: "text", text: lines.join("\n") }];
    imageParts.forEach(({ url }, i) => {
      content.push({ type: "text", text: `<Picture ${i + 1}>:` });
      content.push({ type: "image_url", image_url: { url } });
    });
    return [
      {
        role: "system",
        content:
          (job.format === "minimax" ? MINIMAX_INSTRUCTIONS
          : job.format === "minimax_t2v" ? MINIMAX_T2V_INSTRUCTIONS
          : opts.instructions || DEFAULT_INSTRUCTIONS) +
          (job.rules ?
            "\n\nRULES — the user's own rules for this prompt. Follow every one of them; " +
            "where one conflicts with the guidance above, the rule wins (but still reply in the JSON format asked for):\n" +
            job.rules
          : ""),
      },
      { role: "user", content: imageParts.length ? content : lines.join("\n") },
    ];
  }

  // One prompt from the LLM, streamed (a long non-streamed reply would trip Node's
  // 5-minute header timeout).
  async function writePrompt(job, src, imageParts, signal, onProgress) {
    const opts = readSettings().options;
    const text = await complete(
      job,
      src,
      buildMessages(job, imageParts, job.done + 1),
      opts.temperature,
      imageParts.length > 0,
      signal,
      onProgress,
    );
    if (!job.format || job.format === "default") return parseReply(text);
    // A MiniMax reply that isn't its JSON goes back to the model to be fixed — a
    // text-only request, so the images aren't processed again. After REPAIR_ATTEMPTS
    // the reply is thrown away: the error makes runJob write the prompt afresh.
    let reply = text;
    for (let fix = 1; ; fix++) {
      try {
        return parseStructuredReply(reply, job.format);
      } catch (err) {
        if (fix > REPAIR_ATTEMPTS || !stripThinking(text)) throw err;
        log.warn?.(`LLM: ${err.message} Asking it to fix the JSON (${fix} of ${REPAIR_ATTEMPTS}).`);
        onProgress?.(0, fix);
        reply = await complete(
          job,
          src,
          buildRepairMessages(job, text, err.message),
          0.2,
          false,
          signal,
          (chars) => onProgress?.(chars, fix),
        );
      }
    }
  }

  // Ask the model to turn its own malformed reply into the JSON the format needs.
  function buildRepairMessages(job, text, problem) {
    const shape = (job.format === "minimax" ? MINIMAX_INSTRUCTIONS : MINIMAX_T2V_INSTRUCTIONS)
      .split("\n")
      .pop();
    return [
      {
        role: "system",
        content:
          "You repair malformed JSON. Reply with only the corrected JSON object and nothing else — no commentary, no markdown.",
      },
      {
        role: "user",
        content: [
          `The reply below should be one JSON object in this shape, but it can't be used: ${problem}`,
          shape,
          "",
          "Rewrite it as valid JSON in that shape. Keep the wording as it is and change only what is needed: quotes, commas, brackets, escaping, field names. If it is prose without the structure, sort the text into the fields.",
          "",
          "The reply:",
          stripThinking(text),
        ].join("\n"),
      },
    ];
  }

  // One streamed chat completion → the reply text.
  async function complete(job, src, messages, temperature, hasImages, signal, onProgress) {
    const opts = readSettings().options;
    const body = {
      messages,
      temperature,
      max_tokens: opts.maxTokens,
      stream: true,
    };
    if (job.model) body.model = job.model;
    const url = `${rootUrl(src)}/v1/chat/completions`;
    const idle = new AbortController(); // no tokens for 3 minutes → give up
    let idleTimer = setTimeout(() => idle.abort(new Error("the LLM stopped responding")), 180000);
    const bump = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idle.abort(new Error("the LLM stopped responding")), 180000);
    };
    let text = "";
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: headers(src),
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, idle.signal]),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        let msg = t.slice(0, 400);
        try {
          const j = JSON.parse(t);
          msg = j.error?.message || j.error || j.detail || msg;
        } catch {
          /* raw text */
        }
        if (/image|vision|multimodal|mmproj/i.test(String(msg)) && hasImages)
          msg += " — is this a vision model? (LM Studio shows an eye icon on vision models.)";
        throw new Error(`HTTP ${r.status} — ${msg}`);
      }
      const ctype = r.headers.get("content-type") || "";
      if (!ctype.includes("event-stream")) {
        // Server ignored stream:true.
        const j = await r.json();
        text = j.choices?.[0]?.message?.content || "";
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bump();
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const j = JSON.parse(data);
              if (j.error) throw new Error(j.error.message || String(j.error));
              const piece = j.choices?.[0]?.delta?.content;
              if (piece) {
                text += piece;
                onProgress?.(text.length);
              }
            } catch (err) {
              if (err instanceof SyntaxError) continue;
              throw err;
            }
          }
        }
      }
    } catch (err) {
      if (signal.aborted) throw signal.reason || err;
      if (idle.signal.aborted) throw idle.signal.reason;
      if (err.cause?.code) throw new Error(`Can't reach ${src.name} (${err.cause.code})`);
      throw err;
    } finally {
      clearTimeout(idleTimer);
    }
    return text;
  }

  function savePrompt(job, result, n) {
    const proj = findProject(job.projectId);
    if (!proj) throw new Error("The project was deleted.");
    let title = result.title || `Prompt ${n}`;
    if (job.titlePrefix) title = `${job.titlePrefix} — ${title}`;
    const structured = job.format && job.format !== "default";
    let images = job.format === "minimax_t2v" ? [] : job.images;
    let minimax = result.minimax;
    let duration = job.duration;
    let group;
    const clips = job.clips || [];
    if (clips.length) {
      const k = clipOf(job);
      duration = clips[k];
      if (!job.group) {
        let name = result.videoTitle || result.title || `Video ${variationOf(job) + 1}`;
        if (job.titlePrefix) name = `${job.titlePrefix} — ${name}`;
        job.group = { id: randomUUID(), name: name.slice(0, 200) };
      }
      group = job.group;
      title = `${result.title || group.name} — ${k + 1}/${clips.length}`;
      // Only the images this clip uses, renumbered: its <Picture N> labels count from
      // its own reference list.
      if (images.length) ({ images, minimax } = clipImages(images, minimax, result.pictures));
    }
    // A batch reads top to bottom in the order it was written: each prompt goes
    // right after the previous one from this build (the first goes on top), with its
    // weight so it stays there even if the list was re-ordered meanwhile.
    const list = readPrompts(proj);
    const prevId = job.created.length ? job.created[job.created.length - 1].id : null;
    const at = prevId ? list.findIndex((x) => x.id === prevId) : -1;
    const fields = sanitizePromptFields({
      title,
      type: structured ? job.format : "default",
      prompt: structured ? "" : result.prompt,
      ...(structured ? { minimax } : {}),
      ...(group ? { group } : {}),
      duration,
      weight: at >= 0 ? list[at].weight ?? 0 : 0,
      refs: images.map((g) => ({ id: g.id, kind: "image", name: g.name })),
    });
    const now = new Date().toISOString();
    const entry = {
      id: randomUUID(),
      ...fields,
      llm: {
        model: job.model,
        source: job.sourceName,
        description: job.description,
        theme: job.theme,
        rules: job.rules || undefined,
        jobId: job.id,
      },
      createdAt: now,
      updatedAt: now,
    };
    if (at >= 0) list.splice(at + 1, 0, entry);
    else list.unshift(entry);
    writePrompts(proj, list);
    return withRefDetails ? withRefDetails([entry])[0] : entry;
  }

  // Which variation (0-based) and which of its clips the next prompt is.
  function variationOf(job) {
    return Math.floor(job.done / Math.max(1, job.clips?.length || 1));
  }
  function clipOf(job) {
    return job.clips?.length ? job.done % job.clips.length : 0;
  }

  return {
    readSettings,
    publicSettings,
    updateSettings,
    getSource,
    listModels,
    loadModel,
    unloadModel,
    startBuild,
    startRevise,
    readBuilder: (projectId) => {
      const proj = findProject(projectId);
      if (!proj) throw new Error("unknown projectId");
      return readBuilder(proj);
    },
    saveDraft,
    cancelJob,
    listJobs,
    status,
    getJob: (id) => (jobs.has(id) ? publicJob(jobs.get(id)) : null),
    yieldForGeneration,
    onComfyEvent,
    unloadNow: async () => {
      const t = state.inUse;
      if (!t) return false;
      if (runner) throw new Error("A build is running — cancel it first.");
      state.inUse = null;
      const src = getSource(t.sourceId);
      if (src && SOURCE_KINDS[src.kind].managed) await unloadModel(src, t.model);
      return true;
    },
    _state: state,
  };
}

// How many times a malformed MiniMax reply goes back to the model to be fixed.
const REPAIR_ATTEMPTS = 3;

// A MiniMax build longer than this is written as a prompt group, one prompt per clip
// (the UI's CLIP_MAX_SECONDS).
const CLIP_MAX_SECONDS = 15;
const CLIP_MIN_SECONDS = 4; // the shortest clip the video models make

// The lengths of the clips a video of `total` seconds is made of: full clips, then
// the remainder — topped up from the clip before it when too short to generate.
// [] when one clip is enough.
export function clipLengths(total) {
  const t = Math.round(Number(total) || 0);
  if (t <= CLIP_MAX_SECONDS) return [];
  const out = Array(Math.floor(t / CLIP_MAX_SECONDS)).fill(CLIP_MAX_SECONDS);
  const rest = t % CLIP_MAX_SECONDS;
  if (rest) {
    const last = Math.max(rest, CLIP_MIN_SECONDS);
    out[out.length - 1] -= last - rest;
    out.push(last);
  }
  return out;
}

// One clip's references: the images it listed in `pictures` plus any its text cites
// as <Picture N>, in their original order — renumbered 1, 2, 3… through the text,
// since a prompt's labels count from its own reference list. Every image when it
// named none (or only ones that don't exist).
export function clipImages(images, mm, pictures) {
  const PIC = /<Picture\s+(\d+)>/gi;
  const texts = [
    mm.summary,
    mm.style,
    mm.soundscape,
    mm.music,
    ...(mm.shots || []).map((x) => x.text),
    ...(mm.subjects || []).map((x) => x.definition),
    ...Object.values(mm.retention || {}),
  ];
  const want = new Set(
    (Array.isArray(pictures) ? pictures : [])
      .map((x) => parseInt(String(x).replace(/\D+/g, ""), 10))
      .filter((x) => x >= 1 && x <= images.length),
  );
  for (const t of texts)
    for (const m of String(t || "").matchAll(PIC)) {
      const x = Number(m[1]);
      if (x >= 1 && x <= images.length) want.add(x);
    }
  if (!want.size || want.size === images.length) return { images, minimax: mm };
  const keep = [...want].sort((a, b) => a - b);
  const renumber = new Map(keep.map((x, i) => [x, i + 1]));
  const fix = (t) =>
    String(t ?? "").replace(PIC, (all, x) =>
      renumber.has(Number(x)) ? `<Picture ${renumber.get(Number(x))}>` : all,
    );
  return {
    images: keep.map((x) => images[x - 1]),
    minimax: {
      ...mm,
      summary: fix(mm.summary),
      style: fix(mm.style),
      soundscape: fix(mm.soundscape),
      music: fix(mm.music),
      shots: (mm.shots || []).map((x) => ({ ...x, text: fix(x.text) })),
      subjects: (mm.subjects || []).map((x) => ({ ...x, definition: fix(x.definition) })),
      retention: Object.fromEntries(Object.entries(mm.retention || {}).map(([k, v]) => [k, fix(v)])),
    },
  };
}

// A reply without its <think> block.
function stripThinking(raw) {
  return String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .trim();
}

// The model's reply → { title, prompt }. Tolerates <think> blocks, ``` fences and
// chatter around the JSON; a reply that isn't JSON at all becomes the prompt itself.
export function parseReply(raw) {
  let t = stripThinking(raw);
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    const cand = t.slice(a, b + 1);
    for (const attempt of [cand, escapeRawNewlines(cand)]) {
      try {
        const j = JSON.parse(attempt);
        const prompt = String(j.prompt || j.text || "").trim();
        if (prompt)
          return {
            title: String(j.title || "").trim().replace(/^["']|["']$/g, "").slice(0, 120),
            prompt: prompt.replace(/\\n/g, "\n"),
          };
      } catch {
        /* try the next shape */
      }
    }
  }
  if (!t) throw new Error("The LLM returned an empty reply.");
  return { title: "", prompt: t.replace(/^\s*prompt\s*:\s*/i, "").trim() };
}

// A MiniMax build's reply → { title, minimax, pictures?, videoTitle? } in the stored
// shape (see app.js, "Stored shape (p.minimax)"). Throws when there's no usable JSON,
// so the build retries; a reply with only a "prompt" string becomes a single shot.
// `pictures` and `videoTitle` come from a clip of a longer build (see buildMessages).
export function parseStructuredReply(raw, format) {
  let t = stripThinking(raw);
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  let j = null;
  if (a >= 0 && b > a) {
    const cand = t.slice(a, b + 1);
    for (const attempt of [cand, escapeRawNewlines(cand)]) {
      try {
        j = JSON.parse(attempt);
        break;
      } catch {
        /* try the next shape */
      }
    }
  }
  if (!j || typeof j !== "object")
    throw new Error("The LLM's reply wasn't the JSON the MiniMax format needs.");
  const str = (v) => String(v ?? "").replace(/\\n/g, "\n").trim();
  const key = (k) =>
    str(k)
      .replace(/^@+/, "")
      .replace(/^<|>$/g, "")
      .replace(/\s+/g, "_")
      .toLowerCase();
  const secs = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? Math.max(0, v) : null;
    const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)/.exec(String(v).trim());
    return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null;
  };
  let shots = (Array.isArray(j.shots) ? j.shots : [])
    .map((x) => (typeof x === "string" ? { text: x } : x || {}))
    .map((x) => ({
      len: secs(x.seconds ?? x.len ?? x.length ?? x.duration),
      at: secs(x.at ?? x.time),
      text: str(x.text ?? x.description),
    }))
    .filter((x) => x.text);
  if (!shots.length && str(j.prompt)) shots = [{ len: null, text: str(j.prompt) }];
  if (!shots.length) throw new Error("The LLM's reply had no shots.");
  // A reply that gave start times instead of lengths: a shot lasts until the next starts.
  if (!shots.some((x) => x.len != null) && shots.some((x) => x.at != null))
    shots.forEach((x, i) => {
      const from = i === 0 ? 0 : x.at;
      const to = shots[i + 1]?.at;
      x.len = from == null || to == null ? null : Math.max(0, Math.round((to - from) * 1000) / 1000);
    });
  shots = shots.map(({ len, text }) => ({ len, text }));
  const mm = {
    summary: format === "minimax" ? str(j.summary) : "",
    style: str(j.style),
    shots,
    subjects: [],
    retention: {},
    soundscape: str(j.soundscape),
    music: str(j.music),
  };
  if (format === "minimax") {
    mm.subjects = (Array.isArray(j.subjects) ? j.subjects : [])
      .map((x) => ({ key: key(x?.key ?? x?.label), definition: str(x?.definition) }))
      .filter((x) => x.key || x.definition);
    const ret = j.retention;
    const pairs =
      Array.isArray(ret) ? ret.map((x) => [x?.key ?? x?.label, x?.text ?? x?.value])
      : ret && typeof ret === "object" ? Object.entries(ret)
      : [];
    for (const [k, v] of pairs) if (key(k) && str(v)) mm.retention[`<${key(k)}>`] = str(v);
  }
  const out = {
    title: str(j.title).replace(/^["']|["']$/g, "").slice(0, 120),
    minimax: mm,
  };
  const pics = j.pictures ?? j.images ?? j.references;
  if (Array.isArray(pics)) out.pictures = pics;
  const vt = str(j.video_title ?? j.videoTitle ?? j.group_title);
  if (vt) out.videoTitle = vt.replace(/^["']|["']$/g, "").slice(0, 120);
  return out;
}

// Models often put real line breaks inside JSON strings, which JSON.parse rejects:
// escape them (only inside strings).
function escapeRawNewlines(s) {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r") continue;
      else if (ch === "\t") {
        out += "\\t";
        continue;
      }
    } else if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}

export { GiB, MiB };
