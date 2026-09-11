const form = document.getElementById("genForm");
const submitBtn = document.getElementById("submitBtn");

const errorEl = document.getElementById("error");

// Gallery
const galleryEl = document.getElementById("gallery");
const galleryCount = document.getElementById("galleryCount");
const galleryEmpty = document.getElementById("galleryEmpty");

// Credits + estimate
const creditsValue = document.getElementById("creditsValue");
const refreshCredits = document.getElementById("refreshCredits");
const estimateEl = document.getElementById("estimate");
const projectCreditsTotal = document.getElementById("projectCreditsTotal");
const projectCreditsBreakdown = document.getElementById("projectCreditsBreakdown");

// History
const historyEl = document.getElementById("history");
const historyPager = document.getElementById("historyPager");
const historyEmpty = document.getElementById("historyEmpty");
const historyFilter = document.getElementById("historyFilter");

// Projects
const projectSelect = document.getElementById("projectSelect");
const newProjectBtn = document.getElementById("newProject");
const renameProjectBtn = document.getElementById("renameProject");
const deleteProjectBtn = document.getElementById("deleteProject");

const PROJECT_KEY = "seedance_project";
let projects = [];
let activeProjectId = localStorage.getItem(PROJECT_KEY) || "default";

// Which tags to hide from the History list — a per-browser view preference (a set
// of "video"/"image"/"draft"/"favorite"). The auto-draft MP threshold is a server
// setting (so the server-side sweep applies the same rule as the client).
const HIDE_TAGS_KEY = "genie_hist_hide_tags";
let hiddenTags = new Set(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(HIDE_TAGS_KEY) || "[]");
    } catch {
      return [];
    }
  })(),
);

// Live latent previews during a local ComfyUI run (per-browser). "off" also skips
// opening the preview stream entirely.
const PREVIEW_KEY = "genie_preview_method";
let previewMethod = localStorage.getItem(PREVIEW_KEY) || "auto";

const POLL_INTERVAL_MS = 5000;

// In-flight runs are tracked server-side: every run has a pending entry in
// history.json (the durable source of truth), and background sweeps in server.js
// finish it even if this tab is closed. The client just persists the kie.ai taskId
// onto that entry as soon as it's known (see persistEntryTask) so the sweep can poll
// it, and re-attaches a live status to any pending entry on load (see
// resumeFromHistory). No localStorage — a reload, or another device, picks the run
// back up from server history.

// Record the kie.ai taskId on the run's pending History entry the moment it's known,
// so the server-side sweep can finish the run even if this tab goes away first.
// (ComfyUI runs already store their taskId server-side at queue time.)
async function persistEntryTask(job) {
  if (!job.historyId || !job.taskId) return;
  try {
    await fetch(`/api/history/${job.historyId}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: job.taskId,
        balanceBefore: job.balanceBefore,
        startedAt: job.startedAt,
      }),
    });
  } catch (err) {
    console.error("Failed to persist taskId:", err);
  }
}

let currentCredits = null;
let historyEntries = [];
const HISTORY_PAGE_SIZE = 20; // history cards per page
let historyPage = 1; // 1-based; clamped to the available page count on render
let galleryItems = [];

function show(el) {
  el.classList.remove("hidden");
}
function hide(el) {
  el.classList.add("hidden");
}

// --- lightbox (full-size media overlay) --------------------------------------
const lightbox = document.getElementById("lightbox");
const lightboxContent = document.getElementById("lightboxContent");
const lightboxPrev = document.getElementById("lightboxPrev");
const lightboxNext = document.getElementById("lightboxNext");

// When opened from History, holds the list being browsed + current position, so
// the ‹ › arrows (and ←/→ keys) can step through it. Null for single-item opens.
let lightboxNav = null;

function renderLightboxMedia(kind, src, name) {
  lightboxContent.innerHTML = "";
  let el;
  if (kind === "video") {
    el = document.createElement("video");
    el.src = src;
    el.controls = true;
    el.autoplay = true;
  } else if (kind === "audio") {
    el = document.createElement("audio");
    el.src = src;
    el.controls = true;
  } else {
    el = document.createElement("img");
    el.src = src;
    el.alt = name || "";
  }
  lightboxContent.appendChild(el);
}

function openLightbox(kind, src, name, nav = null) {
  lightboxNav = nav?.items?.length ? nav : null;
  renderLightboxMedia(kind, src, name);
  updateLightboxNav();
  show(lightbox);
}

// Show the arrows only while browsing a list, and hide each at its end.
function updateLightboxNav() {
  const active = !!lightboxNav;
  lightboxPrev.classList.toggle("hidden", !active || lightboxNav.index <= 0);
  lightboxNext.classList.toggle("hidden", !active || lightboxNav.index >= lightboxNav.items.length - 1);
}

function stepLightbox(delta) {
  if (!lightboxNav) return;
  const i = lightboxNav.index + delta;
  if (i < 0 || i >= lightboxNav.items.length) return;
  lightboxNav.index = i;
  const m = lightboxNav.items[i]; // {kind, src, name} — one output
  renderLightboxMedia(m.kind, m.src, m.name);
  updateLightboxNav();
}

function closeLightbox() {
  hide(lightbox);
  lightboxContent.innerHTML = ""; // drops the element so playback stops
  lightboxNav = null;
  updateLightboxNav();
}

lightbox.addEventListener("click", (e) => {
  // close on backdrop or the × — but not on the media itself
  if (e.target === lightbox || e.target.id === "lightboxClose") closeLightbox();
});
lightboxPrev.addEventListener("click", (e) => {
  e.stopPropagation();
  stepLightbox(-1);
});
lightboxNext.addEventListener("click", (e) => {
  e.stopPropagation();
  stepLightbox(1);
});
document.addEventListener("keydown", (e) => {
  if (lightbox.classList.contains("hidden")) return;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowLeft") stepLightbox(-1);
  else if (e.key === "ArrowRight") stepLightbox(1);
});

// Small corner button that opens a thumb's media full-size.
function makeZoomButton(kind, src, name) {
  const zoom = document.createElement("button");
  zoom.type = "button";
  zoom.className = "zoom";
  zoom.textContent = "⤢";
  zoom.title = "View full size";
  zoom.addEventListener("click", (e) => {
    e.stopPropagation();
    openLightbox(kind, src, name);
  });
  return zoom;
}

// Build a "managed" gallery thumbnail: the media preview plus the same view (⤢),
// move (⇄) and remove (×) controls the main gallery uses. Shared by the main
// gallery and the per-field pickers (kie.ai + ComfyUI) so every gallery view
// offers the same actions. `onPick(item)` runs on a body click (add-to-list or
// add-to-field, per caller); `refresh()` re-renders the caller's own view after a
// move/delete; `title` overrides the hover hint.
function makeGalleryThumb(item, { onPick, refresh, title } = {}) {
  const kind = item.kind || "image"; // older entries predate the kind field
  const div = document.createElement("div");
  div.className = `thumb ready${kind === "audio" ? " audio-thumb" : ""}`;
  div.title = title || `${item.name} — click to add`;
  div.appendChild(makeThumbContent(kind, { thumb: item.localUrl, name: item.name }));

  if (kind !== "image") {
    const badge = document.createElement("span");
    badge.className = "img-label kind-badge";
    badge.textContent = kind;
    div.appendChild(badge);
  }

  if (onPick) div.addEventListener("click", () => onPick(item));

  // After a move/delete: reload the shared gallery data, then re-render this
  // caller's own view (the main gallery re-renders via loadGallery itself).
  const afterChange = async () => { await loadGallery(); refresh?.(); };

  // move to another project (file physically moves)
  const mv = document.createElement("button");
  mv.type = "button";
  mv.className = "mv";
  mv.textContent = "⇄";
  mv.title = "Move to another project";
  mv.addEventListener("click", (e) => {
    e.stopPropagation();
    if (div.querySelector(".mv-select")) return;
    const sel = document.createElement("select");
    sel.className = "mv-select";
    const ph = new Option("Move to…", "", true, true);
    ph.disabled = true;
    sel.appendChild(ph);
    for (const p of projects) {
      if (p.id !== (item.projectId || "default")) sel.appendChild(new Option(p.name, p.id));
    }
    sel.addEventListener("click", (ev) => ev.stopPropagation());
    sel.addEventListener("change", async () => {
      try {
        const res = await fetch(`/api/images/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: sel.value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || "Move failed");
        afterChange();
      } catch (err) {
        alert(err.message || String(err));
        sel.remove();
      }
    });
    sel.addEventListener("blur", () => sel.remove());
    div.appendChild(sel);
    sel.focus();
  });
  div.appendChild(mv);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "del";
  del.textContent = "×";
  del.title = "Delete from gallery";
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await fetch(`/api/images/${item.id}`, { method: "DELETE" });
      afterChange();
    } catch (err) {
      console.error(err);
    }
  });
  div.appendChild(del);

  div.appendChild(makeZoomButton(kind, item.localUrl, item.name));
  return div;
}

// ===========================================================================
// Media lists (images / videos / audio) — one factory drives all three.
// Items: { uid, localId, remoteUrl, thumb, name, status }
//   localId   — id of a locally-saved file (hosted on kie.ai at generate time)
//   remoteUrl — a URL dropped directly (used as-is, no upload)
// Dropping a file only saves it locally; nothing goes to the kie.ai API
// until Generate is clicked.
// ===========================================================================

const REORDER_TYPE = "application/x-seedance-reorder";
let nextUid = 1;

const KIND_LABEL = { image: "Image", video: "Video", audio: "Audio" };

// `kind` is the list's DOM/id namespace (image/video/audio/firstFrame/lastFrame).
// opts.mediaType is the actual media family for rendering + file-type filtering
// (defaults to kind); opts.single caps the list at one item (first/last frame).
// opts.max caps a multi list at N items. opts.build creates the field DOM (with a
// per-field gallery picker) instead of binding to fixed ids in index.html — used
// by ComfyUI workflow controls, so they get the same reorder/zoom/gallery UI.
// opts.label / opts.labelSep set the numbered badge text (e.g. "Picture 1").
function makeMediaList(kind, opts = {}) {
  const mediaType = opts.mediaType || kind;
  const single = !!opts.single;
  const max = single ? 1 : opts.max || Infinity;
  const numLabel = opts.label || KIND_LABEL[mediaType];
  const numSep = opts.labelSep ?? "";

  // Per-file "use last N sec" rows, for video fields whose loader can skip frames.
  const tailGrid = opts.tail ? opts.tailGrid || null : null;
  let dropzone, thumbs, fileInput, clearBtn, galleryWrap, galleryThumbs, galleryEmptyEl, fieldEl, tailsEl;
  if (opts.build) {
    // Build the field ourselves (ComfyUI controls have no static markup).
    const noun = mediaType === "audio" ? "audio files" : `${mediaType}s`;
    fieldEl = document.createElement("div");
    fieldEl.className = "field";
    fieldEl.innerHTML =
      `<div class="field-head"><span>${escapeHtmlJs(opts.title || numLabel)} ` +
      `<span class="hint">${escapeHtmlJs(opts.hint || "")}</span></span>` +
      `<button type="button" class="link-btn hidden">Clear all</button></div>` +
      `<div class="dropzone"><div class="thumbs"></div>` +
      `<p class="dz-hint">Drop ${noun} here or <span class="browse">browse</span></p>` +
      `<input type="file" accept="${mediaType}/*" multiple hidden /></div>` +
      `<div class="media-tails"></div>` +
      `<details class="gallery-wrap comfy-gallery"><summary>Pick from gallery</summary>` +
      `<p class="dz-hint gallery-empty">No saved ${mediaType}s in this project yet.</p>` +
      `<div class="thumbs gallery"></div></details>`;
    dropzone = fieldEl.querySelector(".dropzone");
    tailsEl = fieldEl.querySelector(".media-tails");
    thumbs = fieldEl.querySelector(".dropzone .thumbs");
    fileInput = fieldEl.querySelector("input[type=file]");
    clearBtn = fieldEl.querySelector(".link-btn");
    galleryWrap = fieldEl.querySelector(".comfy-gallery");
    galleryThumbs = fieldEl.querySelector(".gallery");
    galleryEmptyEl = fieldEl.querySelector(".gallery-empty");
  } else {
    dropzone = document.getElementById(`dz-${kind}`);
    thumbs = document.getElementById(`thumbs-${kind}`);
    fileInput = document.getElementById(`file-${kind}`);
    clearBtn = document.getElementById(`clear-${kind}`);
  }
  const reorderType = `${REORDER_TYPE}-${kind}`; // reorder stays within one list
  const roomFor = (n = 1) => list.items.length + n <= max;

  const list = {
    kind,
    el: fieldEl, // set when opts.build
    items: [],

    render() {
      thumbs.innerHTML = "";
      let n = 0; // numbers only "ready" items, matching the URL order sent
      for (const item of list.items) {
        const div = document.createElement("div");
        div.className = `thumb ${item.status}${mediaType === "audio" ? " audio-thumb" : ""}`;
        div.title = item.name || item.remoteUrl || "";
        div.draggable = !single; // single-item frames don't reorder

        div.appendChild(makeThumbContent(mediaType, item));

        if (item.status === "ready" && !single) {
          n++;
          const label = document.createElement("span");
          label.className = "img-label";
          label.textContent = `${numLabel}${numSep}${n}`;
          div.appendChild(label);
        }

        const x = document.createElement("button");
        x.type = "button";
        x.className = "x";
        x.textContent = "×";
        x.title = "Remove";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          list.items = list.items.filter((i) => i.uid !== item.uid);
          list.render();
        });
        div.appendChild(x);

        const zoomSrc = item.thumb || item.remoteUrl;
        if (zoomSrc) div.appendChild(makeZoomButton(mediaType, zoomSrc, item.name));

        // drag-to-reorder within this list
        div.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData(reorderType, String(item.uid));
          e.dataTransfer.effectAllowed = "move";
          div.classList.add("dragging");
        });
        div.addEventListener("dragend", () => {
          div.classList.remove("dragging");
          thumbs.querySelectorAll(".drop-target").forEach((t) => t.classList.remove("drop-target"));
        });
        div.addEventListener("dragover", (e) => {
          if (![...e.dataTransfer.types].includes(reorderType)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          div.classList.add("drop-target");
        });
        div.addEventListener("dragleave", () => div.classList.remove("drop-target"));
        div.addEventListener("drop", (e) => {
          if (![...e.dataTransfer.types].includes(reorderType)) return;
          e.preventDefault();
          e.stopPropagation();
          div.classList.remove("drop-target");
          list.reorder(Number(e.dataTransfer.getData(reorderType)), item.uid);
        });

        thumbs.appendChild(div);
      }
      clearBtn.classList.toggle("hidden", list.items.length === 0);
      list.renderTails();
      updateEstimate();
      opts.onChange?.(); // reference labels depend on what's filled across all fields
    },

    // One tail row per ready file, numbered like its thumbnail. Lengths are probed
    // lazily (server-side ffprobe) and re-rendered when they arrive.
    renderTails() {
      if (!tailsEl) return;
      const ready = list.items.filter((i) => i.status === "ready");
      tailsEl.innerHTML = "";
      if (!opts.tail || !ready.length) return;
      ready.forEach((item, i) => {
        if (item.localId && item.probe === undefined) {
          item.probe = null; // probe once per file; null until it lands
          probeGalleryVideo(item.localId).then((p) => {
            item.probe = p;
            list.renderTails();
          });
        }
        tailsEl.appendChild(
          makeTailRow({
            label: `${numLabel}${numSep}${i + 1}`,
            seconds: item.tailSec || 0,
            probe: item.probe || null,
            grid: tailGrid,
            onInput: (v) => { item.tailSec = v; },
          })
        );
      });
    },

    // Per-file tails for the ready files, in slot order: [{seconds, id}].
    tails() {
      return list.items
        .filter((i) => i.status === "ready")
        .map((i) => ({ seconds: i.tailSec || 0, id: i.localId || null }));
    },

    reorder(fromUid, toUid) {
      if (fromUid === toUid) return;
      const from = list.items.findIndex((i) => i.uid === fromUid);
      const to = list.items.findIndex((i) => i.uid === toUid);
      if (from < 0 || to < 0) return;
      const [moved] = list.items.splice(from, 1);
      list.items.splice(to, 0, moved);
      list.render();
    },

    addUrl(url) {
      if (!url) return;
      if (single) list.items = [];
      else if (!roomFor()) return;
      const entry = { uid: nextUid++, localId: null, remoteUrl: url, thumb: url, name: url, status: "ready" };
      list.items.push(entry);
      list.render();
      if (mediaType === "video") {
        probeDuration(url).then((d) => {
          entry.durationSec = d;
          updateEstimate();
        });
      }
    },

    // Read a local file, show a thumbnail, and save it locally only.
    addFile(file) {
      if (single) list.items = [];
      else if (!roomFor()) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const entry = {
          uid: nextUid++,
          localId: null,
          remoteUrl: null,
          thumb: reader.result,
          name: file.name,
          status: "saving",
        };
        list.items.push(entry);
        list.render();

        try {
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64Data: reader.result, fileName: file.name, projectId: activeProjectId }),
          });
          const data = await res.json();
          if (!res.ok || !data.image?.id) throw new Error(data.msg || "Save failed");
          entry.localId = data.image.id;
          entry.thumb = data.image.localUrl || entry.thumb;
          entry.status = "ready";
          if (mediaType === "video") {
            probeDuration(entry.thumb).then((d) => {
              entry.durationSec = d;
              updateEstimate();
            });
          }
          loadGallery();
        } catch (err) {
          console.error(err);
          entry.status = "error";
        }
        list.render();
      };
      reader.readAsDataURL(file);
    },

    addFromGallery(item) {
      if (single) list.items = [];
      else if (!roomFor()) return;
      const entry = {
        uid: nextUid++,
        localId: item.id,
        remoteUrl: null,
        thumb: item.localUrl,
        name: item.name,
        status: "ready",
        tailSec: Number(item.tail) || 0, // remembered per-file reference tail, if any
      };
      list.items.push(entry);
      list.render();
      if (mediaType === "video") {
        probeDuration(item.localUrl).then((d) => {
          entry.durationSec = d;
          updateEstimate();
        });
      }
    },

    addFiles(fileList) {
      let files = single ? [...fileList].slice(0, 1) : [...fileList];
      if (Number.isFinite(max)) files = files.slice(0, Math.max(0, max - list.items.length));
      for (const file of files) {
        if (file.type.startsWith(`${mediaType}/`)) list.addFile(file);
      }
    },

    // Host any local items on kie.ai now, returning the ordered URL list.
    async resolve() {
      const ready = list.items.filter((i) => i.status === "ready");
      // Sequential on purpose: parallel uploads saturate the (usually much
      // smaller) upstream link and stall everything else on the connection.
      const urls = [];
      for (const item of ready) {
        if (item.remoteUrl) {
          urls.push(item.remoteUrl);
          continue;
        }
        if (!item.localId) throw new Error(`${item.name || kind}: missing source`);
        const res = await fetch("/api/reupload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.localId }),
        });
        const data = await res.json();
        if (!res.ok || !data.hostedUrl) throw new Error(`${item.name || kind}: upload failed`);
        urls.push(data.hostedUrl);
      }
      return urls;
    },

    localIds() {
      return list.items.filter((i) => i.status === "ready" && i.localId).map((i) => i.localId);
    },

    clear() {
      list.items = [];
      list.render();
    },
  };

  // --- dropzone interactions ---
  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    list.addFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      if ([...e.dataTransfer.types].includes(reorderType)) return; // internal reorder, not a file drop
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === "dragleave" && dropzone.contains(e.relatedTarget)) return;
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    if ([...e.dataTransfer.types].includes(reorderType)) return;
    if (e.dataTransfer.files?.length) {
      list.addFiles(e.dataTransfer.files);
      return;
    }
    if (opts.localOnly) return; // ComfyUI needs a real file, not a hosted URL
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (url && /^https?:\/\//i.test(url.trim())) list.addUrl(url.trim());
  });

  clearBtn.addEventListener("click", () => list.clear());

  // Per-field gallery picker (built lists only): reuse this project's saved media.
  if (galleryWrap) {
    const renderPicker = () => {
      galleryThumbs.innerHTML = "";
      const gitems = galleryItems.filter(
        (i) => (i.kind || "image") === mediaType && (i.projectId || "default") === activeProjectId
      );
      galleryEmptyEl.classList.toggle("hidden", gitems.length > 0);
      for (const item of gitems) {
        galleryThumbs.appendChild(
          makeGalleryThumb(item, { onPick: (it) => list.addFromGallery(it), refresh: renderPicker })
        );
      }
    };
    galleryWrap.addEventListener("toggle", () => { if (galleryWrap.open) renderPicker(); });
  }

  return list;
}

