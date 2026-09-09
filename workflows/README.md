# Workflows

This is where your **custom ComfyUI workflows** live. Any `.json` file you drop in
this folder — or in a subfolder of it — shows up in GENie's Model dropdown, so you can
run it from the same UI as the kie.ai cloud models.

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

## Subfolders, and installing a workflow repo

Subfolders work as well as loose files, so a published set of workflows installs the
same way a ComfyUI node pack does:

```
cd workflows
git clone https://github.com/someone/their-workflows.git
```

Reload the app and its files appear in the Model dropdown as
`their-workflows/<name>`, and `git pull` updates them in place. Nested folders are
scanned too (up to 5 deep). `.git` and other dot-folders, `node_modules` and
`__pycache__` are skipped, and symlinks aren't followed.

Two things to know:

- A workflow in a subfolder **never overrides a shipped default** — only a file
  directly in this folder does that. Its identity is its path
  (`their-workflows/Cool Thing.json`), which can't collide with the bare filenames
  used by workflows here and in `default/`.
- Your saved picks for it live in `settings/comfy/their-workflows/<name>.json`. Move a
  workflow to a different folder and it starts from its token defaults again, the same
  as renaming one does — copy the old settings file across to keep them.
