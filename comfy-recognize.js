// =========================================================================
// Data-driven ComfyUI node recognition.
//
// GENie's original path needs a workflow's values hand-tokenized ({{name=…}}).
// This module lets a *raw* ComfyUI API-format export drive the form instead: it
// walks the graph, matches each node by class_type against the library in
// node_types/*.json, and emits the same control list the token path produces —
// so the frontend renders it with no changes.
//
// The library is the brain. Adding support for a new node type is a new JSON
// file under node_types/ (or a new entry in an existing one); the only code that
// grows is the small closed set of *primitives* below — control kinds, match
// predicates, and value coercion — which node entries reference but never extend.
//
// A node entry describes ONLY the inputs worth exposing, each as a control. When
// an exposed input is wired from another node (a link [id, slot]) rather than a
// literal, we follow it back to the node that actually holds the editable value
// (a Primitive* provider), so e.g. a KSampler-fed CLIPTextEncode whose text comes
// from a PrimitiveStringMultiline exposes that primitive's string.
// =========================================================================
import fs from "fs";
import path from "path";

// --- Library loading ---------------------------------------------------------

// A node entry may live in any node_types/*.json, one file holding one or more
// entries under `nodes` (so related nodes — LoraLoader variants, say — can share
// a file). The map is class_type → entry; a later file wins a duplicate, with a
// warning, so a user drop-in can override a shipped entry the way workflows do.
function readNodeTypeDir(dir) {
  const map = new Map();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return map; // no node_types/ dir — recognition simply finds nothing
  }
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith(".json")) continue;
    if (ent.name.toLowerCase().endsWith(".readme.json")) continue;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(dir, ent.name), "utf8"));
    } catch (err) {
      console.error(`node_types/${ent.name}: not valid JSON — skipped (${err.message})`);
      continue;
    }
    const nodes = doc?.nodes || {};
    for (const [classType, entry] of Object.entries(nodes)) {
      if (map.has(classType)) {
        console.warn(`node_types: duplicate class_type "${classType}" (${ent.name} overrides an earlier file)`);
      }
      map.set(classType, entry);
    }
  }
  return map;
}

// Cache the library, invalidating when any file in the dir changes (mtime/size),
// so a contributor dropping a new node_types/*.json is picked up without a
// restart — matching how the workflows dir hot-loads.
let _cache = { dir: null, sig: null, map: new Map() };
function dirSignature(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json")).sort();
    return files
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return `${f}:${st.mtimeMs}:${st.size}`;
      })
      .join("|");
  } catch {
    return "";
  }
}
export function loadNodeTypes(dir) {
  const sig = dirSignature(dir);
  if (_cache.dir === dir && _cache.sig === sig) return _cache.map;
  _cache = { dir, sig, map: readNodeTypeDir(dir) };
  return _cache.map;
}

// --- Graph helpers -----------------------------------------------------------

// A ComfyUI input value is a link when it's a [sourceNodeId, outputSlot] pair.
function asLink(v) {
  return Array.isArray(v) && v.length === 2 && (typeof v[0] === "string" || typeof v[0] === "number") ? v : null;
}

// Forward edges: producerId → [consumerId, …]. The graph stores links on the
// consumer (input → producer), so we invert once to answer "what does this feed?".
function forwardIndex(workflow) {
  const fwd = new Map();
  for (const [consumerId, node] of Object.entries(workflow || {})) {
    for (const v of Object.values(node?.inputs || {})) {
      const link = asLink(v);
      if (!link) continue;
      const src = String(link[0]);
      if (!fwd.has(src)) fwd.set(src, []);
      fwd.get(src).push(consumerId);
    }
  }
  return fwd;
}

// Coercion type for a literal, so the submitted value can be written back as the
// same JSON type the node originally held (a number stays a number, etc.).
function literalType(v) {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "string";
}

// Follow an exposed input to the node that actually holds its editable value.
// A literal is editable in place. A link is followed to its source; if that
// source is a declared value-provider (a Primitive*), we recurse into the
// provider's own value input. A link into a non-provider is graph-driven and has
// no single editable value — we return null and the input isn't exposed.
function traceEditable(workflow, nodeTypes, nodeId, inputKey, seen = new Set()) {
  const node = workflow[nodeId];
  if (!node) return null;
  const v = node.inputs?.[inputKey];
  const link = asLink(v);
  if (!link) {
    return { id: String(nodeId), input: inputKey, value: v, type: literalType(v) };
  }
  const srcId = String(link[0]);
  if (seen.has(srcId)) return null; // cycle guard
  seen.add(srcId);
  const srcNode = workflow[srcId];
  const provider = srcNode && nodeTypes.get(srcNode.class_type)?.value_source;
  if (!provider?.input) return null; // link into something we can't edit
  return traceEditable(workflow, nodeTypes, srcId, provider.input, seen);
}