// Read a media file's duration (seconds) from its metadata; null if unreadable.
function probeDuration(src) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => resolve(null);
    v.src = src;
  });
}

// Total seconds of ready reference videos (video refs bill by combined
// input + output duration, per seedance2.ai — unconfirmed by kie.ai docs).
function refVideoSeconds() {
  return lists.video.items
    .filter((i) => i.status === "ready")
    .reduce((sum, i) => sum + (i.durationSec || 0), 0);
}

// Build the preview element for a thumb by kind.
function makeThumbContent(kind, item) {
  const src = item.thumb || item.remoteUrl || (item.localUrl ?? "");
  if (kind === "video") {
    const v = document.createElement("video");
    v.src = src;
    v.muted = true;
    v.preload = "metadata";
    v.draggable = false;
    return v;
  }
  if (kind === "audio") {
    const wrap = document.createElement("div");
    wrap.className = "audio-tile";
    wrap.draggable = false;
    const icon = document.createElement("span");
    icon.className = "audio-icon";
    icon.textContent = "♪";
    const name = document.createElement("span");
    name.className = "audio-name";
    name.textContent = item.name || "audio";
    wrap.append(icon, name);
    return wrap;
  }
  const el = document.createElement("img");
  el.src = src;
  el.draggable = false;
  return el;
}

const lists = {
  image: makeMediaList("image"),
  video: makeMediaList("video"),
  audio: makeMediaList("audio"),
  // Seedance 2.5 start/end keyframes — single image each, rendered like images.
  firstFrame: makeMediaList("firstFrame", { mediaType: "image", single: true }),
  lastFrame: makeMediaList("lastFrame", { mediaType: "image", single: true }),
};
const allItems = () => Object.values(lists).flatMap((l) => l.items);

// --- projects ----------------------------------------------------------------
function projectName(id) {
  return projects.find((p) => p.id === id)?.name || "Default";
}

async function loadProjects() {
  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    projects = data.data || [];
  } catch (err) {
    console.error("Failed to load projects:", err);
    projects = [{ id: "default", name: "Default" }];
  }
  // Alphabetical (case-insensitive) everywhere the list is shown — the project pill,
  // the history filter, and the "move to project" dropdown all iterate `projects`.
  // Default stays pinned first as the system catch-all.
  projects.sort((a, b) => {
    if (a.id === "default") return -1;
    if (b.id === "default") return 1;
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  });
  if (!projects.some((p) => p.id === activeProjectId)) activeProjectId = "default";
  renderProjectControls();
}

function renderProjectControls() {
  projectSelect.innerHTML = "";
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    projectSelect.appendChild(opt);
  }
  projectSelect.value = activeProjectId;

  // history filter: All + each project; keep the current choice if still valid
  const prev = historyFilter.value || activeProjectId;
  historyFilter.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All projects";
  historyFilter.appendChild(all);
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    historyFilter.appendChild(opt);
  }
  historyFilter.value = [...historyFilter.options].some((o) => o.value === prev) ? prev : activeProjectId;

  renderGallery(galleryItems);
  renderHistory(historyEntries);
}

function setActiveProject(id) {
  activeProjectId = id;
  localStorage.setItem(PROJECT_KEY, id);
  projectSelect.value = id;
  historyFilter.value = id;
  renderGallery(galleryItems);
  historyPage = 1; // changing the filtered set starts back at the first page
  renderHistory(historyEntries);
}

projectSelect.addEventListener("change", () => setActiveProject(projectSelect.value));
historyFilter.addEventListener("change", () => {
  historyPage = 1; // new filter → back to page 1
  renderHistory(historyEntries);
});

// History tag controls: the "Hide:" checkboxes (which tags to drop from the list),
// and the auto-draft MP threshold (a server setting — the sweep applies it too, so
// it's fetched/saved server-side).
const hideTagEls = [...document.querySelectorAll(".hist-hide-tag")];
const autoDraftMaxEl = document.getElementById("autoDraftMax");
for (const el of hideTagEls) {
  el.checked = hiddenTags.has(el.value);
  el.addEventListener("change", () => {
    if (el.checked) hiddenTags.add(el.value);
    else hiddenTags.delete(el.value);
    localStorage.setItem(HIDE_TAGS_KEY, JSON.stringify([...hiddenTags]));
    historyPage = 1;
    renderHistory(historyEntries);
  });
}
fetch("/api/settings")
  .then((r) => r.json())
  .then((d) => { autoDraftMaxEl.value = Number(d.data?.autoDraftMaxMP) || 0; })
  .catch(() => {});
autoDraftMaxEl.addEventListener("change", () => {
  const autoDraftMaxMP = Math.max(0, Number(autoDraftMaxEl.value) || 0);
  autoDraftMaxEl.value = autoDraftMaxMP;
  fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoDraftMaxMP }),
  }).catch(() => {});
});

// Live preview method for local runs — sent with each queued prompt.
const previewMethodEl = document.getElementById("previewMethod");
previewMethodEl.value = previewMethod;
previewMethodEl.addEventListener("change", () => {
  previewMethod = previewMethodEl.value;
  localStorage.setItem(PREVIEW_KEY, previewMethod);
  if (previewMethod === "off") closePreviewStream();
});

// Toggle a history entry's tag (draft/favorite) and refresh.
async function toggleHistoryTag(entry, tag) {
  const next = !entry[tag];
  try {
    const res = await fetch(`/api/history/${entry.id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [tag]: next }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.msg || "Update failed");
    // draft/favorite relocate the file server-side, so the entry's saved paths
    // change. Sync them from the response (not just the tag flag) so the re-render
    // points the <video>/<img> at the new URL instead of the now-moved old one.
    Object.assign(entry, body.data || { [tag]: next });
    renderHistory(historyEntries);
  } catch (err) {
    alert(err.message || String(err));
  }
}

// open the output folder matching the history filter (all → video/ root)
document.getElementById("openFolder").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: historyFilter.value || "all" }),
    });
    if (!res.ok) throw new Error((await res.json()).msg || "Failed to open folder");
  } catch (err) {
    alert(err.message || String(err));
  }
});

// Export opens a modal to choose which tags exclude a card (hidden pre-checked).
const exportModal = document.getElementById("exportModal");
const exportExcludeTags = document.getElementById("exportExcludeTags");
document.getElementById("exportHistory").addEventListener("click", () => {
  // Export is per-project — the History filter must be on a specific project.
  const projectId = historyFilter.value;
  if (!projectId || projectId === "all") {
    alert('Pick a specific project in the History filter to export (the "All projects" view can\'t be exported).');
    return;
  }
  const opts = [
    { tag: "hidden", label: "Hidden", checked: true },
    { tag: "favorite", label: "Favorites", checked: false },
    { tag: "draft", label: "Draft", checked: false },
    { tag: "video", label: "Videos", checked: false },
    { tag: "image", label: "Images", checked: false },
  ];
  exportExcludeTags.innerHTML = "";
  for (const o of opts) {
    const lbl = document.createElement("label");
    lbl.className = "inline";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = o.tag;
    cb.checked = o.checked;
    lbl.append(cb, document.createTextNode(` ${o.label}`));
    exportExcludeTags.appendChild(lbl);
  }
  show(exportModal);
});
document.getElementById("exportCancel").addEventListener("click", () => hide(exportModal));
exportModal.addEventListener("click", (e) => { if (e.target === exportModal) hide(exportModal); });
document.getElementById("exportConfirm").addEventListener("click", async () => {
  const projectId = historyFilter.value;
  const excludeTags = [...exportExcludeTags.querySelectorAll("input:checked")].map((c) => c.value);
  const btn = document.getElementById("exportConfirm");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Exporting…";
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, excludeTags }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || "Export failed");
    hide(exportModal);
    alert(
      `Exported ${data.data.entries} generation(s) (${data.data.filesCopied} files) to:\n\n` +
        `${data.data.path}\n\n` +
        `It opened in your file browser. Open index.html to view it, or zip the folder to share.`
    );
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
});

newProjectBtn.addEventListener("click", async () => {
  const name = prompt("New project name:");
  if (!name?.trim()) return;
  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json();
    if (!res.ok || !data.data?.id) throw new Error(data.msg || "Failed to create project");
    await loadProjects();
    setActiveProject(data.data.id);
  } catch (err) {
    alert(err.message || String(err));
  }
});

renameProjectBtn.addEventListener("click", async () => {
  const current = projectName(activeProjectId);
  const name = prompt(`Rename project "${current}" to:`, current);
  if (!name?.trim() || name.trim() === current) return;
  try {
    const res = await fetch(`/api/projects/${activeProjectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || "Rename failed");
    await loadProjects();
  } catch (err) {
    alert(err.message || String(err));
  }
});

