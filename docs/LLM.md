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
| llama.cpp server (GENie runs it) | `http://127.0.0.1:8090` — the port you set | yes — GENie starts and stops `llama-server` itself |
| Other OpenAI-compatible (cloud, a llama.cpp server you start, vLLM…) | your URL | no — used as-is |

## Setup

1. Start the server's API:
   - **LM Studio:** Developer tab → *Start server* (or `lms server start`). LM Studio
     Bionic (the agent app) uses the same engine, but the API server is in LM Studio
     itself. If you only have Bionic installed, you also need LM Studio (or its `lms`
     tool) for this.
   - **text-generation-webui:** launch with `--api`. For a vision model on llama.cpp,
     put its projector in **Load options**, e.g. `{"mmproj": "mmproj-F16.gguf"}`.
   - **llama.cpp server (GENie runs it):** nothing to start. See
     [below](#a-llamacpp-server-genie-runs).
2. In GENie: **Saved Prompts** tab → **✨ Build with AI** → **⚙ LLM settings**.
   Pick the server, click **Test & list models**, and choose a model. Vision models
   are marked 👁 (LM Studio shows vision support; the other servers don't report it).
3. Save.

## Building

A build has two steps, for every format.

**1. The shot list.** Pick images (click order = `<Picture 1>`, `<Picture 2>`, …),
write what should happen and the theme, set the **Shot count** and the video's
**Duration**, then **✨ Build shot list**. The model writes only shots: that many,
with lengths that add up to the duration (GENie evens out a list that's a little over
or under). No subjects, summary, soundscape or music yet. A gallery file's **key** and
**definition** (set in the saved-prompt editor) are passed along, so the model can
refer to `<brent>` instead of "the man in the grey suit".

**2. Breaks, then the prompts.** The shot list appears under the form as the same
shot cards the prompt editor uses. Edit a shot's text or length, move it with ▲ ▼,
remove it, or **＋ Add shot**. Click **✂ Break here** between two shots to start a new
prompt there; **× Remove break** joins them again. Then **✨ Write prompts**: for each
run of shots between breaks, the model writes everything else in the prompt (for
MiniMax: subjects, summary, retention, style, soundscape and music; for Default: an
opening paragraph and a closing one on sound). The shots are never sent back to be
rewritten. They go into the saved prompt exactly as you left them, and anything the
model says about them is ignored.

With no breaks you get one prompt. With breaks you get several prompts, saved one
after another and titled after the **Video title** (`Title — 1/3`…): 9 shots over 45
seconds with breaks after the 3rd and 6th become 3 prompts. Each prompt is its own LLM request and is shown the whole shot
list plus the style and subjects of the prompts before it, so keys and definitions
stay the same from clip to clip. For MiniMax H3 the model also says which images each
prompt needs, and only those are attached to it, renumbered as `<Picture 1>`,
`<Picture 2>`…

The shot list is saved on the server for each project as you edit it, so you can
build it on one device and add the breaks on another. Building a new list replaces it.

**Rules** are standing instructions for the model: what to always do, what never to
do, how to write dialogue, and so on. They're added to the system prompt and
override its default guidance. The form is saved on the server for each project as
you type, so it's the same in every browser and on your phone. **↺ Recent builds**
refills it from any of the project's last 20 builds. A project with no rules yet
starts from the rules you used most recently.

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

## Analyzing reference images

In a MiniMax (reference) prompt, **✨ Analyze images** under `subject_definitions`
has the LLM look at every reference image that has a `@key` and write that subject's
definition and `retention_analysis` line. Images that share a key are looked at
together, as one subject. Whatever is already written for a subject is passed along as
your notes, so "a 20 year old woman" stays true and gets the hair, clothing and so on
added. Each subject is filled in as it comes back; **↶ Undo** puts everything back, and
nothing is saved until **Save changes**.

The Gallery's **Edit** dialog has the same **✨ Analyze** for an image's own
definition — the one saved on the gallery file, which every prompt using it shares.

Pick the server it uses under **⚙ LLM settings → ✨ Analyze images** (by default, the
one builds use). Images are scaled down in the browser first — **Image size**, 768 px
by default. Smaller is faster.

### A CPU-only server

Analyze is a small job, and it's most useful while a video is generating — when the
GPU is taken. Tick **CPU only** on a server whose model runs in system RAM: GENie then
skips the ComfyUI and VRAM checks for it, a generation doesn't interrupt it, its jobs
run alongside a GPU build, and the model stays loaded. To get its RAM back, open the
server in **⚙ LLM settings** and press **⏏ Unload model** (shown while it's loaded);
the next job loads it again.

- **llama.cpp server (GENie runs it)** is the one to use: with **CPU only** ticked
  GENie starts `llama-server` with `--device none`, so the model and its vision
  projector use no VRAM at all, and it's a server of its own, so it never swaps models
  with your build server. Setup is [below](#a-llamacpp-server-genie-runs).
- **text-generation-webui:** GENie loads the model with `gpu_layers` 0. A vision
  model's projector (about 1 GB) still goes to the GPU, because its API doesn't accept
  the flag that would stop it. It also holds one model at a time, so a CPU server at
  the same address as your build server swaps models with it: Analyze waits for a
  build that is using the model, and a build waits for an analysis.
- **Ollama:** loaded with `num_gpu` 0.
- **LM Studio:** set the model's GPU offload to 0 in LM Studio.

On a CPU most of the time goes into reading the image, so a 2–8B vision model and a
small image size are what keep it quick.

### A llama.cpp server GENie runs

With the **llama.cpp server (GENie runs it)** type there is no server to start or
point at. In **⚙ LLM settings** → **＋ Add**, pick that type and fill in:

- **llama-server program:** the full path to `llama-server` (`llama-server.exe` on
  Windows), from a [llama.cpp release](https://github.com/ggml-org/llama.cpp/releases).
  text-generation-webui ships one too, under
  `installer_files\env\Lib\site-packages\llama_cpp_binaries\bin\`.
- **Model file:** the `.gguf` to serve.
- **Vision projector:** the model's `mmproj` `.gguf`. Leave it empty for a text-only
  model, which can't see images.
- **Port:** one nothing else uses (8090 by default).
- **Extra arguments:** anything else for its command line, e.g. `--threads 12`.

Tick **CPU only** for Analyze, save, and choose it under **✨ Analyze images**. GENie
then runs, the first time a job needs the model:

`llama-server -m <model> --mmproj <projector> -c <context length> --host 127.0.0.1 --port <port> --device none --no-mmproj-offload <extra arguments>`

and waits for it to finish loading. (`--device none` and `--no-mmproj-offload` are the
**CPU only** part, and GENie also hides the GPU from the process with
`CUDA_VISIBLE_DEVICES=-1`: a CUDA build otherwise takes about 400 MB of VRAM just by
starting. Without the tick, llama-server decides how much goes to the GPU,
or you say so in the extra arguments, e.g. `-ngl 99`, and GENie makes it take turns
with ComfyUI like any other server.) It stops the server to unload the model, when you
remove the server from the settings, and when GENie exits. Changing its settings
restarts it the next time it's needed. A CPU-only one otherwise stays up, so the next
Analyze starts at once.

If it doesn't start, the error shows the last lines of its output; all of it is in
`settings/llamacpp-<port>.log`. If a llama-server you started yourself is already
answering on the port, GENie uses that one and leaves it running.

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

The **Instructions** box is the system prompt for the Default format: it guides the
opening and sound paragraphs a build writes around the shots, and ✨ Revise uses it
whole. Edit it to match the models you generate with. Keep the last part, the JSON
reply format (`{"title": …, "prompt": …}`), because a revision is read from it. The
shot list and the MiniMax formats use built-in instructions.

Settings are stored in `settings/llm.json` (git-ignored). API keys stay on the
server and are never sent to the browser.
