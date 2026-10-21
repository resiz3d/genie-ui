// --- 🎨 Video effects: PNG overlay layers, desaturation, a new size ---------------
// The form the video editor shows under its clips (and a plugin can reuse, e.g. for
// a batch), plus a rough live preview of it on a <video>. The server (video-editor.js,
// cleanFx) applies the effects in the export's re-encode.
//
// fx: { desat: 0–100, width, height (0 = keep), sizeMode: "fit" | "fill" | "stretch",
//   layers: [{ url, name, clip, pos, scale, opacity, margin }] } — a layer's `clip` is
//   whatever the host's clips() list hands out (null = the whole video); the host maps
//   it to the clip's index when it exports (see forExport).
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const API = "/api/video-editor";

  const blank = () => ({ desat: 0, width: 0, height: 0, sizeMode: "fit", layers: [] });
  const newLayer = (url, name) => ({ url, name, clip: null, pos: "full", scale: 25, opacity: 100, margin: 3 });
  const POSITIONS = [
    ["full", "Full frame (stretched over it)"],
    ["center", "Centre"],
    ["top-left", "Top left"],
    ["top", "Top"],
    ["top-right", "Top right"],
    ["left", "Left"],
    ["right", "Right"],
    ["bottom-left", "Bottom left"],
    ["bottom", "Bottom"],
    ["bottom-right", "Bottom right"],
  ];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const isEmpty = (fx) => !fx || (!fx.desat && !fx.width && !fx.height && !fx.layers.length);

  // The effects in a few words, e.g. "1 overlay · 40% desaturated · 1280×720".
  function summary(fx) {
    if (isEmpty(fx)) return "none";
    return [
      fx.layers.length && plural(fx.layers.length, "overlay"),
      fx.desat && (fx.desat >= 100 ? "black & white" : `${fx.desat}% desaturated`),
      fx.width && fx.height ? `${fx.width}×${fx.height}`
      : fx.width ? `${fx.width} wide`
      : fx.height ? `${fx.height} tall`
      : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  // The fx to send with an export or a saved project: each layer's clip as its index
  // in `list` (indexOf by default), layers on a clip that isn't in it dropped.
  function forExport(fx, list, indexOf = (c) => list.indexOf(c)) {
    const layers = [];
    for (const l of fx.layers) {
      const clip = l.clip == null ? null : indexOf(l.clip);
      if (clip == null || clip >= 0) layers.push({ ...l, clip });
    }
    return { ...fx, layers };
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || `HTTP ${res.status}`);
    return data.data;
  }

  // The form, in `root`. opts: { clips() → [{ ref, label }] | null (no "apply to"
  // choice), projectId() → the project overlay uploads go to, onChange(fx),
  // disabled() → true while the host is busy }.
  function create(root, opts = {}) {
    let fx = blank();
    let recent = null; // the overlays kept so far, once listed
    root.classList.add("vfx");
    root.innerHTML = `
      <details class="vfx-box">
        <summary>🎨 Effects <span class="muted vfx-sum">none</span></summary>
        <div class="vfx-body">
          <div class="vfx-row">
            <span class="vfx-label">Desaturate</span>
            <input type="range" class="vfx-desat" min="0" max="100" step="1" value="0" aria-label="Desaturate" />
            <span class="vfx-num"><input type="number" class="vfx-desatn" min="0" max="100" step="1" value="0" aria-label="Desaturate, percent" />%</span>
          </div>
          <div class="vfx-row">
            <span class="vfx-label">Resize</span>
            <span class="vfx-size">
              <input type="number" class="vfx-w" min="16" max="8192" step="2" placeholder="width" aria-label="Width" />
              ×
              <input type="number" class="vfx-h" min="16" max="8192" step="2" placeholder="height" aria-label="Height" />
            </span>
            <select class="vfx-mode" title="When both are set and the shape changes — Fit adds black bars, Fill crops the edges">
              <option value="fit">Fit — black bars</option>
              <option value="fill">Fill — crop edges</option>
              <option value="stretch">Stretch</option>
            </select>
            <span class="muted vfx-hint">Leave one blank to keep the shape.</span>
          </div>
          <div class="vfx-row vfx-layers-head">
            <span class="vfx-label">Overlays</span>
            <button type="button" class="btn-secondary vfx-add" title="Add a PNG (with transparency) as a layer on top of the video">＋ Image from device…</button>
            <select class="vfx-recent" title="Add an overlay image used before"><option value="">Reuse an overlay…</option></select>
          </div>
          <p class="muted vfx-empty">No overlays. Layers are drawn in order — the last one on top.</p>
          <div class="vfx-layers"></div>
          <p class="sp-save-warn vfx-err hidden"></p>
          <input type="file" class="vfx-file" accept="image/png,image/webp,image/jpeg" multiple hidden />
        </div>
      </details>`;
    const el = {};
    for (const k of ["sum", "desat", "desatn", "w", "h", "mode", "hint", "add", "recent", "empty", "layers", "err", "file"])
      el[k] = $(`.vfx-${k}`, root);
    const box = $(".vfx-box", root);

    let started = false; // the first set() isn't a change
    const changed = () => {
      el.sum.textContent = summary(fx);
      box.classList.toggle("on", !isEmpty(fx));
      el.mode.disabled = !(fx.width && fx.height) || !!opts.disabled?.();
      if (started) opts.onChange?.(fx);
    };
    const showErr = (msg) => {
      el.err.textContent = msg || "";
      el.err.classList.toggle("hidden", !msg);
    };

    function renderLayers() {
      const clips = opts.clips?.() || null;
      el.layers.innerHTML = "";
      el.empty.classList.toggle("hidden", fx.layers.length > 0);
      fx.layers.forEach((l, i) => {
        const row = document.createElement("div");
        row.className = "vfx-layer";
        row.innerHTML = `
          <img alt="" />
          <div class="vfx-layer-main">
            <div class="vfx-layer-top">
              <strong class="vfx-layer-name"></strong>
              <button type="button" class="link-btn" data-act="up" title="Draw earlier (under the next layer)">▲</button>
              <button type="button" class="link-btn" data-act="down" title="Draw later (on top)">▼</button>
              <button type="button" class="link-btn" data-act="remove" title="Remove this layer">×</button>
            </div>
            <div class="vfx-layer-opts">
              <select data-k="clip" title="Draw it on the whole video, or on one clip only"></select>
              <select data-k="pos" title="Where it goes"></select>
              <label class="inline vfx-num" title="Width, as a share of the video's width (the height follows the image's shape)">Size <input type="number" data-k="scale" min="1" max="100" step="1" />%</label>
              <label class="inline vfx-num" title="Gap to the edge, as a share of the video's width">Margin <input type="number" data-k="margin" min="0" max="25" step="0.5" />%</label>
              <label class="inline vfx-num">Opacity <input type="number" data-k="opacity" min="0" max="100" step="5" />%</label>
            </div>
          </div>`;
        $("img", row).src = l.url;
        $(".vfx-layer-name", row).textContent = l.name || "overlay";
        $(".vfx-layer-name", row).title = l.name || "";
        const clipSel = $('[data-k="clip"]', row);
        if (clips) {
          clipSel.add(new Option("Whole video", ""));
          clips.forEach((c, k) => clipSel.add(new Option(c.label, String(k))));
          const at = clips.findIndex((c) => c.ref === l.clip);
          if (l.clip != null && at < 0) l.clip = null; // its clip has gone
          clipSel.value = at < 0 ? "" : String(at);
        } else clipSel.remove();
        const posSel = $('[data-k="pos"]', row);
        for (const [v, label] of POSITIONS) posSel.add(new Option(label, v));
        posSel.value = l.pos;
        for (const k of ["scale", "margin", "opacity"]) $(`[data-k="${k}"]`, row).value = l[k];
        const placed = () =>
          row.querySelectorAll('[data-k="scale"], [data-k="margin"]').forEach((n) => {
            n.disabled = l.pos === "full";
            n.closest("label").classList.toggle("vfx-off", l.pos === "full");
          });
        placed();
        $('[data-act="up"]', row).disabled = i === 0;
        $('[data-act="down"]', row).disabled = i === fx.layers.length - 1;
        row.addEventListener("change", (e) => {
          const k = e.target.dataset.k;
          if (!k) return;
          if (k === "clip") l.clip = e.target.value === "" ? null : clips[Number(e.target.value)].ref;
          else if (k === "pos") {
            l.pos = e.target.value;
            placed();
          } else {
            const [lo, hi] = { scale: [1, 100], margin: [0, 25], opacity: [0, 100] }[k];
            const n = Number(e.target.value);
            l[k] = Number.isFinite(n) && e.target.value !== "" ? Math.min(hi, Math.max(lo, n)) : l[k];
            e.target.value = l[k];
          }
          changed();
        });
        row.addEventListener("input", (e) => {
          const k = e.target.dataset.k;
          const n = Number(e.target.value);
          if (["scale", "margin", "opacity"].includes(k) && e.target.value !== "" && Number.isFinite(n)) {
            l[k] = n;
            changed();
          }
        });
        row.addEventListener("click", (e) => {
          const act = e.target.closest("[data-act]")?.dataset.act;
          if (!act || opts.disabled?.()) return;
          if (act === "remove") fx.layers.splice(i, 1);
          else {
            const to = i + (act === "up" ? -1 : 1);
            [fx.layers[i], fx.layers[to]] = [fx.layers[to], fx.layers[i]];
          }
          renderLayers();
          changed();
        });
        el.layers.appendChild(row);
      });
    }

    async function loadRecent() {
      try {
        recent = await api(`${API}/overlays`);
      } catch {
        recent = [];
      }
      el.recent.length = 1;
      for (const [k, r] of recent.entries())
        el.recent.add(new Option(`${r.name}${r.project ? ` — ${r.project}` : ""}`, String(k)));
      el.recent.disabled = !recent.length;
    }

    async function upload(files) {
      showErr("");
      for (const f of files) {
        try {
          const pid = opts.projectId?.() || "default";
          const saved = await api(
            `${API}/overlays?name=${encodeURIComponent(f.name)}&projectId=${encodeURIComponent(pid)}`,
            { method: "POST", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f },
          );
          fx.layers.push(newLayer(saved.url, saved.name));
        } catch (err) {
          showErr(`${f.name}: ${err.message || err}`);
        }
      }
      renderLayers();
      changed();
      loadRecent();
    }

    el.add.addEventListener("click", () => !opts.disabled?.() && el.file.click());
    el.file.addEventListener("change", () => {
      upload([...el.file.files]);
      el.file.value = "";
    });
    el.recent.addEventListener("change", () => {
      const r = recent?.[Number(el.recent.value)];
      el.recent.value = "";
      if (!r || opts.disabled?.()) return;
      fx.layers.push(newLayer(r.url, r.name));
      renderLayers();
      changed();
    });
    box.addEventListener("toggle", () => box.open && !recent && loadRecent());
    // Dropping an image on the form adds it as a layer (not as a clip).
    root.addEventListener("dragover", (e) => {
      if ([...(e.dataTransfer?.items || [])].some((i) => i.type.startsWith("image/"))) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    root.addEventListener("drop", (e) => {
      const imgs = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) return;
      e.preventDefault();
      e.stopPropagation();
      box.open = true;
      upload(imgs);
    });

    const setDesat = (n) => {
      fx.desat = Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
      el.desat.value = el.desatn.value = fx.desat;
      changed();
    };
    el.desat.addEventListener("input", () => setDesat(el.desat.value));
    el.desatn.addEventListener("input", () => el.desatn.value !== "" && setDesat(el.desatn.value));
    el.desatn.addEventListener("change", () => setDesat(el.desatn.value));
    const dim = (input) => {
      const n = Math.round(Number(input.value));
      return input.value !== "" && n >= 16 && n <= 8192 ? n : 0;
    };
    for (const input of [el.w, el.h]) {
      input.addEventListener("input", () => {
        fx.width = dim(el.w);
        fx.height = dim(el.h);
        changed();
      });
      input.addEventListener("change", () => {
        if (input.value !== "" && !dim(input)) input.value = "";
      });
    }
    el.mode.addEventListener("change", () => {
      fx.sizeMode = el.mode.value;
      changed();
    });

    const form = {
      get: () => fx,
      // Show these effects (a copy); `open` unfolds the form.
      set(next, open) {
        fx = { ...blank(), ...(next || {}) };
        fx.layers = (fx.layers || []).map((l) => ({ ...newLayer(l.url, l.name), ...l }));
        el.desat.value = el.desatn.value = fx.desat;
        el.w.value = fx.width || "";
        el.h.value = fx.height || "";
        el.mode.value = fx.sizeMode;
        if (open != null) box.open = open;
        renderLayers();
        changed();
      },
      // The clip list changed (names, order, removals).
      refresh() {
        renderLayers();
        const off = !!opts.disabled?.();
        if (off) for (const n of root.querySelectorAll("input, select, button")) n.disabled = true;
        else for (const n of [el.desat, el.desatn, el.w, el.h, el.add]) n.disabled = false;
        el.recent.disabled = off || !recent?.length;
        el.mode.disabled = off || !(fx.width && fx.height);
      },
      el: root,
    };
    form.set(blank());
    started = true;
    return form;
  }

  // A rough live preview on `video` (which must sit in a position: relative stage):
  // desaturation as a CSS filter, the layers drawn over it. `clip` is the clip on
  // screen, for layers on one clip only. The resize isn't shown.
  function preview(video, fx, clip) {
    const stage = video.parentElement;
    let pane = $(".vfx-preview", stage);
    if (!pane) {
      pane = document.createElement("div");
      pane.className = "vfx-preview";
      stage.appendChild(pane);
      new ResizeObserver(() => pane._draw?.()).observe(video);
      video.addEventListener("loadedmetadata", () => pane._draw?.());
    }
    pane._draw = () => {
      video.style.filter = fx?.desat ? `saturate(${1 - fx.desat / 100})` : "";
      pane.innerHTML = "";
      const w = video.offsetWidth;
      const h = video.offsetHeight;
      Object.assign(pane.style, {
        left: `${video.offsetLeft}px`,
        top: `${video.offsetTop}px`,
        width: `${w}px`,
        height: `${h}px`,
      });
      if (!fx || !w) return;
      for (const l of fx.layers) {
        if (l.clip != null && l.clip !== clip) continue;
        const img = document.createElement("img");
        img.src = l.url;
        img.alt = "";
        img.style.opacity = String(l.opacity / 100);
        if (l.pos === "full") Object.assign(img.style, { left: 0, top: 0, width: "100%", height: "100%" });
        else {
          const m = `${(w * l.margin) / 100}px`;
          img.style.width = `${l.scale}%`;
          const [x, y] =
            {
              "top-left": ["l", "t"], top: ["c", "t"], "top-right": ["r", "t"],
              left: ["l", "c"], center: ["c", "c"], right: ["r", "c"],
              "bottom-left": ["l", "b"], bottom: ["c", "b"], "bottom-right": ["r", "b"],
            }[l.pos] || ["c", "c"];
          const t = [];
          if (x === "l") img.style.left = m;
          else if (x === "r") img.style.right = m;
          else {
            img.style.left = "50%";
            t.push("translateX(-50%)");
          }
          if (y === "t") img.style.top = m;
          else if (y === "b") img.style.bottom = m;
          else {
            img.style.top = "50%";
            t.push("translateY(-50%)");
          }
          img.style.transform = t.join(" ");
        }
        pane.appendChild(img);
      }
    };
    pane._draw();
  }

  window.VideoFx = { create, preview, summary, isEmpty, forExport, blank };
})();