deleteProjectBtn.addEventListener("click", async () => {
  if (activeProjectId === "default") {
    alert("The Default project cannot be deleted.");
    return;
  }
  const name = projectName(activeProjectId);
  if (!confirm(`Delete project "${name}"?\n\nIts gallery media and history will move to Default.`)) return;
  try {
    const res = await fetch(`/api/projects/${activeProjectId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || "Delete failed");
    await loadProjects();
    setActiveProject("default");
    loadGallery();
    loadHistory();
  } catch (err) {
    alert(err.message || String(err));
  }
});

// --- gallery ---------------------------------------------------------------
async function loadGallery() {
  try {
    const res = await fetch("/api/images");
    const data = await res.json();
    galleryItems = data.data || [];
    renderGallery(galleryItems);
  } catch (err) {
    console.error("Failed to load gallery:", err);
  }
}

function renderGallery(items) {
  galleryEl.innerHTML = "";
  // strict per-project scoping (entries predating projects belong to Default)
  const visible = items.filter((i) => (i.projectId || "default") === activeProjectId);
  galleryCount.textContent = visible.length ? `(${visible.length})` : "";
  galleryEmpty.classList.toggle("hidden", visible.length > 0);

  for (const item of visible) {
    galleryEl.appendChild(
      makeGalleryThumb(item, { onPick: (it) => lists[it.kind || "image"].addFromGallery(it) })
    );
  }
}

// --- credits + estimate ------------------------------------------------------
async function loadCredits() {
  try {
    const res = await fetch("/api/credits");
    const data = await res.json();
    if (typeof data.data === "number") {
      currentCredits = data.data;
      creditsValue.textContent = currentCredits.toLocaleString();
    } else {
      creditsValue.textContent = "—";
    }
  } catch {
    creditsValue.textContent = "—";
  }
  return currentCredits;
}
refreshCredits.addEventListener("click", loadCredits);

// How many of the most-recent matching runs feed a price estimate. Estimates are
// built from the LATEST runs (not an all-time average) so they track price
// changes — sales starting or ending — in both directions with no manual reset;
// taking the median of a few shrugs off the billing noise of overlapping runs.
const RECENT_RATE_SAMPLES = 3;

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// The matching history entries, newest first (defensive re-sort — don't rely on
// stored order). `extra` narrows further (e.g. seedream quality tier).
function recentMatches(model, extra = () => true) {
  return historyEntries
    .filter(
      (e) =>
        (e.input?.model || "bytedance/seedance-2") === model &&
        typeof e.costCredits === "number" &&
        e.costCredits > 0 &&
        extra(e)
    )
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

// credits/sec from the most recent matching runs (video), using effective seconds
// (output duration + reference-video seconds, since video refs appear to bill by
// combined input+output duration). Null until at least one matching run exists.
function ratePerSec(model, resolution, audioOn) {
  const rates = recentMatches(
    model,
    (e) =>
      e.input?.resolution === resolution &&
      (e.input?.generate_audio !== false) === audioOn &&
      e.input?.duration > 0
  )
    .slice(0, RECENT_RATE_SAMPLES)
    .map((e) => e.costCredits / (e.input.duration + (e.refVideoSeconds || 0)));
  return rates.length ? { rate: median(rates), n: rates.length } : null;
}

function updateEstimate() {
  const model = modelSelect.value;

  // Image models: flat per-generation cost, learned per model + quality tier.
  if (isSeedream()) {
    const quality = qualitySelect.value;
    const costs = recentMatches(model, (e) => (e.input?.quality || "basic") === quality)
      .slice(0, RECENT_RATE_SAMPLES)
      .map((e) => e.costCredits);
    if (!costs.length) {
      estimateEl.textContent = `No estimate yet for ${seedreamLabel(model)} (${quality}) — will measure after a run.`;
      estimateEl.title = "";
      return;
    }
    const est = Math.round(median(costs));
    estimateEl.innerHTML = `Est. cost: ~<b>${est.toLocaleString()}</b> credits`;
    estimateEl.title = `Median of your ${costs.length} most recent ${seedreamLabel(model)} run${costs.length > 1 ? "s" : ""} at this quality.`;
    return;
  }

  const resolution = document.getElementById("resolution").value;
  const duration = Number(document.getElementById("duration").value) || 0;
  const audioOn = document.getElementById("generate_audio").checked;
  const r = ratePerSec(model, resolution, audioOn);
  if (!r || !duration) {
    const label = `${videoModelLabel(model)} at ${resolution}`;
    estimateEl.textContent = `No estimate yet for ${label} — will measure after a run.`;
    estimateEl.title = "";
    return;
  }
  const refSecs = refVideoSeconds();
  const est = Math.round(r.rate * (duration + refSecs));
  const refNote = refSecs > 0 ? ` (incl. ~${Math.round(refSecs)}s video ref)` : "";
  const overLimit = refSecs > 15 ? ` ⚠ video refs exceed the 15s total limit` : "";
  estimateEl.innerHTML = `Est. cost: ~<b>${est.toLocaleString()}</b> credits${refNote}${overLimit}`;
  estimateEl.title = `Based on your ${r.n} most recent run${r.n > 1 ? "s" : ""} at this resolution/audio setting (median).`;
}

["resolution", "duration"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateEstimate)
);
document.getElementById("generate_audio").addEventListener("change", updateEstimate);

// Per-model form shaping: Seedance 2 Fast and Mini cap resolution at 720p;
// Seedream 5.0 Lite is image-to-image (no duration/resolution/audio/video, has
// quality, different aspect ratios).
const modelSelect = document.getElementById("model");
const resolutionSelect = document.getElementById("resolution");
const qualitySelect = document.getElementById("quality");
const aspectSelect = document.getElementById("aspect_ratio");

const VIDEO_ASPECTS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
// Seedance 2.5 and 2.0 Mini add an "adaptive" ratio (2.0 and Fast don't).
const VIDEO_ASPECTS_ADAPTIVE = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const IMAGE_ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"];

// Output-format options by output medium: [value, label].
const IMAGE_FORMATS = [["png", "PNG"], ["jpeg", "JPEG"]];
const VIDEO_FORMATS = [["mp4", "mp4"], ["mov", "mov"]];

const isSeedream = () => modelSelect.value.startsWith("seedream/");
const is25 = () => modelSelect.value === "bytedance/seedance-2-5";
// Local ComfyUI workflows are selected as `comfy:<file.json>`.
const isComfy = () => modelSelect.value.startsWith("comfy:");
const comfyFile = () => modelSelect.value.slice("comfy:".length);
// Every Seedance video model (2.5 / 2 / Fast / Mini) exposes first/last-frame
// inputs; 2.5-only extras (mp4/mov, adaptive, 30s, return_last_frame) stay on is25.
const isSeedanceVideo = () => modelSelect.value.startsWith("bytedance/seedance-");

// Seedance makes reference images and first/last frames mutually exclusive (the
// API rejects mixing them), so a toggle picks which set is active. Only the active
// set is shown and sent. `frameMode()` is the raw toggle; `usesFrames()` is true
// only when a Seedance video model is active AND the toggle is on frames.
function frameMode() {
  return document.querySelector('input[name="imageSource"]:checked')?.value || "refs";
}
const usesFrames = () => isSeedanceVideo() && frameMode() === "frames";
const isI2I = () => isSeedream() && modelSelect.value.endsWith("-image-to-image");
const isT2I = () => isSeedream() && modelSelect.value.endsWith("-text-to-image");
// all seedream variants end in "-to-image"; video models never do
const isImageOutput = (model) => (model || "").includes("-to-image");

// Highest resolution each video model supports. The dropdown lists 480p/720p/
// 1080p/4k; options above a model's ceiling are disabled. Seedance 2.5 tops out
// at 1080p (kie.ai's "4K" is marketing — the API's resolution enum stops at
// 1080p); Fast and Mini cap at 720p; the standard model reaches 4k. Anything not
// listed is treated as uncapped (4k).
const RESOLUTION_ORDER = ["480p", "720p", "1080p", "4k"];
const MAX_RESOLUTION = {
  "bytedance/seedance-2-5": "1080p",
  "bytedance/seedance-2-fast": "720p",
  "bytedance/seedance-2-mini": "720p",
};

// Models whose aspect_ratio list includes "adaptive" (2.5 and 2.0 Mini per the
// kie.ai docs; 2.0 and Fast do not offer it).
const ADAPTIVE_ASPECT_MODELS = new Set(["bytedance/seedance-2-5", "bytedance/seedance-2-mini"]);
const hasAdaptiveAspect = () => ADAPTIVE_ASPECT_MODELS.has(modelSelect.value);
// Index into RESOLUTION_ORDER of the current model's ceiling (default: 4k).
const maxResolutionIndex = () =>
  RESOLUTION_ORDER.indexOf(MAX_RESOLUTION[modelSelect.value] || "4k");

// Short suffix distinguishing the non-standard video variants in labels.
const VIDEO_VARIANT_LABEL = {
  "bytedance/seedance-2-5": "2.5",
  "bytedance/seedance-2-fast": "Fast",
  "bytedance/seedance-2-mini": "Mini",
};

// Full display name for a video model id.
function videoModelLabel(model) {
  if (model === "bytedance/seedance-2-5") return "Seedance 2.5";
  if (model === "bytedance/seedance-2-fast") return "Seedance 2 Fast";
  if (model === "bytedance/seedance-2-mini") return "Seedance 2 Mini";
  return "Seedance 2";
}

// Short display name for a seedream model id, e.g. "Seedream Pro".
function seedreamLabel(model) {
  return (model || "").includes("5-pro") ? "Seedream Pro" : "Seedream Lite";
}

// Only the Pro variants document the output_format parameter.
const isSeedreamPro = () => isSeedream() && modelSelect.value.includes("5-pro");

// Quality tiers resolve to different output sizes per family:
// Lite: basic=2K, high=4K.  Pro: basic=1K, high=2K.
const QUALITY_LABELS = {
  lite: { basic: "Basic (2K)", high: "High (4K)" },
  pro: { basic: "Basic (1K)", high: "High (2K)" },
};

function setQualityLabels() {
  const tier = modelSelect.value.includes("5-pro") ? "pro" : "lite";
  for (const opt of qualitySelect.options) {
    opt.textContent = QUALITY_LABELS[tier][opt.value] || opt.value;
  }
}

function setAspectOptions(values, preferred = "16:9") {
  const cur = aspectSelect.value;
  aspectSelect.innerHTML = "";
  for (const v of values) aspectSelect.appendChild(new Option(v, v));
  aspectSelect.value = values.includes(cur)
    ? cur
    : values.includes(preferred)
    ? preferred
    : values[0];
}

// Repopulate the output-format select for the active output medium.
const outputFormatSelect = document.getElementById("output_format");
function setFormatOptions(values, def) {
  const cur = outputFormatSelect.value;
  outputFormatSelect.innerHTML = "";
  for (const [v, label] of values) outputFormatSelect.appendChild(new Option(label, v));
  outputFormatSelect.value = values.some(([v]) => v === cur) ? cur : def;
}

// kie.ai form fields hidden entirely when a local ComfyUI workflow is selected.
const KIE_FIELDS = [
  "promptField", "imageSourceField", "imageField", "galleryWrap", "firstFrameField",
  "lastFrameField", "videoField", "audioField", "optionsRow", "checksRow",
];

function applyModelUI() {
  const comfy = isComfy();
  const cc = document.getElementById("comfyControls");
  cc.classList.toggle("hidden", !comfy);
  cc.classList.toggle("comfy-grid", comfy);
  document.getElementById("comfyCountField").classList.toggle("hidden", !comfy);
  document.getElementById("previewMethodField").classList.toggle("hidden", !comfy);
  if (comfy) {
    // Swap the whole kie.ai form for token-driven workflow controls.
    for (const id of KIE_FIELDS) document.getElementById(id).classList.add("hidden");
    estimateEl.classList.add("hidden");
    comfyRenderPromise = renderComfyControls(); // async (fetches ComfyUI options); awaited on re-import
    updateModelChrome();
    return;
  }
  for (const id of KIE_FIELDS) document.getElementById(id).classList.remove("hidden");
  estimateEl.classList.remove("hidden");

  const seedream = isSeedream();
  const maxResIdx = maxResolutionIndex();
  const frames = is25();
  for (const id of ["videoField", "audioField", "resolutionField", "durationField", "genAudioField", "webSearchField"]) {
    document.getElementById(id).classList.toggle("hidden", seedream);
  }
  // Seedance video models make reference images and first/last frames mutually
  // exclusive, so a toggle chooses which set is shown. `refsHidden` hides
  // reference images (text-to-image, or any Seedance model in frames mode); the
  // frame dropzones show only in that mode. "return last frame" is a 2.5-only
  // output option.
  const seedanceVideo = isSeedanceVideo();
  const framesMode = usesFrames();
  const refsHidden = isT2I() || framesMode;
  document.getElementById("imageSourceField").classList.toggle("hidden", !seedanceVideo);
  document.getElementById("imageField").classList.toggle("hidden", refsHidden);
  document.getElementById("galleryWrap").classList.toggle("hidden", refsHidden);
  document.getElementById("qualityField").classList.toggle("hidden", !seedream);
  for (const id of ["firstFrameField", "lastFrameField"]) {
    document.getElementById(id).classList.toggle("hidden", !framesMode);
  }
  document.getElementById("returnLastFrameField").classList.toggle("hidden", !frames);
  // Output format applies to Seedream Pro (png/jpeg) and Seedance 2.5 (mp4/mov).
  const showFormat = isSeedreamPro() || frames;
  document.getElementById("formatField").classList.toggle("hidden", !showFormat);
  if (frames) setFormatOptions(VIDEO_FORMATS, "mp4");
  else if (isSeedreamPro()) setFormatOptions(IMAGE_FORMATS, "png");
  if (seedream) setQualityLabels();
  setAspectOptions(
    seedream ? IMAGE_ASPECTS : hasAdaptiveAspect() ? VIDEO_ASPECTS_ADAPTIVE : VIDEO_ASPECTS,
    frames ? "adaptive" : "16:9" // only 2.5 documents adaptive as its default
  );
  // Disable any resolution above this model's ceiling; if the current selection
  // is now disabled, drop to the highest allowed option.
  for (const opt of resolutionSelect.options) {
    opt.disabled = RESOLUTION_ORDER.indexOf(opt.value) > maxResIdx;
  }
  if (RESOLUTION_ORDER.indexOf(resolutionSelect.value) > maxResIdx) {
    resolutionSelect.value = RESOLUTION_ORDER[maxResIdx];
  }
  // Seedance 2.5 allows up to 30s; the other video models cap at 15s.
  const durInput = document.getElementById("duration");
  durInput.max = frames ? 30 : 15;
  if (Number(durInput.value) > Number(durInput.max)) durInput.value = durInput.max;
  updatePromptCount(); // the cap depends on the selected model
  updateEstimate();
  updateModelChrome();
}

// Retitle the page and the Generate button for the selected model.
function updateModelChrome() {
  const label = modelSelect.options[modelSelect.selectedIndex].textContent.replace(/\s*\(.*\)$/, "").trim();
  if (isComfy()) {
    document.getElementById("pageTitle").textContent = label;
    document.getElementById("pageSub").innerHTML =
      `Run ${escapeHtmlJs(label)} on your local ComfyUI ` +
      `<span class="experimental-tag">Experimental</span>`;
    document.title = `GENie — ${label}`;
    submitBtn.textContent = "Generate";
    return;
  }
  const image = isSeedream();
  const medium = image ? "image" : "video";
  document.getElementById("pageTitle").textContent = label;
  document.getElementById("pageSub").textContent = `Generate ${medium} with the ${label} model`;
  document.title = `GENie — ${label}`;
  submitBtn.textContent = image ? "Generate Image" : "Generate Video";
}
const MODEL_KEY = "seedance_last_model";
// --- continuation --------------------------------------------------------------
// A workflow can tag two tokens `; continue.in` / `; continue.out`; the server then
// hands each run an opaque integer and records which run it continued. GENie never
// learns what the number means — that's the workflow's business.
//
// `armedContinuation` is the intent for the *next* Generate, set by a history card's
// Continue or Re-roll. Cleared whenever the form is repopulated from elsewhere, so a
// plain Re-import can't leave one attached to an unrelated run.
const continueBanner = document.getElementById("continueBanner");
let armedContinuation = null; // { parentId, from, into|null, file, label }

function renderContinueBanner() {
  if (!armedContinuation) return hide(continueBanner);
  continueBanner.textContent = armedContinuation.into
    ? `↻ Redoing ${armedContinuation.label} in place — a new seed was rolled. `
    : `⛓ Continuing from ${armedContinuation.label} — a new seed was rolled. `;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn-secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", disarmContinuation);
  continueBanner.appendChild(cancel);
  show(continueBanner);
}

function disarmContinuation() {
  if (!armedContinuation) return;
  armedContinuation = null;
  for (const f of comfyFields) f.lock?.(false);
  renderContinueBanner();
}

// Arm after the form has been repopulated: reroll the seed (reusing it under
// near-identical conditioning just reproduces the parent), then lock any pinned
// values the parent recorded so they can't drift between the two runs.
function armContinuation(state, parentValues) {
  armedContinuation = state;
  for (const f of comfyFields) {
    if (typeof f.advance === "function" && typeof f.set === "function") f.set(randomSeed());
  }
  for (const f of comfyFields) {
    if (f.pin && f.name in (parentValues || {})) f.lock?.(true);
  }
  renderContinueBanner();
}

modelSelect.addEventListener("change", () => {
  disarmContinuation(); // the controls it referred to are about to be rebuilt
  applyModelUI();
  scheduleComfyStats(0); // show/hide the host-stats strip promptly on model switch
  try {
    localStorage.setItem(MODEL_KEY, modelSelect.value);
  } catch {
    /* storage blocked — non-fatal */
  }
});
qualitySelect.addEventListener("change", updateEstimate);

// Switching the 2.5 image-source toggle re-shapes which reference set is shown.
document
  .querySelectorAll('input[name="imageSource"]')
  .forEach((r) => r.addEventListener("change", applyModelUI));

// =========================================================================
// ComfyUI: local workflows chosen from the model dropdown. Each workflow's
// {{tokens}} become form controls (inferred from the token name); on Generate
// we upload any image inputs, post to the server, and reuse the job-card +
// history flow. See docs/COMFYUI.md.
// =========================================================================
let comfyWorkflows = [];
const comfyControlsEl = document.getElementById("comfyControls");
let comfyFields = []; // [{ name, getValue() }] for the active workflow
let comfyLoraControl = null; // the dynamic-LoRA section for the active workflow
let comfyBypassControl = null; // enable/disable toggles for bypassable patch nodes
let comfyRenderPromise = null; // resolves when the active workflow's controls are built

const escapeHtmlJs = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

// Load the workflow list and (re)build the "Local · ComfyUI" dropdown group.
async function loadWorkflows() {
  try {
    const res = await fetch("/api/workflows");
    comfyWorkflows = (await res.json()).data || [];
  } catch {
    comfyWorkflows = [];
  }
  modelSelect.querySelector('optgroup[data-comfy]')?.remove();
  if (comfyWorkflows.length) {
    const group = document.createElement("optgroup");
    group.label = "Local · ComfyUI (Experimental)";
    group.setAttribute("data-comfy", "");
    for (const w of comfyWorkflows) {
      const opt = new Option(w.error ? `${w.name} (invalid JSON)` : w.name, `comfy:${w.file}`);
      opt.disabled = !!w.error;
      group.appendChild(opt);
    }
    modelSelect.appendChild(group);
  }
  restoreLastModel(); // now that comfy options exist, reselect the last-used model
}

// Reselect the last-used model (base or comfy:) if it's still a valid option.
function restoreLastModel() {
  let last = null;
  try {
    last = localStorage.getItem(MODEL_KEY);
  } catch {
    /* storage blocked */
  }
  if (!last || last === modelSelect.value) return;
  const opt = [...modelSelect.options].find((o) => o.value === last && !o.disabled);
  if (!opt) return;
  modelSelect.value = last;
  applyModelUI();
}

// A combo is a "file picker" (checkpoint/VAE/CLIP/LoRA selector) when its choices
// are model filenames — those belong in the ComfyUI Settings drawer. Plain enum
// combos (sampler_name, scheduler) have no file extension and stay in the main form.
function isFilePickerCombo(token) {
  return (token.comboOptions || []).some((o) =>
    /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i.test(String(o)),
  );
}

// Choose a control type from a token's name/options. Media checks are ordered
// audio → video → image so "ref_video_audio" (a video's audio track) reads as audio.
function comfyControlType(token) {
  if (token.options?.length) return "select";
  const n = token.name.toLowerCase();
  const key = (token.inputKey || "").toLowerCase();
  if (/prompt/.test(n)) return "textarea";
  // Online, /object_info is authoritative. A combo is a dropdown of installed
  // choices (checkpoints, LoRAs, VAEs, samplers, schedulers) — UNLESS it's an
  // uploadable media input (LoadImage.image, VHS_LoadVideo.video), which carries
  // `uploadKind` and gets the upload dropzone instead.
  if (token.combo) return token.uploadKind || "select";
  if (token.num) return "number";
  // Offline / non-combo fallback by name. A model-file selector input (vae_name,
  // ckpt_name, unet_name, lora_name, clip_name, …) is never a media upload even if
  // its token name contains "video"/"audio" (e.g. `video_vae`).
  const isModelField = /_name$/.test(key) || /^(ckpt|unet|vae|lora|clip|model|control_net|style_model|gligen)/.test(key);
  if (!isModelField) {
    if (/audio/.test(n)) return "audio";
    if (/video/.test(n)) return "video";
    if (/(image|img|frame|photo|picture)/.test(n)) return "image";
  }
  if (
    /(seed|steps|cfg|width|height|length|duration|fps|frames|count|denoise|strength|scale|megapixel|batch)/.test(n) ||
    (token.default !== "" && !Number.isNaN(Number(token.default)))
  )
    return "number";
  return "text";
}

// Media control types share one factory (image/video/audio).
const MEDIA_TYPES = new Set(["image", "video", "audio"]);

// Token width hint → columns of a 12-col grid. Prompt always spans full; media and
// scalars default to full unless the token declares a width (e.g. "; 1/4").
const WIDTH_SPAN = { "1/2": 6, "1/3": 4, "1/4": 3, "2/3": 8, "3/4": 9, full: 12, "1": 12 };
function comfySpan(token, type) {
  if (type === "textarea") return 12;
  return WIDTH_SPAN[token.width] || 12;
}

const prettyLabel = (name) => name.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

// A single-media (image/video/audio) control. Dropped files are saved to the
// project gallery (same store the kie.ai side uses) so they're reusable and
// included in exports; you can also pick an existing gallery item of that kind.
// At generate time the chosen file is pushed into ComfyUI's input folder by id.
const MEDIA_ARTICLE = { image: "an image", video: "a video", audio: "an audio file" };
// --- reference labels --------------------------------------------------------
// MiniMax H3 labels references by *presentation* order, not by field: images, then
// for each reference video its soundtrack's <Audio j> (only when that loader's
// soundtrack is wired) immediately before its <Video k>, then standalone audio. So a
// wired soundtrack claims an audio number and a separately attached audio file is
// <Audio 2> — which is invisible in the form unless we show it. Server sends
// `refLabelScheme` so this node-specific rule is only applied where it holds.
let comfyRefTagsEl = null;
let comfyRefLabelScheme = null;

// Tags in presentation order, plus the per-slot tag for each media field.
function comfyRefTags() {
  const counts = { picture: 0, video: 0, audio: 0 };
  const perField = new Map(); // field -> [tag, …] aligned with its filled slots
  const summary = [];
  const fieldsOfKind = (kind) => comfyFields.filter((f) => f.mediaKind === kind && f.filledMedia);

  for (const f of fieldsOfKind("image")) {
    const tags = f.filledMedia().map(() => `<Picture ${++counts.picture}>`);
    perField.set(f, tags);
    tags.forEach((t, i) => summary.push(`${t} ${f.filledMedia()[i].name || ""}`.trim()));
  }
  for (const f of fieldsOfKind("video")) {
    const tags = [];
    f.filledMedia().forEach((item, i) => {
      if (f.soundtrackAt?.(i)) summary.push(`<Audio ${++counts.audio}> = Video ${counts.video + 1}'s soundtrack`);
      const tag = `<Video ${++counts.video}>`;
      tags.push(tag);
      summary.push(`${tag} ${item.name || ""}`.trim());
    });
    perField.set(f, tags);
  }
  for (const f of fieldsOfKind("audio")) {
    const tags = f.filledMedia().map(() => `<Audio ${++counts.audio}>`);
    perField.set(f, tags);
    tags.forEach((t, i) => summary.push(`${t} ${f.filledMedia()[i].name || ""}`.trim()));
  }
  return { perField, summary };
}

// Write the real tags onto the thumbnails and refresh the summary line. Called from
// every media field's render, so it must not itself trigger a re-render.
function refreshComfyRefTags() {
  if (comfyRefLabelScheme !== "minimax_h3") return;
  const { perField, summary } = comfyRefTags();
  for (const [f, tags] of perField) {
    const labels = f.el.querySelectorAll(".dropzone .thumb.ready .img-label");
    tags.forEach((t, i) => { if (labels[i]) labels[i].textContent = t; });
  }
  if (!comfyRefTagsEl) return;
  comfyRefTagsEl.textContent = summary.length ? `Prompt tags — ${summary.join(" · ")}` : "";
  comfyRefTagsEl.classList.toggle("hidden", !summary.length);
}

// --- reference-video tails ---------------------------------------------------
// "Use only the last N seconds of this reference." Reference frames are re-injected
// on every sampling step, so trimming a reference to the part that matters (its tail,
// when continuing a shot) is the cheapest way to shorten a run. The server turns the
// seconds into a frame-exact skip on that reference's loader; here we preview what
// the model will actually see, because the kept frame count snaps *down* to the
// loader's grid — MiniMax H3 drops reference frames from the end to reach its 17k+5
// grid, which on a continuation would discard the newest frames.
const videoProbeCache = new Map(); // gallery id → {fps, frames, duration} | null

