# Node types — the recognition library

GENie can drive its form from a **raw ComfyUI API export** — no `{{token}}`
authoring required. It does that by recognizing nodes **by `class_type`** and
turning their inputs into form controls. This folder is the library that makes
that possible: one small JSON file per node type (or a group of related ones).

Adding support for a new node is **a new file here** — no server code. Drop it
in, reload, done. The engine ([`../comfy-recognize.js`](../comfy-recognize.js))
never needs to grow for a new node; entries only reference the fixed primitives
below.

> This also replaces the old single `comfyui_known_nodes.json`. Reference-only
> metadata for custom nodes still lives here too (see `apply_vdn_h3.json`) — an
> entry doesn't need a `recognize` block to be a useful reference.

## File shape

Each file holds one or more entries under `nodes`, keyed by ComfyUI `class_type`:

```jsonc
{
  "nodes": {
    "KSampler": { "recognize": { "variants": [ … ] } }
  }
}
```

A later-loaded file wins a duplicate `class_type` (with a console warning), so a
user drop-in can override a shipped entry — the same shipped-vs-yours idea as
`workflows/`.

## Entry fields

| Field | Meaning |
| --- | --- |
| `display_name` | Human label (reference/UI only). |
| `output` | `true` marks a terminal/sink node (SaveImage, VideoCombine). The `feeds_output` predicate walks toward these. |
| `value_source` | `{ "input": "value" }` — marks a passthrough value provider (a Primitive\*). When another node's exposed input is *wired from* this node, recognition follows the link here to the real editable value. |
| `recognize` | How this node becomes controls (below). |
| _anything else_ | Free-form reference metadata (schema, install notes, tokenize hints). Ignored by the engine. |

## `recognize`

```jsonc
"recognize": {
  "variants": [
    {
      "match": [ { "when": "feeds_output" }, { "when": "only" } ],
      "expose": {
        "seed":  { "name": "seed",  "label": "Seed",  "control": "number", "width": "1/3", "order": 10 },
        "steps": { "name": "steps", "label": "Steps", "control": "number", "width": "1/3", "order": 11 }
      }
    }
  ]
}
```

- **`variants`** are tried in order; the first whose `match` passes claims the
  node. Use multiple variants when the same class means different things in
  different wiring (e.g. a `CLIPTextEncode` is the *positive* or *negative*
  prompt depending on which KSampler input it feeds).
- **`match`** is an array of predicates; the variant matches when **any** passes
  (OR). Shorthand: an entry with `recognize.inputs` (no `variants`) is treated as
  one always-matching variant.
- **`group`** (optional, per variant) is the label for the collapsible section the
  variant's controls render under in the UI — one section per matched node
  instance (e.g. `"Prompt"`, `"KSampler"`, `"Latent Image"`). Omit it and the
  label falls back to the entry's `display_name`, then the node's `_meta.title`,
  then the `class_type`. (Grouped sections are shown only for recognized/raw
  workflows; tokenized workflows keep the flat form.)
- **`expose`** maps a node **input key** → a control. Only listed inputs become
  controls; everything else is left alone. If an exposed input is wired from
  another node, recognition follows the link to the editable value (see
  `value_source`); if it leads somewhere non-editable, the control is silently
  skipped.

### `expose` control fields

| Field | Meaning |
| --- | --- |
| `name` | The control's form key (defaults to the input key). Reuse the token naming heuristics: a name containing `seed` gets the seed widget, `prompt` gets a multi-line box, numeric names get number boxes. Duplicate names are auto-suffixed `_2`, `_3`. |
| `label` | Display label. |
| `control` | `number` \| `text` \| `combo` \| `seed` \| `media` \| `toggle`. Combos/numbers still enrich from ComfyUI `/object_info` (installed files, real min/max). |
| `multiline` | `true` with `control: "text"` for a textarea. |
| `options` | Inline dropdown choices, if you don't want `/object_info` to fill them. |
| `width` | Grid span: `full`, `1/2`, `1/3`, `1/4`, `2/3`, `3/4`. |
| `order` | Sort position (ascending). |

## Match predicates (the closed set)

| `when` | Passes when… |
| --- | --- |
| `any` | always (expose every instance). |
| `only` | there is exactly one node of this `class_type` in the workflow. |
| `feeds_output` | a path runs forward from this node to any `output: true` node. |
| `produces` + `target: "Class.input"` | this node is the **direct** upstream producer of that input on some node of that class (e.g. `KSampler.positive`). Direct, not transitive — so a node reaching the sampler only through a `ConditioningZeroOut` does **not** match. |
| `title_matches` + `pattern` | the node's `_meta.title` matches the (case-insensitive) regex. |

Precedence with explicit tokens: if a workflow also has a `{{token}}` of the same
`name`, the **token wins** and the recognized control is dropped. So a tokenized
workflow keeps behaving exactly as before.
