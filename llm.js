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
// One kind of server GENie runs itself: llama.cpp's llama-server, started as a child
// process when a job first needs its model and stopped to unload it.
//
// A server marked "CPU only" is outside all of that: its jobs run in a lane of their
// own, straight away and alongside a generation, and its model stays loaded. That's
// what ✨ Analyze (a subject's reference images → its definition and retention line,
// in the prompt editor) is meant to run on.
//
// A build has two steps. First the model writes only a shot list — the number of shots
// asked for, adding up to the video's length — which waits in the project's builder
// file for the user to edit and to put breaks in. Then, for each run of shots between
// breaks, the model writes the rest of a prompt around them (subjects, summary, style,
// sound, music…): the shots themselves go into the saved prompt exactly as the user
// left them, and are never sent back to be rewritten. Several runs make several prompts,
// saved one after another.
//
// Both steps run as server-side jobs, so they keep going with the browser closed (or
// from the phone). Each prompt is saved to the project's Saved Prompts the moment
// it's written, with the images it was built from as its references.
//
// Settings (sources, API keys, options) live in settings/llm.json — git-ignored,
// and the keys are never sent to the browser.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn as spawnProcess } from "node:child_process";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const SOURCE_KINDS = {
  lmstudio: { label: "LM Studio", port: 1234, managed: true },
  textgen: { label: "text-generation-webui", port: 5000, managed: true },
  ollama: { label: "Ollama", port: 11434, managed: true },
  // No server of its own to connect to: GENie launches llama-server on `port`.
  llamacpp: { label: "llama.cpp server (GENie runs it)", port: 8090, managed: true, launched: true },
  openai: { label: "Other OpenAI-compatible", port: null, managed: false },
};

// The llama-servers GENie has running, across every createLlm(): { child, pid, file }.
// They're stopped when GENie exits, so none is left behind holding RAM. (On Windows a
// child goes down with GENie however it ends — a `node --watch` restart included.
// Elsewhere a GENie killed outright can leave one running, and the next GENie picks
// it up again from its run file; see startLlama.)
const launched = new Set();
function stopLaunched() {
  for (const p of launched) {
    try {
      if (p.child) p.child.kill();
      else process.kill(p.pid);
    } catch {
      /* already gone */
    }
    fs.rmSync(p.file, { force: true });
  }
  launched.clear();
}
let exitHooked = false;
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", stopLaunched);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(sig, () => {
      stopLaunched();
      process.exit();
    });
}

