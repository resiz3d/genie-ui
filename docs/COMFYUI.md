# Local ComfyUI workflows

Run local [ComfyUI](https://github.com/comfyanonymous/ComfyUI) workflows from the
same UI you use for the kie.ai models. Nothing is hard-coded and nothing needs
authoring: drop a **raw ComfyUI API export** in a folder and GENie **recognizes** the
nodes in it and builds a form automatically.

## Setup

1. Have ComfyUI running. By default the app looks for it at
   `http://127.0.0.1:8188`. Point elsewhere with `COMFYUI_URL` in `.env`:

   ```
   COMFYUI_URL=http://127.0.0.1:8188
   ```

2. **Export the workflow from ComfyUI in API format** and drop the `.json` into the
   `workflows/` folder (change the location with `WORKFLOWS_DIR` in `.env`).

   In ComfyUI, with your workflow open, choose **File → Export (API)** and save the
   file into GENie's `workflows/` folder. (On older ComfyUI builds without that menu
   item, enable *Settings → Enable Dev mode Options* first, then use **Save (API
   Format)**.)

   > **Use the API export, not the normal one.** *Export (API)* produces the flat
   > `{ "<nodeId>": { "inputs": …, "class_type": … } }` shape GENie reads. The
   > ordinary **File → Export** (or **Save**) writes the editor's *graph* format, which
   > GENie can't run — so if a dropped workflow doesn't show controls, check you used
   > *Export (API)*.

   Subfolders count: `git clone` a workflow repo into `workflows/<repo>/` and its
   files are listed as `<repo>/<name>` (`.git` and friends are skipped). See
   [`workflows/README.md`](../workflows/README.md).

3. Reload the app. Each workflow appears in the **Model** dropdown under
   **Local · ComfyUI**.