// --- Match predicates (closed set) ------------------------------------------
// Each variant's `match` is an array of predicates; the variant claims a node
// when ANY predicate passes (OR). New node entries choose from these; they don't
// invent new ones — a genuinely new predicate is a rare, deliberate code change.
function nodeMatches(pred, ctx) {
  const { workflow, fwd, nodeTypes, nodeId } = ctx;
  switch (pred.when) {
    case "any":
      return true;
    case "only": {
      const cls = workflow[nodeId].class_type;
      let n = 0;
      for (const node of Object.values(workflow)) if (node.class_type === cls) n++;
      return n === 1;
    }
    case "feeds_output":
      return feedsOutput(ctx);
    case "produces":
      return producesTarget(workflow, nodeId, pred.target);
    case "title_matches": {
      const title = workflow[nodeId]?._meta?.title;
      if (typeof title !== "string" || !pred.pattern) return false;
      try {
        return new RegExp(pred.pattern, "i").test(title);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

// True when `nodeId` is the DIRECT upstream producer of `Class.input` on some
// node of that class — e.g. "produces KSampler.positive" is the node wired
// straight into a KSampler's positive input. Direct (not transitive) is what
// separates the real positive prompt from a node that only reaches it through a
// ConditioningZeroOut.
function producesTarget(workflow, nodeId, target) {
  if (!target || !target.includes(".")) return false;
  const dot = target.indexOf(".");
  const cls = target.slice(0, dot);
  const input = target.slice(dot + 1);
  for (const node of Object.values(workflow)) {
    if (node.class_type !== cls) continue;
    const link = asLink(node.inputs?.[input]);
    if (link && String(link[0]) === String(nodeId)) return true;
  }
  return false;
}

function feedsOutput(ctx) {
  const { workflow, fwd, nodeTypes, nodeId } = ctx;
  const stack = [String(nodeId)];
  const visited = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const node = workflow[cur];
    if (node && nodeTypes.get(node.class_type)?.output) return true;
    for (const next of fwd.get(cur) || []) stack.push(next);
  }
  return false;
}

// --- Recognition -------------------------------------------------------------

// Normalize an entry's recognize block to a list of variants. Shorthand
// `recognize.inputs` (no gating) becomes a single `any` variant.
function variantsOf(entry) {
  const rec = entry?.recognize;
  if (!rec) return [];
  if (Array.isArray(rec.variants)) return rec.variants;
  if (rec.inputs) return [{ match: [{ when: "any" }], expose: rec.inputs }];
  return [];
}

// Walk the workflow and produce a control per exposed, editable input. Each
// control mirrors the token shape the frontend already renders — {name, default,
// options, width, order} — plus `owner` (the node/input whose /object_info
// describes it, for combo/number enrichment) and `targets` (where the value is
// written at submit). Names are made unique with numeric suffixes.
//
// Returns { controls: [...] }. Pure and offline: no ComfyUI needed.
export function recognizeWorkflow(workflow, nodeTypes) {
  if (!workflow || typeof workflow !== "object") return { controls: [] };
  const fwd = forwardIndex(workflow);
  const controls = [];
  const usedNames = new Map(); // base name → count, for de-duping

  // Stable order: by numeric node id when possible, so control order is
  // deterministic before per-control `order` hints re-sort in the UI.
  const ids = Object.keys(workflow).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : String(a).localeCompare(String(b));
  });

  for (const nodeId of ids) {
    const node = workflow[nodeId];
    const entry = nodeTypes.get(node?.class_type);
    if (!entry) continue;
    const variants = variantsOf(entry);
    if (!variants.length) continue;
    const ctx = { workflow, fwd, nodeTypes, nodeId };
    const variant = variants.find((v) => (v.match || [{ when: "any" }]).some((p) => nodeMatches(p, ctx)));
    if (!variant?.expose) continue;

    // Controls from one node instance share a group, so the UI can render them
    // under one collapsible per-node section. The label comes from the variant, the
    // entry's display_name, the node's own title, then the class_type.
    const group = {
      key: String(nodeId),
      label: variant.group || entry.display_name || node._meta?.title || node.class_type,
      collapsed: variant.collapsed === true, // section starts closed (loaders, save node, …)
    };

    for (const [inputKey, spec] of Object.entries(variant.expose)) {
      const traced = traceEditable(workflow, nodeTypes, nodeId, inputKey);
      if (!traced) continue; // graph-driven, nothing editable — skip silently
      const base = spec.name || inputKey;
      // De-dupe: first use keeps the bare name; a second node wanting it gets _2.
      const count = usedNames.get(base) || 0;
      usedNames.set(base, count + 1);
      const name = count === 0 ? base : `${base}_${count + 1}`;
      controls.push({
        name,
        label: spec.label || null,
        default: traced.value == null ? "" : String(traced.value),
        options: Array.isArray(spec.options) ? spec.options : [],
        width: spec.width || null,
        order: Number.isFinite(spec.order) ? spec.order : null,
        multiline: spec.control === "text" && spec.multiline === true ? true : undefined,
        group,
        // The node whose /object_info describes this input's choices/range. For a
        // literal that's the node itself; for a traced value it's still the
        // semantic owner (e.g. KSampler.sampler_name), which is what carries the
        // combo/number metadata.
        owner: { id: String(nodeId), classType: node.class_type, input: inputKey },
        // Where the value is written at submit — the traced editable location.
        targets: [{ id: traced.id, input: traced.input, type: traced.type }],
      });
    }
  }
  return { controls };
}

// Coerce a submitted value to the JSON type the target input originally held, so
// ComfyUI receives a number where it expects one, etc. Empty string on a number
// falls back to leaving the value untouched (handled by the caller).
function coerce(value, type) {
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    return value === "true" || value === "1" || value === 1;
  }
  return value == null ? "" : String(value);
}

// Write recognized control values into a (clone of a) workflow, in place. Only
// controls the caller actually supplied a value for are applied; the rest keep
// the literals already in the JSON. Mirrors substituteWorkflow for the token
// path, but patches typed node inputs directly instead of string placeholders.
export function applyRecognizedValues(workflow, controls, values) {
  if (!controls?.length || !values) return workflow;
  for (const ctrl of controls) {
    if (!(ctrl.name in values)) continue;
    const raw = values[ctrl.name];
    if (raw === undefined || raw === null) continue;
    for (const t of ctrl.targets || []) {
      const node = workflow[t.id];
      if (!node?.inputs) continue;
      node.inputs[t.input] = coerce(raw, t.type);
    }
  }
  return workflow;
}