async function probeGalleryVideo(id) {
  if (!id) return null;
  if (videoProbeCache.has(id)) return videoProbeCache.get(id);
  let probe = null;
  try {
    const res = await fetch(`/api/comfy/probe?id=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (res.ok && data.data?.frames) probe = data.data;
  } catch {
    /* leave null — the server falls back to the whole clip and says so */
  }
  videoProbeCache.set(id, probe);
  return probe;
}

// Largest frame count ≤ keep that lands on the loader's grid (mirrors the server).
function snapTailFrames(keep, grid) {
  if (!Array.isArray(grid) || grid.length !== 2) return keep;
  const [k, r] = grid;
  const rem = ((r % k) + k) % k;
  const snapped = keep - (((keep % k) - rem + k) % k);
  return snapped >= rem && snapped > 0 ? snapped : rem || k;
}

// What the model sees for a given tail request, as text for the row's hint.
function tailHint(seconds, probe, grid) {
  if (!probe) return "length unknown — the whole clip will be used";
  const total = `of ${probe.duration.toFixed(1)}s`;
  if (!(seconds > 0)) return `${total} · whole clip (${probe.frames} frames)`;
  const keep = snapTailFrames(Math.min(probe.frames, Math.max(1, Math.round(seconds * probe.fps))), grid);
  if (keep >= probe.frames) return `${total} · whole clip (${probe.frames} frames)`;
  return `${total} → last ${keep} frames (${(keep / probe.fps).toFixed(1)}s)`;
}

// One "use last N sec" row for a reference video. Updates its own hint as you type
// and reports the value back through onInput.
function makeTailRow({ label, seconds, probe, grid, onInput }) {
  const row = document.createElement("div");
  row.className = "tail-row";
  const name = document.createElement("span");
  name.className = "tail-name";
  name.textContent = label;
  const wrap = document.createElement("label");
  wrap.className = "inline tail-input";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "0.5";
  input.placeholder = "0";
  input.title = "Seconds from the end of the clip to use as the reference. 0 or blank = the whole clip.";
  if (seconds > 0) input.value = String(seconds);
  wrap.append(document.createTextNode("use last "), input, document.createTextNode(" sec"));
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = tailHint(seconds, probe, grid);
  input.addEventListener("input", () => {
    const v = Number(input.value) || 0;
    hint.textContent = tailHint(v, probe, grid);
    onInput(v);
  });
  row.append(name, wrap, hint);
  return row;
}

function makeComfyMedia(token, mediaKind) {
  const field = document.createElement("div");
  field.className = "field";
  field.innerHTML =
    `<div class="field-head"><span>${escapeHtmlJs(prettyLabel(token.name))}</span>` +
    `<button type="button" class="link-btn hidden">Clear</button></div>` +
    `<div class="dropzone"><div class="thumbs"></div>` +
    `<p class="dz-hint">Drop ${MEDIA_ARTICLE[mediaKind]} here or <span class="browse">browse</span></p>` +
    `<input type="file" accept="${mediaKind}/*" hidden /></div>` +
    `<div class="media-tails"></div>` +
    `<details class="gallery-wrap comfy-gallery"><summary>Pick from gallery</summary>` +
    `<p class="dz-hint gallery-empty">No saved ${mediaKind}s in this project yet.</p>` +
    `<div class="thumbs gallery"></div></details>`;
  const dz = field.querySelector(".dropzone");
  const thumbs = field.querySelector(".thumbs");
  const clearBtn = field.querySelector(".link-btn");
  const fileInput = field.querySelector("input[type=file]");
  const galleryWrap = field.querySelector(".comfy-gallery");
  const galleryThumbs = field.querySelector(".gallery");
  const galleryEmptyEl = field.querySelector(".gallery-empty");

  // source: { id, url, name } from a saved gallery item (dropped files get saved
  // there first). uploadedRef caches the ComfyUI filename after one upload.
  let source = null, uploadedRef = null;

  const previewThumb = (url, name, withLabel = false) => {
    const div = document.createElement("div");
    div.className = `thumb ready${mediaKind === "audio" ? " audio-thumb" : ""}`;
    div.appendChild(makeThumbContent(mediaKind, { thumb: url, name }));
    if (withLabel) {
      // filled by refreshComfyRefTags when the workflow uses a known label scheme
      const lab = document.createElement("span");
      lab.className = "img-label";
      div.appendChild(lab);
    }
    return div;
  };
  // Per-file "use last N sec", when this reference's loader can skip frames.
  const tailsEl = field.querySelector(".media-tails");
  let tailSec = 0, probe;
  const renderTail = () => {
    tailsEl.innerHTML = "";
    if (!token.tail || !source) return;
    if (source.id && probe === undefined) {
      probe = null; // probe once per file; null until it lands
      probeGalleryVideo(source.id).then((p) => { probe = p; renderTail(); });
    }
    tailsEl.appendChild(
      makeTailRow({
        label: prettyLabel(token.name),
        seconds: tailSec,
        probe: probe || null,
        grid: token.tail.grid || null,
        onInput: (v) => { tailSec = v; },
      })
    );
  };
  const render = () => {
    thumbs.innerHTML = "";
    clearBtn.classList.toggle("hidden", !source);
    if (source) thumbs.appendChild(previewThumb(source.url, source.name, true));
    renderTail();
    refreshComfyRefTags();
  };
  const setSource = (s) => { source = s; uploadedRef = null; probe = undefined; render(); };

  // Save a dropped/browsed file into the project gallery, then use it.
  const take = (file) => {
    if (!file || !file.type.startsWith(`${mediaKind}/`)) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64Data: reader.result, fileName: file.name, projectId: activeProjectId }),
        });
        const data = await res.json();
        if (!res.ok || !data.image?.id) throw new Error(data.msg || "Save failed");
        setSource({ id: data.image.id, url: data.image.localUrl || reader.result, name: data.image.name });
        loadGallery(); // refresh the shared + per-control galleries
      } catch (err) {
        console.error(err);
        setError(`Couldn't save ${file.name}: ${err.message || err}`);
      }
    };
    reader.readAsDataURL(file);
  };

  // Populate the picker with this project's saved media of this kind when opened.
  const renderGalleryPicker = () => {
    galleryThumbs.innerHTML = "";
    const items = galleryItems.filter(
      (i) => (i.kind || "image") === mediaKind && (i.projectId || "default") === activeProjectId
    );
    galleryEmptyEl.classList.toggle("hidden", items.length > 0);
    for (const item of items) {
      galleryThumbs.appendChild(
        makeGalleryThumb(item, {
          title: `${item.name} — click to use`,
          onPick: (it) => {
            setSource({ id: it.id, url: it.localUrl, name: it.name });
            galleryWrap.open = false;
          },
          refresh: renderGalleryPicker,
        })
      );
    }
  };

  dz.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { take(fileInput.files[0]); fileInput.value = ""; });
  ["dragenter", "dragover"].forEach((e) =>
    dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((e) =>
    dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", (ev) => { if (ev.dataTransfer.files?.length) take(ev.dataTransfer.files[0]); });
  clearBtn.addEventListener("click", () => setSource(null));
  galleryWrap.addEventListener("toggle", () => { if (galleryWrap.open) renderGalleryPicker(); });

  return {
    el: field,
    name: token.name,
    isMedia: true,
    mediaKind,
    mediaKey: token.name,
    filledMedia: () => (source ? [{ name: source.name }] : []),
    soundtrackAt: () => !!token.soundtrack,
    capacity: 1,
    hasDefault: token.default !== "",
    set() {}, // a scalar value can't fill a media control — skip on scalar prefill
    // Restore a previously-used file (last-used defaults, or history re-import).
    setMedia(arr) {
      const it = (arr || [])[0];
      setSource(it && it.id ? { id: it.id, url: it.url, name: it.name } : null);
      tailSec = Number(it?.tail) || 0;
      renderTail();
    },
    setTails(byToken) {
      const seconds = Number(byToken?.[token.name]?.seconds);
      if (seconds > 0) { tailSec = seconds; renderTail(); }
    },
    peekMedia: () => {
      if (!source) return [];
      const m = { id: source.id, url: source.url, name: source.name };
      if (tailSec > 0) m.tail = tailSec; // remembered per-file reference tail
      return [m];
    },
    tailSpec: () => (tailSec > 0 && source?.id ? { [token.name]: { seconds: tailSec, id: source.id } } : {}),
    localId: () => source?.id || null,
    async getValue() {
      if (!source) return token.default || "";
      if (uploadedRef) return uploadedRef;
      const res = await fetch("/api/comfy/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: source.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.data?.filename) throw new Error(data.msg || `Failed to upload ${token.name}`);
      uploadedRef = data.data.filename;
      return uploadedRef;
    },
  };
}

// Render the controls for the selected workflow.
let comfyRenderSeq = 0;
async function renderComfyControls() {
  const seq = ++comfyRenderSeq;
  comfyControlsEl.innerHTML = "";
  comfyFields = [];
  comfyLoraControl = null;
  comfyBypassControl = null;
  comfyRefTagsEl = null;
  comfyRefLabelScheme = null;
  const wf = comfyWorkflows.find((w) => w.file === comfyFile());
  if (!wf) {
    comfyControlsEl.innerHTML = `<p class="muted">Workflow not found — try reloading.</p>`;
    return;
  }
  if (wf.error) {
    comfyControlsEl.innerHTML = `<p class="muted">This workflow isn't valid JSON: ${escapeHtmlJs(wf.error)}</p>`;
    return;
  }
  if (!wf.tokens.length) {
    comfyControlsEl.innerHTML =
      `<p class="muted">No <code>{{tokens}}</code> found in <b>${escapeHtmlJs(wf.name)}</b>. ` +
      `It will run exactly as saved. Add tokens like <code>{{prompt}}</code> to expose controls.</p>`;
    return;
  }

  comfyControlsEl.innerHTML = `<p class="muted">Loading options from ComfyUI…</p>`;
  // Enriched tokens (combo file lists + numeric ranges) + installed LoRAs, from
  // ComfyUI's /object_info. Falls back to the raw tokens (offline) — the picker
  // controls then can't populate, and we show an offline notice.
  let meta = { offline: true, tokens: wf.tokens, loraOptions: [], bypassable: [] };
  try {
    const r = await fetch(`/api/comfy/workflow-meta?file=${encodeURIComponent(wf.file)}`);
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.code === 200 && d.data) meta = d.data;
  } catch {
    /* offline — meta stays with raw tokens */
  }
  if (seq !== comfyRenderSeq) return; // a newer workflow was selected meanwhile
  comfyControlsEl.innerHTML = "";
  if (meta.offline) {
    const note = document.createElement("p");
    note.className = "muted comfy-offline";
    note.textContent = "⚠ ComfyUI is offline — start it to choose models / LoRAs / VAEs / samplers.";
    comfyControlsEl.appendChild(note);
  }
  const tokens = meta.tokens || wf.tokens;

  // Build render items, grouping numbered media tokens (picture1, picture2, …)
  // into one multi-upload control per series — like the kie.ai reference fields.
  const items = [];
  const seriesByKey = new Map();
  tokens.forEach((token, scanIndex) => {
    if (token.role) return; // continuation state — the server fills it; not a control
    const type = comfyControlType(token);
    if (MEDIA_TYPES.has(type)) {
      const m = token.name.match(/^(.*?)(\d+)$/);
      if (m) {
        const key = `${type}:${m[1]}`;
        let it = seriesByKey.get(key);
        if (!it) {
          it = { kind: "series", type, base: m[1], entries: [], order: undefined, scanIndex };
          seriesByKey.set(key, it);
          items.push(it);
        }
        it.entries.push({ token, index: Number(m[2]) });
        if (token.order != null && (it.order == null || token.order < it.order)) it.order = token.order;
        return;
      }
      items.push({ kind: "single-media", type, token, order: token.order, scanIndex });
      return;
    }
    items.push({ kind: "scalar", type, token, order: token.order, scanIndex });
  });
  // A one-entry "series" is just a single control.
  for (const it of items) {
    if (it.kind === "series" && it.entries.length === 1) { it.kind = "single-media"; it.token = it.entries[0].token; }
  }
  // Dynamic reference collections (recognized nodes) render as multi-upload controls,
  // ordered in among the rest by their `order`.
  (meta.references || []).forEach((ref, i) => {
    items.push({ kind: "reference", ref, order: ref.order, scanIndex: 900 + i });
  });
  // Order by the "; #N" hint; items without one keep scan order, after ordered ones.
  items.sort((a, b) => (a.order ?? 1000 + a.scanIndex) - (b.order ?? 1000 + b.scanIndex));

  // The "ComfyUI Settings" drawer is for installed-model-file pickers (checkpoints,
  // VAEs, CLIPs — big `.safetensors` lists) and the toggles for optional patch nodes
  // (e.g. Sage Attention). Plain enum combos like sampler_name / scheduler are
  // generation params and stay in the main form next to steps/seed/duration.
  const bypassIds = new Set((meta.bypassable || []).map((b) => String(b.id)));
  comfyRefLabelScheme = meta.refLabelScheme || null; // null → keep each field's own numbering

  // Recognized (raw-workflow) controls carry a `group` per source node, so the main
  // form is rendered as one collapsible section per node type — Prompt, KSampler,
  // Latent Image, … — instead of a flat grid. Tokenized workflows have no groups and
  // render flat, exactly as before. `mainContainer(token)` returns where a control
  // mounts: its group's <details> body in grouped mode, or the flat grid otherwise.
  const grouped = tokens.some((t) => t.group);
  const groupBodies = new Map(); // group key → body element (created lazily, in order)
  const mainContainer = (token) => {
    if (!grouped || !token.group) return comfyControlsEl;
    let body = groupBodies.get(token.group.key);
    if (!body) {
      const details = document.createElement("details");
      details.className = "comfy-node-group";
      details.open = !token.group.collapsed; // loaders / save node start closed
      details.style.gridColumn = "span 12";
      const summary = document.createElement("summary");
      summary.textContent = token.group.label || "Options";
      body = document.createElement("div");
      body.className = "comfy-node-group-body comfy-grid";
      details.append(summary, body);
      comfyControlsEl.appendChild(details);
      groupBodies.set(token.group.key, body);
    }
    return body;
  };

  const settingsScalars = [];
  for (const it of items) {
    if (it.kind === "reference") {
      const ctrl = makeComfyReference(it.ref);
      ctrl.el.style.gridColumn = "span 12";
      comfyControlsEl.appendChild(ctrl.el);
      comfyFields.push(ctrl);
      continue;
    }
    if (it.kind === "series") {
      const entries = it.entries.sort((a, b) => a.index - b.index);
      const ctrl = makeComfyMediaMulti(
        it.base, it.type, entries.map((e) => e.token.name), entries[0].token.tail,
        entries.map((e) => e.token.soundtrack),
      );
      ctrl.el.style.gridColumn = `span ${WIDTH_SPAN[entries[0].token.width] || 12}`;
      mainContainer(entries[0].token).appendChild(ctrl.el);
      comfyFields.push(ctrl);
    } else if (it.kind === "single-media") {
      const ctrl = makeComfyMedia(it.token, it.type);
      ctrl.el.style.gridColumn = `span ${comfySpan(it.token, it.type)}`;
      mainContainer(it.token).appendChild(ctrl.el);
      comfyFields.push(ctrl);
    } else if (!it.token.group && it.token.combo && (isFilePickerCombo(it.token) || bypassIds.has(String(it.token.nodeId ?? "")))) {
      // Tokenized workflows funnel installed-file pickers + patch-node toggles into the
      // Settings drawer. Recognized controls carry a group and render in their own
      // (collapsed) node section instead, so they skip the drawer.
      settingsScalars.push(it);
    } else {
      // numbers, text, inline-option selects, and non-file object_info combos (sampler)
      renderScalarControl(it.token, it.type, mainContainer(it.token));
    }
  }

  // "ComfyUI Settings" drawer (collapsed): the installed-file/choice pickers from
  // /object_info (model, VAE, CLIP, sampler…) plus the dynamic LoRA section — kept
  // out of the main form so a pile of loader dropdowns doesn't clutter it.
  const details = document.createElement("details");
  details.className = "comfy-settings";
  details.style.gridColumn = "span 12";
  const summary = document.createElement("summary");
  summary.textContent = "ComfyUI Settings";
  details.appendChild(summary);
  const body = document.createElement("div");
  body.className = "comfy-settings-body comfy-grid";
  details.appendChild(body);
  // Enable/disable toggles for optional patch nodes (e.g. Sage Attention). Each
  // node's controls render inside its toggle's group (hidden when disabled); the
  // checkbox sits directly above them.
  comfyBypassControl = (meta.bypassable || []).length ? makeComfyBypassControl(meta.bypassable) : null;
  for (const it of settingsScalars) {
    const nid = String(it.token.nodeId ?? "");
    if (comfyBypassControl && bypassIds.has(nid)) {
      renderScalarControl(it.token, it.type, comfyBypassControl.mountGroup(body, nid));
    } else {
      renderScalarControl(it.token, it.type, body);
    }
  }
  if (comfyBypassControl) comfyBypassControl.mountRemaining(body); // toggles with no controls
  // LoRAs are always offered, so they live in the main form (not tucked inside the
  // "ComfyUI Settings" drawer). The drawer holds only installed-file pickers and
  // patch-node toggles now, and isn't rendered at all when it has neither.
  comfyLoraControl = makeComfyLoraControl(meta.loraOptions || [], !!meta.offline);
  comfyControlsEl.appendChild(comfyLoraControl.el);
  if (comfyRefLabelScheme) {
    // The literal strings to cite in the prompt, in the order the model presents them.
    comfyRefTagsEl = document.createElement("p");
    comfyRefTagsEl.className = "ref-tags hint hidden";
    comfyRefTagsEl.style.gridColumn = "span 12";
    comfyControlsEl.appendChild(comfyRefTagsEl);
  }
  if (body.childElementCount) comfyControlsEl.appendChild(details);

  // Transparency: node types GENie has no controls for. They run exactly as saved
  // in the export. Collapsed by default; recognized (raw) workflows only.
  const unknownTypes = meta.unknownTypes || [];
  if (unknownTypes.length) {
    const info = document.createElement("details");
    info.className = "comfy-node-group comfy-unknown";
    info.style.gridColumn = "span 12";
    const sum = document.createElement("summary");
    sum.textContent = `Other nodes — run as-is (${unknownTypes.length})`;
    const b = document.createElement("div");
    b.className = "comfy-node-group-body";
    b.innerHTML =
      `<p class="muted">GENie has no editable controls for these node types, so they run ` +
      `exactly as saved in the workflow's JSON export:</p>`;
    const ul = document.createElement("ul");
    ul.className = "comfy-unknown-list";
    for (const t of unknownTypes) {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    }
    b.appendChild(ul);
    info.append(sum, b);
    comfyControlsEl.appendChild(info);
  }

  // Overlay this workflow's saved config (server-side settings file) so the form
  // reopens with what you last ran — values, media, seed mode, and LoRAs.
  try {
    const s = await fetch(`/api/comfy/settings?file=${encodeURIComponent(wf.file)}`).then((r) => r.json());
    if (seq !== comfyRenderSeq) return;
    const settings = s?.data || {};
    prefillComfyControls(settings);
    refreshComfyRefTags();
    if (comfyLoraControl && Array.isArray(settings.loras)) comfyLoraControl.setLoras(settings.loras);
    if (comfyBypassControl && Array.isArray(settings.bypass)) comfyBypassControl.setDisabled(settings.bypass);
  } catch {
    /* no saved settings — token defaults stand */
  }
}

// Enable/disable for the workflow's bypassable patch nodes. Each node gets a
// checkbox that sits directly above that node's controls; unchecking it hides those
// controls and removes the node server-side (its passthrough reconnected), so an
// optional custom node (e.g. Sage Attention) can be turned off if you don't have it.
function makeComfyBypassControl(bypassable) {
  const nodes = new Map(); // nodeId -> { checkbox, controlsEl, wrapper, mounted }
  for (const b of bypassable) {
    const wrapper = document.createElement("div");
    wrapper.className = "comfy-bypass-group";
    wrapper.style.gridColumn = "span 12";
    const label = document.createElement("label");
    label.className = "inline bypass-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !b.off; // enabled unless the workflow ships this node switched off
    label.append(cb, document.createTextNode(` ${b.title}`));
    const controlsEl = document.createElement("div");
    controlsEl.className = "bypass-controls comfy-grid";
    wrapper.append(label, controlsEl);
    const sync = () => controlsEl.classList.toggle("hidden", !cb.checked);
    cb.addEventListener("change", sync);
    sync();
    nodes.set(String(b.id), { checkbox: cb, controlsEl, wrapper, mounted: false });
  }
  return {
    // Append the node's group to `container` (once) and return its controls slot.
    mountGroup(container, id) {
      const n = nodes.get(String(id));
      if (!n) return container;
      if (!n.mounted) { container.appendChild(n.wrapper); n.mounted = true; }
      return n.controlsEl;
    },
    // Append any toggles that had no controls to render (bare enable/disable).
    mountRemaining(container) {
      for (const n of nodes.values()) if (!n.mounted) { container.appendChild(n.wrapper); n.mounted = true; }
    },
    // Ids of nodes to bypass (the unchecked ones).
    getDisabled: () => [...nodes].filter(([, n]) => !n.checkbox.checked).map(([id]) => id),
    setDisabled: (ids) => {
      const off = new Set((ids || []).map(String));
      for (const [id, n] of nodes) {
        n.checkbox.checked = !off.has(id);
        n.controlsEl.classList.toggle("hidden", !n.checkbox.checked);
      }
    },
  };
}

// The dynamic-LoRA section: rows of {file dropdown, strength (keyboard, −5..5)}
// plus an "Add LoRA" button. LoRAs are spliced into the graph server-side.
function makeComfyLoraControl(loraOptions, offline) {
  const field = document.createElement("div");
  field.className = "field comfy-loras";
  field.style.gridColumn = "span 12";
  field.innerHTML =
    `<div class="field-head"><span>LoRAs ` +
    `<span class="hint">(added on top of the workflow · strength −5 to 5)</span></span></div>` +
    `<div class="lora-rows"></div>`;
  const rowsEl = field.querySelector(".lora-rows");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn-secondary lora-add";
  addBtn.textContent = "+ Add LoRA";
  field.appendChild(addBtn);

  if (offline) {
    const n = document.createElement("p");
    n.className = "muted";
    n.textContent = "Start ComfyUI to add LoRAs.";
    field.appendChild(n);
    addBtn.disabled = true;
  }

  const addRow = (name = "", strength = 1, enabled = true) => {
    const row = document.createElement("div");
    row.className = "lora-row";
    // A disabled LoRA stays in the loadout (and is saved) but isn't injected — which
    // is different from a strength of 0.
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "lora-enabled";
    chk.checked = enabled !== false;
    chk.title = "Enable this LoRA — unchecked keeps it in the loadout but doesn't apply it";
    const loraOpts = loraOptions.map((o) => ({ label: o, value: o }));
    if (name && !loraOptions.includes(name)) loraOpts.push({ label: `${name} (not installed)`, value: name });
    const sel = makeSearchableSelect(loraOpts, name || "", "Type to filter LoRAs…");
    sel.classList.add("lora-name");
    const str = document.createElement("input");
    str.type = "number";
    str.className = "lora-strength";
    str.min = -5;
    str.max = 5;
    str.step = 0.01;
    str.value = strength;
    str.title = "Strength (−5 to 5)";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "x";
    rm.textContent = "×";
    rm.title = "Remove LoRA";
    rm.addEventListener("click", () => row.remove());
    const syncDim = () => row.classList.toggle("lora-off", !chk.checked);
    chk.addEventListener("change", syncDim);
    syncDim();
    row.append(chk, sel, str, rm);
    rowsEl.appendChild(row);
  };
  addBtn.addEventListener("click", () => addRow(loraOptions[0] || "", 1, true));

  return {
    el: field,
    // All rows (incl. disabled) with their on/off state — for saving the loadout.
    getLoras: () =>
      [...rowsEl.querySelectorAll(".lora-row")]
        .map((r) => ({
          name: r.querySelector(".lora-name").value,
          strength: Number(r.querySelector(".lora-strength").value),
          enabled: r.querySelector(".lora-enabled").checked,
        }))
        .filter((l) => l.name),
    setLoras: (arr) => {
      rowsEl.innerHTML = "";
      for (const l of arr || [])
        addRow(l.name, typeof l.strength === "number" ? l.strength : 1, l.enabled !== false);
    },
  };
}

// A type-to-filter single-select for long option lists (models, LoRAs, samplers…).
// Behaves like a <select> for callers: exposes a `.value` property (get/set) and
// fires "change", so it drops in wherever a native select's `.value` was read.
// `options` are strings or { label, value }.
function makeSearchableSelect(options, initialValue = "", placeholder = "Type to filter…") {
  const opts = (options || []).map((o) => (typeof o === "string" ? { label: o, value: o } : o));
  const root = document.createElement("div");
  root.className = "combo-search";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "combo-search-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = placeholder;
  const list = document.createElement("div");
  list.className = "combo-search-list hidden";
  root.append(input, list);

  let current = initialValue || "";
  let matches = [];
  let highlight = -1;
  const labelFor = (v) => opts.find((o) => o.value === v)?.label ?? v ?? "";
  const isOpen = () => !list.classList.contains("hidden");

  function paint() {
    list.innerHTML = "";
    if (!matches.length) {
      const none = document.createElement("div");
      none.className = "combo-search-empty";
      none.textContent = "No matches";
      list.appendChild(none);
      return;
    }
    matches.forEach((o, i) => {
      const item = document.createElement("div");
      item.className = "combo-search-item";
      if (o.value === current) item.classList.add("selected");
      if (i === highlight) item.classList.add("active");
      item.textContent = o.label;
      item.title = o.label; // full path on hover when the row is truncated
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep input focus, beat the blur
        pick(o.value);
      });
      list.appendChild(item);
    });
    if (highlight >= 0) list.children[highlight]?.scrollIntoView({ block: "nearest" });
  }

  function filter(text) {
    const f = (text || "").trim().toLowerCase();
    matches = f ? opts.filter((o) => o.label.toLowerCase().includes(f)) : opts.slice();
    highlight = -1;
    paint();
  }
  function open() {
    filter("");
    list.classList.remove("hidden");
    input.select();
  }
  function close() {
    list.classList.add("hidden");
    input.value = labelFor(current); // always fall back to a valid selection
  }
  function pick(v) {
    current = v;
    input.value = labelFor(v);
    close();
    root.dispatchEvent(new Event("change", { bubbles: true }));
  }

  input.addEventListener("focus", open);
  input.addEventListener("click", () => { if (!isOpen()) open(); });
  input.addEventListener("input", () => filter(input.value));
  input.addEventListener("blur", () => setTimeout(() => { if (isOpen()) close(); }, 100));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen()) return open();
      highlight = Math.min(highlight + 1, matches.length - 1);
      paint();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight = Math.max(highlight - 1, 0);
      paint();
    } else if (e.key === "Enter") {
      if (isOpen()) {
        e.preventDefault();
        const o = matches[highlight] || matches[0];
        if (o) pick(o.value);
      }
    } else if (e.key === "Escape") {
      if (isOpen()) { e.preventDefault(); close(); input.blur(); }
    }
  });

  input.value = labelFor(current);
  Object.defineProperty(root, "value", {
    get: () => current,
    set: (v) => { current = v ?? ""; input.value = labelFor(current); },
    configurable: true,
  });
  return root;
}

