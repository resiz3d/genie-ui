// --- 🖼 Image editor: crop, flip and draw on an image ------------------------------------
// Opened from the header, or from a History card's / Gallery image's ✂ Crop. The image
// comes from the device or from GENie's own images (History, Gallery, earlier crops).
// The crop box is dragged by touch or mouse — inside to move it, a corner to resize it,
// anywhere else to draw a new one — and can be locked to a common shape. ✏ Draw paints
// on a layer of its own over the image (pen, eraser, size, colour), so the eraser only
// ever rubs out drawing, never the image. The browser
// crops (a canvas); the server (image-editor.js) only stores the result: in the
// project's edited_images folder, on the card it was opened from (added, or in place of
// its image), in the Gallery, or wherever on this device Save as… is pointed.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const API = "/api/image-editor";
  // The shapes on offer: [key, label, width / height]. Free locks nothing; Original
  // locks the image's own shape.
  const RATIOS = [
    ["free", "Free", null],
    ["orig", "Original", null],
    ["1:1", "1:1", 1],
    ["2:3", "2:3", 2 / 3],
    ["3:4", "3:4", 3 / 4],
    ["16:9", "16:9", 16 / 9],
    ["9:16", "9:16", 9 / 16],
    ["4:3", "4:3", 4 / 3],
    ["3:2", "3:2", 3 / 2],
  ];
  const OUT_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

  const modal = document.createElement("div");
  modal.id = "imageEditorModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
  <div class="modal-box fp-box ie-box" role="dialog" aria-labelledby="ieHeading">
    <div class="pe-head">
      <h3 id="ieHeading">🖼 Image editor <span class="hint ie-name"></span></h3>
      <button type="button" class="link-btn pe-close ie-close" title="Close (Esc)">×</button>
    </div>
    <div class="dropzone ie-drop">
      <p class="dz-hint">Drop an image here or <span class="browse">browse</span></p>
    </div>
    <button type="button" class="btn-secondary ie-import" title="Open an image from this project's History, Gallery or earlier crops">📚 Import from GENie…</button>
    <input type="file" class="ie-file" accept="image/png,image/jpeg,image/webp" hidden />
    <div class="ie-editor hidden">
      <div class="ie-modes" role="group" aria-label="Tool">
        <button type="button" class="ie-ratio" data-m="crop" title="Crop the image">✂ Crop</button>
        <button type="button" class="ie-ratio" data-m="draw" title="Draw over the image">✏ Draw</button>
        <button type="button" class="ie-ratio" data-m="mask" title="Paint a black-and-white mask (e.g. for inpainting) — saved apart from the image">◐ Mask</button>
      </div>
      <div class="ie-ratios" role="group" aria-label="Crop shape"></div>
      <div class="ie-tools hidden" role="group" aria-label="Drawing tools">
        <span class="ie-tool-group">
          <button type="button" class="ie-ratio ie-tool" data-t="pen" title="Pen (a stylus draws thicker the harder you press)">✏ Pen</button>
          <button type="button" class="ie-ratio ie-tool" data-t="line" title="Straight line">╱ Line</button>
          <button type="button" class="ie-ratio ie-tool" data-t="arrow" title="Arrow — drag from its tail to its tip">➚ Arrow</button>
          <button type="button" class="ie-ratio ie-tool" data-t="box" title="Box — drag corner to corner">▭ Box</button>
          <button type="button" class="ie-ratio ie-tool" data-t="eraser" title="Eraser — rubs out drawing only, never the image">🧽 Eraser</button>
          <button type="button" class="ie-ratio ie-tool" data-t="pick" title="Eyedropper — tap or drag over the picture to take its colour">💧 Pick</button>
        </span>
        <span class="ie-sizer" title="Pen and eraser size">
          <span class="ie-dot-box"><span class="ie-dot"></span></span>
          <input type="range" class="ie-pensize" min="1" max="60" value="6" aria-label="Size" />
        </span>
        <span class="ie-palette" role="group" aria-label="Colour"></span>
        <span class="ie-tool-group">
          <button type="button" class="link-btn ie-undo" title="Undo the last stroke (Ctrl+Z)">↶ Undo</button>
          <button type="button" class="link-btn ie-redo" title="Redo (Ctrl+Y or Ctrl+Shift+Z)">↷ Redo</button>
          <button type="button" class="link-btn ie-wipe" title="Remove all drawing (the image stays)">Clear drawing</button>
        </span>
      </div>
      <div class="ie-maskbar hidden" role="group" aria-label="Mask">
        <label class="inline" title="Black where you painted, white elsewhere — for tools that keep the white part">
          <input type="checkbox" class="ie-invert" /> Invert
        </label>
        <span class="ie-tool-group">
          <button type="button" class="btn-secondary ie-mask-gallery" disabled title="Add the mask to this project's Gallery">＋ Gallery</button>
          <button type="button" class="btn-secondary ie-mask-ref" disabled title="Add the mask to the form's reference images (it goes to the Gallery too)">＋ References</button>
          <button type="button" class="btn-secondary ie-mask-saveas" disabled title="Choose where on this device to save the mask">Save as…</button>
        </span>
      </div>
      <div class="ie-stage">
        <div class="ie-frame">
          <img class="ie-img" alt="" draggable="false" />
          <canvas class="ie-ink"></canvas>
          <canvas class="ie-mask"></canvas>
          <canvas class="ie-live"></canvas>
          <div class="ie-crop">
            <span class="ie-h" data-h="nw"></span><span class="ie-h" data-h="ne"></span>
            <span class="ie-h" data-h="sw"></span><span class="ie-h" data-h="se"></span>
          </div>
        </div>
      </div>
      <div class="fp-readout">
        <span class="ie-size"></span>
        <span class="ie-links">
          <button type="button" class="link-btn ie-fit hidden" title="Zoom back out to the whole image"></button>
          <button type="button" class="link-btn ie-flip" title="Mirror the image left to right" aria-pressed="false">⇆ Flip</button>
          <button type="button" class="link-btn ie-reset" title="Back to the whole image, unflipped">Reset</button>
          <button type="button" class="link-btn ie-other" title="Crop a different image">Open another…</button>
        </span>
      </div>
      <p class="hint ie-tip"></p>
    </div>
    <div class="ve-target ie-target hidden">
      <label class="inline"><input type="checkbox" class="ie-overwrite" /> <span class="ie-overwrite-label"></span></label>
      <span class="muted ie-thint"></span>
    </div>
    <p class="muted ie-msg hidden"></p>
    <p class="sp-save-warn ie-err hidden"></p>
    <div class="modal-actions">
      <button type="button" class="btn-secondary ie-close">Close</button>
      <button type="button" class="btn-secondary ie-saveas" disabled title="Choose where on this device to save the crop">Save as…</button>
      <button type="button" class="btn-secondary ie-gallery" disabled title="Add the crop to this project's Gallery, e.g. as a reference image">＋ Gallery</button>
      <button type="button" class="ie-save" disabled>💾 Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  // The picker: GENie's own images, one click opens one.
  const lib = document.createElement("div");
  lib.id = "imageEditorLibrary";
  lib.className = "modal hidden";
  lib.innerHTML = `
  <div class="modal-box fp-box ve-lib-box" role="dialog" aria-labelledby="ieLibHeading">
    <div class="pe-head">
      <h3 id="ieLibHeading">Open an image</h3>
      <button type="button" class="link-btn pe-close ie-lib-close" title="Close (Esc)">×</button>
    </div>
    <div class="ve-lib-bar">
      <button type="button" class="btn-secondary ie-lib-device">📁 From this device…</button>
      <label class="inline" title="Show every project's images, not only the active project's">
        <input type="checkbox" class="ie-lib-all" /> All projects
      </label>
      <span class="muted ve-lib-count ie-lib-count"></span>
    </div>
    <p class="dz-hint ie-lib-empty hidden"></p>
    <div class="ve-lib-grid ie-lib-grid"></div>
    <button type="button" class="btn-secondary ie-lib-more hidden">Show more</button>
    <div class="modal-actions">
      <button type="button" class="btn-secondary ie-lib-close">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(lib);

  const el = {};
  for (const k of [
    "name", "drop", "import", "file", "editor", "ratios", "stage", "frame", "img", "crop",
    "size", "flip", "reset", "other", "target", "overwrite", "thint", "msg", "err", "saveas",
    "gallery", "save", "modes", "tools", "pensize", "dot", "palette", "undo", "redo", "wipe", "ink", "live", "tip", "fit", "mask", "maskbar", "invert",
  ])
    el[k] = $(`.ie-${k}`, modal);
  const L = {};
  for (const k of ["device", "all", "count", "empty", "grid", "more"]) L[k] = $(`.ie-lib-${k}`, lib);
  const M = {};
  for (const k of ["gallery", "ref", "saveas"]) M[k] = $(`.ie-mask-${k}`, modal);

  // The image: { url, name, ext, objectUrl (a device file) } and its size in pixels.
  let src = null;
  let W = 0;
  let H = 0;
  let crop = null; // { x, y, w, h } in the image's own pixels, as shown (flipped or not)
  let flipped = false; // mirrored left to right
  let ratioKey = "orig";
  // Where Save puts the crop when the editor was opened from a card:
  // { kind: "history" | "gallery", id, index, projectId } — null for the plain tool.
  let target = null;
  let saved = true; // nothing cropped since the last save
  let busy = false;
  let mode = "crop"; // "crop" | "draw" | "mask"
  let maskSaved = true; // nothing painted on the mask since it was last saved
  // Two layers over the image as shown (flipped or not), each strokes in the image's
  // own pixels replayed onto its canvas: the drawing, which Save merges into the image,
  // and the mask, which is saved on its own as a black-and-white image. A
  // { wipe: true } entry clears what came before it, so Clear can be undone too.
  // A stroke: { tool, color, width, pts: [x, y, pressure, x, y, pressure, …], fill } —
  // a line, arrow or box has two points (its ends or corners), and an arrow its barbs'
  // length (head); a mask's box is filled.
  const ink = el.ink.getContext("2d");
  const layers = {
    draw: { strokes: [], redone: [], cv: el.ink, c: ink },
    mask: { strokes: [], redone: [], cv: el.mask, c: el.mask.getContext("2d") },
  };
  const layer = () => (mode === "mask" ? layers.mask : layers.draw);
  function resetLayers() {
    for (const l of Object.values(layers)) {
      l.strokes = [];
      l.redone = [];
    }
    maskSaved = true;
  }
  const DRAW_TOOLS = ["pen", "line", "arrow", "box", "eraser", "pick"];
  const MASK_TOOLS = ["pen", "box", "eraser"];
  const MASK_INK = "#ff2d55"; // how the mask shows over the image (half see-through)
  const SHAPES = new Set(["line", "arrow", "box"]);
  let tool = "pen";
  let lastTool = "pen"; // what draws again after the eyedropper
  let maskTool = "pen"; // the tool Mask mode had last
  let penColor = "#ff3b30";
  let penSize = 6; // on-screen pixels
  const live = el.live.getContext("2d"); // a shape while it's being dragged out
  const TIPS = {
    crop: "Drag inside the box to move it, a corner to resize it, or anywhere else to draw a new one. Arrow keys nudge it (Shift: 10px). Pinch with two fingers (or Ctrl + scroll) to zoom.",
    draw: "Draw with a finger, stylus or mouse; pinch with two fingers (or Ctrl + scroll) to zoom in and move around. The eraser only rubs out drawing — the image underneath is never touched. Save keeps what's inside the crop box.",
    mask: "Paint over the part to change (a box fills). The mask is saved apart from the image, black and white — white where you painted, unless Inverted — and the size of the crop box, so it lines up with the image as saved.",
  };
  const PALETTE = [
    "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#007aff",
    "#5856d6", "#ff2d55", "#a2845e", "#ffffff", "#8e8e93", "#000000",
  ];

  const show = (node, msg) => {
    node.textContent = msg || "";
    node.classList.toggle("hidden", !msg);
  };
  const showErr = (msg) => show(el.err, msg);
  const showStatus = (msg) => show(el.msg, msg);
  const projectId = () =>
    target?.projectId || (typeof activeProjectId !== "undefined" ? activeProjectId : "default");
  const ratio = () =>
    ratioKey === "orig" ? W / H : (RATIOS.find(([k]) => k === ratioKey)?.[2] ?? null);
  const whole = () => !crop || (crop.x === 0 && crop.y === 0 && crop.w === W && crop.h === H);
  // The strokes since the last wipe: what a layer shows.
  const shown = (l = layer()) => l.strokes.slice(l.strokes.findLastIndex((s) => s.wipe) + 1);
  const drawn = () => shown(layers.draw).some((s) => s.tool !== "eraser");
  const masked = () => shown(layers.mask).some((s) => s.tool !== "eraser");
  // After a change to a layer: is there something unsaved now?
  function touched() {
    if (mode === "mask") maskSaved = !masked();
    else saved = !edited();
  }
  const edited = () => !!crop && (flipped || !whole() || drawn());
  const baseName = () => String(src?.name || "image").replace(/\.[^.]+$/, "");
  const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(String(name).split("?")[0])?.[1] || "").toLowerCase();

  // ------------------------------------------------------------- the crop box
  // The largest box of the chosen shape, centred on the image.
  function fitRatio() {
    const r = ratio();
    if (!r) return (crop = { x: 0, y: 0, w: W, h: H });
    let w = W;
    let h = Math.round(w / r);
    if (h > H) {
      h = H;
      w = Math.round(h * r);
    }
    crop = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
  }

  const scale = () => (W ? el.img.clientWidth / W : 1);
  // Screen pixels per image pixel, zoom included.
  const viewScale = () => (W ? el.img.getBoundingClientRect().width / W : 1);

  // Show the image as large as the stage allows — a small one scaled up too, so its
  // crop box is easy to handle — within the height the stylesheet gives it.
  function fitImage() {
    if (!W || !H) return;
    el.img.style.width = el.img.style.height = "";
    const cs = getComputedStyle(el.stage);
    const availW = el.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const maxH = parseFloat(getComputedStyle(el.img).maxHeight) || window.innerHeight * 0.6;
    const s = Math.min(availW / W, maxH / H);
    for (const node of [el.img, el.ink, el.mask, el.live]) {
      node.style.width = `${Math.floor(W * s)}px`;
      node.style.height = `${Math.floor(H * s)}px`;
    }
  }

  function render() {
    if (!src) return;
    for (const b of el.modes.children) {
      const on = b.dataset.m === mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    el.ratios.classList.toggle("hidden", mode !== "crop");
    el.tools.classList.toggle("hidden", mode === "crop");
    el.tools.classList.toggle("ie-masking", mode === "mask");
    el.maskbar.classList.toggle("hidden", mode !== "mask");
    el.frame.classList.toggle("ie-drawing", mode !== "crop");
    el.frame.classList.toggle("ie-masking", mode === "mask");
    el.wipe.textContent = mode === "mask" ? "Clear mask" : "Clear drawing";
    el.wipe.title = mode === "mask" ? "Remove the whole mask" : "Remove all drawing (the image stays)";
    M.gallery.disabled = M.ref.disabled = M.saveas.disabled = !masked() || busy;
    // Only where the main page's form is there to take it.
    M.ref.classList.toggle("hidden", typeof addRefToPictureField !== "function");
    el.tip.textContent = TIPS[mode];
    renderTools();
    for (const b of el.ratios.children) {
      const on = b.dataset.r === ratioKey;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    if (crop) {
      const s = scale();
      Object.assign(el.crop.style, {
        left: `${crop.x * s}px`,
        top: `${crop.y * s}px`,
        width: `${crop.w * s}px`,
        height: `${crop.h * s}px`,
      });
      el.size.textContent =
        (whole() ? `${W} × ${H} px — the whole image` : `${crop.w} × ${crop.h} px (from ${W} × ${H})`) +
        (flipped ? ", flipped" : "") +
        (drawn() ? ", drawn on" : "");
    }
    el.img.classList.toggle("ie-flipped", flipped);
    el.flip.classList.toggle("on", flipped);
    el.flip.setAttribute("aria-pressed", String(flipped));
    const nothing = !edited() || busy;
    el.save.disabled = el.saveas.disabled = el.gallery.disabled = nothing;
    renderTarget();
  }

  // Image pixels under a pointer, kept inside the image.
  function at(e) {
    const r = el.img.getBoundingClientRect();
    const s = viewScale();
    return {
      x: Math.max(0, Math.min(W, (e.clientX - r.left) / s)),
      y: Math.max(0, Math.min(H, (e.clientY - r.top) / s)),
    };
  }

  // A box from a fixed corner (ax, ay) towards the pointer, of the chosen shape, kept
  // inside the image and no smaller than a fingertip.
  function boxFrom(ax, ay, px, py) {
    const r = ratio();
    const dx = px >= ax ? 1 : -1;
    const dy = py >= ay ? 1 : -1;
    const min = Math.max(1, 24 / scale());
    let w = Math.max(min, Math.abs(px - ax));
    let h = Math.max(min, Math.abs(py - ay));
    if (r) {
      if (w / h > r) h = w / r;
      else w = h * r;
    }
    const maxW = dx > 0 ? W - ax : ax;
    const maxH = dy > 0 ? H - ay : ay;
    if (w > maxW) {
      w = maxW;
      if (r) h = w / r;
    }
    if (h > maxH) {
      h = maxH;
      if (r) w = h * r;
    }
    w = Math.round(w);
    h = Math.round(h);
    return { x: Math.round(dx > 0 ? ax : ax - w), y: Math.round(dy > 0 ? ay : ay - h), w, h };
  }

  // ------------------------------------------------------------- zoom
  // Two fingers pinch to zoom in (and move to pan), as does Ctrl + wheel or a
  // trackpad pinch — to crop or draw finely. The frame is scaled with a CSS transform,
  // so the crop box and the drawing keep working in the image's own pixels.
  const view = { z: 1, x: 0, y: 0 }; // zoom, then the frame's shift in screen px
  const MAX_ZOOM = 8;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Keep the zoomed image covering the frame's own place on the stage.
  function applyView() {
    view.z = clamp(view.z, 1, MAX_ZOOM);
    view.x = clamp(view.x, el.frame.offsetWidth * (1 - view.z), 0);
    view.y = clamp(view.y, el.frame.offsetHeight * (1 - view.z), 0);
    el.frame.style.transform =
      view.z === 1 ? "" : `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    el.fit.classList.toggle("hidden", view.z === 1);
    el.fit.textContent = `⤢ Fit (${Math.round(view.z * 100)}%)`;
  }
  function resetView() {
    view.z = 1;
    view.x = view.y = 0;
    applyView();
  }
  // The frame's unzoomed top-left on screen, and the unzoomed frame point under a
  // screen point.
  const frameOrigin = () => {
    const r = el.frame.getBoundingClientRect();
    return { x: r.left - view.x, y: r.top - view.y };
  };
  const frameAt = (c, o) => ({ x: (c.x - o.x - view.x) / view.z, y: (c.y - o.y - view.y) / view.z });
  // Zoom to z with the frame point u kept under the screen point c.
  function zoomTo(z, c, u, o) {
    view.z = clamp(z, 1, MAX_ZOOM);
    view.x = c.x - o.x - view.z * u.x;
    view.y = c.y - o.y - view.z * u.y;
    applyView();
  }

  const pointers = new Map(); // pointerId → where it is on screen, for the pinch
  let pinch = null; // { d (finger spread), z, u, o } as it began
  const fingers = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };
  function startPinch() {
    const m = fingers();
    const o = frameOrigin();
    pinch = { d: m.d, z: view.z, u: frameAt(m, o), o };
  }
  function movePinch() {
    const m = fingers();
    zoomTo((pinch.z * m.d) / pinch.d, m, pinch.u, pinch.o);
  }
  el.stage.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey || !src) return; // a plain wheel scrolls the dialog
      e.preventDefault();
      const c = { x: e.clientX, y: e.clientY };
      const o = frameOrigin();
      zoomTo(view.z * Math.exp(-e.deltaY * 0.01), c, frameAt(c, o), o);
    },
    { passive: false },
  );

  // ------------------------------------------------------------- pointer
  let drag = null; // { mode: "move" | "size", ax, ay (fixed corner) | ox, oy (grab offset), before }
  let stroke = null; // the stroke being drawn, with the pointer drawing it (id)
  let picking = null; // the eyedropper's pointer

  // A second finger turns whatever the first one began into a pinch: undo it.
  function abandon() {
    if (drag) crop = drag.before;
    drag = null;
    picking = null;
    if (stroke) {
      stroke.layer.strokes.splice(stroke.layer.strokes.indexOf(stroke), 1);
      stroke = null;
      repaint();
      touched();
    }
    render();
  }

  // A stylus draws thicker the harder it's pressed; a finger or mouse evenly.
  const force = (e) => (e.pointerType === "pen" && e.pressure > 0 ? 0.3 + e.pressure * 1.4 : 1);

  el.frame.addEventListener("pointerdown", (e) => {
    if (!crop || busy || e.button > 0) return;
    e.preventDefault();
    try {
      el.frame.setPointerCapture(e.pointerId);
    } catch {} // a pointer that's already gone
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      abandon();
      return startPinch();
    }
    if (pointers.size > 2 || pinch) return;
    const p = at(e);
    if (mode !== "crop") {
      if (tool === "pick") {
        picking = e.pointerId;
        return pick(p);
      }
      const ss = viewScale();
      const l = layer();
      stroke = {
        tool,
        color: mode === "mask" ? MASK_INK : penColor,
        width: penSize / ss,
        pts: [p.x, p.y, force(e)],
        fill: mode === "mask",
        id: e.pointerId,
        layer: l,
      };
      if (SHAPES.has(tool)) {
        stroke.pts = [p.x, p.y, 1, p.x, p.y, 1];
        stroke.head = Math.max(stroke.width * 3, 16 / ss); // an arrow's barbs
      }
      l.strokes.push(stroke);
      if (!SHAPES.has(tool)) paint(l.c, stroke, 0);
      if (mode === "mask") maskSaved = false;
      else saved = false;
      return render();
    }
    const before = { ...crop };
    const handle = e.target.closest(".ie-h")?.dataset.h;
    if (handle) {
      // the corner opposite the one grabbed stays put
      drag = {
        mode: "size",
        ax: handle.includes("w") ? crop.x + crop.w : crop.x,
        ay: handle.includes("n") ? crop.y + crop.h : crop.y,
        before,
      };
    } else if (e.target.closest(".ie-crop")) {
      drag = { mode: "move", ox: p.x - crop.x, oy: p.y - crop.y, before };
    } else {
      drag = { mode: "size", ax: p.x, ay: p.y, before };
      crop = boxFrom(p.x, p.y, p.x, p.y);
    }
    saved = false;
    render();
  });
  el.frame.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pointers.size >= 2) movePinch();
      return;
    }
    if (picking === e.pointerId) return pick(at(e));
    if (stroke && e.pointerId === stroke.id) {
      if (SHAPES.has(stroke.tool)) {
        const p = at(e);
        stroke.pts[3] = p.x;
        stroke.pts[4] = p.y;
        clearLive();
        paint(live, stroke, 0);
        return;
      }
      // A stylus or a quick finger sends several points per frame: take them all.
      const from = stroke.pts.length / 3 - 1;
      const evs = e.getCoalescedEvents?.() || [];
      for (const ev of evs.length ? evs : [e]) {
        const p = at(ev);
        stroke.pts.push(p.x, p.y, force(ev));
      }
      paint(stroke.layer.c, stroke, from);
      return;
    }
    if (!drag) return;
    const p = at(e);
    if (drag.mode === "move")
      crop = {
        ...crop,
        x: Math.round(Math.max(0, Math.min(W - crop.w, p.x - drag.ox))),
        y: Math.round(Math.max(0, Math.min(H - crop.h, p.y - drag.oy))),
      };
    else crop = boxFrom(drag.ax, drag.ay, p.x, p.y);
    render();
  });
  const endDrag = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      // the pinch lasts until every finger is up, so the last one doesn't draw
      if (!pointers.size) pinch = null;
      return;
    }
    drag = null;
    if (picking === e.pointerId) {
      picking = null;
      tool = lastTool;
      savePen();
      render();
    }
    if (stroke && e.pointerId === stroke.id) {
      delete stroke.id;
      if (SHAPES.has(stroke.tool)) {
        clearLive();
        const [x1, y1, , x2, y2] = stroke.pts;
        // a tap with a shape tool draws nothing
        if (Math.hypot(x2 - x1, y2 - y1) * viewScale() < 4) stroke.layer.strokes.pop();
        else paint(stroke.layer.c, stroke, 0);
      }
      if (stroke.layer.strokes.at(-1) === stroke) stroke.layer.redone = [];
      stroke = null;
      touched();
      render();
    }
  };
  el.frame.addEventListener("pointerup", endDrag);
  el.frame.addEventListener("pointercancel", endDrag);
  new ResizeObserver(() => {
    fitImage();
    applyView();
    render();
  }).observe(el.stage);

  // ------------------------------------------------------------- drawing
  // Draw a stroke onto a canvas (the ink, or the live one a shape is previewed on)
  // from its point `from` on — all of it when replaying, only the new part while a pen
  // stroke is being drawn. The eraser cuts through the ink canvas alone, so the image
  // under it is never touched.
  function paint(c, s, from) {
    const p = s.pts;
    c.save();
    c.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
    c.strokeStyle = c.fillStyle = s.color;
    c.lineWidth = s.width;
    c.lineCap = c.lineJoin = "round";
    c.beginPath();
    if (s.tool === "line" || s.tool === "arrow") {
      const [x1, y1, , x2, y2] = p;
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      if (s.tool === "arrow") {
        const a = Math.atan2(y2 - y1, x2 - x1);
        for (const t of [a + 2.6, a - 2.6]) {
          c.moveTo(x2, y2);
          c.lineTo(x2 + Math.cos(t) * s.head, y2 + Math.sin(t) * s.head);
        }
      }
      c.stroke();
    } else if (s.tool === "box") {
      const box = [Math.min(p[0], p[3]), Math.min(p[1], p[4]), Math.abs(p[3] - p[0]), Math.abs(p[4] - p[1])];
      if (s.fill) c.fillRect(...box);
      else c.strokeRect(...box);
    } else if (p.length === 3) {
      // a tap: a dot
      c.arc(p[0], p[1], (s.width * p[2]) / 2, 0, Math.PI * 2);
      c.fill();
    } else {
      // segment by segment, each as wide as the pressure at its ends
      for (let i = Math.max(0, from) * 3 + 3; i < p.length; i += 3) {
        c.beginPath();
        c.lineWidth = (s.width * (p[i - 1] + p[i + 2])) / 2;
        c.moveTo(p[i - 3], p[i - 2]);
        c.lineTo(p[i], p[i + 1]);
        c.stroke();
      }
    }
    c.restore();
  }

  const clearLive = () => live.clearRect(0, 0, el.live.width, el.live.height);

  // Redraw the drawing and the mask from their strokes (after an undo, a flip, a new
  // image).
  function repaint() {
    for (const cv of [el.ink, el.mask, el.live])
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
      }
    clearLive();
    for (const l of Object.values(layers)) {
      l.c.clearRect(0, 0, W, H);
      for (const s of shown(l)) paint(l.c, s, 0);
    }
  }

  // Mirror the drawing and the mask along with the image.
  function flipInk() {
    for (const l of Object.values(layers))
      for (const s of [...l.strokes, ...l.redone])
        if (s.pts) for (let i = 0; i < s.pts.length; i += 3) s.pts[i] = W - s.pts[i];
    repaint();
  }

  // The eyedropper: the colour under a point as shown — the drawing's where there is
  // some, else the image's.
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const probeCtx = probe.getContext("2d", { willReadFrequently: true });
  function pick(p) {
    const x = Math.min(W - 1, Math.floor(p.x));
    const y = Math.min(H - 1, Math.floor(p.y));
    try {
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.drawImage(el.img, flipped ? W - 1 - x : x, y, 1, 1, 0, 0, 1, 1);
      probeCtx.drawImage(el.ink, x, y, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
      penColor = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    } catch {
      showErr("This browser won't read colours from this image.");
    }
    render();
  }

  // The pen's colour, size and tool, kept on the server like GENie's other choices, so
  // phone and desktop share them. Saved a moment after the last change.
  const PEN_KEY = "genie_image_pen";
  let penLoaded = false;
  let penTimer = 0;
  function loadPen() {
    if (penLoaded || typeof getPref !== "function") return;
    penLoaded = true;
    try {
      const v = JSON.parse(getPref(PEN_KEY) || "{}");
      if (/^#[0-9a-f]{6}$/i.test(v.color)) penColor = v.color.toLowerCase();
      if (v.size >= 1 && v.size <= 60) penSize = Number(v.size);
      if (DRAW_TOOLS.includes(v.tool) && v.tool !== "pick") tool = lastTool = v.tool;
    } catch {}
    el.pensize.value = penSize;
  }
  function savePen() {
    clearTimeout(penTimer);
    penTimer = setTimeout(() => {
      if (typeof setPref === "function")
        setPref(PEN_KEY, JSON.stringify({ color: penColor, size: penSize, tool: lastTool }));
    }, 800);
  }

  function renderTools() {
    for (const b of el.tools.querySelectorAll(".ie-tool")) {
      const on = b.dataset.t === tool;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    for (const b of el.palette.querySelectorAll("[data-c]")) {
      const on = b.dataset.c === penColor;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    // Any other colour shows on the last swatch.
    const custom = $(".ie-custom", el.palette);
    const other = !PALETTE.includes(penColor);
    custom.classList.toggle("on", other);
    custom.style.background = other ? penColor : "";
    if (other) $("input", custom).value = penColor;
    const d = Math.max(3, Math.min(30, penSize));
    el.dot.style.width = el.dot.style.height = `${d}px`;
    el.dot.style.background =
      tool === "eraser" ? "transparent"
      : mode === "mask" ? MASK_INK
      : penColor;
    el.dot.classList.toggle("ie-dot-eraser", tool === "eraser");
    const l = layer();
    el.undo.disabled = !l.strokes.length || busy;
    el.redo.disabled = !l.redone.length || busy;
    el.wipe.disabled = !shown().length || busy;
  }

  // Undo and Redo work on the layer of the mode you're in.
  function undo() {
    const l = layer();
    if (!l.strokes.length || busy || stroke) return;
    l.redone.push(l.strokes.pop());
    repaint();
    touched();
    render();
  }
  function redo() {
    const l = layer();
    if (!l.redone.length || busy || stroke) return;
    l.strokes.push(l.redone.pop());
    repaint();
    touched();
    render();
  }

  // A colour is for drawing: from the eraser or the eyedropper, back to the pen.
  function setColor(c) {
    penColor = c;
    if (tool === "eraser" || tool === "pick") tool = lastTool = "pen";
    savePen();
    render();
  }
  for (const c of PALETTE) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ie-swatch";
    b.dataset.c = c;
    b.style.background = c;
    b.title = c;
    b.setAttribute("aria-label", c);
    b.addEventListener("click", () => setColor(c));
    el.palette.appendChild(b);
  }
  {
    // any other colour, from the system's colour picker
    const custom = document.createElement("label");
    custom.className = "ie-swatch ie-custom";
    custom.title = "Any colour…";
    custom.innerHTML = `<input type="color" aria-label="Any colour" />`;
    const input = $("input", custom);
    input.value = penColor;
    input.addEventListener("input", () => setColor(input.value));
    el.palette.appendChild(custom);
  }
  // Draw and Mask share the tools row, each keeping its own tool (Mask has only the
  // pen, box and eraser).
  for (const b of el.modes.children)
    b.addEventListener("click", () => {
      if (stroke || picking != null) return;
      const next = b.dataset.m;
      if (next === mode) return;
      if (mode === "mask") maskTool = tool;
      if (next === "mask") tool = maskTool;
      else if (mode === "mask") tool = lastTool;
      mode = next;
      render();
    });
  for (const b of el.tools.querySelectorAll(".ie-tool"))
    b.addEventListener("click", () => {
      tool = b.dataset.t;
      if (mode === "mask") return render();
      // after picking a colour, back to what was drawing (the pen, from the eraser)
      if (tool !== "pick") lastTool = tool;
      else if (lastTool === "eraser") lastTool = "pen";
      savePen();
      render();
    });
  el.pensize.addEventListener("input", () => {
    penSize = Number(el.pensize.value);
    savePen();
    render();
  });
  el.undo.addEventListener("click", undo);
  el.redo.addEventListener("click", redo);
  el.wipe.addEventListener("click", () => {
    if (!shown().length || busy) return;
    const l = layer();
    l.strokes.push({ wipe: true });
    l.redone = [];
    repaint();
    touched();
    render();
  });
  el.fit.addEventListener("click", resetView);
  el.invert.addEventListener("change", () => (maskSaved = !masked()));

  for (const [key, label, r] of RATIOS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ie-ratio";
    b.dataset.r = key;
    b.textContent = label;
    b.title =
      key === "free" ? "Any shape — drag the corners freely"
      : key === "orig" ? "The image's own shape"
      : `${label} — ${r > 1 ? "landscape" : r < 1 ? "portrait" : "square"}`;
    b.addEventListener("click", () => {
      if (busy) return;
      ratioKey = key;
      // Free keeps the box as it is; a shape takes the largest box of it.
      if (key !== "free") {
        fitRatio();
        saved = !edited();
      }
      render();
    });
    el.ratios.appendChild(b);
  }

  // ------------------------------------------------------------- loading
  // opts: { url, name, objectUrl? }
  function load(opts) {
    if (src?.objectUrl) URL.revokeObjectURL(src.objectUrl);
    src = { ...opts, ext: extOf(opts.name) || extOf(opts.url) };
    crop = null;
    flipped = false;
    resetLayers();
    W = H = 0;
    resetView();
    showErr("");
    el.name.textContent = `— ${opts.name}`;
    el.drop.classList.add("hidden");
    el.import.classList.add("hidden");
    el.editor.classList.remove("hidden");
    el.img.onload = () => {
      W = el.img.naturalWidth;
      H = el.img.naturalHeight;
      fitImage();
      repaint();
      ratioKey = "orig";
      fitRatio();
      saved = true;
      render();
    };
    el.img.onerror = () => showErr(`This browser can't show ${opts.name}.`);
    el.img.src = opts.url;
    render();
  }

  function loadFile(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type))
      return showErr("Pick a PNG, JPEG or WebP image.");
    const url = URL.createObjectURL(file);
    load({ url, name: file.name || "image.png", objectUrl: url });
  }

  function clear() {
    if (src?.objectUrl) URL.revokeObjectURL(src.objectUrl);
    src = null;
    crop = null;
    flipped = false;
    resetLayers();
    W = H = 0;
    resetView();
    target = null;
    saved = true;
    el.img.removeAttribute("src");
    el.name.textContent = "";
    el.drop.classList.remove("hidden");
    el.import.classList.remove("hidden");
    el.editor.classList.add("hidden");
    showErr("");
    showStatus("");
    render();
  }

  // ------------------------------------------------------------- saving
  // What the edit adds to the file name: -crop, -flip, -draw or a mix (-crop-flip-draw).
  const suffix = () =>
    [!whole() && "crop", flipped && "flip", drawn() && "draw"].filter(Boolean).join("-");

  // The crop as a file of the source's type (PNG when that type can't be written).
  // Flipped, the box is over the mirrored image: take the matching part of the
  // original and mirror it.
  async function cropped() {
    const type = OUT_TYPES[src.ext] || "image/png";
    const canvas = document.createElement("canvas");
    canvas.width = crop.w;
    canvas.height = crop.h;
    const ctx = canvas.getContext("2d");
    const sx = flipped ? W - crop.x - crop.w : crop.x;
    if (flipped) {
      ctx.translate(crop.w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(el.img, sx, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    // The drawing is over the image as shown, so it goes on top unmirrored.
    if (drawn()) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(el.ink, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
    if (!blob) throw new Error("This browser couldn't make the edited image");
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[blob.type] || "png";
    return { blob, ext, name: `${baseName()}-${suffix()}.${ext}` };
  }

  // Run one save at a time, with the buttons off and errors shown. mask: it saves the
  // mask, not the edited image.
  async function run(what, fn, mask = false) {
    if (busy || !(mask ? masked() : edited())) return;
    busy = true;
    showErr("");
    showStatus(`${what}…`);
    render();
    try {
      await fn();
      if (mask) maskSaved = true;
      else saved = true;
    } catch (err) {
      showStatus("");
      if (err.name !== "AbortError") showErr(err.message || String(err));
    } finally {
      busy = false;
      render();
    }
  }

  const api = async (url, opts) => {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || `HTTP ${res.status}`);
    return data.data;
  };

  const save = () =>
    run("Saving", async () => {
      const out = await cropped();
      const toCard = target ? { ...target, overwrite: el.overwrite.checked } : null;
      if (
        toCard?.overwrite &&
        !confirm(
          `Replace ${toCard.kind === "history" ? "the card's image" : "this Gallery image"} with the crop? The current file is deleted.`,
        )
      )
        throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      const q = new URLSearchParams({ name: out.name });
      if (toCard) q.set("target", JSON.stringify(toCard));
      else q.set("projectId", projectId());
      const done = await api(`${API}/save?${q}`, {
        method: "POST",
        headers: { "Content-Type": out.blob.type },
        body: out.blob,
      });
      if (done.kind === "history" && typeof loadHistory === "function") loadHistory();
      if (done.kind === "gallery" && typeof loadGallery === "function") loadGallery();
      if (toCard?.overwrite) {
        // The old file is gone: carry on from the saved crop, whole again.
        target = { ...target, index: done.index ?? target.index };
        el.overwrite.checked = false;
        load({ url: done.url, name: src.name });
        return showStatus(
          done.kind === "history" ?
            "Replaced the card's image — now editing the saved version."
          : "Replaced the Gallery image — now editing the saved version.",
        );
      }
      if (toCard)
        return showStatus(
          done.kind === "history" ?
            `Added to the card as image ${done.index + 1} of ${done.count}.`
          : `Added to the Gallery as ${done.name}.`,
        );
      showStatus(`Saved to ${done.folder} as `);
      const a = document.createElement("a");
      a.href = done.url;
      a.target = "_blank";
      a.textContent = done.name;
      a.title = "Open the saved image";
      el.msg.append(a, ".");
    });

  // A made file → a new Gallery entry of a project (returned).
  async function uploadGallery(out, project) {
    const base64Data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(out.blob);
    });
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Data, fileName: out.name, projectId: project }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.image?.id) throw new Error(data.msg || `HTTP ${res.status}`);
    if (typeof loadGallery === "function") loadGallery();
    return data.image;
  }

  const toGallery = () =>
    run("Adding to the Gallery", async () => {
      const out = await cropped();
      await uploadGallery(out, projectId());
      showStatus(`Added to the Gallery as ${out.name}.`);
    });

  // ------------------------------------------------------------- the mask
  // The mask as a PNG the size of the crop box, so it lines up with the image as saved:
  // white where painted on black (or the other way round, inverted), its edges grey
  // where the brush was soft.
  async function maskImage() {
    const inv = el.invert.checked;
    const shape = document.createElement("canvas");
    shape.width = crop.w;
    shape.height = crop.h;
    const s = shape.getContext("2d");
    s.drawImage(el.mask, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    s.globalCompositeOperation = "source-in";
    s.fillStyle = inv ? "#000" : "#fff";
    s.fillRect(0, 0, crop.w, crop.h);
    const canvas = document.createElement("canvas");
    canvas.width = crop.w;
    canvas.height = crop.h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = inv ? "#fff" : "#000";
    ctx.fillRect(0, 0, crop.w, crop.h);
    ctx.drawImage(shape, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("This browser couldn't make the mask");
    return { blob, ext: "png", name: `${baseName()}-mask${inv ? "-inverted" : ""}.png` };
  }

  const maskToGallery = () =>
    run(
      "Adding the mask to the Gallery",
      async () => {
        const out = await maskImage();
        await uploadGallery(out, projectId());
        showStatus(`Added the mask to the Gallery as ${out.name}.`);
      },
      true,
    );

  // To the form's picture field (a ComfyUI workflow's first image input, or the
  // Reference images list) — by way of the active project's Gallery, as a dropped
  // reference goes.
  const maskToRefs = () =>
    run(
      "Adding the mask to the references",
      async () => {
        const out = await maskImage();
        const img = await uploadGallery(
          out,
          typeof activeProjectId !== "undefined" ? activeProjectId : "default",
        );
        const ok = addRefToPictureField({ id: img.id, thumb: img.localUrl, name: img.name || out.name });
        showStatus(
          ok ?
            `Added the mask to the form's reference images (and the Gallery) as ${out.name}.`
          : `The form's reference images are full — the mask is in the Gallery as ${out.name}.`,
        );
      },
      true,
    );

  // Ask where to save first, while the click still counts as a user gesture (only
  // Chromium offers this, and only to localhost / https pages); elsewhere the crop goes
  // through the browser's normal download.
  async function saveAs(mask = false) {
    if (busy || !(mask ? masked() : edited())) return;
    const type = mask ? "image/png" : OUT_TYPES[src.ext] || "image/png";
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[type];
    let handle = null;
    if (window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName:
            mask ? `${baseName()}-mask${el.invert.checked ? "-inverted" : ""}.png`
            : `${baseName()}-${suffix()}.${ext}`,
          types: [{ description: "Image", accept: { [type]: [`.${ext}`] } }],
        });
      } catch (err) {
        if (err.name === "AbortError") return; // they closed the dialog
      }
    }
    await run(
      "Saving",
      async () => {
        const out = await (mask ? maskImage() : cropped());
        if (handle) {
          const w = await handle.createWritable();
          await w.write(out.blob);
          await w.close();
          return showStatus(`Saved as ${handle.name}.`);
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(out.blob);
        a.download = out.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        showStatus(`Sent to this browser's downloads as ${out.name}.`);
      },
      mask,
    );
  }

  // The "save to the card" choice, shown only when the editor was opened from one.
  function renderTarget() {
    el.target.classList.toggle("hidden", !target);
    const card = target?.kind === "history";
    const over = !!target && el.overwrite.checked;
    $(".ie-overwrite-label", el.target).textContent =
      card ? "Overwrite the card's current image" : "Overwrite the Gallery image";
    el.thint.textContent =
      !target ? ""
      : over ?
        card ? "Save replaces the card's image with the crop and deletes the current file."
        : "Save replaces the Gallery image with the crop (prompts using it get the crop) and deletes the current file."
      : card ? "Save adds the crop to the card as another image; the current one stays."
      : "Save adds the crop to the Gallery as a new image; this one stays.";
    el.save.textContent =
      !target ? "💾 Save"
      : over ? "💾 Overwrite image"
      : card ? "💾 Add to card"
      : "💾 Add to Gallery";
    el.save.title =
      target ? el.thint.textContent : "Save the crop as a new file in this project's output folder (edited_images)";
    // From a Gallery image, Save already adds to the Gallery.
    el.gallery.classList.toggle("hidden", target?.kind === "gallery");
  }

  // ------------------------------------------------------------- the picker
  const LIB_PAGE = 30;
  let libItems = [];
  let libShown = 0;

  const libDate = (item) =>
    item.date ?
      new Date(item.date).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  function showMoreLibrary() {
    for (const item of libItems.slice(libShown, libShown + LIB_PAGE)) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "ve-lib-item";
      tile.title = `${item.name}${item.label ? `\n${item.label}` : ""}`;
      tile.innerHTML =
        `<img class="ie-lib-thumb" loading="lazy" decoding="async" alt="" />` +
        `<span class="ve-lib-src"></span><span class="ve-lib-label"></span>`;
      $("img", tile).src = item.url;
      $(".ve-lib-src", tile).textContent = item.source;
      $(".ve-lib-label", tile).textContent = libDate(item) || item.name;
      tile.addEventListener("click", () => {
        closeLibrary();
        if (!confirmDiscard()) return;
        target = null;
        showStatus("");
        load({ url: item.url, name: item.name });
      });
      L.grid.appendChild(tile);
    }
    libShown = Math.min(libItems.length, libShown + LIB_PAGE);
    L.more.classList.toggle("hidden", libShown >= libItems.length);
    L.count.textContent = libItems.length ? `Showing ${libShown} of ${libItems.length}` : "";
  }

  async function loadLibrary() {
    L.grid.innerHTML = "";
    libItems = [];
    libShown = 0;
    L.more.classList.add("hidden");
    L.count.textContent = "";
    show(L.empty, "Loading…");
    const all = L.all.checked;
    const id = all ? "all" : typeof activeProjectId !== "undefined" ? activeProjectId : "default";
    try {
      const items = await api(`${API}/library?projectId=${encodeURIComponent(id)}`);
      if (lib.classList.contains("hidden") || all !== L.all.checked) return;
      libItems = items;
      show(
        L.empty,
        items.length ? "" : (
          `No images in ${all ? "any project" : "this project"} yet — its History results, Gallery images and saved crops show up here.`
        ),
      );
      showMoreLibrary();
    } catch (err) {
      show(L.empty, `Couldn't list GENie's images: ${err.message || err}`);
    }
  }

  function openLibrary() {
    if (busy) return;
    lib.classList.remove("hidden");
    loadLibrary();
  }
  function closeLibrary() {
    lib.classList.add("hidden");
    L.grid.innerHTML = "";
  }

  // ------------------------------------------------------------- open / close
  const confirmDiscard = () =>
    ((saved || !edited()) && (maskSaved || !masked())) ||
    confirm("Discard the edit you haven't saved?");

  // opts (from a card's ✂ Crop): { url, name, projectId, card: { kind: "history" |
  // "gallery", id, index } } — opens the editor on that image, with Save going back to
  // the card. Without it, the plain tool.
  function open(opts) {
    if (opts?.url && !modal.classList.contains("hidden") && !confirmDiscard()) return;
    loadPen();
    modal.classList.remove("hidden");
    if (!opts?.url) {
      if (!src) clear();
      return;
    }
    showStatus("");
    target = opts.card ? { ...opts.card, projectId: opts.projectId || "default" } : null;
    el.overwrite.checked = false;
    load({ url: opts.url, name: opts.name || "image.png" });
  }

  function close() {
    if (modal.classList.contains("hidden") || busy || !confirmDiscard()) return;
    clear();
    modal.classList.add("hidden");
  }

  // ------------------------------------------------------------- wiring
  el.drop.addEventListener("click", () => el.file.click());
  el.import.addEventListener("click", openLibrary);
  el.other.addEventListener("click", openLibrary);
  el.file.addEventListener("change", () => {
    const file = el.file.files[0];
    el.file.value = "";
    if (!file || !confirmDiscard()) return;
    target = null;
    showStatus("");
    loadFile(file);
  });
  modal.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.drop.classList.add("dragover");
  });
  modal.addEventListener("dragleave", () => el.drop.classList.remove("dragover"));
  modal.addEventListener("drop", (e) => {
    e.preventDefault();
    el.drop.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (!file || busy || !confirmDiscard()) return;
    target = null;
    showStatus("");
    loadFile(file);
  });
  el.flip.addEventListener("click", () => {
    if (!crop || busy) return;
    flipped = !flipped;
    // The box and the drawing follow the picture: they stay on the same part, now on
    // the other side.
    crop = { ...crop, x: W - crop.x - crop.w };
    flipInk();
    saved = !edited();
    render();
  });
  el.reset.addEventListener("click", () => {
    if (!src || busy) return;
    // The crop and flip go back; the drawing stays (Clear drawing removes it).
    if (flipped) flipInk();
    flipped = false;
    ratioKey = "orig";
    fitRatio();
    saved = !edited();
    render();
  });
  el.overwrite.addEventListener("change", render);
  el.save.addEventListener("click", save);
  el.saveas.addEventListener("click", () => saveAs());
  M.gallery.addEventListener("click", maskToGallery);
  M.ref.addEventListener("click", maskToRefs);
  M.saveas.addEventListener("click", () => saveAs(true));
  el.gallery.addEventListener("click", toGallery);
  modal.querySelectorAll(".ie-close").forEach((b) => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  L.all.addEventListener("change", loadLibrary);
  L.more.addEventListener("click", showMoreLibrary);
  L.device.addEventListener("click", () => {
    closeLibrary();
    el.file.click();
  });
  lib.querySelectorAll(".ie-lib-close").forEach((b) => b.addEventListener("click", closeLibrary));
  lib.addEventListener("click", (e) => {
    if (e.target === lib) closeLibrary();
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (modal.classList.contains("hidden")) return;
      if (!lib.classList.contains("hidden")) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeLibrary();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return close();
      }
      const key = e.key.toLowerCase();
      if (mode !== "crop" && (e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
        if (e.target.matches?.("input:not([type=checkbox]):not([type=range]), select, textarea")) return;
        e.preventDefault();
        return key === "y" || e.shiftKey ? redo() : undo();
      }
      // Arrows nudge the box, unless typing somewhere (the overwrite box is fine).
      const step = e.shiftKey ? 10 : 1;
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!move || !crop || busy || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.matches?.("input:not([type=checkbox]), select, textarea")) return;
      e.preventDefault();
      crop = {
        ...crop,
        x: Math.max(0, Math.min(W - crop.w, crop.x + move[0])),
        y: Math.max(0, Math.min(H - crop.h, crop.y + move[1])),
      };
      saved = false;
      render();
    },
    true,
  );
  window.addEventListener("pagehide", () => src?.objectUrl && URL.revokeObjectURL(src.objectUrl));

  // ------------------------------------------------------------- entry point
  window.openImageEditor = open;
  document.getElementById("openImageEditor")?.addEventListener("click", () => open());
})();
