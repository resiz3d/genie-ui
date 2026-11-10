// =========================================================================
// ComfyUI graph → API format conversion.
//
// ComfyUI saves a workflow in the editor's *graph* format (nodes with positional
// `widgets_values`, a separate `links` table, subgraph definitions). What /prompt
// runs — and what GENie's recognition reads — is the flat *API* format
// ({ "<id>": { class_type, inputs } }). ComfyUI only ever does that conversion in
// the browser (graphToPrompt), so importing a saved workflow means redoing it here.
//
// This follows the frontend's rules:
//   - a node's widgets come from its /object_info definition, in input order, and
//     `widgets_values` lines up with them (plus a few frontend-only extras such as
//     the seed's "control after generate" value, which are skipped);
//   - muted nodes vanish, bypassed nodes pass a matching input through, and
//     frontend-only nodes (Reroute, Get/Set, PrimitiveNode, notes) are resolved away;
//   - subgraphs are flattened, inner nodes taking ids like "12:7".
//
// It is a pure function of (graph, objectInfo): no I/O, nothing written back.
// Anything it can't convert faithfully is reported in `errors` (the caller should
// refuse the import) or `warnings` (converted, but worth a look) — never guessed
// silently.
// =========================================================================

const MODE_NEVER = 2;
const MODE_BYPASS = 4;

// Frontend-only node types that forward their input to whoever reads their output.
const PASSTHROUGH_TYPES = new Set(["Reroute", "Reroute (rgthree)"]);
// Named wires: a "get" node reads whatever feeds the "set" node of the same name.
const SET_TYPES = new Set(["SetNode", "easy setNode"]);
const GET_TYPES = new Set(["GetNode", "easy getNode"]);
// Holds a literal that the frontend copies into the widgets it's wired to.
const PRIMITIVE_TYPE = "PrimitiveNode";

// Values the frontend stores in widgets_values for widgets that never reach the
// prompt: the seed control, and the upload button on file pickers.
const CONTROL_VALUES = new Set(["fixed", "increment", "decrement", "randomize"]);
const UPLOAD_VALUES = new Set(["image", "video", "audio", "upload"]);

const SEED_NAMES = new Set(["seed", "noise_seed"]);
const PLAIN_KINDS = ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"];

// --- Widget layout from /object_info ------------------------------------------

function inputSpecs(def) {
  const out = [];
  const input = def?.input || {};
  for (const section of ["required", "optional"]) {
    const specs = input[section] || {};
    const order = def?.input_order?.[section] || Object.keys(specs);
    for (const name of order) {
      if (specs[name]) out.push({ name, spec: specs[name] });
    }
  }
  return out;
}

// The widget kind an input gets in the editor, or null when it is socket-only.
function widgetKind(spec) {
  const [type, opts] = spec;
  if (opts?.forceInput) return null;
  if (Array.isArray(type)) return "COMBO";
  // A multi-type socket ("FLOAT,INT") names the widget it shows.
  if (PLAIN_KINDS.includes(opts?.widgetType)) return opts.widgetType;
  if (type === "INT:seed") return "INT";
  if (PLAIN_KINDS.includes(type)) return type;
  if (type === "COMFY_DYNAMICCOMBO_V3") return "DYNAMIC";
  return null;
}

// The ordered widgets a node of this definition shows. `prefix` nests the inputs a
// dynamic combo reveals for its selected option ("resize_type.width").
function widgetSpecs(def, prefix = "") {
  return specsFromList(inputSpecs(def), prefix);
}

function specsFromList(list, prefix) {
  const out = [];
  for (const { name, spec } of list) {
    const kind = widgetKind(spec);
    if (!kind) continue;
    const [type, opts = {}] = spec;
    const w = { name: prefix + name, kind, opts };
    if (kind === "COMBO") w.options = Array.isArray(type) ? type : opts.options || [];
    if (kind === "DYNAMIC") {
      w.options = (opts.options || []).map((o) => o.key);
      w.branches = opts.options || [];
    }
    w.control =
      !!opts.control_after_generate ||
      ((kind === "INT" || type === "INT:seed") && SEED_NAMES.has(name));
    out.push(w);
  }
  return out;
}

