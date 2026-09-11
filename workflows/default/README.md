# Default workflows

The `.json` files in this folder are the ComfyUI workflows **GENie ships with**.
They load automatically in the app's Model dropdown (whenever ComfyUI is running).

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