// Build one scalar control (select / number / text / textarea) and register it,
// appending it to `container` (the main grid, or the ComfyUI Settings drawer).
function renderScalarControl(token, type, container = comfyControlsEl) {
  const field = document.createElement("div");
  field.className = "field";
  field.style.gridColumn = `span ${comfySpan(token, type)}`;
  const head = document.createElement("div");
  head.className = "field-head";
  head.innerHTML = `<span>${escapeHtmlJs(token.label || prettyLabel(token.name))}</span>`;
  field.appendChild(head);
  let afterMode = null; // seed "control after generate" <select>, if present

  // A combo token's options come from ComfyUI (plain installed-file names); an
  // author's inline options are "value" or "Label=value" (e.g. Enabled=1|Disabled=0)
  // so the dropdown can show a friendly label while writing a different value.
  const parsedOptions =
    type === "select"
      ? (token.combo ? token.comboOptions || [] : token.options || []).map((o) => {
          if (token.combo) return { label: String(o), value: String(o) };
          const i = String(o).indexOf("=");
          return i >= 0 ? { label: o.slice(0, i).trim(), value: o.slice(i + 1).trim() } : { label: o, value: o };
        })
      : [];
  // A dropdown whose option values are all numbers should send a number (never for
  // a combo, whose values are filenames/choices).
  const numericSelect =
    token.type !== "str" &&
    type === "select" && !token.combo && parsedOptions.length > 0 &&
    parsedOptions.every((o) => o.value !== "" && !Number.isNaN(Number(o.value)));

  let input;
  if (type === "select") {
    const initial = parsedOptions.some((o) => o.value === token.default) ? token.default : parsedOptions[0]?.value ?? "";
    if (parsedOptions.length > 10) {
      // Long lists (models, samplers, …) get a type-to-filter dropdown.
      input = makeSearchableSelect(parsedOptions, initial);
    } else {
      input = document.createElement("select");
      for (const o of parsedOptions) input.appendChild(new Option(o.label, o.value));
      input.value = initial;
    }
  } else if (type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 4;
    input.value = token.default || "";
  } else {
    input = document.createElement("input");
    input.type = type === "number" ? "number" : "text";
    input.value = token.default || "";
    // Numeric range/step from /object_info, when the field carried it.
    if (type === "number") {
      if (token.min != null) input.min = token.min;
      if (token.max != null) input.max = token.max;
      if (token.step != null) input.step = token.step;
    }
    if (type === "number" && token.name.toLowerCase().includes("seed")) {
      // "Control after generate" mirrors ComfyUI's seed widget: how the seed
      // changes for the next run after you queue one.
      afterMode = document.createElement("select");
      afterMode.className = "seed-after";
      afterMode.title = "Control after generate";
      for (const m of ["fixed", "increment", "decrement", "randomize"]) afterMode.appendChild(new Option(m, m));
      afterMode.value = "fixed";
      const dice = document.createElement("button");
      dice.type = "button";
      dice.className = "link-btn";
      dice.textContent = "🎲";
      dice.title = "Randomize now";
      dice.addEventListener("click", () => { input.value = randomSeed(); });
      head.appendChild(afterMode);
      head.appendChild(dice);
    }
  }
  field.appendChild(input);
  container.appendChild(field);
  const readValue = () => (type === "number" || numericSelect ? Number(input.value) : input.value);
  const ctrl = {
    name: token.name,
    getValue: async () => readValue(),
    peek: readValue, // sync read, for saving last-used defaults
    set: (v) => { input.value = v; },
    // Declared "; pin": must not drift between a run and its continuation, so the
    // form locks it while one is armed.
    pin: !!token.pin,
    lock: (on) => { input.disabled = !!on; field.classList.toggle("locked", !!on); },
  };
  if (afterMode) {
    ctrl.advance = () => {
      const cur = Number(input.value) || 0;
      if (afterMode.value === "increment") input.value = cur + 1;
      else if (afterMode.value === "decrement") input.value = cur - 1;
      else if (afterMode.value === "randomize") input.value = randomSeed();
    };
    // Remember the fixed/increment/decrement/randomize choice in last-used settings.
    ctrl.peekAfter = () => afterMode.value;
    ctrl.setAfter = (v) => { if (v) afterMode.value = v; };
  }
  comfyFields.push(ctrl);
}

// A multi-file control for a numbered token series (picture1, picture2, …). Built
// on the same reference-list component as the kie.ai fields — so it gets drag-to-
// reorder, "view full size", and the gallery picker for free — with numbered
// badges ("Picture 1, 2…"). The Nth file fills the Nth token; unfilled tokens are
// pruned at submit.
let comfyListSeq = 0;
function makeComfyMediaMulti(base, mediaKind, tokenNames, tail = null, soundtracks = [], labelText = null) {
  const label = labelText || prettyLabel(base);
  const max = tokenNames.length;
  const list = makeMediaList(`comfy-${base}-${comfyListSeq++}`, {
    mediaType: mediaKind,
    build: true, // create our own field DOM (no static markup)
    gallery: true, // per-field "Pick from gallery"
    localOnly: true, // ComfyUI needs a saved file, not a hosted URL
    max,
    title: label,
    label,
    labelSep: " ", // "Picture 1" rather than "Picture1"
    hint: `(up to ${max}, in order — drag to reorder)`,
    tail: !!tail, // loader can skip frames → offer a per-file "use last N sec"
    tailGrid: tail?.grid || null,
    onChange: refreshComfyRefTags, // reference tags depend on what's filled
  });

  const ready = () => list.items.filter((i) => i.status === "ready");

  return {
    el: list.el,
    isMultiMedia: true,
    mediaKind,
    // Filled slots in order, and whether slot i's loader carries its own soundtrack
    // (which claims an <Audio j> label ahead of that video's <Video k>).
    filledMedia: () => ready().map((i) => ({ name: i.name })),
    soundtrackAt: (i) => !!soundtracks[i],
    mediaKey: base,
    capacity: max,
    // Restore previously-used files (last-used defaults, or history re-import).
    setMedia(arr) {
      list.items = [];
      for (const it of (arr || []).slice(0, max)) {
        if (it?.id) list.addFromGallery({ id: it.id, localUrl: it.url, name: it.name, tail: it.tail });
      }
      list.render();
    },
    // Re-apply per-file tails from a History entry, which keys them by token name
    // (older entries have none — the files then keep whatever the field restored).
    setTails(byToken) {
      if (!byToken) return;
      const filled = list.items.filter((i) => i.status === "ready");
      tokenNames.forEach((name, i) => {
        const seconds = Number(byToken[name]?.seconds);
        if (filled[i] && seconds > 0) filled[i].tailSec = seconds;
      });
      list.renderTails();
    },
    // Append one saved file (from a history card's reference thumbnail). Respects
    // the field's capacity; returns false if it's full or the item has no local id.
    addMedia(item) {
      if (!item?.id) return false;
      if (ready().length >= max) return false;
      list.addFromGallery({ id: item.id, localUrl: item.url, name: item.name });
      return true;
    },
    peekMedia: () =>
      ready()
        .filter((i) => i.localId)
        .map((i) => {
          const m = { id: i.localId, url: i.thumb, name: i.name };
          if (i.tailSec > 0) m.tail = i.tailSec; // remembered per-file reference tail
          return m;
        }),
    localIds: () => list.localIds(),
    // { tokenName: {seconds, id} } for the filled slots that asked for a tail.
    tailSpec() {
      const spec = {};
      list.tails().forEach((t, i) => {
        if (t.seconds > 0 && tokenNames[i]) spec[tokenNames[i]] = t;
      });
      return spec;
    },
    async resolve() {
      const values = {};
      const prune = [];
      const filled = ready();
      for (let i = 0; i < tokenNames.length; i++) {
        const it = filled[i];
        if (!it) { prune.push(tokenNames[i]); continue; }
        if (!it.localId) throw new Error(`${label}: drop a file (URL inputs aren't supported for local workflows).`);
        if (!it.comfyRef) {
          const res = await fetch("/api/comfy/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: it.localId }),
          });
          const data = await res.json();
          if (!res.ok || !data.data?.filename) throw new Error(data.msg || `Failed to upload ${tokenNames[i]}`);
          it.comfyRef = data.data.filename;
        }
        values[tokenNames[i]] = it.comfyRef;
      }
      return { values, prune };
    },
  };
}

// A dynamic reference collection (1+ images / videos / audio) for a recognized node
// like MiniMax H3. Reuses the multi-upload component; the difference from a token
// series is submit-side: filled files are uploaded, gathered in order, and the
// server injects one loader node per file wired into the target node (no pre-wired
// slots to prune). `ref` is a descriptor from workflow-meta's `references`.
function makeComfyReference(ref) {
  const max = ref.max || 9;
  const slotNames = Array.from({ length: max }, (_, i) => `${ref.name}_${i + 1}`);
  const ctrl = makeComfyMediaMulti(ref.name, ref.kind, slotNames, null, [], ref.label);
  ctrl.isMultiMedia = false; // not a token series — don't route through values/prune
  ctrl.isReferenceCollection = true;
  ctrl.collectionName = ref.name;
  // Uploaded ComfyUI filenames for the filled slots, in order — what the server
  // injects loaders for.
  ctrl.resolveOrdered = async () => {
    const { values } = await ctrl.resolve();
    return slotNames.map((n) => values[n]).filter(Boolean);
  };
  return ctrl;
}

// Prefill the active workflow's controls from a saved values blob. Scalar values
// live at the top level; last-used media files (if any) live under `__media`,
// keyed by control (media can't be restored from a saved values blob otherwise).
function prefillComfyControls(values) {
  const media = values.__media || null;
  const after = values.__after || null;
  for (const f of comfyFields) {
    if (media && typeof f.setMedia === "function" && f.mediaKey in media) {
      f.setMedia(media[f.mediaKey]);
    } else if (f.name in values && typeof f.set === "function") {
      f.set(values[f.name]);
    }
    if (after && typeof f.setAfter === "function" && f.name in after) f.setAfter(after[f.name]);
  }
}

