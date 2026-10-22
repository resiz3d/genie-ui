// --- 🖼 Image editor: crop an image to a chosen shape -----------------------------------
// Opened from the header, or from a History card's / Gallery image's ✂ Crop. The image
// comes from the device or from GENie's own images (History, Gallery, earlier crops).
// The crop box is dragged by touch or mouse — inside to move it, a corner to resize it,
// anywhere else to draw a new one — and can be locked to a common shape. The browser
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
      <div class="ie-ratios" role="group" aria-label="Crop shape"></div>
      <div class="ie-stage">
        <div class="ie-frame">
          <img class="ie-img" alt="" draggable="false" />
          <div class="ie-crop">
            <span class="ie-h" data-h="nw"></span><span class="ie-h" data-h="ne"></span>
            <span class="ie-h" data-h="sw"></span><span class="ie-h" data-h="se"></span>
          </div>
        </div>
      </div>
      <div class="fp-readout">
        <span class="ie-size"></span>
        <span class="ie-links">
          <button type="button" class="link-btn ie-flip" title="Mirror the image left to right" aria-pressed="false">⇆ Flip</button>
          <button type="button" class="link-btn ie-reset" title="Back to the whole image, unflipped">Reset</button>
          <button type="button" class="link-btn ie-other" title="Crop a different image">Open another…</button>
        </span>
      </div>
      <p class="hint ie-tip">Drag inside the box to move it, a corner to resize it, or anywhere else to draw a new one. Arrow keys nudge it (Shift: 10px).</p>
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
    "gallery", "save",
  ])
    el[k] = $(`.ie-${k}`, modal);
  const L = {};
  for (const k of ["device", "all", "count", "empty", "grid", "more"]) L[k] = $(`.ie-lib-${k}`, lib);

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
  const edited = () => !!crop && (flipped || !whole());
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

  // Show the image as large as the stage allows — a small one scaled up too, so its
  // crop box is easy to handle — within the height the stylesheet gives it.
  function fitImage() {
    if (!W || !H) return;
    el.img.style.width = el.img.style.height = "";
    const cs = getComputedStyle(el.stage);
    const availW = el.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const maxH = parseFloat(getComputedStyle(el.img).maxHeight) || window.innerHeight * 0.6;
    const s = Math.min(availW / W, maxH / H);
    el.img.style.width = `${Math.floor(W * s)}px`;
    el.img.style.height = `${Math.floor(H * s)}px`;
  }

  function render() {
    if (!src) return;
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
        (flipped ? ", flipped" : "");
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
    const s = scale();
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

  let drag = null; // { mode: "move" | "size", ax, ay (fixed corner) | ox, oy (grab offset) }
  el.frame.addEventListener("pointerdown", (e) => {
    if (!crop || busy || e.button > 0) return;
    e.preventDefault();
    const p = at(e);
    const handle = e.target.closest(".ie-h")?.dataset.h;
    if (handle) {
      // the corner opposite the one grabbed stays put
      drag = {
        mode: "size",
        ax: handle.includes("w") ? crop.x + crop.w : crop.x,
        ay: handle.includes("n") ? crop.y + crop.h : crop.y,
      };
    } else if (e.target.closest(".ie-crop")) {
      drag = { mode: "move", ox: p.x - crop.x, oy: p.y - crop.y };
    } else {
      drag = { mode: "size", ax: p.x, ay: p.y };
      crop = boxFrom(p.x, p.y, p.x, p.y);
    }
    el.frame.setPointerCapture(e.pointerId);
    saved = false;
    render();
  });
  el.frame.addEventListener("pointermove", (e) => {
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
  const endDrag = () => (drag = null);
  el.frame.addEventListener("pointerup", endDrag);
  el.frame.addEventListener("pointercancel", endDrag);
  new ResizeObserver(() => {
    fitImage();
    render();
  }).observe(el.stage);

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
    W = H = 0;
    showErr("");
    el.name.textContent = `— ${opts.name}`;
    el.drop.classList.add("hidden");
    el.import.classList.add("hidden");
    el.editor.classList.remove("hidden");
    el.img.onload = () => {
      W = el.img.naturalWidth;
      H = el.img.naturalHeight;
      fitImage();
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
    W = H = 0;
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
  // What the edit adds to the file name: -crop, -flip or -crop-flip.
  const suffix = () => [!whole() && "crop", flipped && "flip"].filter(Boolean).join("-");

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
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
    if (!blob) throw new Error("This browser couldn't make the edited image");
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[blob.type] || "png";
    return { blob, ext, name: `${baseName()}-${suffix()}.${ext}` };
  }

  // Run one save at a time, with the buttons off and errors shown.
  async function run(what, fn) {
    if (busy || !edited()) return;
    busy = true;
    showErr("");
    showStatus(`${what}…`);
    render();
    try {
      await fn();
      saved = true;
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

  const toGallery = () =>
    run("Adding to the Gallery", async () => {
      const out = await cropped();
      const base64Data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(out.blob);
      });
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Data, fileName: out.name, projectId: projectId() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.image?.id) throw new Error(data.msg || `HTTP ${res.status}`);
      if (typeof loadGallery === "function") loadGallery();
      showStatus(`Added to the Gallery as ${out.name}.`);
    });

  // Ask where to save first, while the click still counts as a user gesture (only
  // Chromium offers this, and only to localhost / https pages); elsewhere the crop goes
  // through the browser's normal download.
  async function saveAs() {
    if (busy || !edited()) return;
    const type = OUT_TYPES[src.ext] || "image/png";
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[type];
    let handle = null;
    if (window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: `${baseName()}-${suffix()}.${ext}`,
          types: [{ description: "Image", accept: { [type]: [`.${ext}`] } }],
        });
      } catch (err) {
        if (err.name === "AbortError") return; // they closed the dialog
      }
    }
    await run("Saving", async () => {
      const out = await cropped();
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
    });
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
    saved || !edited() || confirm("Discard the edit you haven't saved?");

  // opts (from a card's ✂ Crop): { url, name, projectId, card: { kind: "history" |
  // "gallery", id, index } } — opens the editor on that image, with Save going back to
  // the card. Without it, the plain tool.
  function open(opts) {
    if (opts?.url && !modal.classList.contains("hidden") && !confirmDiscard()) return;
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
    // The box follows the picture: it stays on the same part, now on the other side.
    crop = { ...crop, x: W - crop.x - crop.w };
    saved = !edited();
    render();
  });
  el.reset.addEventListener("click", () => {
    if (!src || busy) return;
    flipped = false;
    ratioKey = "orig";
    fitRatio();
    saved = true;
    render();
  });
  el.overwrite.addEventListener("change", render);
  el.save.addEventListener("click", save);
  el.saveas.addEventListener("click", saveAs);
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
