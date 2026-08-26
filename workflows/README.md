# Workflows

This is where your **custom ComfyUI workflows** live. Any `.json` file you drop
directly in this folder shows up in GENie's Model dropdown, so you can run it from
the same UI as the kie.ai cloud models.

Running a workflow requires a **running ComfyUI instance** (configure its address
with `COMFYUI_URL` in `.env`; defaults to `http://127.0.0.1:8188`).

## What goes here

- **ComfyUI API-format `.json`** exports (Save → *Export (API)* in ComfyUI).
- Optionally **tokenized** with `{{name=default|opt|opt}}` placeholders, which
  GENie turns into form controls. See
  [`../docs/workflows/tokens.md`](../docs/workflows/tokens.md) for the full token
  reference, or [`../docs/COMFYUI.md`](../docs/COMFYUI.md) for the whole integration.

## Defaults vs. your workflows

- The [`default/`](default/) subfolder holds the workflows **GENie ships with**.
  They also load automatically — you don't need to copy them here to use them.
- To tweak a shipped default, **copy it out of `default/` into this folder under a
  new name** and edit the copy. See [`default/README.md`](default/README.md).
- A file here with the **same name** as a shipped default **overrides** it; a file
  with a **new name** is listed alongside the defaults.

Put your own workflows here; leave `default/` to GENie.