function branchSpecs(w, value) {
  const branch = (w.branches || []).find((b) => b.key === value);
  if (!branch) return [];
  const list = [];
  for (const section of ["required", "optional"]) {
    for (const [name, spec] of Object.entries(branch.inputs?.[section] || {}))
      list.push({ name, spec });
  }
  return specsFromList(list, `${w.name}.`);
}

function compatible(w, v) {
  switch (w.kind) {
    case "INT":
    case "FLOAT":
      return typeof v === "number";
    case "BOOLEAN":
      return typeof v === "boolean";
    case "STRING":
      return typeof v === "string";
    case "COMBO":
    case "DYNAMIC":
      if (v === null || typeof v === "object") return false;
      // A seed-control word sitting where a combo is expected is a leftover extra,
      // unless the combo really offers it.
      if (CONTROL_VALUES.has(v) && w.options?.length && !w.options.includes(v))
        return false;
      return true;
    default:
      return false;
  }
}

const looksExtra = (v) =>
  v === null || v === undefined || CONTROL_VALUES.has(v) || UPLOAD_VALUES.has(v);

// Leftover values that are plainly display state (a preview's URL, an empty text
// box, a comparer's image list) rather than a setting worth mentioning.
const trivialLeftover = (v) =>
  looksExtra(v) ||
  v === "" ||
  typeof v === "boolean" ||
  (typeof v === "object" && !Array.isArray(v)) ||
  (typeof v === "string" && /^\/?(api\/)?view\?/.test(v));

// What a widget holds when the saved workflow predates it.
function defaultFor(w) {
  if (w.opts.default !== undefined) return w.opts.default;
  if ((w.kind === "COMBO" || w.kind === "DYNAMIC") && w.options?.length) return w.options[0];
  return undefined;
}

// Defaults for every widget in `specs`, expanding a dynamic combo's default branch.
function defaultsFor(specs) {
  const out = {};
  for (const w of specs) {
    const v = defaultFor(w);
    if (v === undefined) continue;
    out[w.name] = v;
    if (w.kind === "DYNAMIC") Object.assign(out, defaultsFor(branchSpecs(w, v)));
  }
  return out;
}

// Line `values` (a node's positional widgets_values) up with its widgets. Returns
// { values: {name: value}, exact } or null when no consistent reading exists.
// `exact` is false when values were left over that look like real settings.
function alignWidgets(specs, values) {
  let budget = 20000; // backtracking guard; real nodes need a few dozen steps
  const walk = (specs, si, vi) => {
    if (--budget < 0) return null;
    if (si >= specs.length) {
      // Trailing leftovers (a removed widget's value, an upload button) are fine.
      const rest = values.slice(vi);
      return { values: {}, exact: rest.every(trivialLeftover) };
    }
    // Out of saved values: the remaining widgets were added to the node after this
    // workflow was saved, and take their defaults (as they do when ComfyUI loads it).
    if (vi >= values.length) return { values: defaultsFor(specs.slice(si)), exact: true };
    const w = specs[si];
    const v = values[vi];
    if (compatible(w, v)) {
      let rest = specs.slice(si + 1);
      if (w.kind === "DYNAMIC") rest = [...branchSpecs(w, v), ...rest];
      // The control value follows its widget; prefer consuming it when declared.
      const tries = [];
      const next = values[vi + 1];
      if (w.control && CONTROL_VALUES.has(next)) tries.push(vi + 2);
      tries.push(vi + 1);
      for (const nv of tries) {
        const r = walk(rest, 0, nv);
        if (r) return { values: { [w.name]: v, ...r.values }, exact: r.exact };
      }
    }
    // Otherwise this value may belong to a frontend-only widget: skip it.
    if (looksExtra(v)) return walk(specs, si, vi + 1);
    return null;
  };
  return walk(specs, 0, 0);
}

// --- Node-specific readers ----------------------------------------------------

