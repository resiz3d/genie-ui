// --- 📋 Paste media into a drop zone ---------------------------------------
// Loaded after app.js and the editors. Ctrl+V with an image (or files copied in the
// file manager) on the clipboard hands them to a drop zone as if they were dropped
// there, so every zone's own drop handling applies. Which zone:
//   1. inside an open dialog: the zone under the mouse, else its first zone, else
//      the dialog itself (the ✂ editors take drops anywhere on the dialog);
//   2. the zone under the mouse;
//   3. the zone whose field was last clicked (its title, thumbnails, …);
//   4. the Gallery.
// A zone that doesn't take that kind of file is skipped. Where the page may read the
// clipboard (localhost or HTTPS) each image zone also gets a "paste" link, for phones.
(() => {
  const ZONE = ".dropzone, #pePicker";
  const visible = (el) => !!el?.isConnected && el.getClientRects().length > 0;
  const fieldOf = (zone) => zone.closest(".field") || zone;

  // A zone's file input: inside it, or beside it (the ✂ editors).
  const inputOf = (zone) =>
    zone.querySelector("input[type=file]") ||
    zone.parentElement?.querySelector(":scope > input[type=file]");
  // What a zone takes, from its file input ("image/*", "video/*" …); "" takes anything.
  function accepts(zone, file) {
    const acc = (inputOf(zone)?.accept || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!acc.length) return /^(image|video|audio)\//.test(file.type);
    return acc.some((a) =>
      a.endsWith("/*") ? file.type.startsWith(a.slice(0, -1)) : file.type === a,
    );
  }

  let hoverZone = null;
  let lastZone = null;
  document.addEventListener("pointerover", (e) => {
    hoverZone = e.target.closest?.(ZONE) || null;
  });
  document.addEventListener("pointerdown", (e) => {
    const field = e.target.closest?.(".field, #pePicker, .modal-box");
    const zone = field?.matches(ZONE) ? field : field?.querySelector(ZONE);
    if (!zone) return;
    lastZone?.classList.remove("paste-target");
    lastZone = zone;
    zone.classList.add("paste-target");
  });

  const openModal = () =>
    [...document.querySelectorAll(".modal:not(.hidden)")].filter(visible).pop() || null;

  function pickTarget(files) {
    const ok = (z) => z && visible(z) && files.some((f) => accepts(z, f));
    const modal = openModal();
    if (modal) {
      if (ok(hoverZone) && modal.contains(hoverZone)) return hoverZone;
      const zone = [...modal.querySelectorAll(ZONE)].find(ok);
      return zone || modal.querySelector(".modal-box") || modal;
    }
    if (ok(hoverZone)) return hoverZone;
    if (ok(lastZone)) return lastZone;
    return document.getElementById("dz-gallery");
  }

  function deliver(target, files) {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    target.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
    if (target.matches(ZONE)) {
      target.classList.add("pasted");
      setTimeout(() => target.classList.remove("pasted"), 700);
    }
  }

  // A clipboard image comes without a useful name ("image.png"): give it one.
  const named = (f) =>
    f.name && f.name !== "image.png" ? f
    : new File([f], `pasted-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type });

  document.addEventListener("paste", (e) => {
    const cd = e.clipboardData;
    const files = [...(cd?.files || [])].filter((f) => /^(image|video|audio)\//.test(f.type));
    if (!files.length) return;
    // Typing into a text box: text on the clipboard goes there as usual.
    const t = e.target;
    const editable = t?.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t?.tagName);
    if (editable && cd.types.includes("text/plain")) return;
    const target = pickTarget(files);
    if (!target) return;
    e.preventDefault();
    deliver(target, files.map(named));
  });

  // ---------------------------------------------------- "paste" links (phones)
  if (!(window.isSecureContext && navigator.clipboard?.read)) return;
  document.documentElement.classList.add("can-paste");

  async function pasteInto(zone, link) {
    const old = link.textContent;
    try {
      const files = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((x) => x.startsWith("image/"));
        if (type) files.push(named(new File([await item.getType(type)], "image.png", { type })));
      }
      const fit = files.filter((f) => accepts(zone, f));
      if (!fit.length) throw new Error("No image on the clipboard");
      deliver(zone, fit);
    } catch (err) {
      link.textContent = err.name === "NotAllowedError" ? "not allowed" : "no image";
      setTimeout(() => (link.textContent = old), 1500);
    }
  }

  function addLinks(root) {
    for (const browse of root.querySelectorAll?.(".dropzone .dz-hint .browse") || []) {
      const zone = browse.closest(ZONE);
      const hint = browse.parentElement;
      if (hint.querySelector(".dz-paste")) continue;
      const acc = inputOf(zone)?.accept || "";
      if (acc && !acc.includes("image")) continue;
      const wrap = document.createElement("span");
      wrap.className = "dz-paste-wrap";
      wrap.innerHTML = ` or <span class="dz-paste" role="button" tabindex="0">paste</span>`;
      const link = wrap.querySelector(".dz-paste");
      const go = (e) => {
        e.stopPropagation(); // the zone's own click opens the file picker
        e.preventDefault();
        pasteInto(zone, link);
      };
      link.addEventListener("click", go);
      link.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && go(e));
      browse.after(wrap);
      // "Drop images here or browse or paste" → "Drop images here, browse or paste"
      const lead = browse.previousSibling;
      if (lead?.nodeType === 3) lead.textContent = lead.textContent.replace(/,?\s+or\s*$/, ", ");
    }
  }
  addLinks(document);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) addLinks(n);
  }).observe(document.body, { childList: true, subtree: true });
})();