4. *Optional.* A video's live preview shows only frame 0. A separate ComfyUI custom
   node, [ComfyUI-GENie-Filmstrip](https://github.com/hittatsu/ComfyUI-GENie-Filmstrip),
   turns it into a grid of frames across the clip. See
   [Filmstrip previews](#filmstrip-previews) below. GENie doesn't require it — skip this
   and everything else works exactly the same.

## Controls — from node recognition

There is nothing to mark up. GENie reads the export, matches each node by its
`class_type` against the **recognition library** in
[`node_types/`](../node_types/), and turns the recognized inputs into form controls —
a **Prompt** box, a **KSampler** section with seed/steps/cfg/sampler/scheduler/denoise,
a **Latent Image** section with resolution, a **Save Image** filename, loader pickers,
and so on. Each recognized node becomes its own **collapsible section**, so the form
mirrors the graph instead of being one flat wall of fields.

- **Type is preserved** — a numeric input stays a number, a combo stays a dropdown.
- **Nodes GENie doesn't recognize run exactly as saved.** They're listed, collapsed,
  under **Other nodes (run as-is)** so you can see what's passing through untouched.
- **Your last-used values win.** Picks are saved per workflow under
  `settings/comfy/<name>.json` (see [Per-workflow settings](#per-workflow-settings));
  the export's own values are the starting point until then.

### Adding support for a node

Recognition is **data-driven** — supporting a new node type is a small JSON file in
[`node_types/`](../node_types/), no server code. Its
[README](../node_types/README.md) is the full reference: how a node maps its inputs to
controls, how to disambiguate (e.g. positive vs. negative prompt), how to expose media
(the `references` mechanism, below), and the closed set of match predicates. A file you
drop in can also **override** a shipped entry, the same shipped-vs-yours idea as
`workflows/`.

## Models, LoRAs, VAEs & samplers (from ComfyUI)

When a recognized control is a loader or sampler field — `ckpt_name`, `vae_name`,
`lora_name`, `sampler_name`, `scheduler`, … — GENie fills its dropdown from your
**live ComfyUI install**, so you pick from exactly what's installed with no list to
maintain. Numeric fields (`cfg`, `steps`, `strength_model`, …) pick up their real
min/max/step from the same place.

The choices come from ComfyUI's `/object_info`, so **ComfyUI must be running** to build
these pickers — if it's offline the form shows a notice and those dropdowns don't
populate (text and number controls still work).

### Dynamic LoRAs

Independently of any checkpoint LoRA in the graph, the **LoRAs** control lets you add
extra LoRAs to any workflow: click **+ Add LoRA**, pick a file from your installed
LoRAs, and type a **strength** (e.g. `0.3`, `0.85`, range **−5 to 5**). Add as many as
you like.

These are spliced into the workflow at generate time — the app inserts a chain of
`LoraLoader` nodes between the checkpoint's MODEL/CLIP and everything that consumes
them, so **any checkpoint workflow** gets extra LoRAs without being pre-wired. If a
workflow has no MODEL input to attach to (e.g. some video pipelines), adding a LoRA
surfaces an error (the run can't be queued). Workflows without a CLIP encoder use
`LoraLoaderModelOnly` (model-only) automatically.

### Optional / bypassable nodes

Mark a node `_meta.bypassable` and the form shows an **enable/disable** checkbox above
that node's controls; unchecking it hides those controls and **removes the node** at
generate time, reconnecting its passthrough (its `model` link input → whatever consumed
its output), so an optional custom node can be turned off for anyone who doesn't have it
installed:

```jsonc
"400": {
  "inputs": { "sage_attention": "auto", "model": ["127", 0] },
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

### Per-workflow settings

Your picks — control values, chosen model/LoRA/VAE/sampler, media, seed mode, the
LoRA list, and node enable/disable toggles — are saved **server-side** per workflow
in `settings/comfy/<name>.json`
(override the folder with `COMFY_SETTINGS_DIR`). Because it lives on the server, the
same config is shared across every device that opens the app — including your phone
over LAN — and it survives a browser-cache clear. Re-selecting the workflow (or
re-importing a run from History) reloads it.

A workflow in a subfolder keys on its path (`settings/comfy/<repo>/<name>.json`), so
two repos can ship a same-named workflow without treading on each other. Move a
workflow between folders and it starts from the export's own values again — its old
settings file stays where it was.

## Image inputs & the gallery

Image controls work like the kie.ai reference dropzones:

- **Drop or browse** a file and it's saved into the current project's gallery
  (`input/<project>/`), the same store the API side uses — so it's reusable and
  shows up in exports.
- **Pick from gallery** to reuse any image already saved in the project.

At generate time the chosen image is pushed into ComfyUI's input folder and its
gallery id is recorded on the History entry, so a **project export** bundles
ComfyUI input images alongside API ones.

### Reference media — driven by the importing node

Media (images / videos / audio) is exposed by the node that **imports** it, not by the
`LoadImage` / `VHS_LoadVideo` loader nodes. A recognized consuming node declares its
media collections (in its `node_types` entry — see the `references` schema in the
[node_types README](../node_types/README.md)), and GENie renders a **multi-upload per
collection** — the *same* component as the kie.ai reference-images dropzone, so it
supports **drag-to-reorder**, **view full size** (⤢), and **Pick from gallery**.

At generate time GENie **injects one loader node per uploaded file** and wires it into
the importing node's inputs, so you can add **1 or more** of each with no pre-wired
slots. A collection you leave untouched keeps whatever wiring the export had baked.
(MiniMax H3, for example, exposes up to **9 image / 3 video / 3 audio** references this
way.) URL drops aren't accepted here — ComfyUI needs a real file, so drop or browse one
(it's saved to the gallery first).

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
`MiniMaxH3ReferenceToVideo` node, plus a per-video `soundtrack` flag; other
workflows keep each field's own numbering.

> **Reference-video tails ("use last N sec")** — trimming a reference to its last few
> seconds (cheaper attention on continuations) was previously tied to the retired
> `{{token}}` layer and is **not currently active** on the recognition path. Re-adding
> it as a property of a recognized reference collection is tracked as follow-up work.

## Continuations — carry state between runs

Some workflows carry state from one run to the next — a sampler that writes something
and reads it back, so a second clip continues the first. GENie supports that without
knowing anything about the mechanism: it hands each run an **opaque integer**, remembers
which run each one continued, and gives you a **Continue** button. What the number
*means* is entirely the workflow's business.

This is the one place a workflow still opts in with a marker in the JSON. Tag two
primitive value inputs with a continuation role:

```jsonc
"610": { "inputs": { "value": "{{prev=0 ; continue.in}}"  }, "class_type": "PrimitiveInt" },
"611": { "inputs": { "value": "{{cur=0 ; continue.out}}"  }, "class_type": "PrimitiveInt" }
```

- **`continue.out`** receives a fresh integer for this run — unique, never reused.
- **`continue.in`** receives the integer that was given to the run you're continuing
  from, or `0` when there is no parent. Make `0` the default too (the natural "nothing
  to continue" value).

Wire those two inputs into whatever writes and reads your state. Neither shows up as a
control — GENie fills them, so there's nothing to set by hand. Run the workflow once and
its History card grows two buttons:

- **⛓ Continue** — a new run that continues this one. Everything is re-imported, and
  the **seed is re-rolled**, because reusing the parent's seed with near-identical
  conditioning just reproduces the parent.
- **↻ Re-roll** — redo *this* run into its own slot, keeping its place so anything
  continuing from it stays valid. Plain **Re-run** deliberately forks instead: it
  allocates a new integer and never overwrites.

A banner shows while a continuation is armed, with a Cancel; re-importing anything else
clears it. A continued run's History entry carries `continuation: { parentId, from,
slot }` — who it continued, the integer it read, and the integer it was given. Ordinary
runs, and runs of workflows that don't declare these roles, have `continuation: null`
and behave exactly as before.

> The `{{prev=0 ; continue.in}}` marker is the **only** `{{token}}` GENie still reads.
> It's an implementation detail of Continue, not a general authoring system — every
> other control comes from node recognition.

## How a run works

1. Image inputs are saved to the gallery, then pushed to ComfyUI (`/upload/image`).
2. The workflow is recognized and prepared in a **copy** (your file is never modified):
   recognized control values are written into their nodes, reference media loaders are
   injected and wired, continuation roles are filled, and any added LoRAs are spliced
   in.
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

### Live preview frames

While a run samples, its pending History card shows a **live preview** of the frame
being formed, updating every sampler step, in the slot the finished output will take.

This needs nothing per workflow: GENie asks for previews on each queued prompt
(`extra_data.preview_method`), so it works whatever ComfyUI was launched with. The
server picks the frames off ComfyUI's `/ws` and pushes them to the browser over
`/api/comfy/preview-stream` (server-sent events); the frames themselves are fetched
from `/api/comfy/preview`.

The **Preview** dropdown next to the ×N queue counter picks the decoder, per browser:

- **fast** (default) — `latent2rgb`. No downloads, near-zero cost, but coarse:
  impressionistic colour blocks that sharpen as sampling proceeds.
- **sharp** — `taesd`. Needs an approx-VAE in ComfyUI's `models/vae_approx/`:
  `taesd_decoder.pth` for SD/SDXL, or the matching video TAE (`taehv`,
  `lighttaew2_2`, `lighttaew2_1`, `lighttaehy1_5`, `taeltx_2`, `taeh3`). Without one,
  ComfyUI logs a warning and quietly falls back to `latent2rgb`. The video ones come
  from [madebyollin/taehv](https://github.com/madebyollin/taehv) — e.g. `taeh3.pth`
  for MiniMax H3. The filename must **start with** the name above, since that's what
  ComfyUI matches on. Take care where you get them: other "taeh3" files exist that are
  built for a specific node pack rather than ComfyUI core, and core doesn't reject
  them gracefully — it raises `'NoneType' object has no attribute
  'show_progress_bar'` mid-run. A core-compatible video TAE has `decoder.`-prefixed
  keys; a file whose keys start at `1.weight` is not one.
- **off** — no previews requested, no stream opened.

`COMFY_PREVIEW_METHOD` in `.env` sets the default and, set to `off`, disables
previews server-side whatever a browser asks for.

Two limits: a video latent previews as **one frame** (frame 0), not motion — unless
you install the optional [filmstrip node](#filmstrip-previews) below, which turns it
into several frames across the clip; and only samplers that use ComfyUI's standard
preview callback emit frames — the core `KSampler` family does, but a custom-node
sampler may not, in which case the card just looks the way it did before this feature.

### Filmstrip previews

*Optional, and a separate project.* Ordinarily a video's preview is a single frame,
because ComfyUI's previewers take frame 0 of the latent and throw the rest away — for a
97-frame MiniMax H3 render that's one of about 25 frames sitting in the tensor handed to
them every step.

[**ComfyUI-GENie-Filmstrip**](https://github.com/hittatsu/ComfyUI-GENie-Filmstrip) is a
small ComfyUI custom node that pastes four of them into one image as a 2×2 grid, in time
order: the first, two through the middle, and the last. Install it like any other node
pack and restart ComfyUI:

```
cd ComfyUI/custom_nodes
git clone https://github.com/hittatsu/ComfyUI-GENie-Filmstrip
```

Not sure where that folder is? With ComfyUI running, open
<http://127.0.0.1:8188/internal/folder_paths> and look for `custom_nodes` — under ComfyUI
Desktop it is often *not* inside the install directory.

To confirm it loaded, look for this line in ComfyUI's console on startup:

```
[genie-filmstrip] v1.1.0 active -- video latent previews will show 4 frames (max strip 2048px)
```

If it says `NOT active`, or nothing at all, previews simply stay single-frame — the node
is designed to fail that way rather than break anything.

**GENie neither requires it nor knows whether it's installed.** There's no setting and no
detection: install it and previews become grids, skip it and everything works exactly as
described above. The node itself is fail-soft too — if a decode throws, or a future
ComfyUI moves the internals it patches, previews quietly revert to the stock single frame.

Either way, **click the preview in a card to open it full size**. At 200 px wide a 2×2 is
about 100 px per tile, enough to read motion but not detail.

The cost is GPU contention rather than arithmetic — a preview decode competes with the
sampler. Four tiles is roughly 4× a normal preview, which against a 90 s H3 step is about
**2.4% on sharp and 0.05% on fast**. (A single *sharp* preview already costs ~870 ms
mid-run; that's stock ComfyUI, not the node.) Its `GENIE_PREVIEW_*` environment variables
tune the frame count, the image size and a cheaper one-tile-per-step mode — see its README.

## Notes & limits

- Local models are labelled **Experimental** in the UI — the recognition layer is
  generic and hasn't been exercised across every node type yet. A node it doesn't
  recognize still runs as-is; add a `node_types/` entry to expose its inputs.
- Requires a workflow that **saves an output** (e.g. `VHS_VideoCombine`,
  `SaveImage`) — that's what the app pulls the result from.
- Re-import from History reselects the workflow, refills text/number/dropdown
  values, and re-populates the media fields from the run's saved gallery files
  (any file since deleted from the gallery is skipped).
- A workflow's **identity is its path** under `workflows/`, and that's what History
  records — move or rename one and older runs can't re-import it (the same has always
  been true of a rename). The workflows GENie ships in `default/` are the exception:
  they're addressed by bare filename, so runs made before subfolders existed keep
  working.
- Errors from ComfyUI surface on the run's History card in readable form: a
  validation rejection (e.g. a model that isn't installed) is parsed from `node_errors` into
  lines like `CheckpointLoaderSimple (node 12): Value not in list — ckpt_name: '…'
  not in […]`, and a mid-run failure shows the failing node type + exception message.
  Common runtime failures get a short headline instead of the raw traceback: **out
  of VRAM**, **model mismatch** (state-dict/size mismatch), and **missing file**.
- **MiniMax H3 reference videos need the comfy-kitchen attention backend.** H3 hands
  attention its `q`/`k` as slices of one fused qkv projection, so their sequence
  stride is `3·56·128 = 21504` elements. SageAttention and PyTorch attention (flash
  and mem-efficient alike) do that pointer arithmetic in int32, which overflows at
  `2³¹ / 21504 ≈ 99,800 tokens` and dies mid-sampling with **CUDA error: an illegal
  memory access was encountered**. A reference video roughly doubles the packed
  sequence — 15s target + 15s reference at 0.5 MP is ~123k tokens — so it reliably
  crosses the line, while reference *images* barely move it. ComfyUI's own int8
  attention handles the layout correctly (and peaks lower on VRAM, since it quantizes
  and frees `q`/`k`/`v` before attending), which is why a **Model Attention Backend**
  node (bypassable, downstream of a Sage patch) is the reliable way to switch a
  reference-video run onto `comfy kitchen attention`. Left on Sage or PyTorch
  attention, keep target + reference duration under roughly 22 combined seconds at
  0.5 MP, halving that per doubling of megapixels. On an install without comfy-kitchen
  attention the dropdown offers only `pytorch attention`, where the same ceiling applies.