// rgthree's Power Lora Loader draws its rows with its own widgets, so nothing in
// /object_info describes them: each row is an object in widgets_values, sent as
// lora_1, lora_2, … (the node reads any input named lora_*).
const POWER_LORA_TYPE = "Power Lora Loader (rgthree)";
function powerLoraInputs(values) {
  const inputs = {};
  let n = 0;
  for (const v of values) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    if (v.type === "PowerLoraLoaderHeaderWidget") inputs.PowerLoraLoaderHeaderWidget = { type: v.type };
    else if ("lora" in v) {
      const row = { on: !!v.on, lora: v.lora, strength: v.strength };
      if (v.strengthTwo != null) row.strengthTwo = v.strengthTwo;
      inputs[`lora_${++n}`] = row;
    }
  }
  inputs["➕ Add Lora"] = "";
  return inputs;
}

// ComfyUI's editor rewrites some text when it queues a run; the server never sees
// the original. Do the part that has a server-side equivalent, flag the rest.
const DATE_TOKENS = { yyyy: "%year%", MM: "%month%", dd: "%day%", hh: "%hour%", mm: "%minute%", ss: "%second%" };
function editorText(value, w, where, warn) {
  if (typeof value !== "string") return value;
  let out = value;
  out = out.replace(/%date:([^%]+)%/g, (whole, fmt) => {
    const mapped = fmt.replace(/yyyy|MM|dd|hh|mm|ss/g, (t) => DATE_TOKENS[t]);
    if (/[A-Za-z]/.test(mapped.replace(/%[a-z]+%/g, "")))
      warn(`${where}: its ${whole} pattern uses parts only ComfyUI's editor fills in — check the filename.`);
    return mapped;
  });
  if (w?.opts?.dynamicPrompts && /\{[^{}]*\|[^{}]*\}/.test(out))
    warn(
      `${where}: uses ComfyUI's {a|b} random-choice syntax, which only ComfyUI's editor expands — GENie sends the text as written.`,
    );
  return out;
}

// --- Graph model ----------------------------------------------------------------

function normLink(l) {
  if (Array.isArray(l))
    return { id: l[0], origin_id: l[1], origin_slot: l[2], target_id: l[3], target_slot: l[4], type: l[5] };
  return l;
}

// One graph scope: the root workflow or a subgraph definition.
class Scope {
  constructor(data) {
    this.data = data;
    this.nodes = new Map();
    for (const n of data.nodes || []) this.nodes.set(String(n.id), n);
    this.links = new Map();
    for (const raw of data.links || []) {
      if (!raw) continue;
      const l = normLink(raw);
      this.links.set(l.id, l);
    }
  }
}

function typesConnect(a, b) {
  const any = (t) => t === "*" || t === "" || t === 0 || t == null;
  if (any(a) || any(b)) return true;
  const A = String(a).toLowerCase().split(",");
  const B = String(b).toLowerCase().split(",");
  return A.some((t) => B.includes(t));
}

const isLinkValue = (v) =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && Number.isInteger(v[1]);

// Arrays as literal values are wrapped so the server can tell them from links.
const wrapValue = (v) => (Array.isArray(v) ? { __value__: v } : v);

/**
 * Convert a saved ComfyUI workflow (graph format) to API format.
 * @param {object} graph       the saved workflow JSON
 * @param {object} objectInfo  ComfyUI's /object_info
 * @returns {{ prompt: object, warnings: string[], errors: string[] }}
 */
