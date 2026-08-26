# Workflow variables (tokens)

How to turn values in a ComfyUI workflow into **form controls** in GENie, so you
(and anyone using your workflow) can change them from the UI instead of editing JSON
every time.

This is the authoring reference for the `{{token}}` system. For the surrounding
behavior — the gallery, live progress, dynamic LoRAs, bypassable nodes, reference
tails, and how a run executes — see [../COMFYUI.md](../COMFYUI.md).

---

## The idea in one line

Wherever you'd hard-code a value in the workflow JSON, put a **token** instead.
GENie reads the tokens, builds a form control for each, and substitutes your chosen
values back in **on a copy** at generate time — your file on disk is never modified.

**Before** (a fixed value):

```jsonc
"124": { "inputs": { "steps": 8 } }
```

**After** (a control, defaulting to 8):

```jsonc
"124": { "inputs": { "steps": "{{steps=8}}" } }
```

> Tokens live **inside string values**. Because JSON needs the value to be a string
> to hold the `{{…}}` text, a number like `8` becomes `"{{steps=8}}"`. Don't worry —
> a whole-value token keeps its real type when substituted (see
> [Type is preserved](#type-is-preserved)), so ComfyUI still receives the number `8`.

Requirements:

- The workflow must be an **API-format** export (ComfyUI: enable *Dev mode* →
  **Save (API Format)**), i.e. the flat `{ "<nodeId>": { "inputs": …, "class_type": … } }`
  shape.
- ComfyUI must be **running** for the install-based pickers (models, LoRAs, VAEs,
  samplers, …) to populate. Text/number/dropdown controls work offline.

---

## Anatomy of a token

```
{{ name = default | option | option ; width ; #order }}
```

| Part | Required | Meaning |
| --- | --- | --- |
| `name` | ✅ | The variable's name. Also the control's label, and the tag you reference in the prompt (`<Picture 1>`, etc.). |
| `= default` | — | Starting value baked into the JSON (e.g. `=8`). Also the value used if the field is left empty. |
| `\| option \| option` | — | Explicit dropdown choices. Their presence **forces a dropdown**. Use `Label=value` to show a friendly label but send a different value. |
| `; width` | — | Column span in the form's 12-column grid: `full`, `1`, `1/2`, `1/3`, `1/4`, `2/3`, `3/4`. |
| `; #order` | — | Sort position (ascending integer). Lower numbers appear first. |

The `; width` and `; #order` hints are **layout only** — they're stripped before the
value is sent to ComfyUI, and can appear in either order. Everything before the
first layout `;` is the value spec.

Examples:

```jsonc
"{{seed=14}}"                                   // number, default 14
"{{prompt}}"                                    // multi-line text box (name contains "prompt")
"{{sampler}}"                                   // dropdown of installed samplers (from ComfyUI)
"{{steps=8 ; 1/4 ; #5}}"                         // number, quarter width, 5th in order
"{{extra_lora=1|Enabled=1|Disabled=0}}"          // dropdown: shows Enabled/Disabled, sends 1/0
```

---

## Type is preserved

- If a token is the **entire** string value, its substituted value keeps its real
  **type** — a number stays a number, so `"{{steps=8}}"` sends `8`, not `"8"`.
- If a token is **embedded** in a longer string, the result is text (interpolated).
- For `Label=value` dropdowns, if **every** option value is a number, the dropdown
  sends a number (so a strength of `0` stays numeric, not `"0"`).

```jsonc
"noise_seed": "{{seed=14}}"                       // → 14        (number)
"text":       "A photo of {{subject=a cat}}"      // → "A photo of a cat"   (text)
```

---

## One name, used many places

The **same token name** can appear on multiple nodes. It renders **one** control and
fills **every** occurrence with the same value. Handy when several nodes need the
same seed, resolution, or model. The first occurrence's spec (default/options/hints)
wins if they differ.

---

## What control you get

GENie picks the control from the token, in this order (first match wins):

| # | Rule | Control |
| --- | --- | --- |
| 1 | Has inline options `\|a\|b` | **dropdown** of those options |
| 2 | Name contains `prompt` | **multi-line text box** |
| 3 | ComfyUI reports the field as a **combo** (checkpoint, LoRA, VAE, `sampler_name`, `scheduler`, …) | **dropdown of installed choices** (from `/object_info`) |
| 4 | ComfyUI reports the field as **FLOAT / INT** | **number box** with the field's real min/max/step |
| 5 | Name contains a media word — `audio`, then `video`, then `image`/`img`/`frame`/`photo`/`picture` | **upload dropzone** (unless the node input is a model-file selector — see below) |
| 6 | Name has a numeric hint (`seed`, `steps`, `cfg`, `width`, `height`, `length`, `duration`, `fps`, `frames`, `count`, `denoise`, `strength`, `scale`, `megapixel`, `batch`) **or** the default is a number | **number box** |
| 7 | otherwise | single-line **text box** |

**Media vs. model-file is decided by the node input, not the token name.** An
*uploadable* input (`LoadImage.image`, `VHS_LoadVideo.video`, `VHS_LoadAudioUpload.audio`)
gets an upload dropzone, while a model-file selector (`vae_name`, `ckpt_name`,
`unet_name`, `lora_name`, `clip_name`, …) gets an installed-file dropdown — so a
token named `video_vae` sitting on a `vae_name` input is correctly a VAE picker, not
a video upload.

**Forcing a control:** the two levers are **inline options** (rule 1 — force a
dropdown by listing exact accepted strings) and **naming** (rules 2/5/6 — include
`prompt`, a media word, or a numeric hint). For an aspect-ratio node that ComfyUI
doesn't report as a combo, list the strings yourself:

```jsonc
"aspect_ratio": "{{aspect_ratio=3:4 (Portrait Standard)|16:9 (Landscape Standard)|1:1 (Square)}}"
```

---

## Media inputs

Image/video/audio tokens become upload dropzones that save the dropped file to the
project gallery, offer **Pick from gallery**, and upload the file to ComfyUI at
generate time.

**Numbered series → one multi-upload field.** Media tokens that share a base name and
end in a number are grouped into a single reorderable, multi-file control (the same
component as the kie.ai reference dropzone):

```jsonc
"{{picture1}}" … "{{picture9}}"      // one "Picture" field holding up to 9, drag to reorder
"{{ref_video1}}" … "{{ref_video3}}"  // one "Ref Video" field, up to 3
```

Files fill from the top (Picture 1, Picture 2, …), matching `<Picture N>` prompt
tags. The field's width/order come from the first token in the series (`picture1`).

**Media is optional.** Any slot you leave empty has its **loader node pruned** from
the submitted workflow, so you only fill the references you have — no "empty input"
errors. (URL drops aren't accepted for local workflows; ComfyUI needs a real file, so
drop or browse one.)

---

## Installed-file & choice pickers (needs ComfyUI running)

Tokenize a loader/sampler field with **no options list** and GENie fills the dropdown
from your live ComfyUI install (`/object_info`) — you don't hand-list what's
installed:

```jsonc
"ckpt_name":   "{{model}}"          // → checkpoint dropdown
"vae_name":    "{{vae}}"            // → VAE dropdown
"lora_name":   "{{lora}}"           // → LoRA dropdown
"sampler_name":"{{sampler}}"        // → sampler dropdown
"scheduler":   "{{scheduler}}"      // → scheduler dropdown
```

Numeric fields (`strength_model`, `cfg`, `steps`, …) also pick up their real
min/max/step from the same source. If ComfyUI is offline, the form shows a notice and
these pickers stay empty (add an explicit `|option|` list if you want them to work
offline, or to restrict the choices).

Installed-**file** pickers (checkpoints/VAEs/CLIPs/LoRAs — anything whose choices are
`.safetensors`-style filenames) render inside a collapsed **ComfyUI Settings** drawer
to keep the main form uncluttered. Plain enum pickers like `sampler` and `scheduler`
stay in the main form. Width/order hints still apply within each.

---

## Numbers & the seed control

- **Number boxes** honor the ComfyUI field's min/max/step when available; a field
  ComfyUI reports as effectively unbounded is treated as unbounded (the spinner
  arrows still work).
- **Seed control-after-generate.** Any number token whose name contains `seed` gets a
  `fixed / increment / decrement / randomize` dropdown and a 🎲, like ComfyUI's seed
  widget. After each run the seed advances per that setting; 🎲 randomizes it now. The
  mode is remembered per workflow.

---

## Layout hints

Controls render in a 12-column grid.

- **width** — `; 1/2`, `; 1/3`, `; 1/4`, `; 2/3`, `; 3/4`, `; full`. Untagged
  controls, the prompt, and media dropzones span full width.
- **order** — `; #N`, ascending. Tokens without an order keep their scan order,
  after any explicitly-ordered ones.

```jsonc
"{{sampler ; 1/3 ; #3}}"     // one-third wide, sorted third
"{{scheduler ; 1/3 ; #4}}"   // sits beside it, sorted fourth
```

Three `1/3` controls in a row make one clean line; two `1/2` fill a line; and so on.

---

## Defaults vs. your saved settings

- `= default` is the value **baked into the JSON** — the way to ship a sensible
  starting point (`{{steps=8}}`).
- On top of that, GENie **remembers your last-used settings per workflow** (control
  values, picked media, seed mode, LoRA list, node toggles), stored server-side in
  `settings/comfy/<workflow-name>.json`. These **override** the token defaults when
  you re-open the workflow.
- To reset a workflow to its baked defaults, delete that `settings/comfy/<name>.json`.

Because your saved settings live in a separate file, **editing a default in the JSON
won't change what you see** once you've run the workflow — the saved value wins.
Delete the settings file (or change the value in the form) to pick up a new default.

---

## A worked example

```jsonc
{
  "3":  { "inputs": { "seed": "{{seed=0 ; 1/3 ; #1}}",
                      "steps": "{{steps=20 ; 1/3 ; #2}}",
                      "cfg": "{{cfg=7 ; 1/3 ; #3}}",
                      "sampler_name": "{{sampler ; 1/2 ; #4}}",
                      "scheduler": "{{scheduler ; 1/2 ; #5}}",
                      "denoise": 1,
                      "model": ["4", 0], "positive": ["6", 0],
                      "negative": ["7", 0], "latent_image": ["5", 0] },
        "class_type": "KSampler" },

  "4":  { "inputs": { "ckpt_name": "{{model}}" },
        "class_type": "CheckpointLoaderSimple" },

  "6":  { "inputs": { "text": "{{prompt}}", "clip": ["4", 1] },
        "class_type": "CLIPTextEncode" },

  "10": { "inputs": { "image": "{{picture1}}" },
        "class_type": "LoadImage" }
}
```

That workflow renders: a **Seed** number (with the 🎲 + fixed/increment control), a
**Steps** and **Cfg** number, a **Sampler** and **Scheduler** dropdown (filled from
ComfyUI), a **Model** checkpoint picker in the Settings drawer, a **Prompt** text
box, and a **Picture** upload — all from tokens, no code.

---

## Gotchas

- **API format only.** The editor's normal graph export won't work — use *Save (API
  Format)*.
- **ComfyUI must be running** for model/LoRA/VAE/sampler/scheduler pickers and for
  real number bounds. Text, `|option|` dropdowns, and defaults work offline.
- **The workflow must save an output** (`VHS_VideoCombine`, `SaveImage`, …) — that's
  what GENie pulls the result from.
- **Type:** only a *whole-value* token preserves a number/boolean; a token inside a
  longer string is always text.
- **Reserved layout hints:** a trailing `; 1/2`, `; #3`, etc. is treated as a layout
  hint, not part of the value. If you genuinely need a value that ends in `; 1/2`,
  don't make it a whole-value token (or avoid the pattern).
- **First occurrence wins** when the same name appears with different specs.

---

See also: [../COMFYUI.md](../COMFYUI.md) (full ComfyUI integration guide),
[../../workflows/README.md](../../workflows/README.md) (where custom workflows go).