// Re-populate a ComfyUI workflow's media fields from a saved History entry's
// gallery ids. Ids are resolved to the saved files and distributed across the
// media controls of each kind in order (each takes up to its capacity).
async function restoreComfyMedia(entry) {
  const localIds = entry.mediaLocalIds || { image: entry.imageLocalIds || [] };
  const kinds = ["image", "video", "audio"];
  if (!kinds.some((k) => (localIds[k] || []).length)) return;
  let saved = [];
  try {
    saved = await fetch("/api/images").then((r) => r.json()).then((d) => d.data || []);
  } catch {
    return;
  }
  const byId = new Map(saved.map((i) => [i.id, i]));
  for (const kind of kinds) {
    const items = (localIds[kind] || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((i) => ({ id: i.id, url: i.localUrl, name: i.name }));
    let queue = items;
    for (const f of comfyFields) {
      if (f.mediaKind !== kind || typeof f.setMedia !== "function") continue;
      f.setMedia(queue.slice(0, f.capacity || 1));
      queue = queue.slice(f.capacity || 1);
    }
  }
  // Re-apply the run's per-reference tails (absent on entries from before the
  // feature, and on runs that used whole clips).
  if (entry.input?.tails) {
    for (const f of comfyFields) if (typeof f.setTails === "function") f.setTails(entry.input.tails);
  }
}

// Per-workflow config, saved server-side (settings/comfy/<file>.json) so it's
// shared across devices: control values, media picks (by gallery id/url under
// `__media`), seed modes (`__after`), and the dynamic LoRA list. Loaded in
// renderComfyControls; token `=default`s are the base and these override them.
async function saveComfySettings(file) {
  const data = { __media: {}, __after: {} };
  for (const f of comfyFields) {
    if (typeof f.peekMedia === "function") data.__media[f.mediaKey] = f.peekMedia();
    else if (typeof f.peek === "function") data[f.name] = f.peek();
    if (typeof f.peekAfter === "function") data.__after[f.name] = f.peekAfter();
  }
  if (comfyLoraControl) data.loras = comfyLoraControl.getLoras();
  if (comfyBypassControl) data.bypass = comfyBypassControl.getDisabled();
  try {
    await fetch(`/api/comfy/settings?file=${encodeURIComponent(file)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error("Failed to save comfy settings:", err);
  }
}

// Gather token values (uploading media to ComfyUI as needed). Empty optional media
// controls are returned in `prune` so the server can drop their loader nodes.
async function collectComfyValues() {
  const values = {};
  const prune = [];
  const references = {}; // { collectionName: [comfyFilename, …] } for injected ref media
  const tails = {}; // per-reference "use last N sec" (the server turns it into frames)
  for (const f of comfyFields) {
    if (typeof f.tailSpec === "function") Object.assign(tails, f.tailSpec());
    if (f.isReferenceCollection) {
      references[f.collectionName] = await f.resolveOrdered();
      continue;
    }
    if (f.isMultiMedia) {
      const r = await f.resolve(); // fills the filled slots, prunes the empty ones
      Object.assign(values, r.values);
      prune.push(...r.prune);
      continue;
    }
    if (f.isMedia && !f.hasDefault && !f.localId()) {
      prune.push(f.name); // nothing selected — prune this reference loader
      continue;
    }
    values[f.name] = await f.getValue();
  }
  return { values, prune, tails, references };
}

// How many generations to queue (the ×N counter, local ComfyUI only).
function comfyQueueCount() {
  const n = Math.floor(Number(document.getElementById("comfyCount").value) || 1);
  return Math.min(20, Math.max(1, n));
}

// Submit a ComfyUI workflow. Queues `count` runs back-to-back; between runs the
// seed advances (control-after-generate), so with a randomize/increment seed each
// queued run differs. Media uploads are cached, so only the first run uploads.
async function submitComfy() {
  const wf = comfyWorkflows.find((w) => w.file === comfyFile());
  if (!wf) return setError("Workflow not found — try reloading.");
  hide(errorEl);
  submitBtn.disabled = true;
  if (armedContinuation && armedContinuation.file !== wf.file) disarmContinuation();
  const cont = armedContinuation;
  // Redoing a run in place writes one fixed slot; queueing several would stamp the
  // same one N times.
  const count = cont?.into ? 1 : comfyQueueCount();
  const allLoras = comfyLoraControl ? comfyLoraControl.getLoras() : [];
  const enabledLoras = allLoras.filter((l) => l.enabled !== false); // only these get injected
  const bypass = comfyBypassControl ? comfyBypassControl.getDisabled() : [];
  try {
    for (let i = 0; i < count; i++) {
      const { values, prune, tails, references } = await collectComfyValues();
      const mediaIds = { image: [], video: [], audio: [] };
      for (const f of comfyFields) {
        if (f.isMultiMedia || f.isReferenceCollection) mediaIds[f.mediaKind]?.push(...f.localIds());
        else if (f.isMedia) {
          const localId = f.localId();
          if (localId) mediaIds[f.mediaKind]?.push(localId);
        }
      }
      const input = { model: `comfy:${wf.file}`, workflow: wf.name, values };
      if (allLoras.length) input.loras = allLoras; // store the full loadout (incl. disabled) for re-import
      if (bypass.length) input.bypass = bypass;
      if (typeof values.prompt === "string" && values.prompt.trim()) input.prompt = values.prompt.trim();
      await queueComfyRun(wf, values, prune, mediaIds, input, enabledLoras, bypass, tails, cont, references);
      // Advance seeds for the next queued run (no-op when the mode is "fixed").
      for (const f of comfyFields) if (typeof f.advance === "function") f.advance();
    }
    saveComfySettings(wf.file); // remember the final values + LoRAs (server-side)
    disarmContinuation(); // one arm, one submit
  } finally {
    submitBtn.disabled = false;
  }
}

// Queue one ComfyUI run: one request queues it AND creates the pending History
// entry server-side (so a dropped connection can't orphan it — the sweep finishes
// it). Then attach a live status to that pending card, wire Cancel, and poll.
async function queueComfyRun(wf, values, prune, mediaIds, input, loras, bypass, tails, cont, references) {
  const job = {
    jobId: nextJobId++,
    taskId: null,
    input,
    mediaLocalIds: mediaIds,
    projectId: activeProjectId,
    startedAt: Date.now(),
  };
  try {
    const res = await fetch("/api/comfy/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: wf.file,
        values,
        prune,
        references: references || {},
        loras: loras || [],
        bypass: bypass || [],
        tails: tails || {},
        input: job.input,
        mediaLocalIds: job.mediaLocalIds,
        projectId: job.projectId,
        refVideoSeconds: 0,
        previewMethod,
        ...(cont ? { continueFrom: { parentId: cont.parentId, from: cont.from, slot: cont.into } } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok || data.code !== 200 || !data.data?.promptId) {
      throw new Error(data.msg || "ComfyUI rejected the workflow.");
    }
    job.taskId = data.data.promptId;
    job.historyId = data.data.historyId || null;
    // Queued, but something the run asked for couldn't be honored (e.g. a reference
    // tail the server couldn't measure) — say so rather than silently ignoring it.
    if (data.data.warnings?.length) setError(`Queued, but: ${data.data.warnings.join(" ")}`);
    const live = createLiveStatus(job);
    live.setStatus("Generating on ComfyUI… this can take a while.");
    if (job.historyId) liveStatus.set(job.historyId, live);
    wireComfyCancel(job);
    ensurePreviewStream(); // start listening for this run's preview frames
    loadHistory(); // renders the pending entry with the live status inside
    pollComfyJob(job);
  } catch (err) {
    // Couldn't queue (e.g. missing node) — no History entry was created; surface it.
    setError(err.message || String(err));
  }
}

// Poll a ComfyUI job (server normalizes /history into the kie.ai status shape).
async function pollComfyJob(job) {
  if (job.cancelled) return; // stopped by the user
  const live = liveOf(job);
  let data;
  try {
    const res = await fetch(`/api/comfy/status?promptId=${encodeURIComponent(job.taskId)}`);
    if (job.cancelled) return; // cancelled while this poll was in flight
    data = await res.json();
    if (res.status >= 400 && res.status < 500) {
      // Definitive client error — the task is gone/invalid.
      await failJob(job, data.msg || `Status check failed (${res.status})`);
      return;
    }
    if (!res.ok || data.code !== 200) throw new Error(data.msg || `Status check failed (${res.status})`);
  } catch {
    // Transient (network / 5xx) — leave the entry pending and retry.
    if (job.cancelled) return;
    if (live) live.setStatus("Reconnecting to ComfyUI…");
    setTimeout(() => pollComfyJob(job), POLL_INTERVAL_MS);
    return;
  }

  const state = data.data?.state;
  if (state === "success") {
    finishLive(job, { hold: true }); // keep the last preview frame up while we save
    const urls = JSON.parse(data.data.resultJson || "{}").resultUrls || [];
    if (!urls.length) {
      releaseLive(job);
      return failJob(job, "Finished, but ComfyUI returned no output file.");
    }
    // Pass every output (a batch can be several) and ComfyUI's real per-prompt run time.
    await attachHistoryResult(job, urls, null, data.data.runtimeMs); // downloads, marks done, refreshes History
    releaseLive(job); // the card now renders the real output — drop the held frame
    return;
  }
  if (state === "fail") {
    await failJob(job, data.data?.failMsg || "ComfyUI generation failed.");
    return;
  }
  if (state === "lost") {
    // ComfyUI has no record of this prompt (usually it was restarted). A couple of
    // polls of grace for the brief submit→queue race, then stop.
    job.lostCount = (job.lostCount || 0) + 1;
    if (job.lostCount < 3) {
      setTimeout(() => pollComfyJob(job), POLL_INTERVAL_MS);
      return;
    }
    await failJob(
      job,
      "ComfyUI has no record of this run — it was likely restarted. If its output is in " +
        "ComfyUI's output folder it couldn't be copied automatically; re-run to regenerate."
    );
    return;
  }
  // Still running — surface live step progress (drives the elapsed/ETA clock).
  const prog = data.data?.progress;
  if (live && prog && prog.max > 0) live.setProgress(prog.value, prog.max);
  setTimeout(() => pollComfyJob(job), POLL_INTERVAL_MS);
}

// --- prompt length counter -----------------------------------------------
// Caps per the model docs: Seedance 20,000; Seedream Lite 3,000; Pro 5,000.
const promptEl = document.getElementById("prompt");
const promptCount = document.getElementById("promptCount");
const promptCapHint = document.getElementById("promptCapHint");

function promptCap() {
  if (!isSeedream()) return 20000;
  return isSeedreamPro() ? 5000 : 3000;
}

function updatePromptCount() {
  const cap = promptCap();
  const len = promptEl.value.length;
  promptCapHint.textContent = `(max ${cap.toLocaleString()} characters)`;
  promptCount.textContent = `${len.toLocaleString()} / ${cap.toLocaleString()}`;
  promptCount.classList.toggle("over", len > cap);
}
promptEl.addEventListener("input", updatePromptCount);
updatePromptCount();

// --- helpers ----------------------------------------------------------------
// Form-level error (validation / pre-submit failures). Per-run failures are
// persisted onto the run's History entry instead — see failJob().
function setError(msg) {
  errorEl.textContent = msg;
  show(errorEl);
}

// Copy text to the clipboard. The async Clipboard API needs a secure context, so it's
// unavailable when the app is opened over http://<LAN-IP> (a common phone/PC setup);
// fall back to a hidden-textarea execCommand there. Returns whether the copy landed.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* blocked or unavailable — fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// --- live status (in the pending History card) --------------------------------
// A generation's live status/progress lives on its (up-front) pending History
// card, so there's no separate "job card". `liveStatus` maps a pending entry's id
// to a controller that owns a status element; renderHistory drops that element into
// the pending card and re-parents it across re-renders, so the poller's reference
// stays valid.
let nextJobId = 1;
const liveStatus = new Map(); // historyId -> controller

// Human-readable elapsed/ETA, e.g. "8s", "2m 05s", "1h 03m".
function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

function createLiveStatus(job) {
  const el = document.createElement("div");
  el.className = "hist-live";
  const line = document.createElement("div");
  line.className = "status-line";
  const spin = document.createElement("span");
  spin.className = "spinner";
  const statusText = document.createElement("span");
  statusText.className = "job-status";
  statusText.textContent = "Starting…";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "job-cancel hidden";
  cancelBtn.textContent = "Cancel";
  line.append(spin, statusText, cancelBtn);
  const progressWrap = document.createElement("div");
  progressWrap.className = "job-progress hidden";
  const progressBar = document.createElement("div");
  progressBar.className = "job-progress-bar";
  progressWrap.appendChild(progressBar);
  // The status/progress column is wrapped so a live preview frame can sit beside it
  // in a 200px thumb, matching the layout of a finished card.
  const col = document.createElement("div");
  col.className = "hist-live-col";
  col.append(line, progressWrap);
  el.appendChild(col);

  let previewImg = null;
  let previewToken = 0;
  let baseStatus = "Generating…";
  let progInfo = null; // { value, max, anchorT, anchorValue }
  const progStartedAt = job.startedAt || Date.now();
  let progTicker = null;
  const paint = () => {
    if (!progInfo) { statusText.textContent = baseStatus; return; }
    const { value, max, anchorT, anchorValue } = progInfo;
    const now = Date.now();
    const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    const elapsed = fmtDuration(now - progStartedAt);
    let eta = "";
    const dv = value - anchorValue;
    const dt = now - anchorT;
    if (value < max && dv > 0 && dt > 0) eta = ` · ~${fmtDuration((max - value) * (dt / dv))} left`;
    statusText.textContent = `${baseStatus} step ${value}/${max} (${pct}%) · ${elapsed} elapsed${eta}`;
  };

  return {
    el,
    running: true,
    isComfy: (job.input?.model || "").startsWith("comfy:"),
    promptId: job.taskId || null,
    setStatus(text) { baseStatus = text; paint(); },
    setProgress(value, max) {
      if (!max || max <= 0) return;
      if (!progInfo || value < progInfo.value) progInfo = { value, max, anchorT: Date.now(), anchorValue: value };
      else progInfo = { value, max, anchorT: progInfo.anchorT, anchorValue: progInfo.anchorValue };
      progressBar.style.width = `${Math.max(0, Math.min(100, Math.round((value / max) * 100)))}%`;
      progressWrap.classList.remove("hidden");
      paint();
      if (!progTicker) progTicker = setInterval(paint, 1000);
    },
    // Latest latent-preview frame. The <img> hangs off this controller's element, so
    // renderHistory's re-parenting keeps it on screen across refreshes.
    setPreview(url) {
      if (!previewImg) {
        previewImg = document.createElement("img");
        previewImg.className = "hist-preview-img zoomable";
        previewImg.alt = "";
        previewImg.decoding = "async";
        previewImg.title = "Click to see this preview full size";
        // The card's slot is narrow, so a multi-frame preview is small there. Open the
        // pixels already decoded in this <img> rather than its URL: /api/comfy/preview
        // is served no-store and the server drops the frame when the run ends, so
        // handing the lightbox the URL would refetch and 404 exactly when you want a
        // last look at it.
        previewImg.addEventListener("click", () => {
          let src = previewImg.src;
          try {
            const canvas = document.createElement("canvas");
            canvas.width = previewImg.naturalWidth;
            canvas.height = previewImg.naturalHeight;
            canvas.getContext("2d").drawImage(previewImg, 0, 0);
            src = canvas.toDataURL("image/jpeg", 0.92);
          } catch {
            /* canvas unavailable — fall back to the URL, fine while the run is live */
          }
          openLightbox("image", src, "Live preview");
        });
        const wrap = document.createElement("div");
        wrap.className = "hist-live-thumb";
        wrap.appendChild(previewImg);
        el.prepend(wrap);
        el.classList.add("has-preview");
      }
      // Decode off-screen and swap only on load — assigning src directly can blank
      // the card between frames. A frame that lands after a newer one is dropped.
      const token = ++previewToken;
      const pre = new Image();
      pre.onload = () => { if (token === previewToken) previewImg.src = pre.src; };
      pre.src = url;
    },
    // Show a Cancel button; `fn` runs once on click.
    enableCancel(fn) {
      cancelBtn.classList.remove("hidden");
      cancelBtn.addEventListener(
        "click",
        async () => { cancelBtn.disabled = true; statusText.textContent = "Cancelling…"; await fn(); },
        { once: true }
      );
    },
    stop() { this.running = false; clearInterval(progTicker); progTicker = null; },
  };
}

const liveOf = (job) => (job.historyId ? liveStatus.get(job.historyId) : null);
// Stop the clock. With `hold`, the controller stays mounted so the card keeps showing
// its last preview frame until attachHistoryResult re-renders it with the real output
// — dropping it here would flash the ⏳ placeholder in between.
function finishLive(job, { hold = false } = {}) {
  const l = liveOf(job);
  if (!l) return;
  l.stop();
  if (hold) return l.setStatus("Saving output…");
  liveStatus.delete(job.historyId);
}
function releaseLive(job) {
  if (job.historyId) liveStatus.delete(job.historyId);
}
// Persist a definitive failure/cancel to the pending History entry, then refresh.
async function failJob(job, msg) {
  finishLive(job);
  if (job.historyId) {
    try {
      await fetch(`/api/history/${job.historyId}/fail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: msg }),
      });
    } catch (err) {
      console.error("Failed to mark history entry failed:", err);
    }
  }
  loadHistory();
}

// Cancel a ComfyUI run (interrupt if running / drop from queue if pending) without
// stopping ComfyUI. The prompt is in History, so it can be re-run.
function wireComfyCancel(job) {
  const live = liveOf(job);
  if (!live) return;
  live.enableCancel(async () => {
    job.cancelled = true;
    try {
      await fetch("/api/comfy/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: job.taskId }),
      });
    } catch (err) {
      console.error("Cancel failed:", err);
    }
    await failJob(job, "Cancelled — re-run from History any time.");
  });
}

// --- live preview frames (ComfyUI latent previews) ------------------------------
// One EventSource for the whole page: the server tags each ping with the promptId, so
// however many runs are queued they share this stream. Only the ping crosses it; the
// frame itself is fetched as a plain JPEG, so a tab that doesn't own the run pays
// nothing for it.
let previewES = null;
let previewDead = false; // 401 / route missing — stop trying for this page load

function ensurePreviewStream() {
  if (previewES || previewDead || previewMethod === "off") return;
  const es = (previewES = new EventSource("/api/comfy/preview-stream"));
  es.addEventListener("message", (ev) => {
    let d;
    try { d = JSON.parse(ev.data); } catch { return; }
    // Route by promptId: frames for another tab's run — or for a prompt queued
    // straight from ComfyUI's own UI — simply match nothing here.
    const live = [...liveStatus.values()].find((l) => l.isComfy && l.promptId === d.promptId);
    live?.setPreview(`/api/comfy/preview?promptId=${encodeURIComponent(d.promptId)}&seq=${d.seq}`);
  });
  es.addEventListener("error", () => {
    // Per spec a non-2xx response closes the stream for good (signed out, or a server
    // without the route) — accept that and go quiet. A merely dropped connection
    // reconnects on its own and doesn't land here as CLOSED.
    if (es.readyState === EventSource.CLOSED) { previewDead = true; previewES = null; }
  });
}

function closePreviewStream() {
  if (previewES) { previewES.close(); previewES = null; }
}

function collectInput(resolved) {
  if (isSeedream()) {
    const input = {
      model: modelSelect.value,
      prompt: document.getElementById("prompt").value.trim(),
      aspect_ratio: aspectSelect.value,
      quality: qualitySelect.value,
      nsfw_checker: document.getElementById("nsfw_checker").checked,
    };
    if (isI2I()) input.image_urls = resolved.image;
    if (isSeedreamPro()) input.output_format = document.getElementById("output_format").value;
    return input;
  }
  const input = {
    model: modelSelect.value,
    prompt: document.getElementById("prompt").value.trim(),
    reference_image_urls: resolved.image,
    reference_video_urls: resolved.video,
    reference_audio_urls: resolved.audio,
    generate_audio: document.getElementById("generate_audio").checked,
    resolution: document.getElementById("resolution").value,
    aspect_ratio: document.getElementById("aspect_ratio").value,
    duration: Number(document.getElementById("duration").value),
    web_search: document.getElementById("web_search").checked,
    nsfw_checker: document.getElementById("nsfw_checker").checked,
  };
  // Start/end keyframes — all Seedance video models. `resolved` is already
  // mode-gated (empty unless the frames toggle is active), so these never coexist
  // with reference_image_urls.
  if (resolved.firstFrame?.[0]) input.first_frame_url = resolved.firstFrame[0];
  if (resolved.lastFrame?.[0]) input.last_frame_url = resolved.lastFrame[0];
  // 2.5-only extras: output format + last-frame return.
  if (is25()) {
    input.output_format = document.getElementById("output_format").value;
    input.return_last_frame = document.getElementById("return_last_frame").checked;
  }
  return input;
}

// --- submit / generate --------------------------------------------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Local ComfyUI workflows have their own submit path (no kie.ai uploads/credits).
  if (isComfy()) {
    submitComfy();
    return;
  }

  if (allItems().some((i) => i.status === "saving")) {
    setError("Some files are still saving — wait a moment and try again.");
    return;
  }
  if (allItems().some((i) => i.status === "error")) {
    setError("Remove the failed file(s) before generating.");
    return;
  }
  if (isI2I() && !lists.image.items.some((i) => i.status === "ready")) {
    setError("Seedream image-to-image needs at least one reference image.");
    return;
  }
  if (promptEl.value.length > promptCap()) {
    setError(
      `Prompt is ${promptEl.value.length.toLocaleString()} characters — this model's limit is ${promptCap().toLocaleString()}.`
    );
    return;
  }

  hide(errorEl);
  // Lock only for the upload→create window so a double-click can't double-submit
  // the same form. It re-enables once the task is created, freeing you to queue
  // another generation while this one keeps polling in the background.
  submitBtn.disabled = true;

  const mediaLocalIds = {
    image: isT2I() || usesFrames() ? [] : lists.image.localIds(),
    video: isSeedream() ? [] : lists.video.localIds(),
    audio: isSeedream() ? [] : lists.audio.localIds(),
    firstFrame: usesFrames() ? lists.firstFrame.localIds() : [],
    lastFrame: usesFrames() ? lists.lastFrame.localIds() : [],
  };

  const job = {
    jobId: nextJobId++,
    taskId: null,
    input: null,
    mediaLocalIds,
    balanceBefore: null,
    projectId: activeProjectId, // pin now so a mid-run project switch can't misfile it
    refSecs: isSeedream() ? 0 : refVideoSeconds(),
    startedAt: Date.now(),
  };

  // Create the pending History entry up front (before the upload), so the run has a
  // live card from the start. Its stored input has no hosted URLs yet — reference
  // counts come from mediaLocalIds — and the real (resolved) input is sent to the API.
  job.input = collectInput({ image: [], video: [], audio: [], firstFrame: [], lastFrame: [] });
  job.historyId = await createHistoryEntry(job.input, null, job.mediaLocalIds, job.projectId, job.refSecs);
  const live = createLiveStatus(job);
  if (job.historyId) liveStatus.set(job.historyId, live);
  loadHistory();

  // Host reference media on kie.ai now — nothing was sent when they were dropped.
  let resolved;
  try {
    if (allItems().some((i) => i.status === "ready")) live.setStatus("Uploading reference media…");
    resolved = {
      // only upload the reference kinds the selected model+mode actually uses
      // (2.5 forbids mixing reference images with first/last frames)
      image: isT2I() || usesFrames() ? [] : await lists.image.resolve(),
      video: isSeedream() ? [] : await lists.video.resolve(),
      audio: isSeedream() ? [] : await lists.audio.resolve(),
      firstFrame: usesFrames() ? await lists.firstFrame.resolve() : [],
      lastFrame: usesFrames() ? await lists.lastFrame.resolve() : [],
    };
  } catch (err) {
    await failJob(job, err.message || "Failed to upload reference media.");
    submitBtn.disabled = false;
    return;
  }

  const genInput = collectInput(resolved); // real input (hosted URLs) for the API call
  live.setStatus("Submitting…");

  // Snapshot the balance so we can measure actual cost on completion. (With
  // overlapping runs this delta is unreliable; the per-task creditsConsumed
  // reported on completion is the primary source and stays accurate.)
  job.balanceBefore = await loadCredits();

  try {
    job.taskId = await createTask(genInput, live);
    live.setStatus("Generating… this can take a few minutes.");
    await persistEntryTask(job); // let the server-side sweep finish it if this tab goes away
    pollJob(job);
  } catch (err) {
    await failJob(job, err.message || String(err));
  } finally {
    submitBtn.disabled = false;
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST /api/create, retrying on HTTP 429 — kie.ai's one hard limit is 20 new
// requests / 10s, and rejected requests are NOT queued, so we back off and retry.
const RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_BACKOFF_MS = 6000;
async function createTask(input, live) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      live.setStatus(`Rate-limited — retrying (${attempt + 1}/${RATE_LIMIT_RETRIES})…`);
      await sleep(RATE_LIMIT_BACKOFF_MS);
      continue;
    }
    if (!res.ok || data.code !== 200 || !data.data?.taskId) {
      throw new Error(data.msg || `Request failed (${res.status})`);
    }
    return data.data.taskId;
  }
}

async function pollJob(job) {
  const { taskId, balanceBefore } = job;
  let data;
  try {
    const res = await fetch(`/api/status?taskId=${encodeURIComponent(taskId)}`);
    data = await res.json();
    if (res.status >= 400 && res.status < 500) {
      // 4xx means the task is gone/invalid — terminal.
      await failJob(job, data.msg || `Status check failed (${res.status})`);
      return;
    }
    if (!res.ok || data.code !== 200) throw new Error(data.msg || `Status check failed (${res.status})`);
  } catch {
    // Transient (network / 5xx) — leave the entry pending and retry.
    setTimeout(() => pollJob(job), POLL_INTERVAL_MS);
    return;
  }

  const state = data.data?.state;
  if (state === "success") {
    finishLive(job);
    const url = JSON.parse(data.data.resultJson || "{}").resultUrls?.[0];
    if (!url) return failJob(job, "Task succeeded but no result URL was returned.");

    // Prefer the API's exact per-task cost (creditsConsumed on recordInfo); fall
    // back to the balance delta for older responses (unreliable when runs overlap).
    const balanceAfter = await loadCredits(); // also refreshes the header balance
    let cost = null;
    const reported = Number(data.data.creditsConsumed);
    if (Number.isFinite(reported) && reported > 0) cost = reported;
    else if (typeof balanceBefore === "number" && typeof balanceAfter === "number") {
      const delta = balanceBefore - balanceAfter;
      if (delta > 0) cost = delta;
    }
    await attachHistoryResult(job, url, cost); // downloads, marks done, refreshes History
    return;
  }
  if (state === "fail") {
    await failJob(job, data.data?.failMsg || `Generation failed (code ${data.data?.failCode ?? "?"}).`);
    return;
  }
  setTimeout(() => pollJob(job), POLL_INTERVAL_MS);
}

// --- history -------------------------------------------------------------------
// Create a PENDING history entry at submit time so the prompt/settings are saved
// immediately — a run that later fails, stalls, or is cancelled won't lose them.
// Returns the new entry's id (to attach the output to on success).
async function createHistoryEntry(input, taskId, mediaLocalIds, projectId, refSecs) {
  try {
    const res = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        taskId,
        mediaLocalIds,
        refVideoSeconds: typeof refSecs === "number" ? refSecs : 0,
        projectId: projectId || activeProjectId,
        imageLocalIds: mediaLocalIds?.image || [], // kept for older readers of history.json
      }),
    });
    const data = await res.json();
    loadHistory();
    return data.data?.id || null;
  } catch (err) {
    console.error("Failed to create history entry:", err);
    return null;
  }
}

