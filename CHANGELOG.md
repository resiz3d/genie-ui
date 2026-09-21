# Changelog

All notable changes to GENie are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

**Releasing:** bump `version` in `package.json` (the only place the number lives — the
startup log and the page footer read it), move the **Unreleased** notes under a new
heading for that version with the date, commit, then tag the commit `vX.Y.Z`.

## [Unreleased]

## [1.2.0] - 2026-09-21

### Added

- **Add media straight to the gallery.** The Gallery panel has its own drop zone:
  drop images, videos or audio on it (or click to browse) and they're saved to
  the active project — no need to route them through a reference field or a
  History card. The panel is also available for every model now (including
  ComfyUI workflows and text-to-image models), since it's the project's media
  library rather than part of the reference fields.
- **MiniMax T2V saved prompts.** A second MiniMax format for text-to-video, per
  MiniMax's base prompt guide: the same style, cuts, soundscape and music fields
  as the MiniMax form, without references, subjects, summary or retention. It
  compiles to `integrated_multimodal_description`, `overall_soundscape` and
  `non_diegetic_music`. Create one with **＋ New MiniMax T2V prompt**, choose it
  as the format when saving, or switch an existing prompt with **⇄ To T2V** /
  **⇄ To MiniMax ref** in the editor.
- **Wildcards.** A third tab beside Saved Prompts holds named lists of values,
  grouped by category and shared by every project (`wildcards.json`). Write
  `%category:key%` in any prompt — kie.ai, ComfyUI (every text field) or a
  saved prompt — and each run picks one value at random; a ×N batch or queue
  gets fresh picks per run. `%category:key:1%` keeps its pick, so a later
  `%category:key%` in the same run reuses it. Values can contain tokens of their
  own. An unknown or empty wildcard stops the run before anything is sent.
  History shows the prompt as sent, and Re-import brings back the `%…%`
  template. Tokens copy with a click or go into the prompt with ＋ Insert.
  Typing `%` in any prompt box (including the saved-prompt editor) suggests
  categories and lists as you type; ↑/↓ and Enter or Tab to pick one. Tokens
  are highlighted in the text — tinted when the list exists, red when it doesn't
  (a typo, or a list that was deleted).
  On first start, `wildcards.json` is created from `default.wildcards.json`, a
  starter set of example lists (clothing, rooms, hair, dialogue) kept in the
  repo; your own `wildcards.json` stays out of git.

## [1.1.0] - 2026-09-19

### Added

- **Prompt lock (🔒): keep the prompt and references when switching models.** The
  kie.ai form and each ComfyUI workflow were separate forms, so switching from a
  local draft (e.g. MiniMax H3 on ComfyUI) to the cloud model for the final run
  left your prompt and reference images behind. Now, while the lock on the prompt
  is on (the default, remembered per browser), a switch between ComfyUI and
  kie.ai — or between two workflows — brings the prompt and the reference images,
  videos and audio with it, in order, so `<Picture N>` still points at the same
  file. What you carry beats a workflow's saved settings. An empty prompt or empty
  reference list never wipes the other side's. Resolution, duration and other
  settings stay per model. Hosted-URL references can't go to a local workflow;
  you'll see a note when one is left behind.
- **Saved Prompts.** A **💾 Save prompt** button on the prompt saves the prompt
  text, its reference images/videos/audio and the duration under a title you
  choose, per project (`projects/<project>/prompts.json`). The prompt's header is
  now two tabs, **Prompt** and **Saved Prompts**; the second lists the project's
  saved prompts as compact cards (filterable; the tab you were on is remembered
  across reloads), ordered Drupal-style by **weight**: lighter (lower) rises to
  the top, heavier sinks, default 0. Drag a
  card, or use its ▲ ▼ (Alt+↑/↓), to reorder — that renumbers the weights 0, 1,
  2… in the new order. Clicking a card opens an editor for its title, prompt,
  duration, weight and references — × drops one, and **＋ Add media** picks more
  from the project's gallery (click again to take one out) or uploads/drops new
  files straight into the prompt — with
  **Import** (into the current model or workflow — replaces the prompt,
  references and duration), **Duplicate**, **Move to…** / **Copy to…** another
  project and **Delete**. Works for kie.ai models and for a ComfyUI workflow's
  main prompt. References point at gallery files (nothing is duplicated); one
  deleted from the gallery shows as missing and is skipped on import. Deleting a
  project moves its saved prompts to Default.
- **Link a History card to a saved prompt.** A finished History card has a
  **📌 Saved prompt** dropdown: pick one of its project's saved prompts and that
  output (image, or video — it plays with sound on hover) becomes the prompt card's
  thumbnail, and shows in the prompt's editor under **Output**. Each prompt shows
  one take, so linking another replaces it; unlink from the dropdown or the
  editor. A duplicated or copied prompt starts unlinked; deleting the History
  entry drops the thumbnail. On a linked card, **📌 Re-import** restores the run's
  model and settings but takes the prompt text, references and duration from
  the saved prompt (its current version), and **✎ Edit prompt** opens that
  prompt's editor — even when the card is from another project.