export function graphToApi(graph, objectInfo) {
  const warnings = [];
  const errors = [];
  const warn = (m) => warnings.includes(m) || warnings.push(m);
  const fail = (m) => errors.includes(m) || errors.push(m);
  const missing = new Set(); // node types in use that /object_info doesn't know

  if (!graph || !Array.isArray(graph.nodes))
    return { prompt: {}, warnings, errors: ["Not a ComfyUI workflow (no nodes list)."] };

  const subgraphDefs = new Map();
  for (const d of graph.definitions?.subgraphs || []) subgraphDefs.set(d.id, d);
  const scopeCache = new Map();
  const scopeFor = (def) => {
    if (!scopeCache.has(def.id)) scopeCache.set(def.id, new Scope(def));
    return scopeCache.get(def.id);
  };
  const root = new Scope(graph);

  if (graph.extra?.groupNodes && Object.keys(graph.extra.groupNodes).length) {
    const used = graph.nodes.some((n) => /^workflow[/>]/.test(n.type || ""));
    if (used)
      fail(
        "Uses legacy group nodes, which can't be imported. In ComfyUI, convert them to subgraphs (or ungroup them) and save.",
      );
  }

  // A context is one instantiated node: its scope, the path of subgraph instances
  // leading to it, and (inside a subgraph) the instance context it belongs to.
  const ctxs = new Map(); // flattened id → ctx
  const label = (ctx) => `${ctx.node.title || ctx.node.type} (node ${ctx.id})`;

  const build = (scope, path, parent, depth) => {
    if (depth > 20) return fail("Subgraphs are nested too deeply (or recursively).");
    for (const node of scope.nodes.values()) {
      const id = [...path, node.id].join(":");
      const ctx = { id, node, scope, path, parent, def: subgraphDefs.get(node.type) || null };
      ctxs.set(id, ctx);
      const mode = node.mode || 0;
      if (ctx.def && mode !== MODE_NEVER && mode !== MODE_BYPASS)
        build(scopeFor(ctx.def), [...path, node.id], ctx, depth + 1);
    }
  };
  build(root, [], null, 0);

  const siblingCtx = (ctx, nodeId) => ctxs.get([...ctx.path, nodeId].join(":"));
  const inputLink = (ctx, slot) => {
    const linkId = ctx.node.inputs?.[slot]?.link;
    return linkId == null ? null : ctx.scope.links.get(linkId) || null;
  };

  // The promoted-widget values a subgraph instance carries, keyed two ways:
  // by its own input name, and by "<innerNodeId>:<widgetName>" for inner widgets
  // shown on the instance without a socket.
  const instanceValues = (ctx) => {
    if (ctx.promoted) return ctx.promoted;
    const byInput = new Map();
    const byInner = new Map();
    const wv = ctx.node.widgets_values;
    const proxies = ctx.node.properties?.proxyWidgets;
    if (Array.isArray(wv)) {
      if (Array.isArray(proxies) && proxies.length) {
        proxies.forEach((p, i) => {
          if (!Array.isArray(p) || i >= wv.length) return;
          const [nodeId, name] = p;
          if (String(nodeId) === "-1") byInput.set(name, wv[i]);
          else byInner.set(`${nodeId}:${name}`, wv[i]);
        });
      } else {
        // One value per subgraph input that lands on a widget inside, in the
        // definition's input order (the instance's own input list can be partial).
        const scope = scopeFor(ctx.def);
        const names = (ctx.def.inputs || [])
          .filter((sgInput) =>
            (sgInput.linkIds || []).some((id) => {
              const link = scope.links.get(id);
              const target = link && scope.nodes.get(String(link.target_id));
              return !!target?.inputs?.[link.target_slot]?.widget;
            }),
          )
          .map((sgInput) => sgInput.name);
        names.forEach((name, i) => i < wv.length && byInput.set(name, wv[i]));
      }
    }
    ctx.promoted = { byInput, byInner };
    return ctx.promoted;
  };

  // Resolve what feeds input `slot` of `ctx`. Returns { id, slot } for a real
  // upstream output, { value } for a literal, or null when nothing reaches it.
  const resolveInput = (ctx, slot, seen, type) => {
    const key = `${ctx.id}[I]${slot}`;
    if (seen.has(key)) {
      fail(`Circular link while resolving ${label(ctx)}.`);
      return null;
    }
    seen.add(key);
    const input = ctx.node.inputs?.[slot];
    if (!input) return null;
    const link = inputLink(ctx, slot);
    if (!link) return null;
    const wantType = type ?? input.type;

    // Fed from the subgraph's own input: continue outside, on the instance node.
    const inId = ctx.scope.data.inputNode?.id ?? -10;
    if (ctx.parent && link.origin_id === inId) {
      const inst = ctx.parent;
      const sgInput = inst.def.inputs?.[link.origin_slot];
      if (!sgInput) return null;
      const outerSlot = (inst.node.inputs || []).findIndex((i) => i.name === sgInput.name);
      if (outerSlot !== -1 && inputLink(inst, outerSlot)) return resolveInput(inst, outerSlot, seen);
      const { byInput } = instanceValues(inst);
      return byInput.has(sgInput.name) ? { value: byInput.get(sgInput.name) } : null;
    }

    const src = siblingCtx(ctx, link.origin_id);
    if (!src) return null;
    return resolveOutput(src, link.origin_slot, wantType, seen);
  };

  const resolveOutput = (ctx, slot, type, seen) => {
    const key = `${ctx.id}[O]${slot}`;
    if (seen.has(key)) {
      fail(`Circular link while resolving ${label(ctx)}.`);
      return null;
    }
    seen.add(key);
    const { node } = ctx;
    const mode = node.mode || 0;
    if (mode === MODE_NEVER) return null;
    if (mode === MODE_BYPASS) {
      const inputs = node.inputs || [];
      const outType = node.outputs?.[slot]?.type;
      let idx;
      if (type === "*" || type === "") idx = inputs.length > slot ? slot : 0;
      else if (inputs[slot] && typesConnect(inputs[slot].type, outType) && typesConnect(inputs[slot].type, type))
        idx = slot;
      else {
        idx = inputs.findIndex((i) => i.type === type);
        if (idx === -1)
          idx = inputs.findIndex((i) => typesConnect(i.type, outType) && typesConnect(i.type, type));
      }
      if (idx === -1 || !inputs[idx]) return null;
      return resolveInput(ctx, idx, seen);
    }

    if (ctx.def) {
      // A subgraph instance: follow the definition's output back to an inner node.
      const scope = scopeFor(ctx.def);
      const linkId = ctx.def.outputs?.[slot]?.linkIds?.[0];
      const link = linkId == null ? null : scope.links.get(linkId);
      if (!link) return null;
      const inId = ctx.def.inputNode?.id ?? -10;
      if (link.origin_id === inId) {
        // Output wired straight to an input of the subgraph.
        const sgInput = ctx.def.inputs?.[link.origin_slot];
        const outerSlot = (node.inputs || []).findIndex((i) => i.name === sgInput?.name);
        return outerSlot === -1 ? null : resolveInput(ctx, outerSlot, seen, type);
      }
      const inner = ctxs.get(`${ctx.id}:${link.origin_id}`);
      return inner ? resolveOutput(inner, link.origin_slot, type, seen) : null;
    }

    if (PASSTHROUGH_TYPES.has(node.type) || SET_TYPES.has(node.type))
      return resolveInput(ctx, 0, seen, type);

    if (GET_TYPES.has(node.type)) {
      const name = Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined;
      const setter = [...ctx.scope.nodes.values()].find(
        (n) => SET_TYPES.has(n.type) && Array.isArray(n.widgets_values) && n.widgets_values[0] === name,
      );
      if (!setter) {
        warn(`${label(ctx)} reads "${name}", but no Set node with that name exists.`);
        return null;
      }
      return resolveInput(siblingCtx(ctx, setter.id), 0, seen, type);
    }

    if (node.type === PRIMITIVE_TYPE) {
      const v = Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined;
      return v === undefined ? null : { value: v };
    }

    if (!objectInfo[node.type]) {
      missing.add(node.type);
      return null;
    }
    return { id: ctx.id, slot };
  };

  // --- Emit ---------------------------------------------------------------------

  const prompt = {};
  for (const ctx of ctxs.values()) {
    const { node } = ctx;
    const mode = node.mode || 0;
    if (mode === MODE_NEVER || mode === MODE_BYPASS) continue;
    if (ctx.def) continue; // flattened into its inner nodes
    const type = node.type;
    if (
      PASSTHROUGH_TYPES.has(type) ||
      SET_TYPES.has(type) ||
      GET_TYPES.has(type) ||
      type === PRIMITIVE_TYPE
    )
      continue;

    const def = objectInfo[type];
    if (!def) {
      // Notes, labels and other canvas furniture have no links; anything wired in
      // is a real node this ComfyUI doesn't have.
      const wired =
        (node.inputs || []).some((i) => i.link != null) ||
        (node.outputs || []).some((o) => o.links?.length);
      if (wired) missing.add(type);
      continue;
    }

    const inputs = {};
    const specs = widgetSpecs(def);
    const wv = node.widgets_values;
    if (type === POWER_LORA_TYPE && Array.isArray(wv)) {
      Object.assign(inputs, powerLoraInputs(wv));
    } else if (wv && !Array.isArray(wv) && typeof wv === "object") {
      // Some node packs (VideoHelperSuite) save widget values by name. Keep the
      // ones the definition knows, plus format-specific extras it reveals at runtime.
      const known = new Set(inputSpecs(def).map((s) => s.name));
      for (const [k, v] of Object.entries(wv)) {
        if (v !== null && typeof v === "object" && !Array.isArray(v)) continue; // preview state
        if (!known.has(k) && UPLOAD_VALUES.has(v)) continue; // the upload button
        inputs[k] = wrapValue(v);
      }
    } else if (specs.length) {
      const values = Array.isArray(wv) ? wv : [];
      const aligned = alignWidgets(specs, values);
      if (aligned) {
        const byName = new Map(specs.map((w) => [w.name, w]));
        for (const [k, v] of Object.entries(aligned.values))
          inputs[k] = wrapValue(editorText(v, byName.get(k), label(ctx), warn));
        if (!aligned.exact)
          warn(`${label(ctx)}: has editor-only settings GENie can't read — they were left out.`);
      } else {
        // No consistent reading. Take defaults so the node is at least valid, keep
        // the values that still fit by position, and say so. A linked input below
        // still overrides whatever lands here.
        Object.assign(inputs, defaultsFor(specs));
        specs.forEach((w, i) => {
          if (values[i] !== undefined && compatible(w, values[i])) inputs[w.name] = wrapValue(values[i]);
        });
        warn(
          `${label(ctx)}: its saved settings don't match the installed version of "${type}" — check them before running.`,
        );
      }
    }

    // Inner widgets a subgraph instance shows directly override the definition's.
    if (ctx.parent) {
      const { byInner } = instanceValues(ctx.parent);
      for (const w of specs) {
        const k = `${node.id}:${w.name}`;
        if (byInner.has(k) && byInner.get(k) != null) inputs[w.name] = wrapValue(byInner.get(k));
      }
    }

    (node.inputs || []).forEach((input, slot) => {
      if (input.link == null) return;
      const r = resolveInput(ctx, slot, new Set());
      if (!r) return;
      if ("value" in r) {
        if (r.value !== undefined) inputs[input.name] = wrapValue(r.value);
      } else inputs[input.name] = [r.id, r.slot];
    });

    prompt[ctx.id] = {
      inputs,
      class_type: type,
      _meta: { title: node.title || def.display_name || type },
    };
  }

  // Links to nodes that didn't make it into the prompt are dropped, as ComfyUI does.
  for (const { inputs } of Object.values(prompt)) {
    for (const [k, v] of Object.entries(inputs))
      if (isLinkValue(v) && !Object.hasOwn(prompt, v[0])) delete inputs[k];
  }

  if (missing.size)
    fail(
      `Uses node types that aren't installed in ComfyUI: ${[...missing].sort().join(", ")}. Install them (or remove those nodes) and try again.`,
    );
  if (!errors.length && !Object.keys(prompt).length)
    errors.push("The workflow has no runnable nodes.");
  if (!errors.length && !Object.values(prompt).some((n) => objectInfo[n.class_type]?.output_node))
    warn("No output node (Save Image, Video Combine, …) was found — GENie needs one to collect a result.");

  return { prompt, warnings, errors };
}
