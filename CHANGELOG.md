# Changelog

All notable changes to GENie are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

**Releasing:** bump `version` in `package.json` (the only place the number lives — the
startup log and the page footer read it), move the **Unreleased** notes under a new
heading for that version with the date, commit, then tag the commit `vX.Y.Z`.

## [Unreleased]

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