- **Generate straight from a saved prompt.** Press **▶** on a saved-prompt card to
  make it the project's active prompt (remembered per browser). While the **Saved
  Prompts** tab is open, Generate (marked 📌) sends that prompt's text in place of
  the Prompt tab's; settings stay as the form has them, and your draft in the
  Prompt tab is untouched. A Default prompt sends only its text (references come
  from the form); a MiniMax prompt also loads its own references into the form's
  reference fields, in its order, since its `<Picture N>` labels are numbered from
  them. Switch back to the Prompt
  tab and Generate uses the textarea again. Works for kie.ai models and ComfyUI
  workflows. The run's History card links itself to the saved prompt once it has
  an output, so a failed or cancelled run never replaces the prompt's thumbnail.
- **Saved prompt formats: Default and MiniMax H3.** A saved prompt now has a
  format, and each format has its own edit form. **Default** is the plain text as
  before. **MiniMax H3** stores fields instead of text and compiles them into the
  six sections of MiniMax's full-reference prompt format whenever the prompt is
  used (Generate, Import, preview) — the compiled text isn't stored, so nothing is
  kept twice:
  - `subject_definitions` comes from the references' gallery key + definition
    (`<sibella>, seen in <Picture 1>, is …`), plus subjects without an image typed
    on the prompt (e.g. `<new>`). Keys ignore case (`Sibella` and `sibella` are
    one subject; keys are stored lowercase), a definition typed on the prompt
    overrides the image's gallery one, and a definition that already starts with
    `<sibella> is …` (or just `is …`) isn't doubled. Only subjects with a definition get
    a line: a reference whose key isn't defined anywhere (say a second image of
    a subject, cited as `@manuela_sheet` in `<manuela>`'s definition) is just an
    `@key` token.
  - **@key tokens:** write `@sibella` anywhere in a MiniMax prompt to mean the
    reference file with that key; it compiles to its current label (`<Picture 1>`,
    or `<Picture 1> and <Picture 2>` for a key on several files), so re-ordering
    the references keeps every mention on the right file. A shot that mentions
    `@sibella` counts as `<sibella>` appearing in it.
  - The **reference media** (their thumbnails, key and definition boxes, and
    ＋ Add media) sit between subject_definitions and summary in this form, so the
    images are in view while you write the definitions.
  - `summary`: free text — you write the `[reference generation] …` prefix.
  - `retention_analysis`: written under each subject, right below its definition
    (e.g. `fully_preserved - …`); "(appears in [Shot N])" is added from which
    shots mention the subject's `<label>`, and `@shots` in the text becomes that
    same list (`[Shot 1], [Shot 3]`).
  - `detailed_description`: a style opening, Shot 1, and a list of **cuts** you add
    and remove, each with a time — compiled as `[Shot N] At 00:05.000, …`. Cuts
    keep themselves in time order: change a cut's time and it moves (and renumbers)
    into place when you finish typing.
  - `overall_soundscape` and `non_diegetic_music`.
  The editor shows the compiled prompt live. **＋ New MiniMax prompt** (Saved
  Prompts tab) starts one from the form's references; the Save dialog has a
  **Format** choice (picked for you when the text already has MiniMax sections);
  and **⇄ To MiniMax** / **⇄ To plain text** convert an existing prompt, splitting
  text on its section headers, `[Shot N]` markers and "At 00:15.000" paragraphs.
- **Subject key and definition on gallery media.** Each gallery file can now carry
  a key (e.g. `@sibella`) and a definition of what it shows. Every reference in
  the saved-prompt editor has a key field and a definition box, saved with
  **Save changes**. They're stored on the gallery item, so every prompt using that
  file shares them. Groundwork for LLM-assisted prompting.

## [1.0.1] - 2026-09-17

### Added

- **MiniMax H3 (Hailuo 03) on kie.ai** — three new cloud models in the model
  dropdown: **text-to-video**, **image-to-video** (first and/or last frame) and
  **reference-to-video** (up to 9 images, 3 videos and 3 audio references). 4–15s
  clips at **768P or 2K** with native audio, so the form drops the Generate-audio,
  Web-search and NSFW-checker switches for these models, swaps in H3's own
  resolution tiers, and hides Aspect ratio for image-to-video (which has no such
  parameter). GENie also checks H3's input rules before submitting: image-to-video
  needs a frame, and reference-to-video needs an image or video reference — audio
  can't stand alone. API details are in [docs/kie-api/minimax-h3.md](docs/kie-api/minimax-h3.md).
- **Free VRAM** in the ComfyUI host-stats strip — unloads ComfyUI's models and clears
  its cache. With a run in flight it takes effect once that run finishes; the next
  run reloads its models.
