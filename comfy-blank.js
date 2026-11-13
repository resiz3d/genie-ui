// Clearing one person's run out of a workflow export: the media files its loaders
// point at, the prompt text, and the LoRA picks. Used by the ComfyUI import (an
// option, on by default) so a copied workflow starts clean. Pure and offline; it
// changes `workflow` in place and returns how many of each it emptied.
//
// - Media: a literal file name on a loader node — one the node library names as a
//   reference collection's loader (LoadImage, VHS_LoadVideo, VHS_LoadAudioUpload), or
//   any Load*/VHS_Load* image/video/audio node's image/video/audio/file input. Wired
//   inputs are left alone.
// - Prompt: wherever recognition puts the form's Prompt box (the control named
//   `prompt`), followed through primitives and switches, so every place it would
//   write is emptied. A negative prompt is model tuning, not the run, and stays.
// - LoRAs: `lora_name` on any LoRA loader, the same nodes the LoRA section lists. The
//   node and its strength stay, for the user to pick a file or switch it off.
import { recognizeWorkflow } from "./comfy-recognize.js";

const MEDIA_LOADER = /^(Load(Image|Video|Audio)|VHS_Load(Video|Audio|Image))/i;
const MEDIA_INPUTS = ["image", "video", "audio", "file"];

// Loader class → its file input, from every `references[].loader` in the library.
function libraryLoaders(nodeTypes) {
  const out = new Map();
  for (const entry of nodeTypes.values())
    for (const v of entry?.recognize?.variants || [])
      for (const r of v.references || [])
        if (r.loader?.class_type && r.loader.input)
          out.set(r.loader.class_type, r.loader.input);
  return out;
}

const filled = (v) => typeof v === "string" && v !== "";

export function blankPersonalContent(workflow, nodeTypes) {
  const cleared = { media: 0, prompt: 0, loras: 0 };
  if (!workflow || typeof workflow !== "object") return cleared;

  const { controls } = recognizeWorkflow(workflow, nodeTypes);
  const promptTargets = controls
    .filter((c) => c.name === "prompt")
    .flatMap((c) => c.targets || []);
  for (const t of promptTargets) {
    const inputs = workflow[t.id]?.inputs;
    if (inputs && filled(inputs[t.input])) {
      inputs[t.input] = "";
      cleared.prompt++;
    }
  }

  const loaders = libraryLoaders(nodeTypes);
  for (const node of Object.values(workflow)) {
    const cls = node?.class_type || "";
    const inputs = node?.inputs;
    if (!inputs) continue;
    if (/lora/i.test(cls) && filled(inputs.lora_name)) {
      inputs.lora_name = "";
      cleared.loras++;
    }
    const keys =
      loaders.has(cls) ? [loaders.get(cls)]
      : MEDIA_LOADER.test(cls) ? MEDIA_INPUTS
      : [];
    for (const k of keys)
      if (filled(inputs[k])) {
        inputs[k] = "";
        cleared.media++;
      }
  }
  // Several targets of one prompt (a switch's two branches) are still one prompt.
  cleared.prompt = Math.min(cleared.prompt, 1);
  return cleared;
}
