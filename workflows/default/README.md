# Default workflows

The `.json` files in this folder are the ComfyUI workflows **GENie ships with**.
They load automatically in the app's Model dropdown (whenever ComfyUI is running).

## They ship without file names

The model, CLIP, VAE and reference-image fields in these workflows are **left
empty on purpose**: the nodes are what matters, and the files are yours. GENie
fills each dropdown from what ComfyUI actually has installed, and an empty
reference slot is dropped from the graph rather than sent, so a default runs
without hunting for someone else's files.

Pick your own in the form — GENie remembers the choice per workflow. For
reference, these were built against:

| Workflow | Diffusion model | CLIP | VAE |
| --- | --- | --- | --- |
| Anima | `anima-base-v1.0` | `qwen_3_06b_base` | `qwen_image_vae` |
| Krea2 | `krea2_turbo_fp8_scaled` | `qwen3vl_4b_fp8_scaled` | `qwen_image_vae` |
| MiniMax H3 Ref2Video (Basic) | `minimax_h3_fastvideo_vsa_datafree_1300step_4step_int8_convrot` | `qwen3vl_32b_minimax_h3_nvfp4_awq` | `minimax_h3_video_vae_fp16` + `minimax_h3_audio_vae_fp32` |
| MiniMax H3 Ref2Video (Advanced) | `Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8` | `qwen3vl_32b_minimax_h3_nvfp4_awq` | `minimax_h3_video_vae_fp16` + `minimax_h3_audio_vae_fp32` |
| Qwen Image 2.1 Image Edit | `qwen_image_2.1_int8_convrot` | `qwen3vl_8b_int8_convrot` | `qwen_image_2.1_vae_bf16` |
| Z-Image Turbo | a Z-Image Turbo checkpoint (e.g. `cyberrealisticZImage_v10`) | `qwen3_4b_fp8_scaled` | `ae` |

The Qwen Image 2.1 edit workflow is the exception: it keeps its four model file names
(only its image slot is empty), because it needs two different text models and a
picker left on the first file in the list fails in a way that's hard to read. If you
don't have a file it names, pick your own in the form. It also loads a second text model for its **prompt
enhancer** — `qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot`, picked under *Prompt
Enhancer Model (LLM)*. It's only loaded while the enhancer is switched on.

Any comparable model works — the table is a starting point, not a requirement.
A workflow of your own that names a file you do have still selects it, even when
it sits in a different subfolder.

## Don't edit these directly

Treat everything in this folder as read-only. A future update to GENie may
**overwrite these files**, so any changes you make here can be lost without warning.

## Customizing a default

To base your own workflow on one of these:

1. **Copy** the `.json` file up one level into [`../`](../) (the `workflows/` folder).
2. **Rename** the copy to something distinct (e.g. `Minimax H3 (my tweaks).json`).
3. Edit that copy. Your version appears in the Model dropdown alongside the
   default, and it's never touched by updates.

A file in `workflows/` with the **same name** as one here **overrides** the
shipped default. Giving your copy a **new name** keeps both — which is the
recommended approach.

See [`../README.md`](../README.md) for more on custom workflows, and
[`../../docs/COMFYUI.md`](../../docs/COMFYUI.md) for the ComfyUI integration.