- **Reset** on each recognized node's section header — puts that section's controls
  back to recommended values, never the workflow's own baked ones. The value comes
  from a new `recommended` field in `node_types/`, else ComfyUI's node default from
  `/object_info`; text clears, a dropdown takes its first choice, and a number with
  neither keeps its value. Controls locked by an armed continuation are left alone,
  and it asks first if a typed prompt would be wiped.
- **Model Sparse Attention** (ComfyUI core's `BlockSparseAttention`) is recognized,
  replacing the deprecated kijai `SolAttnPatch` entry. Its `method` is a DynamicCombo,
  so recognition now resolves the dotted inputs an API export stores for those
  (`selection.tau`) from the chosen option's schema.
- Spectrum MiniMax H3 exposes **model-aware mode** and its **risk threshold**.

### Changed

- A ComfyUI run that goes over its sampler steps twice now shows it on the card:
  **pass 1 of 2 · step 8/25** instead of **step 8/50**, with the bar and time left
  for the current pass. The time left used to assume the fast second pass took as
  long as the first. This applies to MiniMax H3 workflows using Spectrum with
  **Offline smoothing replay** on; other nodes can opt in through a new
  `progress_passes` field in `node_types/`.
- Extra LoRAs splice onto the workflow's model loader (or the last LoRA already
  stacked on it) instead of wherever the model chain was first found, so they sit
  **ahead of** MODEL patches like attention backends, sparse attention and Spectrum
  rather than between those and the sampler.
- A ComfyUI number input whose step `/object_info` doesn't describe now accepts
  decimals instead of being rounded to whole numbers by the browser.

## [1.0.0] - 2026-09-13

First versioned release. GENie is a local front-end and project manager for your own
ComfyUI, with kie.ai cloud models (Seedance video, Seedream images) as an optional
second path.

### Highlights

- **Zero-authoring ComfyUI workflows** — drop a raw *File → Export (API)* `.json` in
  `workflows/` and the form is built from recognized nodes, one collapsible section
  per node. Support for a node type is a small JSON file in `node_types/`.
- **Projects, History and gallery** — every run (local or cloud) is filed per project
  with its prompt, settings, references and result, with Re-import, Re-run and Export.
- **Live runs** — sampler progress, latent previews, host CPU/GPU/VRAM stats, dynamic
  LoRAs, on/off toggles for optional patch nodes, and Continue for stateful workflows.
- **kie.ai cloud (optional)** — Seedance 2.5 / 2 / 2 Fast / 2 Mini and Seedream 5.0
  Lite / Pro, with a live credit balance and measured cost estimates.

### Added in the run-up to 1.0.0

- **Batches for kie.ai** — the ×N counter beside Generate queues up to 20 identical
  runs in one click. Reference media is uploaded once and shared by the batch, one
  task per run is created (spaced to stay under kie.ai's rate limit), and the cost
  estimate shows the batch total.
- **Runs without a kie.ai key** — GENie now starts and works as a ComfyUI-only
  front-end. The kie.ai models are listed but disabled with a hint, the credit pills
  are hidden, and kie.ai routes return a clear "no key configured" error.
- **New recognized nodes** — `PathchSageAttentionKJ`, `ModelAttentionBackend`,
  `SolAttnPatch`, `SpectrumApplyMiniMaxH3` and `VHS_VideoCombine`.
- **Recognition features** — a `node_types` entry can mark a node `bypassable` (and
  `bypassed_by_default`) so a raw export gets an on/off toggle; `BOOLEAN` inputs render
  as checkboxes; per-format widgets (VHS `crf` / `pix_fmt`) pick up their options and
  ranges from ComfyUI.
- **Version in the footer** — the page footer shows the running version and links
  here.

### Changed

- The Model dropdown lists **Local · ComfyUI** first, with the cloud models grouped
  under **kie.ai API**.
- The header balance is labelled **kie.ai credits**.
- Phone layout: the header stacks under the title, and page, form and section padding
  is thinner.
- A section's only control no longer repeats the section's name as its label (e.g.
  "Prompt" inside Prompt), and prompt boxes open at 15 rows.
- The "Prompt tags — …" summary under MiniMax H3 references is gone; each thumbnail
  still shows its tag.
- The shipped `MiniMax_H3_Ref2Video.json` workflow is now `MiniMax H3 Ref2Video Basic`,
  alongside a new `MiniMax H3 Ref2Video Advanced`. History runs of the old name can't
  be re-imported.

### Fixed

- The server exited at startup without `KIE_API_KEY`, although the docs called the
  key optional.
- A long ComfyUI workflow name (no spaces) widened the whole page on phones.
- The ComfyUI ×N and Preview controls, and the History header, ran off narrow screens.
- A failed run's long error message (e.g. kie.ai's "Timeout while downloading url=…")
  took over its History card and crushed the buttons beside it.

[Unreleased]: https://github.com/resiz3d/genie-ui/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/resiz3d/genie-ui/releases/tag/v1.0.0
