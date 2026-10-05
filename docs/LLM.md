# ✨ Build with AI — prompts from a local vision LLM

GENie can have a vision-capable LLM look at images from a project's gallery and
write video prompts from a short description and a theme. Each prompt lands in the
project's **Saved Prompts** with those images attached as its references, ready to
generate from.

It talks to any **OpenAI-compatible** server, so one setup covers:

| Server | Default address | Loads/unloads models? |
| --- | --- | --- |
| LM Studio (0.4+) | `http://127.0.0.1:1234` | yes — `/api/v1/models/load` and `/unload` |
| text-generation-webui (started with `--api`) | `http://127.0.0.1:5000` | yes — `/v1/internal/model/load` and `/unload` |
| Ollama | `http://127.0.0.1:11434` | yes — `keep_alive` |
| Other OpenAI-compatible (cloud, llama.cpp server, vLLM…) | your URL | no — used as-is |

## Setup

1. Start the server's API:
   - **LM Studio:** Developer tab → *Start server* (or `lms server start`). LM Studio
     Bionic (the agent app) uses the same engine, but the API server is in LM Studio
     itself. If you only have Bionic installed, you also need LM Studio (or its `lms`
     tool) for this.
   - **text-generation-webui:** launch with `--api`. For a vision model on llama.cpp,
     put its projector in **Load options**, e.g. `{"mmproj": "mmproj-F16.gguf"}`.
2. In GENie: **Saved Prompts** tab → **✨ Build with AI** → **⚙ LLM settings**.
   Pick the server, click **Test & list models**, and choose a model. Vision models
   are marked 👁 (LM Studio shows vision support; the other servers don't report it).
3. Save.

## Building

Pick images (click order = `<Picture 1>`, `<Picture 2>`, …), write what should happen
and the theme, choose how many variations, then **✨ Build**. A gallery file's
**key** and **definition** (set in the saved-prompt editor) are passed along, so the
model can refer to `<brent>` instead of "the man in the grey suit".

**Rules** are standing instructions for the model: what to always do, what never to
do, how to write dialogue, and so on. They're added to the system prompt and
override its default guidance. The form is saved on the server for each project as
you type, so it's the same in every browser and on your phone. **↺ Recent builds**
refills it from any of the project's last 20 builds. A project with no rules yet
starts from the rules you used most recently.

**Longer than one clip.** With a MiniMax format and a **Duration** over 15 seconds,
the build is written as a **prompt group**: one whole prompt per clip (15s clips, then
the rest; a short remainder is topped up to 4s). Each clip is its own LLM request and
gets its own subjects, summary, retention and shots, and the model is shown the clips
written so far so it carries on where the last one ended. It also says which images
each clip needs, and only those are attached to that prompt, renumbered as
`<Picture 1>`, `<Picture 2>`… With several variations, each one becomes a group of its
own, named after the title the model gives the whole video.

Builds run on the server: you can close the tab or start one from your phone. The
Saved Prompts tab shows builds in progress and picks up each prompt as it's saved.

## Revising a saved prompt

Open a saved prompt and expand **✨ Revise with AI**. Describe the change you want and
press **✨ Revise** (Ctrl+Enter works too). The LLM gets the prompt exactly as it is in
the editor, including unsaved edits and its reference images, and returns a complete
revised version in the same format. You see it as a diff against the editor:

- **Apply to editor** puts it in. Nothing is saved until you press **Save changes**,
  and **↶ Undo** puts back what was there.
- **Try again** asks for another take on the same request.
- **Follow my Rules** also applies the Rules from the project's ✨ Build form.

For MiniMax prompts, a field the model leaves empty keeps its current text, so a
model that only returns the fields it changed can't blank the rest.

## Sharing the GPU with ComfyUI

GENie makes the LLM and ComfyUI take turns on the GPU:

- **Before loading**, it waits for ComfyUI's queue to empty and stay empty for
  *Resume after idle* seconds, then checks free VRAM (`nvidia-smi`, or ComfyUI's own
  reading). The model needs its file size plus *Headroom*, or whatever you set as
  *VRAM needed*. If that doesn't fit, it asks ComfyUI to unload its models (like the
  **Free VRAM** button), then keeps waiting up to *Wait for VRAM* minutes.
- **When a generation starts**, whether from GENie or from ComfyUI's own UI, GENie
  stops the LLM mid-reply and unloads it before the video model loads. The build
  shows as paused and continues with the same prompt once ComfyUI is idle again.
- **When a build finishes**, the LLM is unloaded (unless you turn that off).

A model that was already loaded when the build started (for example, loaded by hand
in LM Studio) is used as-is, without the VRAM check.

## Tuning

The **Instructions** box is the system prompt. Edit it to match the models you
generate with. Keep the last part, the JSON reply format (`{"title": …, "prompt": …}`),
because GENie reads the reply from it. If a model returns plain text instead, GENie
saves the text as the prompt anyway.

Settings are stored in `settings/llm.json` (git-ignored). API keys stay on the
server and are never sent to the browser.