// '--threads 12 --chat-template-file "C:\my files\t.jinja"' → its arguments.
function splitArgs(s) {
  return [...String(s || "").matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
}

export const DEFAULT_INSTRUCTIONS = `You write prompts for AI video generation (image-to-video and reference-to-video models such as Seedance, MiniMax Hailuo and LTX Video).

You are shown the reference images the video will be made from. Refer to each one exactly by its label, like <Picture 1>, and to a named subject by its <key> label when one is given. Look closely at what the images actually show — the people or characters, their build, clothing, hair and expressions, the setting, lighting and colours — and keep that continuity unless the request asks for a change.

Write concrete, filmable action in the present tense: who is on screen, what they do and in what order, how the camera moves and frames them, and the lighting and mood. Pace the action to fit the clip's duration. For a cut to a new shot, start a new paragraph with "At 00:05.000, cut to …" using the time it happens.

Write the prompt as plain prose paragraphs — no markdown, no bullet points, no notes to the reader.

Reply with only a JSON object and nothing else:
{"title": "a short title, at most 8 words", "prompt": "the full prompt text"}`;

// The formats ✨ Build with AI can save as. "default" uses the editable instructions
// above; the MiniMax formats have their own (their JSON reply fills a structured
// prompt's fields, so it can't be edited away).
export const PLAIN_REVISE_INSTRUCTIONS =
  "You revise text for the user. You get a text and the changes they want; apply those changes and keep everything else exactly as it is — wording, line breaks, markup such as <tags>, [brackets] and {wildcards} — unless a change requires otherwise.";
const PLAIN_REVISE_REPLY =
  "Reply with ONLY the complete revised text: no preamble, no explanation, no quotes, no code fences, no markers around it.";
// The guides a quick revise can follow (see guideFor in createLlm).
export const PLAIN_REVISE_GUIDES = new Set(["", "default", "minimax", "minimax_t2v", "kling"]);

export const BUILD_FORMATS = new Set(["default", "minimax", "minimax_t2v"]);

const LOOK_CLOSELY =
  "Look closely at what the images actually show — build, clothing, hair, expression, setting, lighting and colours — and keep that continuity unless the request asks for a change.";
const PLAIN_TEXT = "Plain text in every field — no markdown, no bullet points, no notes to the reader.";
const JSON_ONLY = "Reply with only a JSON object and nothing else:";
const MM_HEAD =
  "You write structured prompts for MiniMax Hailuo H3 reference-to-video. The video model receives the reference images as <Picture 1>, <Picture 2> … and a prompt made of labelled sections, which you fill in as JSON fields.";
const MM_SUBJECTS =
  'Subjects: every person, character, creature, object or place the video keeps from the references is a subject with a <key> label — one short lowercase word (underscores allowed), like <hulk> or <stall>. When an image is given with a subject key, use exactly that key. Otherwise invent one, and start that subject\'s definition with the images it comes from, e.g. "seen in <Picture 1> and <Picture 2>, a tall green woman with long black hair …". In every other field, refer to subjects only by their <key> label, never by picture number or by a name.';
const T2V_HEAD =
  "You write structured prompts for MiniMax Hailuo H3 text-to-video. There are no reference images: the prompt alone describes everything on screen, so describe each person, character and place fully the first time it appears — build, clothing, hair, expression, setting, lighting and colours.";
const FIELD = {
  subjects:
    '- subjects: one entry per subject: {"key": "hulk", "definition": "one or two sentences describing how the subject looks"}.',
  summary:
    '- summary: the task type in square brackets, then one short paragraph on what the video shows and what each reference is for, e.g. "[reference generation] <hulk> strides down a desert road toward the camera …".',
  retention:
    '- retention: for each subject key, how closely the video must match its references: a marker, " - ", then what is kept, e.g. {"hulk": "fully_preserved - face, hair, build and skin colour"}. Markers: fully_preserved, partially_preserved, attribute_transfer, weak_reference.',
  style:
    '- style: one sentence with the visual style, e.g. "The target video uses a live action cinematic style."',
  shots:
    '- shots: the shots in order, each with "seconds": how many seconds it lasts. The seconds of all the shots add up to the clip\'s length. Each "text" is concrete, filmable action in the present tense: who does what and in what order, how the camera moves and frames them, the lighting and mood. Pace the action to fit the clip\'s length; use one shot unless the action needs a cut.',
  soundscape: "- soundscape: the diegetic sound — ambience, footsteps, voices, effects.",
  music: '- music: the non-diegetic music, or "None".',
};
const fieldList = (...names) => ["Fields:", ...names.map((n) => FIELD[n])].join("\n");

// A whole MiniMax prompt, shots included — what ✏️ Revise edits.
export const MINIMAX_INSTRUCTIONS = [
  MM_HEAD,
  MM_SUBJECTS,
  LOOK_CLOSELY,
  fieldList("subjects", "summary", "retention", "style", "shots", "soundscape", "music"),
  PLAIN_TEXT,
  `${JSON_ONLY}\n{"title": "a short title, at most 8 words", "subjects": [{"key": "…", "definition": "…"}], "summary": "…", "retention": {"key": "…"}, "style": "…", "shots": [{"seconds": 5, "text": "…"}], "soundscape": "…", "music": "…"}`,
].join("\n\n");

export const MINIMAX_T2V_INSTRUCTIONS = [
  T2V_HEAD,
  fieldList("style", "shots", "soundscape", "music"),
  PLAIN_TEXT,
  `${JSON_ONLY}\n{"title": "a short title, at most 8 words", "style": "…", "shots": [{"seconds": 5, "text": "…"}], "soundscape": "…", "music": "…"}`,
].join("\n\n");

// Kling 4.0 (through kie.ai) — a guide for ✨ Revise with AI only; the prompt is plain
// text. Distilled from Kuaishou's Kling 4 user guide; see docs/KLING-PROMPTING.md.
export const KLING_INSTRUCTIONS = [
  "You write prompts for Kling 4.0, an AI video model with reference-to-video and keyframe-to-video modes. It generates its own dialogue, sound effects and music.",
  "References are named the way kie.ai's API names them, and every mention must match a file that is sent: reference images @image_1, @image_2 …, reference videos @video_1 …, voices @voice_1 … @voice_3; in keyframe-to-video @first_frame, @keyframe_1 … @keyframe_8 and @last_frame. Never write @Image1, <Picture 1> or any other form in the prompt, and don't invent mentions for files that aren't there. When the user attaches pictures to look at, describe what they show in words instead.",
  "Give every reference a role and say what to keep from it, e.g. \"@image_1 is the hero; keep her face, hair and red jacket exactly\" or \"@video_1 sets the camera movement and the timing of the fight\".",
  "Reference-to-video prompts follow this order, each part only when it changes the result: [Asset roles] one line per reference; [Overall settings] scene and texture, visual style, camera tone; [Sequence of events] timed beats like \"0–3s: …\", \"3–7s: …\", \"7s–end: …\" covering the visuals, action, emotion and camera; [Audio] dialogue, ambience, effects and music. A single clear sentence (who, where, doing what, feeling what) is a valid prompt too.",
  "Keyframe-to-video prompts say what each frame shows, then what happens between them and how the camera gets from one to the next, as timed lines like \"0–3s | @first_frame to @keyframe_1: …\". Keep the same people, clothing, props and positions throughout. First, middle and last frames together are at most the duration in seconds plus one, and at most 10.",
  "To change an existing video rather than borrow from it, the prompt must say \"Edit @video_1\" (\"Reference @video_1\" makes a new video instead) and usually ends with \"Keep everything else unchanged.\"",
  "Be concrete: replace vague words like premium, vintage feel or cinematic with what makes them so (materials, light, colours, lens, framing). Don't pile on adjectives; longer is not better.",
  "Camera and cuts: use plain film language (handheld, tracking, push in by an amount, pull out, tilt, pan, whip pan, orbit, low angle, overhead, wide, medium close-up, close-up, rack focus). For several shots give each its time range and say where the hard cuts fall; for a single take say \"one continuous shot, no cuts\". Keep continuity across cuts.",
  "Dialogue: put each line in double quotes after who says it, in which language and how, e.g. She says in slow, clear Spanish: \"…\". With several speakers, one speaks at a time with no overlap. Describe ambience, effects and music in words.",
  "Prefer positive wording (\"she is shown in profile\") over negatives, which can cause mistakes. The exclusions worth stating are \"No subtitles\" and \"No background music\" when they are not wanted.",
  "Stay within 8,000 characters.",
].join("\n\n");

// Step 1 of a build — the shot list alone.
const SHOT_LIST_HEAD = {
  default:
    "You are shown the reference images the video will be made from. Refer to each one exactly by its label, like <Picture 1>, and to a named subject by its <key> label when one is given.",
  minimax:
    "The video model receives the reference images you are shown as <Picture 1>, <Picture 2> … Every person, character, creature, object or place the video keeps from them is a subject with a <key> label — one short lowercase word (underscores allowed), like <hulk> or <stall>. When an image is given with a subject key, use exactly that key; otherwise invent one and use the same key in every shot. Refer to subjects only by their <key> label, never by picture number or by a name.",
  minimax_t2v:
    "There are no reference images: the text alone describes everything on screen, so describe each person, character and place fully the first time it appears — build, clothing, hair, expression, setting, lighting and colours.",
};
export const shotListInstructions = (format) =>
  [
    "You plan the shot list for an AI-generated video. You write only the shots: no subject definitions, no summary, no style line, no soundscape and no music — those are written later, around the shots you give.",
    SHOT_LIST_HEAD[format] || SHOT_LIST_HEAD.default,
    ...(format === "minimax_t2v" ? [] : [LOOK_CLOSELY]),
    'Each shot is one continuous camera setup, with "seconds": how many whole seconds it lasts (at least 1). Its "text" is concrete, filmable action in the present tense: who does what and in what order, how the camera frames them and moves, the lighting and mood. Write exactly the number of shots asked for, and make their seconds add up to exactly the video\'s length. Pace what should happen across the whole video: the first shot opens it and the last one ends it.',
    "The shots are edited together into one continuous video, so write them as one sequence: each shot carries on from the one before, without setting the scene again.",
    "Plain text — no markdown, no bullet points, no notes to the reader.",
    `${JSON_ONLY}\n{"title": "a short title for the video, at most 8 words", "shots": [{"seconds": 5, "text": "…"}]}`,
  ].join("\n\n");

// Step 2 — everything in a prompt except its shots, which are fixed by then.
const SHOTS_ARE_FINAL =
  "The shots of this prompt are already written and final: they are given in the request and go into the prompt exactly as they are. Do not rewrite them, repeat them or return them — write only the other fields, to fit them.";
export const MINIMAX_AROUND_INSTRUCTIONS = [
  MM_HEAD,
  MM_SUBJECTS,
  LOOK_CLOSELY,
  `${SHOTS_ARE_FINAL} Define a subject for every <key> label the shots use, under exactly that key.`,
  fieldList("subjects", "summary", "retention", "style", "soundscape", "music"),
  PLAIN_TEXT,
  `${JSON_ONLY}\n{"title": "a short title, at most 8 words", "subjects": [{"key": "…", "definition": "…"}], "summary": "…", "retention": {"key": "…"}, "style": "…", "soundscape": "…", "music": "…"}`,
].join("\n\n");

export const MINIMAX_T2V_AROUND_INSTRUCTIONS = [
  "You write structured prompts for MiniMax Hailuo H3 text-to-video. There are no reference images: the prompt alone describes everything on screen.",
  SHOTS_ARE_FINAL,
  fieldList("style", "soundscape", "music"),
  PLAIN_TEXT,
  `${JSON_ONLY}\n{"title": "a short title, at most 8 words", "style": "…", "soundscape": "…", "music": "…"}`,
].join("\n\n");

// Added to the Default format's (editable) instructions, whose own reply format asks
// for the whole prompt.
const DEFAULT_AROUND = [
  `${SHOTS_ARE_FINAL} What you write:`,
  '- intro: one opening paragraph that goes before the first shot — who and what is on screen (by their labels), the setting, the visual style, the lighting and mood. "" when the shots need no setting up.\n- sound: one closing paragraph on the sound — ambience, voices, effects — and the music. "" for none.',
  `Reply with only this JSON object instead of the one above, and nothing else:\n{"title": "a short title, at most 8 words", "intro": "…", "sound": "…"}`,
].join("\n\n");

// ✨ Analyze: one subject's reference image(s) → its definition and retention line.
// (The last line is the reply's JSON shape — see buildRepairMessages.)
const ANALYZE_INSTRUCTIONS = [
  "You look at the reference image(s) of one subject for a MiniMax Hailuo H3 reference-to-video prompt and describe that subject, so the video model knows what to keep from them. When several images are given they all show the same subject — different views, or a sheet of views.",
  [
    "Fields:",
    '- kind: "person", "creature", "object" or "place".',
    '- definition: one noun phrase of 15 to 45 words that finishes the sentence "<key> is …". Start with "a", "an" or "the"; no label and no picture number. Only what is visible and stays the same from shot to shot. For a person or creature: apparent age and gender, build, skin, hair (colour, length, style), notable facial features, clothing and accessories. For a place: the kind of place, its main features and objects, materials, lighting, colours and time of day. For an object: what it is, its shape, material, colour and markings. Leave out the pose, the expression, the camera angle and the image quality.',
    '- retention: how closely the video must match the image(s): a marker, " - ", then what is kept. Markers: fully_preserved, partially_preserved, attribute_transfer, weak_reference. Use fully_preserved unless the author\'s notes say otherwise, and name the elements, e.g. "fully_preserved - all elements including her skin colour, clothing, accessories, hairstyle and hair colour" for a person, or "fully_preserved - all elements, objects, features and lighting" for a place.',
  ].join("\n"),
  "The author's notes and current retention line, when given, are true: keep every fact in them and build on them with what the image shows.",
  PLAIN_TEXT,
  `${JSON_ONLY}\n{"kind": "person", "definition": "…", "retention": "…"}`,
].join("\n\n");

// ✨ Analyze scene: the "Previous scene" frame — where the last clip left off — read for
// its staging and set, so the next clip's Shot 1 starts with everyone in the same place
// in the same room. A reference for planning, not a first frame. parseSceneAnalysis
// turns the reply into the subject's definition, retention line and Shot 1's opener.
const SCENE_INSTRUCTIONS = [
  "You look at one frame from the end of the previous clip of a video. The next clip is generated by MiniMax Hailuo H3 from a reference-to-video prompt, and this frame is given to it as a reference for the staging and the set — so the new clip keeps everyone in the same place in the same room. Video models often swap who stands where and change room details between clips; your description is what prevents that.",
  [
    "Fields:",
    '- definition: one noun phrase of 15 to 40 words that finishes the sentence "<key> is …". Start with "the scene at the end of the previous clip:", then the kind of place and who is in it. No picture number.',
    "- staging: where every person or creature in the frame is, in screen terms — screen-left, centre or screen-right; foreground or background — which way each faces, whether they stand, sit or lie, and what they are next to or touching. Refer to each one by their <key> from the subject list, written with its angle brackets, when their look matches its definition; otherwise by a short description (\"a man in a grey suit\"). Never guess a <key> you are not sure of, and never swap two people. Also say how the frame is shot: framing (wide, medium, close-up) and camera height and angle. Present tense, 1 to 4 sentences.",
    "- set: the room or place itself — 3 to 6 specific, fixed features and props with where they are in the frame (\"a tall window behind <anna>\", \"a red lamp on the side table to the right of the couch\"), the main materials and colours, and the lighting: its direction, colour and the time of day. 1 to 3 sentences.",
    "- shot1: one sentence, present tense, that opens the next clip with the same staging: who is where, by <key>, facing whom. No new action, no camera move — the author writes those after it.",
  ].join("\n"),
  "Only what is visible in the frame. Leave out faces, hair and clothing details (the subjects' own definitions cover them), motion blur and image quality. The author's notes, when given, are true: keep every fact in them.",
  PLAIN_TEXT,
  `${JSON_ONLY}\n{"definition": "…", "staging": "…", "set": "…", "shot1": "…"}`,
].join("\n\n");
const SCENE_RETENTION_LEAD = "partially_preserved - keep the staging and the set:";

const DEFAULT_SETTINGS = {
  activeSourceId: "lmstudio",
  analyzeSourceId: "", // the server ✨ Analyze uses — "" = the active one
  analyzeImageSize: 768, // px on the longest side sent to it (the browser scales them down)
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
const MAX_SHOTS = 60; // in one shot list
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
    spawn = spawnProcess, // (file, args, options) => ChildProcess — the tests' way in
    llamaStartMs = 10 * 60 * 1000, // how long a llama-server may take to load its model
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
    const analyzeSourceId =
      sources.some((x) => x.id === s.analyzeSourceId) ? s.analyzeSourceId : "";
    const size = Number(s.analyzeImageSize);
    const analyzeImageSize =
      Number.isFinite(size) && size > 0 ?
        Math.round(Math.min(2048, Math.max(256, size)))
      : DEFAULT_SETTINGS.analyzeImageSize;
    return { activeSourceId, analyzeSourceId, analyzeImageSize, sources, options };
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
    // A path as typed or pasted — Windows' "Copy as path" wraps it in quotes.
    const file = (v) =>
      String(v || "")
        .trim()
        .replace(/^"(.*)"$/, "$1")
        .slice(0, 500);
    const src = {
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
      cpuOnly: !!x.cpuOnly, // runs in system RAM: no turn-taking with ComfyUI
      // llama.cpp server (GENie runs it): what to launch, and where it listens.
      exePath: file(x.exePath),
      modelPath: file(x.modelPath),
      mmprojPath: file(x.mmprojPath),
      port: Math.round(num(x.port, SOURCE_KINDS.llamacpp.port, 1, 65535)),
      extraArgs: String(x.extraArgs || "")
        .trim()
        .slice(0, 2000),
    };
    if (kind === "llamacpp") {
      // Its address and model follow from the port and the file.
      src.baseUrl = llamaUrl(src);
      src.model = llamaModelId(src);
    }
    return src;
  }

  // What the browser sees: no API keys, just whether one is set.
  function publicSettings(s = readSettings()) {
    return {
      activeSourceId: s.activeSourceId,
      analyzeSourceId: s.analyzeSourceId,
      analyzeImageSize: s.analyzeImageSize,
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
    if (body.analyzeSourceId !== undefined)
      next.analyzeSourceId = String(body.analyzeSourceId || "");
    if (body.analyzeImageSize !== undefined)
      next.analyzeImageSize = Number(body.analyzeImageSize);
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
    // A llama-server whose source was removed (or moved to another port) has no
    // one left to stop it.
    for (const old of cur.sources)
      if (
        old.kind === "llamacpp" &&
        !next.sources.some((x) => x.id === old.id && x.kind === "llamacpp" && Number(x.port) === old.port)
      )
        stopLlama(old).catch(() => {});
    writeSettings(next);
    return readSettings(); // as it reads back: a removed Analyze server falls away
  }

  function getSource(id, s = readSettings()) {
    return s.sources.find((x) => x.id === (id || s.activeSourceId)) || null;
  }

  // ------------------------------------------------------------ HTTP helpers
  // "http://host:1234/v1" and "http://host:1234" both mean the server root.
  const rootUrl = (src) =>
    src.kind === "llamacpp" ?
      llamaUrl(src)
    : src.baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");

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

  // ------------------------------------------ llama.cpp server (GENie runs it)
  // One llama-server per port: { child, pid, sig, token, file, exited, code, error }.
  // `sig` is the command line it was started with — a server started from settings
  // that have since changed is stopped and started again. `child` is null for one
  // picked up from a GENie before this one (see startLlama).
  const llamaProcs = new Map();
  const llamaPort = (src) => Math.round(Number(src.port)) || SOURCE_KINDS.llamacpp.port;
  function llamaUrl(src) {
    return `http://127.0.0.1:${llamaPort(src)}`;
  }
  function llamaModelId(src) {
    return String(src.modelPath || "").split(/[\\/]/).pop();
  }
  // Next to the settings: llamacpp-<port>.json (the server GENie has running there)
  // and llamacpp-<port>.log (its output).
  const llamaFile = (src, ext) =>
    path.join(path.dirname(settingsFile), `llamacpp-${llamaPort(src)}.${ext}`);

  function llamaArgs(src) {
    const args = ["-m", src.modelPath];
    if (src.mmprojPath) args.push("--mmproj", src.mmprojPath);
    if (src.contextLength > 0) args.push("-c", String(src.contextLength));
    args.push("--host", "127.0.0.1", "--port", String(llamaPort(src)));
    if (src.cpuOnly) {
      // No GPU device at all: the model and its projector both stay in system RAM.
      args.push("--device", "none");
      if (src.mmprojPath) args.push("--no-mmproj-offload");
    }
    return [...args, ...splitArgs(src.extraArgs)]; // last, so they win
  }
  // A CUDA build of llama-server takes some 400 MB of VRAM just by starting, with no
  // layers on the GPU at all. Hiding the GPU from the process stops that.
  const llamaEnv = (src) => (src.cpuOnly ? { CUDA_VISIBLE_DEVICES: "-1" } : {});
  const llamaSig = (src) => JSON.stringify([src.exePath, llamaEnv(src), ...llamaArgs(src)]);

  // The settings can be changed from any browser that reaches GENie, so the program
  // has to at least be a llama-server, not whatever path was typed.
  function llamaCheck(src) {
    const isFile = (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    };
    if (!src.exePath) throw new Error(`${src.name}: no llama-server program set`);
    if (!/^llama-server(\.exe)?$/i.test(String(src.exePath).split(/[\\/]/).pop()))
      throw new Error(`${src.name}: the program must be llama-server (llama-server.exe on Windows)`);
    if (!isFile(src.exePath)) throw new Error(`${src.name}: can't find ${src.exePath}`);
    if (!src.modelPath) throw new Error(`${src.name}: no model file set`);
    if (!isFile(src.modelPath)) throw new Error(`${src.name}: can't find the model file ${src.modelPath}`);
    if (src.mmprojPath && !isFile(src.mmprojPath))
      throw new Error(`${src.name}: can't find the vision projector ${src.mmprojPath}`);
  }

  // "ok" (ready), "loading", "other" (not a llama-server) or null (nothing there).
  async function llamaHealth(src) {
    try {
      const r = await fetch(`${llamaUrl(src)}/health`, { signal: AbortSignal.timeout(3000) });
      return r.ok ? "ok" : r.status === 503 ? "loading" : "other";
    } catch {
      return null;
    }
  }

  const pidAlive = (pid) => {
    try {
      process.kill(pid, 0); // throws when there's no such process
      return true;
    } catch {
      return false;
    }
  };
  const llamaGone = (p) => (p.child ? p.exited : !pidAlive(p.pid));

  // The server GENie has on this port: the child it started, or one a GENie before
  // this one started — known by its run file, and by answering to the name it was
  // given then (so a stale file can't point at some other program's process).
  async function llamaOurs(src) {
    const p = llamaProcs.get(llamaPort(src));
    if (p && !llamaGone(p)) return p;
    const file = llamaFile(src, "json");
    try {
      const f = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!pidAlive(f.pid)) return null;
      const r = await fetch(`${llamaUrl(src)}/v1/models`, { signal: AbortSignal.timeout(3000) });
      const d = await r.json();
      if (!(d.data || []).some((m) => m.id === f.token)) return null;
      return { child: null, pid: f.pid, sig: f.sig, token: f.token, file };
    } catch {
      return null;
    }
  }

  function llamaLogTail(src) {
    try {
      const lines = fs.readFileSync(llamaFile(src, "log"), "utf8").trim().split(/\r?\n/);
      return lines.slice(-8).join("\n").slice(-1200);
    } catch {
      return "";
    }
  }

  // Wait for /health to say the model is loaded. `p` is the process to watch (and
  // to stop if this gives up), when it's ours.
  async function llamaReady(src, signal, p) {
    const deadline = Date.now() + llamaStartMs;
    const fail = (what) => {
      const tail = llamaLogTail(src);
      return new Error(`llama-server ${what}${tail ? ` — its last output:\n${tail}` : ""}`);
    };
    for (;;) {
      if (signal?.aborted) {
        if (p) await stopLlama(src);
        throw signal.reason || new Error("aborted");
      }
      if (p?.error) throw new Error(`couldn't start ${src.exePath} (${p.error})`);
      if (p && llamaGone(p)) throw fail(`exited${p.code == null ? "" : ` with code ${p.code}`} before it was ready`);
      const h = await llamaHealth(src);
      if (h === "ok") return;
      if (h === "other")
        throw new Error(`something other than llama-server is answering on port ${llamaPort(src)} — pick another port`);
      if (Date.now() > deadline) {
        if (p) await stopLlama(src);
        throw fail(`wasn't ready after ${Math.round(llamaStartMs / 1000)}s`);
      }
      await sleep(500);
    }
  }

  async function startLlama(src, signal) {
    llamaCheck(src);
    hookExit();
    const port = llamaPort(src);
    const sig = llamaSig(src);
    let p = llamaProcs.get(port);
    if (p && llamaGone(p)) p = null;
    if (!p && (await llamaHealth(src))) {
      // Something is on the port already: a server the last GENie left running (it
      // was killed before it could stop it), or one started by hand.
      await llamaReady(src, signal, null);
      p = await llamaOurs(src);
      if (!p) {
        log.log?.(`LLM: using the server already on port ${port} — GENie didn't start it, so it won't stop it.`);
        return;
      }
      llamaAdopt(src, p);
      if (p.sig === sig) return log.log?.(`LLM: picked up the llama-server on port ${port} (pid ${p.pid}).`);
    }
    if (p && p.sig === sig) return llamaReady(src, signal, p); // ours, and still starting
    if (p) await stopLlama(src); // started with other settings

    const token = `genie-${randomUUID().slice(0, 8)}`;
    const args = llamaArgs(src);
    args.splice(args.length - splitArgs(src.extraArgs).length, 0, "--alias", token);
    // Its output goes to a file: there to read after a failed start, and nothing
    // breaks if the server outlives this GENie.
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const out = fs.openSync(llamaFile(src, "log"), "w");
    p = { child: null, pid: null, sig, token, file: llamaFile(src, "json"), exited: false };
    const proc = p;
    try {
      p.child = spawn(src.exePath, args, {
        stdio: ["ignore", out, out],
        windowsHide: true,
        env: { ...process.env, ...llamaEnv(src) },
      });
    } finally {
      fs.closeSync(out);
    }
    p.pid = p.child.pid;
    p.child.on("error", (err) => {
      proc.error = err.code || err.message;
      proc.exited = true;
      launched.delete(proc);
    });
    p.child.on("exit", (code) => {
      proc.exited = true;
      proc.code = code;
      launched.delete(proc);
      if (llamaProcs.get(port) === proc) {
        llamaProcs.delete(port);
        fs.rmSync(proc.file, { force: true });
      }
    });
    llamaProcs.set(port, p);
    launched.add(p);
    if (p.pid) fs.writeFileSync(p.file, JSON.stringify({ pid: p.pid, port, token, sig }));
    log.log?.(`LLM: started llama-server on port ${port} (pid ${p.pid}) — ${llamaModelId(src)}${src.cpuOnly ? ", CPU only" : ""}.`);
    await llamaReady(src, signal, p);
  }

  // Stop the server GENie has on this source's port. False when there's none of ours.
  async function stopLlama(src) {
    const p = await llamaOurs(src);
    if (!p) return false;
    try {
      if (p.child) p.child.kill();
      else process.kill(p.pid);
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 100 && !llamaGone(p); i++) await sleep(100);
    launched.delete(p);
    if (llamaProcs.get(llamaPort(src)) === p) llamaProcs.delete(llamaPort(src));
    fs.rmSync(p.file, { force: true });
    return true;
  }

  function llamaAdopt(src, p) {
    llamaProcs.set(llamaPort(src), p);
    launched.add(p);
    hookExit();
  }
  // A server the last GENie left running (see startLlama): take it over now, so
  // it's stopped with this one even if no job uses it again.
  for (const src of readSettings().sources)
    if (src.kind === "llamacpp")
      llamaOurs(src)
        .then((p) => {
          if (!p || llamaProcs.has(llamaPort(src))) return;
          llamaAdopt(src, p);
          log.log?.(`LLM: picked up the llama-server on port ${llamaPort(src)} (pid ${p.pid}).`);
        })
        .catch(() => {});

  // ------------------------------------------------ per-server model management
  // listModels → [{ id, name, vision (true/false/null), sizeBytes, loaded, instances }]
  async function listModels(src) {
    if (src.kind === "llamacpp") {
      // The one model it's set to serve — loaded when its server is up and was
      // started with these settings.
      llamaCheck(src);
      const id = llamaModelId(src);
      let loaded = (await llamaHealth(src)) === "ok";
      if (loaded) {
        const p = await llamaOurs(src);
        if (p && p.sig !== llamaSig(src)) loaded = false;
      }
      const size = (p) => (p ? fs.statSync(p).size : 0);
      return [
        {
          id,
          name: id,
          vision: !!src.mmprojPath,
          sizeBytes: size(src.modelPath) + size(src.mmprojPath),
          loaded,
          instances: loaded ? [id] : [],
        },
      ];
    }
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
    if (src.kind === "llamacpp") return startLlama(src, signal);
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
      const args = { ...extra };
      if (!Object.keys(extra).length && src.contextLength > 0)
        args.ctx_size = src.contextLength;
      if (src.cpuOnly && args.gpu_layers === undefined) args.gpu_layers = 0;
      if (Object.keys(args).length) body.args = args;
      await call(src, "POST", "/v1/internal/model/load", body, {
        timeoutMs: 10 * 60 * 1000,
        signal,
      });
    } else if (src.kind === "ollama") {
      const body = { model, keep_alive: "60m" };
      const opts = { ...extra };
      if (src.contextLength > 0 && opts.num_ctx === undefined)
        opts.num_ctx = src.contextLength;
      if (src.cpuOnly && opts.num_gpu === undefined) opts.num_gpu = 0;
      if (Object.keys(opts).length) body.options = opts;
      await call(src, "POST", "/api/generate", body, {
        timeoutMs: 10 * 60 * 1000,
        signal,
      });
    }
    // openai: nothing to do — the server serves what it serves.
  }

  async function unloadModel(src, model) {
    if (src.kind === "llamacpp") {
      await stopLlama(src);
      return true;
    }
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
  // Jobs on a "CPU only" server run in a lane of their own, one at a time: they never
  // wait for ComfyUI and a generation never interrupts them.
  const cpu = {
    queue: [],
    runner: null, // { job }
    request: null, // AbortController of its chat request
    loading: null, // AbortController of its model load
  };
  // text-generation-webui holds one model at a time, so two servers at the same
  // address (the usual setup: a GPU model for builds, a CPU one for ✨ Analyze) can't
  // both be in use — whichever lane got there first finishes its step.
  const sharesOneModel = (a, b) =>
    !!a && !!b && a.kind === "textgen" && b.kind === "textgen" && rootUrl(a) === rootUrl(b);

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
      if (!j.cpu && (j.status === "generating" || j.status === "loading"))
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
    const { images, current, groups, clipsDone, scaled, ...rest } = j;
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
  // `draft` is the form as last left, `recent` the inputs of the last builds started,
  // and `shotList` the shot list being worked on — as the model wrote it, then with
  // the user's edits and breaks.
  // A project with no rules of its own starts from the rules used most recently
  // anywhere (options.lastRules), since rules tend to carry across projects.
  function readBuilderFile(proj) {
    if (!builderFile) return {};
    try {
      return JSON.parse(fs.readFileSync(builderFile(proj), "utf8")) || {};
    } catch {
      return {}; // none yet
    }
  }

  function readBuilder(proj) {
    const d = readBuilderFile(proj);
    const draft = d.draft ? cleanForm(d.draft) : null;
    return {
      draft,
      recent: Array.isArray(d.recent) ? d.recent.map(cleanForm).slice(0, MAX_RECENT) : [],
      shotList: cleanShotList(d.shotList),
      lastRules: readSettings().options.lastRules || "",
    };
  }

  // Replaces only the parts given.
  function writeBuilder(proj, parts) {
    if (!builderFile) return;
    const file = builderFile(proj);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...readBuilderFile(proj), ...parts }, null, 2));
  }

  // A shot list as stored: { title, shots: [{ len, text, brk }], jobId, at }. `brk`
  // marks a break after the shot — the next one starts a new prompt. null for none.
  function cleanShotList(l) {
    if (!l || typeof l !== "object" || !Array.isArray(l.shots) || !l.shots.length) return null;
    const shots = l.shots.slice(0, MAX_SHOTS).map((s) => {
      const n = Number(s?.len);
      return {
        len: s?.len === null || s?.len === "" || !Number.isFinite(n) || n <= 0 ? null : n,
        text: String(s?.text ?? "").slice(0, 20000),
        brk: !!s?.brk,
      };
    });
    shots[shots.length - 1].brk = false;
    return {
      title: String(l.title ?? "").slice(0, 120),
      shots,
      jobId: typeof l.jobId === "string" ? l.jobId.slice(0, 60) : undefined,
      at: typeof l.at === "string" ? l.at.slice(0, 40) : undefined,
    };
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
      // (`count` — how many variations — is what earlier versions kept here.)
      shotCount: Math.max(1, Math.min(MAX_SHOTS, Math.round(Number(f.shotCount ?? f.count) || 1))),
      duration: num(f.duration),
      titlePrefix: str(f.titlePrefix, 100),
      imageIds: (Array.isArray(f.imageIds) ? f.imageIds : []).map(String).slice(0, MAX_IMAGES),
      at: typeof f.at === "string" ? f.at.slice(0, 40) : undefined,
    };
  }

  // A PUT from the browser: the form (`draft`), the shot list (`shotList`, null to
  // clear it), or both — whichever is sent.
  function saveBuilder(projectId, { draft, shotList } = {}) {
    const proj = findProject(projectId);
    if (!proj) throw new Error("unknown projectId");
    const parts = {};
    if (draft && typeof draft === "object") {
      parts.draft = cleanForm(draft);
      delete parts.draft.at;
    }
    if (shotList !== undefined) parts.shotList = cleanShotList(shotList);
    writeBuilder(proj, parts);
    if (parts.draft) rememberRules(parts.draft.rules);
    return parts;
  }

  function rememberRules(rules) {
    if (!rules.trim()) return;
    const s = readSettings();
    if (s.options.lastRules === rules) return;
    s.options = { ...s.options, lastRules: rules };
    writeSettings(s);
  }

  // A shot list was asked for: its inputs become the draft and go on top of `recent`
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

  // What both steps of a build start from: the server and model, the project, the
  // images and the request. `needRequest`: there must be something to write from.
  function buildInputs(body, needRequest) {
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
      if (needRequest && !description)
        throw new Error("MiniMax T2V needs a description (it takes no images).");
    }
    if (needRequest && !description && !images.length)
      throw new Error("Add a description, an image, or both.");
    return { src, model, proj, images, description, format };
  }

  function newJob({ src, model, proj, images, description, format }, body, fields) {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      projectId: proj.id,
      sourceId: src.id,
      sourceName: src.name,
      model,
      format,
      imageIds: images.map((g) => g.id),
      images, // gallery entries (stripped from the public view)
      description,
      theme: String(body.theme || "").trim().slice(0, 2000),
      rules: String(body.rules || "").trim().slice(0, MAX_RULES),
      titlePrefix: String(body.titlePrefix || "").trim().slice(0, 100),
      count: 1,
      done: 0,
      created: [], // [{ id, title }]
      status: "queued",
      message: "Queued",
      error: null,
      cancelled: false,
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
  }

  function enqueue(job) {
    jobs.set(job.id, job);
    job.cpu = !!getSource(job.sourceId)?.cpuOnly;
    (job.cpu ? cpu.queue : queue).push(job);
    pruneJobs();
    if (job.cpu) pumpCpu();
    else pump();
    return publicJob(job);
  }

  // Step 1: a shot list — `shotCount` shots adding up to `duration` seconds. Nothing
  // goes to Saved Prompts: the list is put in the project's builder file (replacing
  // the one there) for the user to edit and break up.
  function startShots(body = {}) {
    const inp = buildInputs(body, true);
    const shotCount = Math.max(1, Math.min(MAX_SHOTS, Math.round(Number(body.shotCount) || 1)));
    const d = Number(body.duration);
    const job = newJob(inp, body, {
      kind: "shots",
      shotCount,
      duration: Number.isFinite(d) && d > 0 ? d : null,
      result: null,
    });
    rememberBuild(inp.proj, { ...body, shotCount }, job);
    return enqueue(job);
  }

  // Step 2: the prompts around a finished shot list. `body.shots` is the list as the
  // user left it — [{ len, text, brk }], `brk` marking a break after a shot. Each run
  // of shots between breaks becomes one saved prompt holding exactly those shots; two
  // or more runs are saved one after another, titled `body.title — 1/N`…
  function startBuild(body = {}) {
    const inp = buildInputs(body, false);
    const list = cleanShotList({ shots: body.shots, title: body.title });
    if (!list) throw new Error("There's no shot list yet — build one first.");
    list.shots.forEach((s, i) => {
      if (!s.text.trim()) throw new Error(`Shot ${i + 1} is empty — write it or remove it.`);
      if (s.len == null) throw new Error(`Shot ${i + 1} needs a length.`);
    });
    const groups = [[]];
    for (const s of list.shots) {
      groups[groups.length - 1].push({ len: s.len, text: s.text });
      if (s.brk) groups.push([]);
    }
    const total = (g) => Math.round(g.reduce((a, s) => a + s.len, 0) * 1000) / 1000;
    const job = newJob(inp, body, {
      groups, // each prompt's shots, fixed (stripped from the public view)
      clips: groups.map(total), // each prompt's seconds
      videoTitle: list.title.trim(),
      clipsDone: [], // the prompts written so far, for the next one's context
      duration: total(list.shots),
      count: groups.length,
    });
    return enqueue(job);
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
    // `plain`: the main prompt box's quick revise — the text goes in as it is and
    // comes back as text, no JSON, no references; `body.images` (gallery ids) are
    // pictures for the model to look at while it makes the changes.
    const plain = !!body.plain;
    const guide = plain && PLAIN_REVISE_GUIDES.has(body.guide) ? body.guide : "";
    const format = !plain && BUILD_FORMATS.has(body.format) ? body.format : "default";
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
    for (const r of (plain ? [] : Array.isArray(body.refs) ? body.refs : []).slice(0, 50)) {
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
    if (plain)
      for (const id of (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES)) {
        const g = gallery.find((x) => x.id === String(id));
        const isImage = (g?.kind || (String(g?.mime || "").startsWith("image/") ? "image" : "")) === "image";
        if (g && isImage && !images.includes(g)) images.push(g);
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
      plain,
      guide,
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
    return enqueue(job);
  }

  // ✨ Analyze: look at each subject's reference image(s) and write its definition and
  // retention line. `body.subjects` is [{ key, note, retention, images: [{ id, url }] }]
  // as the editor has them — `note`/`retention` what's typed there now, `url` an
  // optional scaled-down copy of the image (a data: URL; the gallery file otherwise).
  // One request per subject. Nothing is saved: the results build up on the job
  // (result.subjects[key] = { kind, definition, retention }) for the editor to fill in.
  function startAnalyze(body = {}) {
    const settings = readSettings();
    const src = getSource(body.sourceId || settings.analyzeSourceId, settings);
    if (!src) throw new Error("No LLM source is set up — open ⚙ LLM settings.");
    const model = String(body.model || src.model || "").trim();
    if (!model && src.kind !== "openai")
      throw new Error(`Pick a model for ${src.name} in ⚙ LLM settings.`);
    const proj = findProject(body.projectId);
    if (!proj) throw new Error("unknown projectId");

    const gallery = readJson(imagesFile);
    const images = [];
    const scaled = {};
    const subjects = [];
    for (const s of (Array.isArray(body.subjects) ? body.subjects : []).slice(0, 20)) {
      const key = analyzeKey(s?.key);
      if (!key || subjects.some((x) => x.key === key)) continue;
      const imageIds = [];
      for (const im of (Array.isArray(s.images) ? s.images : []).slice(0, 4)) {
        const g = gallery.find((x) => x.id === String(im?.id));
        if (!g || !(g.kind === "image" || String(g.mime || "").startsWith("image/"))) continue;
        if (!images.includes(g)) {
          if (images.length >= MAX_IMAGES) break;
          images.push(g);
          const url = String(im.url || "");
          if (url.length < 8 * MiB && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url))
            scaled[g.id] = url;
        }
        imageIds.push(g.id);
      }
      if (!imageIds.length) continue;
      const sub = {
        key,
        imageIds,
        note: String(s.note || "").trim().slice(0, 2000),
        retention: String(s.retention || "").trim().slice(0, 1000),
      };
      // The "Previous scene" frame: read for staging and set (SCENE_INSTRUCTIONS), with
      // the prompt's other subjects so it can name who is where.
      if (s.scene) {
        sub.scene = true;
        sub.others = (Array.isArray(s.others) ? s.others : [])
          .slice(0, 20)
          .map((o) => ({ key: analyzeKey(o?.key), definition: String(o?.definition || "").trim().slice(0, 600) }))
          .filter((o) => o.key && o.key !== key);
      }
      subjects.push(sub);
    }
    if (!subjects.length)
      throw new Error("Nothing to analyse — give an image a @key in reference media first.");
    const now = new Date().toISOString();
    return enqueue({
      id: randomUUID(),
      kind: "analyze",
      projectId: proj.id,
      promptId: String(body.promptId || "").slice(0, 100) || null,
      sourceId: src.id,
      sourceName: src.name,
      model,
      format: "minimax",
      subjects,
      imageIds: images.map((g) => g.id),
      images,
      scaled, // image id → data: URL (stripped from the public view)
      description: subjects.map((s) => `<${s.key}>`).join(", "), // what the job list shows
      theme: "",
      rules: "",
      titlePrefix: "",
      count: subjects.length,
      done: 0,
      created: [],
      result: { subjects: {} },
      status: "queued",
      message: "Queued",
      error: null,
      cancelled: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  function cancelJob(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (["done", "failed", "cancelled"].includes(job.status)) return publicJob(job);
    job.cancelled = true;
    for (const q of [queue, cpu.queue]) {
      const i = q.indexOf(job);
      if (i >= 0) q.splice(i, 1);
    }
    const e = new Error("Cancelled");
    e.cancelled = true;
    if (runner?.job === job) {
      state.request?.abort(e);
      state.loading?.controller.abort(e);
    }
    if (cpu.runner?.job === job) {
      cpu.request?.abort(e);
      cpu.loading?.abort(e);
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

  const jobFailed = (job) => (err) => {
    if (job.cancelled) return;
    job.error = err.message || String(err);
    setJob(job, "failed", job.error);
    log.error?.("LLM build failed:", job.error);
  };

  // The CPU lane. Its model stays loaded when the queue empties: it's in system RAM,
  // out of ComfyUI's way, and the next ✨ Analyze starts at once.
  function pumpCpu() {
    if (cpu.runner || !cpu.queue.length) return;
    const job = cpu.queue.shift();
    cpu.runner = { job };
    runJob(job)
      .catch(jobFailed(job))
      .finally(() => {
        cpu.runner = null;
        pumpCpu();
      });
  }

  function pump() {
    if (runner || !queue.length) return;
    const job = queue.shift();
    runner = { job };
    runJob(job)
      .catch(jobFailed(job))
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

      // The CPU lane is using this same one-model server: let it finish.
      const cpuJob = cpu.runner?.job;
      if (cpuJob && sharesOneModel(src, getSource(cpuJob.sourceId))) {
        setJob(job, "waiting", `Waiting for ${cpuJob.kind === "analyze" ? "the image analysis" : "a CPU job"} on ${src.name} to finish…`);
        await sleep(2000);
        continue;
      }

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

  // The CPU lane's version: no ComfyUI, no VRAM — just the model loaded.
  async function acquireCpu(job, src) {
    for (;;) {
      checkCancel(job);
      // A build has its model in this same one-model server right now: wait for it
      // (a build paused by a generation has let go, so this doesn't wait on ComfyUI).
      const held = state.loading || (runner && state.inUse);
      if (held && held.model !== job.model && sharesOneModel(src, getSource(held.sourceId))) {
        setJob(job, "waiting", `${src.name} is busy with a build (it holds one model at a time)…`);
        await sleep(2000);
        continue;
      }
      break;
    }
    if (!SOURCE_KINDS[src.kind].managed) return;
    const info = await modelInfo(src, job.model);
    if (!info)
      throw new Error(`${src.name} has no model "${job.model}". Pick another in ⚙ LLM settings.`);
    if (info.loaded) return;
    // Loading here replaces whatever a build left loaded in the same server.
    if (state.inUse && sharesOneModel(src, getSource(state.inUse.sourceId))) state.inUse = null;
    const controller = new AbortController();
    cpu.loading = controller;
    setJob(job, "loading", `Loading ${job.model} in ${src.name} (CPU)…`);
    const t0 = Date.now();
    try {
      await loadModel(src, job.model, controller.signal);
    } catch (err) {
      if (job.cancelled) checkCancel(job);
      throw new Error(`Couldn't load ${job.model}: ${err.message}`);
    } finally {
      cpu.loading = null;
    }
    log.log?.(`LLM: loaded ${job.model} on the CPU in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  }

  async function runJob(job) {
    const src = getSource(job.sourceId);
    if (!src) throw new Error("That LLM source was removed from settings.");
    const lane = job.cpu ? cpu : state; // whose `request` this job's chat call is
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
        url: job.scaled?.[g.id] || `data:${g.mime || "image/png"};base64,${buf.toString("base64")}`,
      };
    });

    // While a request is in flight, watch ComfyUI's queue too (the websocket may
    // not be connected) so a run started elsewhere still takes the GPU back.
    if (!job.cpu) ensureComfyWs();
    const watch =
      job.cpu ? null : (
        setInterval(async () => {
          if (state.request && (await comfyQueueBusy()))
            yieldForGeneration("ComfyUI started a run").catch(() => {});
        }, 3000)
      );

    let failures = 0;
    try {
      while (job.done < job.count) {
        checkCancel(job);
        if (job.cpu) await acquireCpu(job, src);
        else await acquire(job, src);
        checkCancel(job);
        const n = job.done + 1;
        const subject = job.kind === "analyze" ? job.subjects[job.done] : null;
        const parts =
          subject ? imageParts.filter((p) => subject.imageIds.includes(p.g.id)) : imageParts;
        const doing =
          job.kind === "revise" ? "Revising"
          : subject ?
            `Looking at <${subject.key}>${job.count > 1 ? ` (${n} of ${job.count})` : ""}`
          : job.kind === "shots" ?
            `Writing a list of ${job.shotCount} shot${job.shotCount === 1 ? "" : "s"}`
          : job.count > 1 ? `Writing prompt ${n} of ${job.count} around its shots`
          : "Writing the prompt around its shots";
        setJob(job, "generating", `${doing}…`);
        const controller = new AbortController();
        lane.request = controller;
        let result;
        try {
          result = await writePrompt(job, src, parts, controller.signal, (chars, fix) =>
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
          log.error?.(`LLM: ${job.kind === "shots" ? "shot list" : subject ? `<${subject.key}>` : `prompt ${n}`} failed:`, err.message);
          if (failures >= 3) throw err;
          setJob(job, undefined, `That failed (${err.message}) — retrying…`);
          await sleep(2000);
          continue;
        } finally {
          lane.request = null;
        }
        failures = 0;
        if (subject) {
          // The editor fills this subject in while the next one is looked at.
          job.result = { subjects: { ...job.result.subjects, [subject.key]: result } };
          job.done++;
          continue;
        }
        if (job.kind === "revise") {
          job.result = result; // the editor shows it; nothing is saved here
          job.done = 1;
          break;
        }
        if (job.kind === "shots") {
          // The wrong number of shots is asked for once more, then taken as it is —
          // the user can add or remove shots.
          if (result.shots.length !== job.shotCount && !job.recounted) {
            job.recounted = true;
            log.warn?.(`LLM: wrote ${result.shots.length} shots, not ${job.shotCount} — asking again.`);
            continue;
          }
          saveShotList(job, result);
          job.result = result;
          job.done = 1;
          break;
        }
        const saved = savePrompt(job, result, n);
        job.created.push({ id: saved.id, title: saved.title });
        job.clipsDone.push(result);
        job.done++;
      }
      if (job.kind === "revise") {
        setJob(
          job,
          "done",
          job.plain ? "Revision ready — review it under the prompt."
          : "Revision ready — review it in the prompt editor.",
        );
        return;
      }
      if (job.kind === "analyze") {
        setJob(job, "done", `Described ${job.count} subject${job.count === 1 ? "" : "s"}.`);
        return;
      }
      if (job.kind === "shots") {
        const got = job.result.shots.length;
        setJob(
          job,
          "done",
          `Shot list ready: ${got} shot${got === 1 ? "" : "s"}` +
            (got !== job.shotCount ? ` (${job.shotCount} were asked for)` : "") +
            ". Edit it, add breaks, then ✨ Write prompts.",
        );
        return;
      }
      setJob(
        job,
        "done",
        job.count > 1 ?
          `Saved ${job.count} prompts to Saved Prompts.`
        : "Saved the prompt to Saved Prompts.",
      );
    } finally {
      if (watch) clearInterval(watch);
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

  // The quick revise: the prompt box's text and what to change, the text back.
  // A guide is one of the build instructions without its JSON reply format (always
  // their last paragraph): what makes a good prompt, not how to answer.
  function guideFor(name) {
    const whole =
      name === "minimax" ? MINIMAX_INSTRUCTIONS
      : name === "minimax_t2v" ? MINIMAX_T2V_INSTRUCTIONS
      : name === "kling" ? KLING_INSTRUCTIONS
      : name === "default" ? readSettings().options.instructions || DEFAULT_INSTRUCTIONS
      : "";
    const cut = whole.indexOf("Reply with only");
    return (cut >= 0 ? whole.slice(0, cut) : whole).trim();
  }

  function buildPlainReviseMessages(job, imageParts) {
    const guide = guideFor(job.guide);
    const system = [
      PLAIN_REVISE_INSTRUCTIONS,
      imageParts.length &&
        "REFERENCE IMAGES — the user attached pictures (<Picture 1>, <Picture 2> …). Look at them closely and use what you see where the changes call for it: describe people, outfits, places, objects, colours, lighting and style as they appear in the pictures, in concrete words. Don't mention the pictures themselves in the text unless the user asks you to.",
      guide &&
        "PROMPTING GUIDE — the text is a prompt for an AI video model; follow this guide where it bears on the changes. " +
          "Where it describes the prompt as JSON fields, those are the text's labelled sections: keep the text's own layout and write plain text, not JSON.\n\n" +
          guide,
      job.rules && "RULES — the user's own rules. Follow every one of them:\n" + job.rules,
      PLAIN_REVISE_REPLY,
    ].filter(Boolean);
    const text =
      `The text:\n<<<\n${job.current}\n>>>\n\n` +
      (imageParts.length ?
        `Reference images: ${imageParts.map((_, i) => `<Picture ${i + 1}>`).join(", ")}, below.\n\n`
      : "") +
      `Changes to make: ${job.instruction}\n\n` +
      "Reply with only the complete revised text.";
    const content = [{ type: "text", text }];
    imageParts.forEach(({ url }, i) => {
      content.push({ type: "text", text: `<Picture ${i + 1}>:` });
      content.push({ type: "image_url", image_url: { url } });
    });
    return [
      { role: "system", content: system.join("\n\n") },
      { role: "user", content: imageParts.length ? content : text },
    ];
  }

  function buildReviseMessages(job, imageParts) {
    if (job.plain) return buildPlainReviseMessages(job, imageParts);
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

  // The system prompt a job runs under. Its last line is the JSON shape of the reply.
  function instructionsFor(job, opts = readSettings().options) {
    const whole = opts.instructions || DEFAULT_INSTRUCTIONS;
    if (job.kind === "analyze")
      return job.subjects[job.done]?.scene ? SCENE_INSTRUCTIONS : ANALYZE_INSTRUCTIONS;
    if (job.kind === "shots") return shotListInstructions(job.format);
    if (job.kind === "revise")
      return (
        job.format === "minimax" ? MINIMAX_INSTRUCTIONS
        : job.format === "minimax_t2v" ? MINIMAX_T2V_INSTRUCTIONS
        : whole
      );
    return (
      job.format === "minimax" ? MINIMAX_AROUND_INSTRUCTIONS
      : job.format === "minimax_t2v" ? MINIMAX_T2V_AROUND_INSTRUCTIONS
      : `${whole}\n\n${DEFAULT_AROUND}`
    );
  }

  // The request's opening lines: the reference images, then what was asked for.
  function requestLines(job, imageParts) {
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
    return lines;
  }

  function chatMessages(job, lines, imageParts) {
    const content = [{ type: "text", text: lines.join("\n") }];
    imageParts.forEach(({ url }, i) => {
      content.push({ type: "text", text: `<Picture ${i + 1}>:` });
      content.push({ type: "image_url", image_url: { url } });
    });
    return [
      {
        role: "system",
        content:
          instructionsFor(job) +
          (job.rules ?
            "\n\nRULES — the user's own rules for this prompt. Follow every one of them; " +
            "where one conflicts with the guidance above, the rule wins (but still reply in the JSON format asked for):\n" +
            job.rules
          : ""),
      },
      { role: "user", content: imageParts.length ? content : lines.join("\n") },
    ];
  }

  const secs = (n) => `${+Number(n).toFixed(3)}s`;
  const shotLines = (shots) =>
    shots.map((s, i) => `  Shot ${i + 1} (${secs(s.len)}): ${s.text.trim().replace(/\s*\n\s*/g, " ")}`);

  // ✨ Analyze: the subject being looked at (job.subjects[job.done]) and its image(s).
  function buildAnalyzeMessages(job, imageParts) {
    const s = job.subjects[job.done];
    if (s.scene) return buildSceneMessages(s, imageParts);
    const lines = [
      `The subject's key is <${s.key}>. ${imageParts.length > 1 ? `Its ${imageParts.length} reference images follow` : "Its reference image follows"}.`,
    ];
    if (s.note) lines.push(`The author's notes on <${s.key}>: ${s.note}`);
    if (s.retention) lines.push(`The author's current retention line: ${s.retention}`);
    lines.push("Reply with only the JSON object with the fields kind, definition and retention.");
    const content = [{ type: "text", text: lines.join("\n") }];
    for (const { url } of imageParts) content.push({ type: "image_url", image_url: { url } });
    return [
      { role: "system", content: ANALYZE_INSTRUCTIONS },
      { role: "user", content },
    ];
  }

  // ✨ Analyze scene: the previous-scene frame, with the subjects it may show.
  function buildSceneMessages(s, imageParts) {
    const lines = [`The frame's key is <${s.key}>. It follows below.`];
    if (s.others.length) {
      lines.push("", "The prompt's subjects — the people and things that may be in the frame:");
      for (const o of s.others) lines.push(`- <${o.key}>${o.definition ? `: ${o.definition}` : ""}`);
    } else lines.push("", "The prompt defines no other subjects: describe the people by how they look.");
    if (s.note) lines.push("", `The author's notes on the scene: ${s.note}`);
    if (s.retention) lines.push(`What the author has written about the staging so far: ${s.retention}`);
    lines.push("", "Reply with only the JSON object with the fields definition, staging, set and shot1.");
    const content = [{ type: "text", text: lines.join("\n") }];
    for (const { url } of imageParts) content.push({ type: "image_url", image_url: { url } });
    return [
      { role: "system", content: SCENE_INSTRUCTIONS },
      { role: "user", content },
    ];
  }

  function buildMessages(job, imageParts) {
    if (job.kind === "analyze") return buildAnalyzeMessages(job, imageParts);
    if (job.kind === "revise") return buildReviseMessages(job, imageParts);
    const lines = requestLines(job, imageParts);
    lines.push("");
    if (job.kind === "shots") {
      const n = `${job.shotCount} shot${job.shotCount === 1 ? "" : "s"}`;
      lines.push(
        job.duration ?
          `Write exactly ${n} for a video ${secs(job.duration)} long: their seconds add up to ${+job.duration}.`
        : `Write exactly ${n}, each as long as its action needs.`,
        "",
        "Reply with only the JSON object with the fields title and shots.",
      );
      return chatMessages(job, lines, imageParts);
    }

    // One prompt: everything around its shots.
    const groups = job.groups;
    const k = job.done;
    const many = groups.length > 1;
    const structured = job.format !== "default";
    if (many) {
      lines.push(
        `The video is ${secs(job.duration)} long, made as ${groups.length} clips that are generated separately and edited together in order. Its shots are already written and final:`,
      );
      groups.forEach((g, i) => {
        lines.push(`Clip ${i + 1} (${secs(job.clips[i])})${i === k ? " — the clip to write now" : ""}:`, ...shotLines(g));
      });
      lines.push(
        "",
        `Write the prompt for clip ${k + 1}: every field except its shots. The clip is generated on its own and never sees the others, so write for what is in clip ${k + 1}'s shots only` +
          (job.format === "minimax" ? " and define every subject they use" : "") +
          `. Keep ${structured ? "the subjects (same keys, same definitions), " : ""}the setting and the style the same from clip to clip.`,
      );
      if (job.format === "minimax" && imageParts.length > 1)
        lines.push(
          `Also give "pictures": the numbers of the reference images this clip needs, e.g. [1, 3] — only those are sent with it. Refer to images by those same numbers.`,
        );
      if (job.clipsDone.length) {
        lines.push("", "Already written for the earlier clips — stay consistent with it:");
        if (structured) {
          const first = job.clipsDone[0].minimax;
          if (first.style) lines.push(`Style: ${first.style}`);
          const subjects = new Map();
          for (const c of job.clipsDone)
            for (const x of c.minimax.subjects || [])
              if (x.key && !subjects.has(x.key)) subjects.set(x.key, x.definition);
          for (const [key, definition] of subjects) lines.push(`Subject <${key}>: ${definition}`);
          const music = job.clipsDone[job.clipsDone.length - 1].minimax.music;
          if (music) lines.push(`Music: ${music}`);
        } else
          job.clipsDone.forEach((c, i) => {
            if (c.intro) lines.push(`Clip ${i + 1} intro: ${c.intro}`);
            if (c.sound) lines.push(`Clip ${i + 1} sound: ${c.sound}`);
          });
      }
    } else
      lines.push(
        `The clip is ${secs(job.duration)} long. Its shots are already written and final:`,
        ...shotLines(groups[0]),
        "",
        "Write the prompt around them: every field except the shots.",
      );
    lines.push(
      "",
      job.format === "minimax" ?
        `Reply with only the JSON object with the fields title, subjects, summary, retention, style, soundscape and music${many && imageParts.length > 1 ? ", and pictures" : ""}.`
      : job.format === "minimax_t2v" ?
        "Reply with only the JSON object with the fields title, style, soundscape and music."
      : 'Reply with only the JSON object: {"title": "…", "intro": "…", "sound": "…"}',
    );
    return chatMessages(job, lines, imageParts);
  }

  // One reply from the LLM, streamed (a long non-streamed reply would trip Node's
  // 5-minute header timeout) and read into what the job needs: a shot list, a
  // revision, or a prompt — whose shots are the job's own, not the model's.
  async function writePrompt(job, src, imageParts, signal, onProgress) {
    const opts = readSettings().options;
    const text = await complete(
      job,
      src,
      buildMessages(job, imageParts),
      job.kind === "analyze" ? 0.3 : opts.temperature, // a description, not invention
      imageParts.length > 0,
      signal,
      onProgress,
    );
    // A revised Default prompt is read leniently: a reply that isn't JSON is the prompt.
    if (job.kind === "revise" && job.plain) return parsePlainReply(text);
    if (job.kind === "revise" && job.format === "default") return parseReply(text);
    const shots = job.kind ? null : job.groups[job.done];
    const parse =
      job.kind === "analyze" ?
        job.subjects[job.done].scene ?
          (t) => parseSceneAnalysis(t, job.subjects[job.done].key, job.subjects[job.done].others.map((o) => o.key))
        : (t) => parseAnalysis(t, job.subjects[job.done].key)
      : job.kind === "shots" ? (t) => parseShotList(t, job.duration)
      : job.kind === "revise" ? (t) => parseStructuredReply(t, job.format)
      : job.format === "default" ? (t) => parseAroundReply(t, shots)
      : (t) => parseStructuredReply(t, job.format, shots);
    // A reply that isn't its JSON goes back to the model to be fixed — a text-only
    // request, so the images aren't processed again. After REPAIR_ATTEMPTS the reply
    // is thrown away: the error makes runJob ask afresh.
    let reply = text;
    for (let fix = 1; ; fix++) {
      try {
        return parse(reply);
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

  // Ask the model to turn its own malformed reply into the JSON the job needs.
  function buildRepairMessages(job, text, problem) {
    const shape = instructionsFor(job).split("\n").pop();
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

  // The model's shot list → the project's builder file, where the user works on it.
  function saveShotList(job, result) {
    const proj = findProject(job.projectId);
    if (!proj) throw new Error("The project was deleted.");
    writeBuilder(proj, {
      shotList: cleanShotList({
        title: result.title,
        shots: result.shots,
        jobId: job.id,
        at: new Date().toISOString(),
      }),
    });
  }

  // Prompt `n` (1-based) of a build: the model's fields around the job's own shots.
  function savePrompt(job, result, n) {
    const proj = findProject(job.projectId);
    if (!proj) throw new Error("The project was deleted.");
    const prefixed = (t) => (job.titlePrefix ? `${job.titlePrefix} — ${t}` : t);
    const structured = job.format !== "default";
    let images = job.format === "minimax_t2v" ? [] : job.images;
    let minimax = result.minimax;
    let title = prefixed(job.videoTitle || result.title || `Prompt ${n}`);
    if (job.groups.length > 1) {
      const name = prefixed(job.videoTitle || result.title || "Video");
      title = `${result.title || name} — ${n}/${job.groups.length}`;
      // Only the images this clip uses, renumbered: its <Picture N> labels count from
      // its own reference list (the one change a shot's text can see — a label that
      // would otherwise point at the wrong image).
      if (structured && images.length)
        ({ images, minimax } = clipImages(images, minimax, result.pictures));
    }
    // A build reads top to bottom in the order it was written: each prompt goes
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
      duration: job.clips[n - 1],
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

  return {
    readSettings,
    publicSettings,
    updateSettings,
    getSource,
    listModels,
    loadModel,
    unloadModel,
    startShots,
    startBuild,
    startRevise,
    startAnalyze,
    readBuilder: (projectId) => {
      const proj = findProject(projectId);
      if (!proj) throw new Error("unknown projectId");
      return readBuilder(proj);
    },
    saveBuilder,
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
    // A "CPU only" server's model stays loaded on purpose; this is how it's let go
    // (⚙ LLM settings → ⏏ Unload). False when it wasn't loaded.
    unloadCpu: async (sourceId) => {
      const src = sourceId ? getSource(sourceId) : null;
      if (!src) throw new Error("That server isn't saved in the settings.");
      if (!src.cpuOnly || !SOURCE_KINDS[src.kind].managed)
        throw new Error(`${src.name} isn't a CPU-only server GENie loads models on.`);
      if (cpu.runner && cpu.runner.job.sourceId === src.id)
        throw new Error("It's in use — cancel the job first.");
      // The same one-model server may be holding a build's model instead.
      const held = state.loading || state.inUse;
      if (held && sharesOneModel(src, getSource(held.sourceId)))
        throw new Error(`${src.name} is busy with a build.`);
      const info = await modelInfo(src, src.model);
      if (!info?.loaded) return false;
      await unloadModel(src, src.model);
      log.log?.(`LLM: unloaded ${src.model} from ${src.name} (CPU).`);
      return true;
    },
    _state: state,
  };
}

// How many times a malformed reply goes back to the model to be fixed.
const REPAIR_ATTEMPTS = 3;

// The JSON in a reply — an object, or an array when the model sent a bare list — or
// null. Tolerates <think> blocks, ``` fences, chatter around it and raw line breaks
// inside its strings.
function replyJson(raw) {
  let t = stripThinking(raw);
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const between = (open, close) => {
    const a = t.indexOf(open);
    const b = t.lastIndexOf(close);
    return a >= 0 && b > a ? t.slice(a, b + 1) : null;
  };
  const cands = [between("{", "}"), between("[", "]")].filter(Boolean);
  if (t.startsWith("[")) cands.reverse();
  for (const cand of cands)
    for (const attempt of [cand, escapeRawNewlines(cand)]) {
      try {
        const j = JSON.parse(attempt);
        if (j && typeof j === "object") return j;
      } catch {
        /* try the next shape */
      }
    }
  return null;
}

const replyText = (v) => String(v ?? "").replace(/\\n/g, "\n").trim();
const replyTitle = (v) => replyText(v).replace(/^["']|["']$/g, "").slice(0, 120);

// A reply's "shots" → [{ len, text }], the empty ones dropped. A reply that gave start
// times instead of lengths: a shot lasts until the next one starts.
function readShots(list) {
  const secs = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? Math.max(0, v) : null;
    const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)/.exec(String(v).trim());
    return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null;
  };
  const shots = (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === "string" ? { text: x } : x || {}))
    .map((x) => ({
      len: secs(x.seconds ?? x.len ?? x.length ?? x.duration),
      at: secs(x.at ?? x.time),
      text: replyText(x.text ?? x.description),
    }))
    .filter((x) => x.text);
  if (!shots.some((x) => x.len != null) && shots.some((x) => x.at != null))
    shots.forEach((x, i) => {
      const from = i === 0 ? 0 : x.at;
      const to = shots[i + 1]?.at;
      x.len = from == null || to == null ? null : Math.max(0, Math.round((to - from) * 1000) / 1000);
    });
  return shots.map(({ len, text }) => ({ len, text }));
}

// Step 1's reply → { title, shots: [{ len, text }] }, every shot with a length and —
// when the video's length is known — the lengths adding up to it (see fitShotLengths).
// Throws when there are no shots in it, so the build asks again.
export function parseShotList(raw, total) {
  const j = replyJson(raw);
  const shots = readShots(Array.isArray(j) ? j : j?.shots ?? j?.shot_list);
  if (!shots.length) throw new Error("The LLM's reply wasn't a JSON shot list.");
  const lens = fitShotLengths(shots.map((s) => s.len), total);
  return {
    title: Array.isArray(j) ? "" : replyTitle(j.title ?? j.video_title),
    shots: shots.map((s, i) => ({ len: lens[i], text: s.text })),
  };
}

// Shot lengths that add up to `total` seconds. Models are loose with arithmetic: a
// missing length gets the average of the others, and a list that's over or under is
// scaled to fit, in whole seconds (at least 1 each) while there's a second per shot.
// With no total, lengths are only filled in and rounded.
export function fitShotLengths(lens, total) {
  const n = lens.length;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const known = lens.filter((x) => x > 0);
  const fill = known.length ? known.reduce((a, x) => a + x, 0) / known.length : total > 0 ? total / n : 5;
  const out = lens.map((x) => (x > 0 ? x : fill));
  if (!(total > 0)) return out.map((x) => Math.max(1, Math.round(x)));
  const sum = out.reduce((a, x) => a + x, 0);
  if (Math.abs(sum - total) < 0.0005) return out.map(r3);
  const whole = Math.floor(total);
  if (whole < n) return out.map((x) => r3((x * total) / sum));
  const scaled = out.map((x) => (x * whole) / sum);
  const fit = scaled.map((x) => Math.max(1, Math.floor(x)));
  // Hand out (or take back) the seconds rounding left over, to the shots it shorted most.
  let left = whole - fit.reduce((a, x) => a + x, 0);
  while (left !== 0) {
    const step = Math.sign(left);
    let pick = -1;
    fit.forEach((x, i) => {
      if (step < 0 && x <= 1) return;
      if (pick < 0 || (scaled[i] - x) * step > (scaled[pick] - fit[pick]) * step) pick = i;
    });
    fit[pick] += step;
    left -= step;
  }
  fit[n - 1] = r3(fit[n - 1] + (total - whole)); // a fraction of a second, if any
  return fit;
}

// A Default prompt's text: the intro, then the shots exactly as written — each later
// one under the time it starts, as the default instructions mark a cut — then the sound.
export function composeDefaultPrompt(intro, shots, sound) {
  const clock = (sec) => {
    const m = Math.floor(sec / 60);
    return `${String(m).padStart(2, "0")}:${(sec - m * 60).toFixed(3).padStart(6, "0")}`;
  };
  let t = 0;
  const paras = shots.map((s, i) => {
    const at = t;
    t += Number(s.len) || 0;
    return i === 0 ? s.text.trim() : `At ${clock(at)}: ${s.text.trim()}`;
  });
  return [intro, ...paras, sound].filter((p) => String(p || "").trim()).join("\n\n");
}

// Step 2's reply for the Default format → { title, intro, sound, prompt }, the prompt
// put together around `shots`. Throws when the reply isn't its JSON.
export function parseAroundReply(raw, shots) {
  const j = replyJson(raw);
  if (!j || Array.isArray(j)) throw new Error("The LLM's reply wasn't the JSON asked for.");
  const intro = replyText(j.intro ?? j.introduction ?? j.opening);
  const sound = /^none\.?$/i.test(replyText(j.sound)) ? "" : replyText(j.sound ?? j.audio);
  return {
    title: replyTitle(j.title),
    intro,
    sound,
    prompt: composeDefaultPrompt(intro, shots, sound),
  };
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

// A quick-revise reply → { prompt }: the text as written, minus a <think> block, a
// fence around the whole of it and the <<< >>> markers it was sent in.
function parsePlainReply(raw) {
  let t = stripThinking(raw);
  const fence = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1];
  t = t.replace(/^<<<\s*\n/, "").replace(/\n?\s*>>>$/, "").trim();
  if (!t) throw new Error("The LLM returned an empty reply.");
  return { title: "", prompt: t };
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

// A MiniMax reply → { title, minimax, pictures? } in the stored shape (see app.js,
// "Stored shape (p.minimax)"). Throws when there's no usable JSON, so the job retries.
// With `fixedShots` (a build: the user's own shots) the reply's shots, if it sent any,
// are ignored and those go in untouched; without (a revision) the shots are the
// reply's, and a reply with only a "prompt" string becomes a single shot.
// `pictures` comes from one prompt of a multi-prompt build (see buildMessages).
export function parseStructuredReply(raw, format, fixedShots = null) {
  const j = replyJson(raw);
  if (!j || Array.isArray(j))
    throw new Error("The LLM's reply wasn't the JSON the MiniMax format needs.");
  const str = replyText;
  const key = (k) =>
    str(k)
      .replace(/^@+/, "")
      .replace(/^<|>$/g, "")
      .replace(/\s+/g, "_")
      .toLowerCase();
  let shots = fixedShots ? fixedShots.map(({ len, text }) => ({ len, text })) : readShots(j.shots);
  if (!shots.length && str(j.prompt)) shots = [{ len: null, text: str(j.prompt) }];
  if (!shots.length) throw new Error("The LLM's reply had no shots.");
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
  const out = { title: replyTitle(j.title), minimax: mm };
  const pics = j.pictures ?? j.images ?? j.references;
  if (Array.isArray(pics)) out.pictures = pics;
  return out;
}

// A subject key as the editor writes it (see normKey in app.js).
const analyzeKey = (k) =>
  String(k ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/^<|>$/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase()
    .slice(0, 40);

// An ✨ Analyze reply → { kind, definition, retention }. The definition is what follows
// "<key> is …" (the editor's compiler writes that lead-in and the picture numbers), so a
// model that wrote them anyway has them taken off. Throws without a definition.
export function parseAnalysis(raw, key = "") {
  const j = replyJson(raw);
  if (!j || Array.isArray(j)) throw new Error("The LLM's reply wasn't the JSON asked for.");
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = replyText(j.definition ?? j.description)
    .replace(new RegExp(`^<${esc}>\\s*(?:,[^,]*,\\s*)?(?:is\\b)?\\s*`, "i"), "")
    .replace(/^is\s+/i, "")
    .replace(/^seen in <Picture \d+>(?:(?:,| and) <Picture \d+>)*,?\s*(?:is\s+)?/i, "")
    .trim();
  if (!definition) throw new Error("The LLM's reply had no definition.");
  let retention = replyText(j.retention).replace(/\s*\(appears in[^)]*\)\.?\s*$/i, "");
  // A bare list of what's kept gets the marker it was asked for.
  if (retention && !/^(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b/i.test(retention))
    retention = `fully_preserved - ${retention}`;
  return { kind: replyText(j.kind).toLowerCase().slice(0, 20), definition, retention };
}

// An ✨ Analyze scene reply → { kind: "scene", definition, retention, shot1 }: the
// retention line is the staging and the set after the "partially_preserved - keep the
// staging and the set:" lead; shot1 is the sentence that follows Shot 1's lead.
export function parseSceneAnalysis(raw, key = "", others = []) {
  const j = replyJson(raw);
  if (!j || Array.isArray(j)) throw new Error("The LLM's reply wasn't the JSON asked for.");
  const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = replyText(j.definition ?? j.description)
    .replace(new RegExp(`^<${esc(key)}>\\s*(?:is\\b)?\\s*`, "i"), "")
    .replace(/^is\s+/i, "")
    .trim();
  // A subject named without its brackets ("marco stands…") gets them back, and each
  // sentence starts with a capital (a <key> opening one stays as it is).
  const tidy = (t) => {
    for (const k of others)
      t = t.replace(new RegExp(`(?<![<\\p{L}\\p{N}_@-])${esc(k)}(?![>\\p{L}\\p{N}_-])`, "giu"), `<${k}>`);
    return t.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (m, a, c) => a + c.toUpperCase());
  };
  const staging = tidy(replyText(j.staging));
  const set = tidy(replyText(j.set ?? j.room ?? j.setting));
  if (!definition || !(staging || set)) throw new Error("The LLM's reply had no staging or set.");
  const lead = /^partially_preserved\s*-\s*keep the staging and the set:\s*/i;
  const body = [staging, set]
    .map((t) => endSentence(t.replace(lead, "")))
    .filter((t) => t !== ".")
    .join(" ");
  const shot1 = tidy(
    replyText(j.shot1 ?? j.shot_1 ?? j.opening)
      .replace(/^\[Shot 1\]\s*/i, "")
      .replace(/^Continuing from the staging in <[^>]+>:\s*/i, ""),
  );
  return {
    kind: "scene",
    definition,
    retention: `${SCENE_RETENTION_LEAD} ${body} The camera angle and the poses may change.`,
    shot1: shot1 ? endSentence(shot1) : "",
  };
}
const endSentence = (t) => (!t ? "." : /[.!?…"”')\]]$/.test(t) ? t : `${t}.`);

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
