# Local ComfyUI workflows

Run local [ComfyUI](https://github.com/comfyanonymous/ComfyUI) workflows from the
same UI you use for the kie.ai models. Nothing is hard-coded: drop workflow files
in a folder, mark the values you want to control with `{{tokens}}`, and the UI
builds a form for them automatically.

## Setup

1. Have ComfyUI running. By default the app looks for it at
   `http://127.0.0.1:8188`. Point elsewhere with `COMFYUI_URL` in `.env`:

   ```
   COMFYUI_URL=http://127.0.0.1:8188
   ```

2. Put **API-format** workflow exports (`.json`) in the `workflows/` folder (change
   the location with `WORKFLOWS_DIR` in `.env`). In ComfyUI, enable
   *Settings → Enable Dev mode Options* and use **Save (API Format)** — this is the
   flat `{ "<nodeId>": { "inputs": …, "class_type": … } }` shape, not the editor's
   graph export.

3. Reload the app. Each workflow appears in the **Model** dropdown under
   **Local · ComfyUI**.

## Tokens

Replace any value in the workflow JSON with a token to expose it as a control:

```jsonc
"129": { "inputs": { "noise_seed": "{{seed=14}}" } },      // number, default 14
"138": { "inputs": { "value": "{{prompt}}" } },            // big text box
"137": { "inputs": { "image": "{{first_frame}}" } },       // image upload
"12":  { "inputs": { "sampler_name": "{{sampler}}" } }     // dropdown from ComfyUI
```

The grammar is `{{ name = default | opt | opt ; width ; #order }}`, and GENie picks
each control automatically from the token name, its options, and what ComfyUI reports
for that node input. In brief:

- **Type is preserved** for a whole-value token (a number stays a number); embedded
  tokens interpolate as text.
- The **same name** on multiple nodes renders one control and fills them all.
- **`=default`** bakes a starting value; your last-used settings (saved per workflow
  under `settings/comfy/<name>.json`) override it — delete that file to reset.
- **Layout hints** `; 1/2` … `; full` (width) and `; #N` (order) arrange the grid.

> 📖 **Full authoring reference:** [workflows/tokens.md](workflows/tokens.md) — the
> complete `{{token}}` guide (grammar, the control-inference rules, media series,
> forcing dropdowns, the worked example, and gotchas) for anyone writing their own
> workflows. The rest of this page covers the surrounding behavior.

## Models, LoRAs, VAEs & samplers (from ComfyUI)

Tokenize a loader/sampler field and the app fills its dropdown from your **live
ComfyUI install** — no need to list options by hand:

```jsonc
"4":  { "inputs": { "ckpt_name":  "{{model}}" } },        // → checkpoint dropdown
"10": { "inputs": { "vae_name":   "{{vae}}" } },          // → VAE dropdown
"14": { "inputs": { "lora_name":  "{{lora}}",             // → LoRA dropdown
                    "strength_model": "{{lora_strength=0.8}}" } },
"12": { "inputs": { "sampler_name": "{{sampler}}",        // → sampler dropdown
                    "scheduler":    "{{scheduler}}" } }    // → scheduler dropdown
```

The choices come from ComfyUI's `/object_info`, so a dropdown shows exactly what's
installed; numeric fields (`strength_model`, `cfg`, `steps`, …) pick up their real
min/max/step from the same source. **ComfyUI must be running** to build these
controls — if it's offline the form shows a notice and those pickers don't populate
(text/number controls still work). No `|option|` list needed; only add one if you
want to force specific choices.

These installed-file pickers (and the LoRA section below) render inside a collapsed
**ComfyUI Settings** drawer at the bottom of the form, so a workflow's loader
dropdowns don't clutter the main controls. Width/order hints (`; full`, `; #1`, …)
still order them within the drawer.

### Dynamic LoRAs

Separately from any tokenized `lora_name`, the **ComfyUI Settings** drawer has a
**LoRAs** section: click
**+ Add LoRA**, pick a file from your installed LoRAs, and type a **strength**
(keyboard entry, e.g. `0.3`, `0.85`, range **−5 to 5**). Add as many as you like.

These are spliced into the workflow at generate time — the app inserts a chain of
`LoraLoader` nodes between the checkpoint's MODEL/CLIP and everything that consumes
them, so **any checkpoint workflow** gets extra LoRAs without being pre-wired. If a
workflow has no MODEL input to attach to (e.g. some video pipelines), adding a LoRA
surfaces an error (the run can't be queued). Workflows without a CLIP encoder use
`LoraLoaderModelOnly` (model-only) automatically.

### Optional / bypassable nodes

Mark a node `_meta.bypassable` and the **ComfyUI Settings** drawer shows an
**enable/disable** checkbox directly above that node's controls; unchecking it hides
those controls and **removes the node** at generate time, reconnecting its
passthrough (its `model` link input → whatever consumed its output), so an optional
custom node can be turned off for anyone who doesn't have it installed:

```jsonc
"400": {
  "inputs": { "sage_attention": "{{sage_attention=auto}}", "model": ["127", 0] },
  "class_type": "PathchSageAttentionKJ",
  "_meta": { "title": "Patch Sage Attention KJ", "bypassable": true }
}
```

Best for single-in/single-out model "patch" nodes (Sage Attention, attention backends,
model-sampling patches, …) — the passthrough is taken from the node's `model` input (or
its sole link input).

Add `_meta.bypassed_by_default: true` and the toggle starts **off**, for a node that
shouldn't impose anything until it's asked for. Your saved settings win once the
workflow has been run, so this only sets the starting state.

The bundled MiniMax workflow ships two patch nodes chained: **Patch Sage Attention KJ**
then **Model Attention Backend**, the second of them off by default. Both write the same
`transformer_options["optimized_attention_override"]`, so they can't coexist and the
**downstream node wins** — enabling the backend selector makes it authoritative,
switching it back off hands control to the Sage patch, and with both off you get
whatever ComfyUI was launched with.

### Per-workflow settings

Your picks — control values, chosen model/LoRA/VAE/sampler, media, seed mode, the
LoRA list, and node enable/disable toggles — are saved **server-side** per workflow
in `settings/comfy/<name>.json`
(override the folder with `COMFY_SETTINGS_DIR`). Because it lives on the server, the
same config is shared across every device that opens the app — including your phone
over LAN — and it survives a browser-cache clear. Re-selecting the workflow (or
re-importing a run from History) reloads it.

## Image inputs & the gallery

Image controls work like the kie.ai reference dropzones:

- **Drop or browse** a file and it's saved into the current project's gallery
  (`input/<project>/`), the same store the API side uses — so it's reusable and
  shows up in exports.
- **Pick from gallery** to reuse any image already saved in the project.

At generate time the chosen image is pushed into ComfyUI's input folder and its
gallery id is recorded on the History entry, so a **project export** bundles
ComfyUI input images alongside API ones.

### Optional / multiple references

A workflow can wire many reference-loader nodes (e.g. all 9 image / 3 video /
3 audio slots of MiniMax H3) and tokenize each with a **numbered series** —
`{{picture1}}`…`{{picture9}}`, `{{ref_video1}}`…, `{{ref_audio1}}`….

Media tokens that share a base name and end in a number are **grouped into one
multi-upload field** — the *same* component as the kie.ai reference-images dropzone,
so it supports **drag-to-reorder**, **view full size** (⤢), and **Pick from
gallery**. Add several files; each thumbnail is labelled with the **exact tag to cite
in the prompt** (see *Reference labels* below), and you can drag them to re-sort. The Nth
file fills the Nth token; the field's width/order come from the first token in the
series (`picture1`). URL drops aren't accepted here — ComfyUI needs a real file, so
drop or browse a file (it's saved to the gallery first).

### Reference labels

MiniMax H3 numbers references by **presentation order, not by field**: images first,
then for each reference video its soundtrack's `<Audio j>` label immediately *before*
that video's `<Video k>`, then standalone audio. A wired soundtrack therefore **claims
an audio number**, so with a picture, a reference video carrying sound, and your own
audio file all loaded, the tags are:

```
<Picture 1>  your image
<Audio 1>    the reference video's soundtrack   ← easy to miss
<Video 1>    the reference video
<Audio 2>    your audio file
```

Because it depends on what's loaded *and* on whether the workflow wires
`ref_video_audios.ref_video_audio_N`, the numbering shifts between workflows and
between runs. So the form shows the real tag on each thumbnail and lists the whole
mapping in one line beneath the reference fields, updating as you add, remove or
reorder files. A workflow that drops the soundtrack link makes your audio file
`<Audio 1>` — same files, different tag.

The server reports `refLabelScheme: "minimax_h3"` for workflows containing a
`MiniMaxH3ReferenceToVideo` node, plus a per-video-token `soundtrack` flag; other
workflows keep each field's own numbering.

Media is **optional**: any slot you leave empty has its **loader node pruned** from
the submitted workflow (with its now-dangling connections), so you only fill the
references you have — no "empty input" errors. Files fill from the top, so slots
stay contiguous. (Pruning doesn't renumber, so a hand-built workflow that fills
non-contiguous slots could leave a gap the node may reject — not possible via the
grouped field, which always fills in order.)

### Reference-video tails ("use last N sec")

Each reference **video** gets its own **use last N sec** box under the dropzone.
Reference frames are re-injected on every sampling step, so a long reference is
expensive: at 0.5 MP, a 15s target with a full 15s reference is ~123k tokens, while
the same run with only the reference's last ~4s is ~74k — and attention cost grows
faster than linearly, so the wall-clock saving is bigger than the token ratio. When
you're continuing a shot, the tail is usually the only part that matters.

Leave the box at `0` (or blank) for the whole clip. The hint next to it shows the
clip's length and how many frames the tail actually keeps.

It's applied as **`skip_first_frames` on that reference's own loader**, not by
re-encoding a trimmed file: frame-exact, instant, and `VHS_LoadVideo` derives its
audio start from the same input, so a trimmed reference keeps its soundtrack in sync.

**Frame-grid snapping.** MiniMax H3 truncates reference frames **from the end** to
reach its 17k+5 frame grid — on a continuation that would silently drop the newest
frames, the ones you're continuing from. So the kept count snaps *down* to the grid
(5 / 22 / 39 / 56 / 73 / 90 / 124 …) and nothing is lost off the end. Declare the
grid on the loader node; without it the tail is used as-is:

```jsonc
"144": {
  "inputs": { "video": "{{ref_video1}}", "skip_first_frames": 0, … },
  "class_type": "VHS_LoadVideo",
  "_meta": { "title": "Load Video (Upload)", "tail_frame_grid": [17, 5] }
}
```

A video reference offers the control whenever its loader has a `skip_first_frames`
input (override the input name with `_meta.tail_input`). Tails are remembered per
file in the workflow's saved settings, and the **frames actually used** are recorded
on the History entry, so re-importing a run restores the same trim.

Measuring the clip needs **ffprobe** on the app server's PATH (ComfyUI already
depends on ffmpeg for `VHS_VideoCombine` and reference-audio extraction, so it's
normally there). Without it the run still queues — it just uses the whole clip and
says so on the run.

### Pinned guide clips (continuation)

A plain reference video is positioned *before* the target on the model's shared time
axis, which gives context but no frame-level tie to the target's first frame — so a
"continue this shot" run tends to re-establish the scene instead of resuming.
`MiniMaxH3AddGuide` is the hard mechanism: it writes `minimax_keyframes` into the
conditioning, and those rows sit at the **same time coordinates as the target**, so the
frames you anchor at `frame_idx 0` condition the opening of the generated clip.

The local `Minimax H3 (Continue)` workflow wires this from the reference loader itself,
so there's no second upload and the guide always comes from whatever the reference tail
left:

```jsonc
"503": { "inputs": { "value": "{{guide_len=22}}" }, "class_type": "PrimitiveInt" },
// batch_index must be -guide_len; derive it so the two can't drift apart
"501": { "inputs": { "expression": "-a", "values.a": ["503", 0] },
         "class_type": "ComfyMathExpression" },                       // output 1 is the INT
"502": { "inputs": { "image": ["144", 0], "batch_index": ["501", 1], "length": ["503", 0] },
         "class_type": "ImageFromBatch" },                            // negative index = from the end
"500": { "inputs": { "positive": ["136", 0], "latent": ["136", 1], "vae": ["119", 0],
                     "image": ["502", 0], "frame_idx": 0 },
         "class_type": "MiniMaxH3AddGuide" }
```

`BasicGuider`'s `conditioning` then reads `["500", 0]`; the sampler's `latent_image`
still reads `["136", 1]`, since a guide only alters conditioning.

- **Guide length** must land on the model's grid — 5, 22, 39, 56 … (`% 17 == 5`).
  `nodes_minimax_h3.py` crops *down* to it, and anything under 5 collapses to a single
  frame. 22 frames ≈ 0.9s ≈ 7 latent frames, ~3,640 tokens at 640×832.
- **One frame pins position, not motion.** A multi-frame guide encodes real movement, so
  velocity carries across the seam — usually what you want when continuing a shot.
- **Guide frames are not copied through verbatim.** Condition rows and target rows are
  packed side by side and the output is read from the target rows, so the opening frames
  are regenerated under strong conditioning — near-identical, not byte-identical.
- **Aspect must match the source clip.** Guide frames are resized with a *centre crop*
  to the target's dimensions, so a mismatched `aspect_ratio`/`megapixels` crops them and
  the seam jumps.
- **The reference video is required** in that workflow: leaving it empty prunes its
  loader and strands the guide chain's `image` input.
- The `audio` anchor is left unwired. At `frame_idx 0` it pins up to the whole remaining
  track, so it needs its own trimmed clip to be useful rather than the reference's.

## How a run works

1. Image inputs are saved to the gallery, then pushed to ComfyUI (`/upload/image`).
2. Empty optional reference loaders are pruned; any reference-video tail becomes a
   `skip_first_frames` on its loader; remaining tokens are substituted
   into a copy of the workflow (your file is never modified).
3. The workflow is queued (`/prompt`) and its **pending History entry is created in
   the same request** (so a dropped connection right after — common on mobile —
   can't orphan the run); the app then polls `/history/{id}`. While it runs,
   the server also listens on ComfyUI's `/ws` and reports **live progress** (sampler
   step count) — the run's **pending History card** shows a bar and
   `step N/M (X%) · elapsed · ETA` (with a **Cancel** button) — plus a **host-stats
   strip** (CPU %, GPU %, VRAM) above History. The strip is shown whenever a
   ComfyUI workflow is selected (refreshing every 5s, or every 2s during a run) so you
   can watch VRAM even between runs. GPU %/VRAM come from `nvidia-smi` when available;
   without it, VRAM falls back to ComfyUI's `/system_stats` and GPU % is shown as `–`.
4. The first video/animation/image output is downloaded into your `output/<project>/`
   folder and the run's History card updates to the result — the **same folders and
   History** as a kie.ai generation, so mixed local+API projects export together. No
   credits are involved. The card records the **run-time** (wall time from submit to
   finished output), shown as `⏱ 2m 34s` in its meta line, and its thumbnail is the
   **downloaded local copy** (ComfyUI's `/view` URL doesn't render a reliable inline
   poster).

A pending run is finished by whichever poller sees it done first: the browser, or a
**server-side sweep** (every ~15s). The sweep is the safety net — it copies the
output and marks the entry done **even if the browser was closed or tabbed away**
when the run finished, as long as the app server and ComfyUI stay up. The watch list
is just the pending ComfyUI entries in `history.json`, so it survives an app-server
restart. If ComfyUI itself is restarted before a finished run is copied, its
in-memory record is gone: after a short grace the entry is marked failed with a note
(the output still sits in ComfyUI's output folder) — re-run to regenerate it.

## Notes & limits

- Local models are labelled **Experimental** in the UI — the token/control layer is
  generic and hasn't been exercised across many node types yet.
- Requires a workflow that **saves an output** (e.g. `VHS_VideoCombine`,
  `SaveImage`) — that's what the app pulls the result from.
- Re-import from History reselects the workflow, refills text/number/dropdown
  values, and re-populates the media fields from the run's saved gallery files
  (any file since deleted from the gallery is skipped).
- Errors from ComfyUI surface on the run's History card in readable form: a
  validation rejection (e.g. a model that isn't installed) is parsed from `node_errors` into
  lines like `CheckpointLoaderSimple (node 12): Value not in list — ckpt_name: '…'
  not in […]`, and a mid-run failure shows the failing node type + exception message.
  Common runtime failures get a short headline instead of the raw traceback: **out
  of VRAM**, **model mismatch** (state-dict/size mismatch), and **missing file**.
- The bundled `workflows/Minimax H3 (Ref2Video).json` is a tokenized example showing
  every control type: `prompt` (text), up to **9 image / 3 video / 3 audio**
  optional references (`picture1`…`picture9`, `ref_video1`…, `ref_audio1`…),
  `seed`/`duration`/`steps` (numbers), `aspect_ratio`/`megapixels`/`scheduler`/`ref_image_size`
  (inline dropdowns), and `model`/`clip`/`video_vae`/`audio_vae` (installed-file
  pickers from `/object_info`, shown in the **ComfyUI Settings** drawer), plus
  width/order layout hints. Add extra LoRAs via the drawer's **LoRAs** section.
- **MiniMax H3 reference videos need the comfy-kitchen attention backend.** H3 hands
  attention its `q`/`k` as slices of one fused qkv projection, so their sequence
  stride is `3·56·128 = 21504` elements. SageAttention and PyTorch attention (flash
  and mem-efficient alike) do that pointer arithmetic in int32, which overflows at
  `2³¹ / 21504 ≈ 99,800 tokens` and dies mid-sampling with **CUDA error: an illegal
  memory access was encountered**. A reference video roughly doubles the packed
  sequence — 15s target + 15s reference at 0.5 MP is ~123k tokens — so it reliably
  crosses the line, while reference *images* barely move it. ComfyUI's own int8
  attention handles the layout correctly (and peaks lower on VRAM, since it quantizes
  and frees `q`/`k`/`v` before attending), which is why the bundled workflow offers a
  **Model Attention Backend** node downstream of the Sage patch. It ships **switched
  off**, so nothing changes for runs that don't use a reference video — tick it in the
  drawer and pick `comfy kitchen attention` before a reference-video run. Left off (on
  Sage or PyTorch attention) keep target + reference duration under roughly 22 combined
  seconds at 0.5 MP, halving that per doubling of megapixels. On an install without
  comfy-kitchen attention the dropdown offers only `pytorch attention`, where the same
  ceiling applies.