// Attach the finished output to a pending entry (downloads the file). Falls back
// to a fresh save if there's no pending id (e.g. a job resumed from a reload
// predating the pending entry).
// Returns the saved local file path (/video/…) so callers can preview the
// downloaded copy instead of the source URL (ComfyUI's /view URL doesn't render a
// reliable inline poster; the local file does).
// `result` is one URL (kie.ai) or an array of URLs (a ComfyUI batch can return
// several files). All are downloaded server-side; the first mirrors resultUrl.
async function attachHistoryResult(job, result, costCredits, runtimeMs) {
  const resultUrls = Array.isArray(result) ? result : [result].filter(Boolean);
  const resultUrl = resultUrls[0] || null;
  try {
    let entry = null;
    if (job.historyId) {
      const r = await fetch(`/api/history/${job.historyId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultUrls, resultUrl, costCredits, runtimeMs }),
      });
      entry = (await r.json().catch(() => ({})))?.data;
    } else {
      const r = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: job.input,
          taskId: job.taskId,
          resultUrl,
          costCredits,
          mediaLocalIds: job.mediaLocalIds,
          refVideoSeconds: typeof job.refSecs === "number" ? job.refSecs : 0,
          projectId: job.projectId || activeProjectId,
          imageLocalIds: job.mediaLocalIds?.image || [],
          startedAt: job.startedAt || null,
        }),
      });
      entry = (await r.json().catch(() => ({})))?.data;
    }
    loadHistory();
    return entry?.localVideo || null;
  } catch (err) {
    console.error("Failed to save history result:", err);
    return null;
  }
}

async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    historyEntries = data.data || [];
    renderHistory(historyEntries);
    updateEstimate();
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

// The history entries the current filter keeps, in display order — shared by
// the rendered list and the lightbox's ‹ › navigation so they stay in sync.
// Entries carrying any tag checked in the "Hide:" controls are dropped. The
// "cancelled" checkbox isn't a card tag — it drops failed/cancelled runs (both
// land on status "failed"), so it's handled here rather than via entryTags.
function filterHistory(entries) {
  const filter = historyFilter.value || "all";
  const byProject = filter === "all" ? entries : entries.filter((e) => (e.projectId || "default") === filter);
  if (!hiddenTags.size) return byProject;
  return byProject.filter((e) => {
    if (hiddenTags.has("cancelled") && e.status === "failed") return false;
    return !entryTags(e).some((t) => hiddenTags.has(t));
  });
}

// A history entry's tags: derived kind (image/video, only once there's an output)
// + the stored favorite/draft.
function entryTags(entry) {
  const tags = [];
  const src = entry.localVideo || entry.resultUrl || "";
  if (src) {
    const input = entry.input || {};
    const isImg = (input.model || "").startsWith("comfy:") ? isImageFile(src) : isImageOutput(input.model);
    tags.push(isImg ? "image" : "video");
  }
  if (entry.favorite) tags.push("favorite");
  if (entry.draft) tags.push("draft");
  return tags;
}

// True if a saved-output URL/path points at a still image (used for ComfyUI,
// whose output medium isn't derivable from the model id).
const isImageFile = (u) => {
  if (!u) return false;
  let name = u;
  // ComfyUI /view URLs carry the real name in ?filename=…; read that when present.
  try {
    const f = new URL(u, location.origin).searchParams.get("filename");
    if (f) name = f;
  } catch {
    /* not a parseable URL — test the raw string */
  }
  return /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(name);
};

// A history entry's outputs as [{ resultUrl, localVideo }]. Newer entries carry an
// `outputs` array (a batch can be several); older/kie entries have the single
// resultUrl/localVideo, normalized here to a one-item list.
function entryOutputs(entry) {
  if (entry.outputs && entry.outputs.length) return entry.outputs;
  if (entry.localVideo || entry.resultUrl) return [{ resultUrl: entry.resultUrl, localVideo: entry.localVideo }];
  return [];
}

// kind/src/name for one output of an entry (for the lightbox / thumbnails).
function outputMedia(entry, out, index, total) {
  const input = entry.input || {};
  const src = out.localVideo || out.resultUrl; // localVideo is the saved output file
  const kind = (input.model || "").startsWith("comfy:")
    ? isImageFile(src) ? "image" : "video"
    : isImageOutput(input.model) ? "image" : "video";
  const name = total > 1 ? `${input.prompt || ""} (${index + 1}/${total})` : input.prompt;
  return { kind, src, name };
}

// Every output of every visible history entry, flattened — so the lightbox arrows
// step through all of them (including each image of a batch), not just one per entry.
function flattenHistoryOutputs() {
  const items = [];
  for (const entry of filterHistory(historyEntries)) {
    const outs = entryOutputs(entry);
    outs.forEach((o, i) => {
      const m = outputMedia(entry, o, i, outs.length);
      if (m.src) items.push(m);
    });
  }
  return items;
}

// Open one output full-size, with arrow navigation across every visible output.
function openHistoryLightbox(entry, outIndex = 0) {
  const outs = entryOutputs(entry);
  const target = outs[outIndex] || outs[0];
  if (!target) return;
  const m = outputMedia(entry, target, outIndex, outs.length);
  const items = flattenHistoryOutputs();
  let index = items.findIndex((it) => it.src === m.src);
  if (index < 0) index = 0;
  openLightbox(items[index].kind, items[index].src, items[index].name, { items, index });
}

// Human-readable spend category for a model id, used in the per-project credit
// breakdown. Entries predating model storage were Seedance 2 (matches the
// estimate code's default), Lite/Pro collapse i2i + t2i into one category.
function creditCategory(model) {
  const m = model || "bytedance/seedance-2";
  if (m.startsWith("comfy:")) return "ComfyUI (local)";
  if (m.startsWith("seedream/"))
    return m.includes("5-pro") ? "Seedream Pro" : "Seedream Lite";
  if (m === "bytedance/seedance-2-5") return "Seedance 2.5";
  if (m === "bytedance/seedance-2-fast") return "Seedance 2 Fast";
  if (m === "bytedance/seedance-2-mini") return "Seedance 2 Mini";
  if (m === "bytedance/seedance-2") return "Seedance 2";
  return "Other";
}

// Total (and per-category) credits spent in the active project, shown in the
// header line below the account balance.
function renderProjectCredits() {
  if (!projectCreditsTotal) return;
  const entries = historyEntries.filter(
    (e) => (e.projectId || "default") === activeProjectId
  );
  let total = 0;
  const byCat = new Map();
  for (const e of entries) {
    const c = typeof e.costCredits === "number" ? e.costCredits : 0;
    if (!c) continue;
    total += c;
    const cat = creditCategory(e.input?.model);
    byCat.set(cat, (byCat.get(cat) || 0) + c);
  }
  projectCreditsTotal.textContent = `${total.toLocaleString()} credits`;

  projectCreditsBreakdown.innerHTML = "";
  const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "pc-empty";
    p.textContent = "No credits spent in this project yet.";
    projectCreditsBreakdown.appendChild(p);
    return;
  }
  for (const [cat, amt] of rows) {
    const row = document.createElement("div");
    row.className = "pc-row";
    const name = document.createElement("span");
    name.className = "pc-cat";
    name.textContent = cat;
    const val = document.createElement("span");
    val.className = "pc-amt";
    val.textContent = amt.toLocaleString();
    row.append(name, val);
    projectCreditsBreakdown.appendChild(row);
  }
}

// A collapsible <details> holding this run's generation settings and its full,
// untrimmed prompt. Which settings apply depends on the model family: ComfyUI (H3)
// runs use megapixels + sampler/scheduler/steps; Seedance video uses resolution +
// duration; Seedream images use quality + format. Rows with no value are omitted.
function buildHistDetails(entry, input, comfyEntry, isImg) {
  const rows = [];
  const push = (label, val) => {
    if (val === undefined || val === null || val === "") return;
    rows.push([label, String(val)]);
  };
  if (comfyEntry) {
    const v = input.values || {};
    push("Aspect ratio", v.aspect_ratio);
    push("Size (MP)", v.megapixels);
    push("Sampler", v.sampler);
    push("Scheduler", v.scheduler);
    push("Steps", v.steps);
    push("Seed", v.seed);
    push("Duration", v.duration != null && v.duration !== "" ? `${v.duration}s` : v.duration);
  } else if (isImg) {
    push("Aspect ratio", input.aspect_ratio);
    push("Quality", input.quality);
    push("Format", input.output_format);
    push("Seed", input.seed);
  } else {
    push("Resolution", input.resolution);
    push("Aspect ratio", input.aspect_ratio);
    push("Duration", input.duration != null && input.duration !== "" ? `${input.duration}s` : input.duration);
    push("Seed", input.seed);
  }

  const details = document.createElement("details");
  details.className = "hist-details";
  const summary = document.createElement("summary");
  summary.textContent = "Settings & full prompt";
  details.appendChild(summary);

  const dbody = document.createElement("div");
  dbody.className = "hist-details-body";
  if (rows.length) {
    const dl = document.createElement("dl");
    dl.className = "hist-settings";
    for (const [k, val] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = val;
      dl.append(dt, dd);
    }
    dbody.appendChild(dl);
  }

  // Thumbnails for any reference media (images, video, audio) used by this run.
  const refs = historyRefMedia(entry);
  if (refs.length) {
    const label = document.createElement("div");
    label.className = "hist-refs-label";
    label.textContent = "Reference media";
    const grid = document.createElement("div");
    grid.className = "hist-refs";
    for (const r of refs) {
      const cell = document.createElement("div");
      // Images are larger and carry action buttons; video/audio stay compact.
      cell.className =
        "hist-ref" + (r.kind === "image" ? " hist-ref-lg" : "") + (r.kind === "audio" ? " audio-thumb" : "");
      cell.title = r.name || r.kind;
      cell.appendChild(makeThumbContent(r.kind, { thumb: r.thumb, name: r.name }));
      if (r.kind === "image") {
        const bar = document.createElement("div");
        bar.className = "hist-ref-bar";
        const openB = document.createElement("button");
        openB.type = "button";
        openB.className = "hist-ref-btn";
        openB.textContent = "⛶";
        openB.title = "Open in a larger view";
        openB.addEventListener("click", (e) => {
          e.stopPropagation();
          openLightbox("image", r.thumb, r.name);
        });
        const addB = document.createElement("button");
        addB.type = "button";
        addB.className = "hist-ref-btn";
        addB.textContent = "＋";
        addB.title = "Add to the current picture field";
        addB.addEventListener("click", (e) => {
          e.stopPropagation();
          const ok = addRefToPictureField(r);
          addB.textContent = ok ? "✓" : "⚠";
          setTimeout(() => (addB.textContent = "＋"), 1000);
        });
        bar.append(openB, addB);
        cell.appendChild(bar);
      } else {
        const badge = document.createElement("span");
        badge.className = "img-label kind-badge";
        badge.textContent = r.kind;
        cell.appendChild(badge);
      }
      grid.appendChild(cell);
    }
    dbody.append(label, grid);
  }

  const fp = document.createElement("div");
  fp.className = "hist-fullprompt";
  fp.textContent = input.prompt || "(no prompt)";
  dbody.appendChild(fp);
  details.appendChild(dbody);
  return details;
}

// The reference media (image/video/audio) used by a history entry, as
// {kind, thumb, name}. Finished kie.ai runs store hosted URLs in `input`; ComfyUI
// and pending runs store local ids in `mediaLocalIds`, resolved to saved-file URLs
// via the cached gallery list. Unresolvable local ids (file deleted) are skipped.
function historyRefMedia(entry) {
  const input = entry.input || {};
  const mli = entry.mediaLocalIds || {};
  const byId = new Map(galleryItems.map((i) => [i.id, i]));
  const out = [];
  const addUrls = (urls, kind) => {
    for (const u of urls || []) if (u) out.push({ kind, id: null, thumb: u, name: urlBasename(u) });
  };
  const addLocal = (ids, kind) => {
    for (const id of ids || []) {
      const m = byId.get(id);
      if (m) out.push({ kind, id: m.id, thumb: m.localUrl, name: m.name });
    }
  };
  const imgUrls = input.reference_image_urls || input.image_urls;
  if (imgUrls?.length) addUrls(imgUrls, "image");
  else addLocal(mli.image || entry.imageLocalIds, "image");
  if (input.reference_video_urls?.length) addUrls(input.reference_video_urls, "video");
  else addLocal(mli.video, "video");
  if (input.reference_audio_urls?.length) addUrls(input.reference_audio_urls, "audio");
  else addLocal(mli.audio, "audio");
  return out;
}

// Add a reference image to the current form's picture field. In ComfyUI mode this
// is the workflow's first image media field (which needs a local file); otherwise
// it's the kie.ai Reference-images list (which also accepts a hosted URL). Returns
// true on success, false if the field is full or a local file was required but the
// reference is a remote-only URL.
function addRefToPictureField(r) {
  const comfyActive = comfyControlsEl && !comfyControlsEl.classList.contains("hidden");
  const comfyImg = comfyActive
    ? comfyFields.find((f) => f.mediaKind === "image" && typeof f.addMedia === "function")
    : null;
  if (comfyImg) {
    // ComfyUI needs a saved local file; remote-only kie URLs can't be used here.
    return comfyImg.addMedia({ id: r.id, url: r.thumb, name: r.name });
  }
  if (r.id) {
    lists.image.addFromGallery({ id: r.id, localUrl: r.thumb, name: r.name });
  } else {
    lists.image.addUrl(r.thumb);
  }
  return true;
}

// Best-effort human filename from a media URL (handles ComfyUI ?filename= URLs).
function urlBasename(u) {
  try {
    const p = new URL(u, location.origin);
    return p.searchParams.get("filename") || decodeURIComponent(p.pathname.split("/").pop() || "") || u;
  } catch {
    return String(u).split("/").pop() || u;
  }
}

// Jump to a history page and re-render (used by the pager buttons).
function goHistoryPage(n) {
  historyPage = n;
  renderHistory(historyEntries);
  historyEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The compact page numbers to show: always first & last, the current page ±1, with
// null standing in for an ellipsis gap. e.g. 1 … 4 5 6 … 20.
function historyPageNumbers(current, total) {
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const shown = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of shown) {
    if (p - prev > 1) out.push(null); // gap → ellipsis
    out.push(p);
    prev = p;
  }
  return out;
}

// Prev / numbered / Next controls under the history list. Hidden when everything
// fits on one page.
function renderHistoryPager(pageCount) {
  historyPager.innerHTML = "";
  historyPager.classList.toggle("hidden", pageCount <= 1);
  if (pageCount <= 1) return;

  const mkBtn = (label, page, { disabled = false, current = false } = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hist-page-btn" + (current ? " current" : "");
    b.textContent = label;
    b.disabled = disabled;
    if (!disabled && !current) b.addEventListener("click", () => goHistoryPage(page));
    return b;
  };

  historyPager.appendChild(mkBtn("‹ Prev", historyPage - 1, { disabled: historyPage <= 1 }));
  for (const p of historyPageNumbers(historyPage, pageCount)) {
    if (p === null) {
      const gap = document.createElement("span");
      gap.className = "hist-page-gap";
      gap.textContent = "…";
      historyPager.appendChild(gap);
    } else {
      historyPager.appendChild(mkBtn(String(p), p, { current: p === historyPage }));
    }
  }
  historyPager.appendChild(mkBtn("Next ›", historyPage + 1, { disabled: historyPage >= pageCount }));
}

function renderHistory(entries) {
  renderProjectCredits();
  historyEl.innerHTML = "";
  const filter = historyFilter.value || "all"; // used below for the per-entry project label
  const visible = filterHistory(entries);
  historyEmpty.classList.toggle("hidden", visible.length > 0);

  // Paginate: clamp the page to the current count (entries may have been deleted or
  // filtered), then render just this page's slice. The lightbox still walks the full
  // filtered list, so ‹ › navigation isn't interrupted by page boundaries.
  const pageCount = Math.max(1, Math.ceil(visible.length / HISTORY_PAGE_SIZE));
  historyPage = Math.min(Math.max(1, historyPage), pageCount);
  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const pageEntries = visible.slice(start, start + HISTORY_PAGE_SIZE);
  renderHistoryPager(pageCount);

  for (const entry of pageEntries) {
    const input = entry.input || {};
    const card = document.createElement("div");
    card.className = "hist-card";

    // ComfyUI output medium isn't encoded in the model id — read it off the file.
    const comfyEntry = (input.model || "").startsWith("comfy:");
    const output = entry.localVideo || entry.resultUrl;
    const isImg = comfyEntry ? isImageFile(output) : isImageOutput(input.model);
    if (!output) {
      const live = entry.status === "pending" ? liveStatus.get(entry.id) : null;
      if (live) {
        // In-flight: show this run's live status/progress (+ Cancel) right here. The
        // element is re-parented across re-renders so the poller's ref stays valid.
        card.classList.add("hist-card-live");
        card.appendChild(live.el);
      } else {
        // Pending with no live controller (e.g. before resume polls), or a run that
        // failed/was cancelled. Prompt is preserved; Re-run works.
        const ph = document.createElement("div");
        ph.className = `hist-placeholder ${entry.status === "pending" ? "pending" : "unfinished"}`;
        ph.textContent =
          entry.status === "pending" ? "⏳ Generating…" : entry.error || "no output — re-run below";
        if (entry.error) ph.title = entry.error;
        card.appendChild(ph);
      }
    } else {
      // History always shows a thumbnail — a <video preload="metadata"> renders the
      // first frame without downloading the whole file. The media is wrapped in a
      // fixed-width thumb so the flex row can't stretch it to the card's height. A
      // run that produced several outputs (a batch) shows them all in a grid.
      const outs = entryOutputs(entry);
      const thumb = document.createElement("div");
      thumb.className = "hist-thumb" + (outs.length > 1 ? " hist-thumb-grid" : "");
      outs.forEach((o, i) => {
        const src = o.localVideo || o.resultUrl;
        if (!src) return;
        const oIsImg = comfyEntry ? isImageFile(src) : isImageOutput(input.model);
        if (oIsImg) {
          const im = document.createElement("img");
          im.src = src;
          im.className = "hist-img zoomable";
          im.loading = "lazy";
          im.addEventListener("click", () => openHistoryLightbox(entry, i)); // full-size, with ‹ › nav
          thumb.appendChild(im);
        } else {
          const vid = document.createElement("video");
          vid.src = src;
          vid.preload = "metadata";
          if (outs.length > 1) {
            // In a grid, each video is a click-to-open thumb (controls live in the lightbox).
            vid.muted = true;
            vid.classList.add("zoomable");
            vid.addEventListener("click", () => openHistoryLightbox(entry, i));
          } else {
            vid.controls = true; // a lone video plays inline as before
          }
          thumb.appendChild(vid);
        }
      });
      card.appendChild(thumb);
    }

    const body = document.createElement("div");
    body.className = "hist-body";

    // Timestamp line (built here, appended last in the column). Seed and reference
    // counts live in the Settings dropdown now, so they're omitted here.
    const meta = document.createElement("div");
    meta.className = "hist-meta";
    const date = new Date(entry.createdAt).toLocaleString();
    const cost = typeof entry.costCredits === "number" ? ` · ${entry.costCredits.toLocaleString()} credits` : "";
    // generation run-time (wall time from submit to finished output)
    const rt = entry.runtimeMs ? ` · ⏱ ${fmtDuration(entry.runtimeMs)}` : "";
    // show which project the entry belongs to when viewing all projects
    const proj = filter === "all" ? ` · ${projectName(entry.projectId || "default")}` : "";
    if (comfyEntry) {
      const wfName = input.workflow || input.model.slice("comfy:".length).replace(/\.json$/i, "");
      meta.textContent = `${date} · ComfyUI · ${wfName}${rt}${proj}`;
    } else if (isImg) {
      meta.textContent =
        `${date} · ${seedreamLabel(input.model)} · ${input.quality || "basic"} · ${input.aspect_ratio || "?"}` +
        `${cost}${rt}${proj}`;
    } else {
      const variant = VIDEO_VARIANT_LABEL[input.model] ? ` · ${VIDEO_VARIANT_LABEL[input.model]}` : "";
      meta.textContent =
        `${date}${variant} · ${input.resolution || "?"} · ${input.aspect_ratio || "?"} · ` +
        `${input.duration || "?"}s${cost}${rt}${proj}`;
    }

    const actions = document.createElement("div");
    actions.className = "hist-actions";

    const reimport = document.createElement("button");
    reimport.type = "button";
    reimport.className = "btn-secondary";
    reimport.textContent = "Re-import";
    reimport.addEventListener("click", () => {
      applyEntry(entry);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    actions.appendChild(reimport);

    // Continue / Re-roll, for a workflow that declares the continuation tokens and a
    // run that carries a slot. The workflow list is already in memory, so this
    // self-heals: drop the tags from the .json and the buttons disappear.
    const cont = entry.continuation;
    const wfMeta = comfyEntry
      ? comfyWorkflows.find((w) => w.file === (input.model || "").slice("comfy:".length))
      : null;
    const roles = {};
    for (const t of wfMeta?.tokens || []) if (t.role) roles[t.role] = t.name;
    const when = new Date(entry.createdAt || Number(entry.id)).toLocaleString();

    if (cont?.slot && roles["continue.in"] && roles["continue.out"] && output) {
      const contBtn = document.createElement("button");
      contBtn.type = "button";
      contBtn.className = "btn-secondary";
      contBtn.innerHTML = '<span class="btn-ico">⛓</span> Continue';
      contBtn.title = "Start a new run that continues from this one";
      contBtn.addEventListener("click", async () => {
        await applyEntry(entry); // reselects the workflow and prefills everything
        armContinuation(
          { parentId: entry.id, from: cont.slot, into: null, file: wfMeta.file, label: when },
          input.values || {}
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      actions.appendChild(contBtn);
    }

    if (cont && roles["continue.out"]) {
      // Redo this run in place, keeping its position so anything continuing from it
      // stays valid. Plain Re-run below deliberately forks instead — it never
      // overwrites, which keeps the safe default safe.
      const rollBtn = document.createElement("button");
      rollBtn.type = "button";
      rollBtn.className = "btn-secondary";
      rollBtn.innerHTML = '<span class="btn-ico">↻</span> Re-roll';
      rollBtn.title = "Regenerate this run in place, keeping its place in the chain";
      rollBtn.addEventListener("click", async () => {
        await applyEntry(entry);
        armContinuation(
          { parentId: cont.parentId, from: cont.from, into: cont.slot, file: wfMeta.file, label: when },
          input.values || {}
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      actions.appendChild(rollBtn);
    }

    const rerun = document.createElement("button");
    rerun.type = "button";
    rerun.className = "btn-secondary";
    rerun.textContent = "Re-run";
    rerun.addEventListener("click", async () => {
      const entryProject = entry.projectId || "default";
      if (entryProject !== activeProjectId) {
        const ok = confirm(
          `This generation is from project "${projectName(entryProject)}".\n` +
            `The new result will be saved to the active project "${projectName(activeProjectId)}".\n\nContinue?`
        );
        if (!ok) return;
      }
      await applyEntry(entry);
      window.scrollTo({ top: 0, behavior: "smooth" });
      form.requestSubmit();
    });
    actions.appendChild(rerun);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn-secondary";
    copyBtn.innerHTML = '<span class="btn-ico">⧉</span> Prompt';
    copyBtn.title = "Copy the prompt to the clipboard";
    copyBtn.addEventListener("click", async () => {
      copyBtn.textContent = (await copyText(input.prompt || "")) ? "Copied!" : "Copy failed";
      setTimeout(() => (copyBtn.innerHTML = '<span class="btn-ico">⧉</span> Prompt'), 1200);
    });
    actions.appendChild(copyBtn);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn-secondary";
    openBtn.innerHTML = '<span class="btn-ico">⛶</span> Open';
    openBtn.title = "Open full size";
    openBtn.addEventListener("click", () => openHistoryLightbox(entry));
    actions.appendChild(openBtn);

    // Re-download the saved output from its source URL — recovers a run whose local
    // file failed to save or went missing. Only shown when there's a source to fetch.
    const hasSource = !!(entry.resultUrl || (entry.outputs || []).some((o) => o.resultUrl));
    if (hasSource) {
      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.className = "btn-secondary";
      refreshBtn.innerHTML = '<span class="btn-ico">⟳</span> Refresh';
      refreshBtn.title = "Re-download the output file from the source (fixes a missing or wrong saved file)";
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        const prev = refreshBtn.innerHTML;
        refreshBtn.innerHTML = "Refreshing…";
        try {
          const res = await fetch(`/api/history/${entry.id}/redownload`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.msg || "Re-download failed");
          refreshBtn.innerHTML = "Refreshed!";
          await loadHistory(); // re-renders the card with the freshly-saved file
        } catch (err) {
          alert(err.message || String(err));
          refreshBtn.innerHTML = prev;
          refreshBtn.disabled = false;
        }
      });
      actions.appendChild(refreshBtn);
    }

    // add the generated image to the gallery for its own project
    if (isImg) {
      const galleryBtn = document.createElement("button");
      galleryBtn.type = "button";
      galleryBtn.className = "btn-secondary";
      galleryBtn.innerHTML = '<span class="btn-ico">＋</span> Gallery';
      galleryBtn.title = "Add this image to the gallery";
      galleryBtn.addEventListener("click", async () => {
        galleryBtn.disabled = true;
        try {
          const res = await fetch(`/api/history/${entry.id}/to-gallery`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.msg || "Failed to add to gallery");
          galleryBtn.innerHTML = "Added!";
          loadGallery();
          setTimeout(() => {
            galleryBtn.innerHTML = '<span class="btn-ico">＋</span> Gallery';
            galleryBtn.disabled = false;
          }, 1200);
        } catch (err) {
          alert(err.message || String(err));
          galleryBtn.innerHTML = '<span class="btn-ico">＋</span> Gallery';
          galleryBtn.disabled = false;
        }
      });
      actions.appendChild(galleryBtn);
    }

    // reassign the entry to another project (files stay where they are)
    const projSel = document.createElement("select");
    projSel.className = "hist-project";
    projSel.title = "Move this entry (and its saved video) to another project";
    for (const p of projects) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      projSel.appendChild(opt);
    }
    const entryProjectId = entry.projectId || "default";
    projSel.value = projSel.querySelector(`option[value="${entryProjectId}"]`) ? entryProjectId : "default";
    projSel.addEventListener("change", async () => {
      try {
        const res = await fetch(`/api/history/${entry.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: projSel.value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || "Reassign failed");
        loadHistory();
      } catch (err) {
        alert(err.message || String(err));
        projSel.value = entryProjectId;
      }
    });
    actions.appendChild(projSel);

    // delete this entry (removes the saved output too) — with confirmation
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-secondary hist-delete";
    del.innerHTML = '<span class="btn-ico">🗑</span> Delete';
    del.title = "Delete this history item (Ctrl+click to skip confirmation)";
    del.addEventListener("click", async (e) => {
      // Ctrl (or ⌘) + click deletes immediately, skipping the confirm prompt.
      const skipConfirm = e.ctrlKey || e.metaKey;
      if (!skipConfirm && !confirm("Delete this history item? This also removes its saved output file and can't be undone.")) return;
      del.disabled = true;
      try {
        const res = await fetch(`/api/history/${entry.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).msg || "Delete failed");
        loadHistory();
      } catch (err) {
        alert(err.message || String(err));
        del.disabled = false;
      }
    });
    actions.appendChild(del);

    // Favorite (star) and draft toggles — tags kept on the entry either way;
    // both also relocate the saved file server-side.
    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = "btn-secondary hist-tag-toggle" + (entry.favorite ? " active" : "");
    favBtn.innerHTML = entry.favorite ? "★ Favorite" : "☆ Favorite";
    favBtn.title = entry.favorite
      ? "Remove from favorites (moves the file out of favorites/)"
      : "Mark as favorite (moves the file into favorites/)";
    favBtn.addEventListener("click", () => toggleHistoryTag(entry, "favorite"));
    actions.appendChild(favBtn);

    const draftBtn = document.createElement("button");
    draftBtn.type = "button";
    draftBtn.className = "btn-secondary hist-tag-toggle" + (entry.draft ? " active" : "");
    draftBtn.innerHTML = "📝 Draft";
    draftBtn.title = entry.draft ? "Remove the draft tag" : "Tag this as a draft";
    draftBtn.addEventListener("click", () => toggleHistoryTag(entry, "draft"));
    actions.appendChild(draftBtn);

    // Tag chips (kind + favorite/draft), shown at the top of the card body.
    const tagsRow = document.createElement("div");
    tagsRow.className = "hist-tags";
    for (const t of entryTags(entry)) {
      const chip = document.createElement("span");
      chip.className = `hist-tag hist-tag-${t}`;
      chip.textContent = t;
      tagsRow.appendChild(chip);
    }

    // Right column: tag chips, buttons, the Settings dropdown, then the timestamp,
    // separated by 2em gaps (see .hist-body spacing).
    if (tagsRow.childElementCount) body.appendChild(tagsRow);
    body.appendChild(actions);
    body.appendChild(buildHistDetails(entry, input, comfyEntry, isImg));
    body.appendChild(meta);
    card.appendChild(body);
    historyEl.appendChild(card);
  }
}

// Populate the form from a saved history entry (local files re-host at generate).
async function applyEntry(entry) {
  disarmContinuation(); // Re-import/Re-run start clean; Continue re-arms after this
  const input = entry.input || {};

  // ComfyUI entries: reselect the workflow and prefill its controls (images can't
  // be restored from a saved ref, so they're left empty).
  if ((input.model || "").startsWith("comfy:")) {
    if (![...modelSelect.options].some((o) => o.value === input.model)) {
      setError(
        `Workflow "${input.workflow || input.model.slice("comfy:".length)}" isn't loaded — ` +
          `put its .json back in the workflows folder and reload.`
      );
      return;
    }
    modelSelect.value = input.model;
    applyModelUI(); // kicks off the async control render (ComfyUI options + settings)
    await comfyRenderPromise; // wait for the controls to exist before filling them
    prefillComfyControls(input.values || {});
    if (comfyLoraControl && Array.isArray(input.loras)) comfyLoraControl.setLoras(input.loras);
    if (comfyBypassControl && Array.isArray(input.bypass)) comfyBypassControl.setDisabled(input.bypass);
    await restoreComfyMedia(entry); // re-populate the image/video/audio fields
    // "Generate preview" is a persisted global preference — re-import leaves it as-is.
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  modelSelect.value = input.model || "bytedance/seedance-2";
  // Restore the 2.5 image-source mode (frames if the entry saved either keyframe).
  const savedMode = input.first_frame_url || input.last_frame_url ? "frames" : "refs";
  const modeRadio = document.querySelector(`input[name="imageSource"][value="${savedMode}"]`);
  if (modeRadio) modeRadio.checked = true;
  applyModelUI(); // shape the form (and aspect options) before filling values
  document.getElementById("prompt").value = input.prompt || "";
  document.getElementById("resolution").value = input.resolution || "720p";
  if (input.aspect_ratio) aspectSelect.value = input.aspect_ratio;
  qualitySelect.value = input.quality || "basic";
  // applyModelUI already set the format options + default for this model; only
  // override when the saved entry recorded one.
  if (input.output_format) outputFormatSelect.value = input.output_format;
  updatePromptCount();
  if (input.duration) document.getElementById("duration").value = input.duration;
  document.getElementById("generate_audio").checked = input.generate_audio !== false;
  document.getElementById("web_search").checked = !!input.web_search;
  document.getElementById("nsfw_checker").checked = !!input.nsfw_checker;
  document.getElementById("return_last_frame").checked = !!input.return_last_frame;
  // "Generate preview" is a persisted global preference — re-import leaves it as-is.

  const saved = await fetch("/api/images").then((r) => r.json()).then((d) => d.data || []);
  const localIds = entry.mediaLocalIds || { image: entry.imageLocalIds || [] };
  const urlsByKind = {
    image: input.reference_image_urls || input.image_urls || [],
    video: input.reference_video_urls || [],
    audio: input.reference_audio_urls || [],
    firstFrame: input.first_frame_url ? [input.first_frame_url] : [],
    lastFrame: input.last_frame_url ? [input.last_frame_url] : [],
  };

  for (const kind of ["image", "video", "audio", "firstFrame", "lastFrame"]) {
    lists[kind].items = [];
    const ids = localIds[kind] || [];
    if (ids.length) {
      // Prefer locally-saved files (their old hosted URLs may have expired).
      for (const id of ids) {
        const item = saved.find((i) => i.id === id);
        if (item) lists[kind].addFromGallery(item);
        // if the saved file was deleted, silently skip it
      }
    } else {
      for (const url of urlsByKind[kind]) lists[kind].addUrl(url);
    }
    lists[kind].render();
  }

  updateEstimate();
}

// Attach a live status + poller to one pending server-history entry, unless this tab
// is already tracking it. Returns true if it newly attached. Shared by the load-time
// resume and the periodic sync so a run started on another device gets picked up the
// same way. Entries with no taskId (never got one persisted) can't be polled and are
// skipped — their card just shows the pending placeholder.
function trackPendingEntry(entry) {
  if (entry.status !== "pending" || !entry.taskId) return false;
  if (liveStatus.has(entry.id)) return false; // already live in this tab
  const isComfyJob = (entry.input?.model || "").startsWith("comfy:");
  const job = {
    jobId: nextJobId++,
    taskId: entry.taskId,
    historyId: entry.id,
    input: entry.input,
    // older saved state used imageLocalIds (a plain array)
    mediaLocalIds: entry.mediaLocalIds || { image: entry.imageLocalIds || [] },
    balanceBefore: entry.balanceBefore,
    projectId: entry.projectId || activeProjectId,
    refSecs: entry.refVideoSeconds || 0,
    startedAt: entry.startedAt || new Date(entry.createdAt).getTime(),
  };
  const live = createLiveStatus(job);
  live.setStatus("Resuming previous generation…");
  liveStatus.set(job.historyId, live);
  if (isComfyJob) {
    wireComfyCancel(job);
    ensurePreviewStream();
    pollComfyJob(job);
  } else pollJob(job);
  return true;
}

// Re-attach live pollers to every run still pending in server history (the durable
// source of truth) — after a tab reload, or when opening the app on another device
// mid-run. The server-side sweeps finish these regardless; this just keeps the cards
// live while the tab is open. Runs once, right after the first history load.
let resumedOnce = false;
function resumeFromHistory() {
  if (resumedOnce) return;
  resumedOnce = true;
  let attached = false;
  for (const entry of historyEntries) attached = trackPendingEntry(entry) || attached;
  if (attached) renderHistory(historyEntries); // drop the freshly-attached live status into the cards
  lastPendingKey = pendingKey(historyEntries.filter((e) => e.status === "pending"));
  scheduleSyncPending();
}

// --- periodic pending-run sync --------------------------------------------------
// An open tab attaches its live pollers only at load. This lightweight poll closes
// the two gaps: a run started on ANOTHER device after this tab loaded (attach a
// poller to it), and a run the server-side sweep finished while this tab wasn't
// tracking it (re-render so its card flips to the result). Cheap: it fetches only the
// pending entries, and only refetches the full history when that set changes.
const SYNC_PENDING_ACTIVE_MS = 5000; // something pending — check often
const SYNC_PENDING_IDLE_MS = 20000; // nothing pending — just watch for runs from elsewhere
let syncPendingTimer = null;
let lastPendingKey = "";
const pendingKey = (list) => list.map((e) => e.id).sort().join(",");

function scheduleSyncPending(delay) {
  clearTimeout(syncPendingTimer);
  syncPendingTimer = setTimeout(syncPending, delay ?? SYNC_PENDING_IDLE_MS);
}

async function syncPending() {
  let pending = [];
  try {
    const res = await fetch("/api/history/pending");
    const data = await res.json();
    if (!res.ok || data.code !== 200) throw new Error(data.msg || "sync failed");
    pending = data.data || [];
  } catch {
    scheduleSyncPending(); // transient — retry next tick
    return;
  }
  let attached = false;
  for (const entry of pending) attached = trackPendingEntry(entry) || attached;
  if (attached) renderHistory(historyEntries);
  // The pending set changed (a run finished, or a new one appeared) — pull the full
  // history once so freshly-finished cards render with their output.
  const key = pendingKey(pending);
  if (key !== lastPendingKey) {
    lastPendingKey = key;
    loadHistory(); // renderHistory re-parents live-status elements, so active cards stay live
  }
  scheduleSyncPending(pending.length ? SYNC_PENDING_ACTIVE_MS : SYNC_PENDING_IDLE_MS);
}

// --- server-down banner ----------------------------------------------------------
// Infrequent ping so a dead server (closed terminal, crash) is surfaced instead of
// drops/generates silently failing. Also re-checks when the tab regains focus.
const offlineEl = document.getElementById("offline");
const PING_INTERVAL_MS = 30000;

async function checkServer() {
  try {
    const r = await fetch("/api/ping", { cache: "no-store" });
    offlineEl.classList.toggle("hidden", r.ok);
  } catch {
    offlineEl.classList.remove("hidden");
  }
}
setInterval(checkServer, PING_INTERVAL_MS);
window.addEventListener("focus", checkServer);

// --- host stats readout (CPU / RAM / GPU / VRAM) --------------------------------
// Shown whenever a ComfyUI workflow is selected or a local run is in flight:
// polls every 2s during an active run, every 5s while idle. Hidden (and not polled)
// otherwise, so we don't shell out to nvidia-smi when ComfyUI isn't in play.
const comfyStatsEl = document.getElementById("comfyStats");
const COMFY_STATS_ACTIVE_MS = 2000;
const COMFY_STATS_IDLE_MS = 5000;
let comfyStatsTimer = null;

function renderComfyStats(d) {
  if (!d) return;
  const pct = (v) => (v == null ? "–" : `${v}%`);
  const gb = (mib) => (mib / 1024).toFixed(1);
  const parts = [`CPU ${pct(d.cpu)}`];
  if (d.ram) {
    parts.push(`RAM ${d.ram.pct}% (${gb(d.ram.used)}/${gb(d.ram.total)} GB)`);
  } else {
    parts.push("RAM –");
  }
  parts.push(`GPU ${pct(d.gpu)}`);
  if (d.vram) {
    parts.push(`VRAM ${d.vram.pct}% (${gb(d.vram.used)}/${gb(d.vram.total)} GB)`);
  } else {
    parts.push("VRAM –");
  }
  comfyStatsEl.textContent = `⚙ ${parts.join("   ·   ")}`;
}

function scheduleComfyStats(delay) {
  clearTimeout(comfyStatsTimer);
  comfyStatsTimer = setTimeout(comfyStatsTick, delay);
}

async function comfyStatsTick() {
  const running = [...liveStatus.values()].some((l) => l.isComfy && l.running);
  if (!running) closePreviewStream(); // no run in flight — don't hold an idle stream open
  if (running || isComfy()) {
    try {
      const r = await fetch("/api/comfy/stats");
      const d = (await r.json())?.data;
      renderComfyStats(d);
      comfyStatsEl.classList.remove("hidden");
    } catch {
      /* transient — keep the last reading */
    }
  } else {
    comfyStatsEl.classList.add("hidden");
  }
  scheduleComfyStats(running ? COMFY_STATS_ACTIVE_MS : COMFY_STATS_IDLE_MS);
}
comfyStatsTick();

// --- initial load ---------------------------------------------------------------
applyModelUI(); // sync title, button, and model-dependent fields to the default
loadProjects();
loadCredits();
loadGallery();
loadHistory().then(resumeFromHistory); // re-attach live status to any run still pending server-side
loadWorkflows(); // add any local ComfyUI workflows to the model dropdown
