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
const projectCreditsBreakdown = document.getElementById(
  "projectCreditsBreakdown",
);

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
  lightboxNext.classList.toggle(
    "hidden",
    !active || lightboxNav.index >= lightboxNav.items.length - 1,
  );
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
  div.appendChild(
    makeThumbContent(kind, { thumb: item.localUrl, name: item.name }),
  );

  if (kind !== "image") {
    const badge = document.createElement("span");
    badge.className = "img-label kind-badge";
    badge.textContent = kind;
    div.appendChild(badge);
  }

  if (onPick) div.addEventListener("click", () => onPick(item));

  // After a move/delete: reload the shared gallery data, then re-render this
  // caller's own view (the main gallery re-renders via loadGallery itself).
  const afterChange = async () => {
    await loadGallery();
    refresh?.();
  };

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
      if (p.id !== (item.projectId || "default"))
        sel.appendChild(new Option(p.name, p.id));
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
  let dropzone,
    thumbs,
    fileInput,
    clearBtn,
    galleryWrap,
    galleryThumbs,
    galleryEmptyEl,
    fieldEl,
    tailsEl;
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
        if (zoomSrc)
          div.appendChild(makeZoomButton(mediaType, zoomSrc, item.name));

        // drag-to-reorder within this list
        div.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData(reorderType, String(item.uid));
          e.dataTransfer.effectAllowed = "move";
          div.classList.add("dragging");
        });
        div.addEventListener("dragend", () => {
          div.classList.remove("dragging");
          thumbs
            .querySelectorAll(".drop-target")
            .forEach((t) => t.classList.remove("drop-target"));
        });
        div.addEventListener("dragover", (e) => {
          if (![...e.dataTransfer.types].includes(reorderType)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          div.classList.add("drop-target");
        });
        div.addEventListener("dragleave", () =>
          div.classList.remove("drop-target"),
        );
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
            onInput: (v) => {
              item.tailSec = v;
            },
          }),
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
      const entry = {
        uid: nextUid++,
        localId: null,
        remoteUrl: url,
        thumb: url,
        name: url,
        status: "ready",
      };
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
            body: JSON.stringify({
              base64Data: reader.result,
              fileName: file.name,
              projectId: activeProjectId,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.image?.id)
            throw new Error(data.msg || "Save failed");
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
      if (Number.isFinite(max))
        files = files.slice(0, Math.max(0, max - list.items.length));
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
        if (!item.localId)
          throw new Error(`${item.name || kind}: missing source`);
        const res = await fetch("/api/reupload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.localId }),
        });
        const data = await res.json();
        if (!res.ok || !data.hostedUrl)
          throw new Error(`${item.name || kind}: upload failed`);
        urls.push(data.hostedUrl);
      }
      return urls;
    },

    localIds() {
      return list.items
        .filter((i) => i.status === "ready" && i.localId)
        .map((i) => i.localId);
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
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === "dragleave" && dropzone.contains(e.relatedTarget)) return;
      dropzone.classList.remove("dragover");
    }),
  );
  dropzone.addEventListener("drop", (e) => {
    if ([...e.dataTransfer.types].includes(reorderType)) return;
    if (e.dataTransfer.files?.length) {
      list.addFiles(e.dataTransfer.files);
      return;
    }
    if (opts.localOnly) return; // ComfyUI needs a real file, not a hosted URL
    const url =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain");
    if (url && /^https?:\/\//i.test(url.trim())) list.addUrl(url.trim());
  });

  clearBtn.addEventListener("click", () => list.clear());

  // Per-field gallery picker (built lists only): reuse this project's saved media.
  if (galleryWrap) {
    const renderPicker = () => {
      galleryThumbs.innerHTML = "";
      const gitems = galleryItems.filter(
        (i) =>
          (i.kind || "image") === mediaType &&
          (i.projectId || "default") === activeProjectId,
      );
      galleryEmptyEl.classList.toggle("hidden", gitems.length > 0);
      for (const item of gitems) {
        galleryThumbs.appendChild(
          makeGalleryThumb(item, {
            onPick: (it) => list.addFromGallery(it),
            refresh: renderPicker,
          }),
        );
      }
    };
    galleryWrap.addEventListener("toggle", () => {
      if (galleryWrap.open) renderPicker();
    });
  }

  return list;
}

// Read a media file's duration (seconds) from its metadata; null if unreadable.
function probeDuration(src) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () =>
      resolve(Number.isFinite(v.duration) ? v.duration : null);
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
    return (a.name || "").localeCompare(b.name || "", undefined, {
      sensitivity: "base",
    });
  });
  if (!projects.some((p) => p.id === activeProjectId))
    activeProjectId = "default";
  renderProjectControls();
  loadSavedPrompts(); // project names in the cards (and a vanished active project) changed
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
  historyFilter.value =
    [...historyFilter.options].some((o) => o.value === prev) ? prev : (
      activeProjectId
    );

  renderGallery(galleryItems);
  renderHistory(historyEntries);
}

function setActiveProject(id) {
  activeProjectId = id;
  localStorage.setItem(PROJECT_KEY, id);
  projectSelect.value = id;
  historyFilter.value = id;
  loadSavedPrompts();
  renderGallery(galleryItems);
  historyPage = 1; // changing the filtered set starts back at the first page
  renderHistory(historyEntries);
}

projectSelect.addEventListener("change", () =>
  setActiveProject(projectSelect.value),
);
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
  .then((d) => {
    autoDraftMaxEl.value = Number(d.data?.autoDraftMaxMP) || 0;
  })
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
    if (!res.ok)
      throw new Error((await res.json()).msg || "Failed to open folder");
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
    alert(
      'Pick a specific project in the History filter to export (the "All projects" view can\'t be exported).',
    );
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
document
  .getElementById("exportCancel")
  .addEventListener("click", () => hide(exportModal));
exportModal.addEventListener("click", (e) => {
  if (e.target === exportModal) hide(exportModal);
});
document.getElementById("exportConfirm").addEventListener("click", async () => {
  const projectId = historyFilter.value;
  const excludeTags = [
    ...exportExcludeTags.querySelectorAll("input:checked"),
  ].map((c) => c.value);
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
        `It opened in your file browser. Open index.html to view it, or zip the folder to share.`,
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
    if (!res.ok || !data.data?.id)
      throw new Error(data.msg || "Failed to create project");
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
  if (
    !confirm(
      `Delete project "${name}"?\n\nIts gallery media and history will move to Default.`,
    )
  )
    return;
  try {
    const res = await fetch(`/api/projects/${activeProjectId}`, {
      method: "DELETE",
    });
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
// Save files to a project's gallery (what a dropped reference does behind the scenes).
// Returns the created gallery entries; anything that fails is reported and skipped.
async function uploadToGallery(files, projectId = activeProjectId) {
  const saved = [];
  for (const file of [...files].filter((f) =>
    /^(image|video|audio)\//.test(f.type),
  )) {
    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Data, fileName: file.name, projectId }),
      });
      const data = await res.json();
      if (!res.ok || !data.image?.id)
        throw new Error(data.msg || "Save failed");
      saved.push(data.image);
    } catch (err) {
      alert(`Couldn't save ${file.name}: ${err.message || err}`);
    }
  }
  await loadGallery();
  return saved;
}

// The Gallery panel's own drop zone: add media without going through a reference field.
const galleryDrop = document.getElementById("dz-gallery");
const galleryFileInput = document.getElementById("file-gallery");
const galleryDropHint = galleryDrop.querySelector(".dz-hint");
const GALLERY_DROP_HINT = galleryDropHint.innerHTML;

async function addFilesToGallery(files) {
  const list = [...files].filter((f) => /^(image|video|audio)\//.test(f.type));
  if (!list.length) return;
  galleryDropHint.textContent = `Saving ${plural(list.length, "file")}…`;
  const saved = await uploadToGallery(list);
  galleryDropHint.textContent =
    saved.length ?
      `Added ${plural(saved.length, "file")} to ${projectName(activeProjectId)}.`
    : "";
  setTimeout(() => {
    galleryDropHint.innerHTML = GALLERY_DROP_HINT;
  }, 2000);
}

galleryDrop.addEventListener("click", () => galleryFileInput.click());
galleryFileInput.addEventListener("change", () => {
  addFilesToGallery(galleryFileInput.files);
  galleryFileInput.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  galleryDrop.addEventListener(evt, (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    galleryDrop.classList.add("dragover");
  }),
);
["dragleave", "drop"].forEach((evt) =>
  galleryDrop.addEventListener(evt, (e) => {
    if (evt === "dragleave" && galleryDrop.contains(e.relatedTarget)) return;
    galleryDrop.classList.remove("dragover");
  }),
);
galleryDrop.addEventListener("drop", (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  addFilesToGallery(e.dataTransfer.files);
});

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
  const visible = items.filter(
    (i) => (i.projectId || "default") === activeProjectId,
  );
  galleryCount.textContent = visible.length ? `(${visible.length})` : "";
  galleryEmpty.classList.toggle("hidden", visible.length > 0);

  for (const item of visible) {
    galleryEl.appendChild(
      makeGalleryThumb(item, {
        onPick: (it) => lists[it.kind || "image"].addFromGallery(it),
      }),
    );
  }
}

// --- credits + estimate ------------------------------------------------------
async function loadCredits() {
  try {
    const res = await fetch("/api/credits");
    const data = await res.json();
    // No kie.ai key configured: there's no balance to show, so hide the pill. A real
    // key that fails to load still shows "—", so a broken key stays noticeable.
    kieConfigured = data.configured !== false;
    document
      .getElementById("credits")
      .classList.toggle("hidden", !kieConfigured);
    syncKieAvailability();
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

// Without a kie.ai key GENie is a ComfyUI-only front-end: the kie.ai models stay listed
// (so it's clear they exist) but disabled, the per-project credit spend is hidden, and
// a kie.ai model left selected by default gives way to the first ComfyUI workflow.
// Runs once the key status is known and again whenever the workflow list loads.
let kieConfigured = null; // null until /api/credits answers
function syncKieAvailability() {
  if (kieConfigured !== false) return;
  const group = modelSelect.querySelector("optgroup[data-kie]");
  if (group) {
    group.label = "kie.ai API — add KIE_API_KEY to .env to enable";
    for (const o of group.querySelectorAll("option")) o.disabled = true;
  }
  document.getElementById("projectCredits").classList.add("hidden");
  const current = modelSelect.options[modelSelect.selectedIndex];
  if (!current || current.disabled) {
    const firstComfy = [...modelSelect.options].find(
      (o) => o.value.startsWith("comfy:") && !o.disabled,
    );
    if (firstComfy) {
      modelSelect.value = firstComfy.value;
      applyModelUI();
      scheduleComfyStats(0);
    }
  }
}

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
        extra(e),
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
      // H3 has no generate_audio param, so every run of it is an audio run.
      (audioOn === null || (e.input?.generate_audio !== false) === audioOn) &&
      e.input?.duration > 0,
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
    const costs = recentMatches(
      model,
      (e) => (e.input?.quality || "basic") === quality,
    )
      .slice(0, RECENT_RATE_SAMPLES)
      .map((e) => e.costCredits);
    if (!costs.length) {
      estimateEl.textContent = `No estimate yet for ${seedreamLabel(model)} (${quality}) — will measure after a run.`;
      estimateEl.title = "";
      return;
    }
    const est = Math.round(median(costs));
    estimateEl.innerHTML = `Est. cost: ~<b>${est.toLocaleString()}</b> credits${batchCostNote(est)}`;
    estimateEl.title = `Median of your ${costs.length} most recent ${seedreamLabel(model)} run${costs.length > 1 ? "s" : ""} at this quality.`;
    return;
  }

  const resolution = document.getElementById("resolution").value;
  const duration = Number(document.getElementById("duration").value) || 0;
  const audioOn =
    isH3() ? null : document.getElementById("generate_audio").checked;
  const r = ratePerSec(model, resolution, audioOn);
  if (!r || !duration) {
    const label = `${videoModelLabel(model)} at ${resolution}`;
    estimateEl.textContent = `No estimate yet for ${label} — will measure after a run.`;
    estimateEl.title = "";
    return;
  }
  const refSecs = usesRefMedia() ? refVideoSeconds() : 0;
  const est = Math.round(r.rate * (duration + refSecs));
  const refNote =
    refSecs > 0 ? ` (incl. ~${Math.round(refSecs)}s video ref)` : "";
  const overLimit =
    refSecs > 15 ? ` ⚠ video refs exceed the 15s total limit` : "";
  estimateEl.innerHTML = `Est. cost: ~<b>${est.toLocaleString()}</b> credits${refNote}${batchCostNote(est)}${overLimit}`;
  estimateEl.title = `Based on your ${r.n} most recent run${r.n > 1 ? "s" : ""} at this resolution/audio setting (median).`;
}

// " × 4 = ~56" when the ×N counter queues a batch; nothing for a single run.
function batchCostNote(each) {
  const n = queueCount();
  return n > 1 ? ` × ${n} = ~<b>${(each * n).toLocaleString()}</b>` : "";
}

["resolution", "duration"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateEstimate),
);
document
  .getElementById("generate_audio")
  .addEventListener("change", updateEstimate);
document.getElementById("queueCount").addEventListener("input", updateEstimate);

// Per-model form shaping: Seedance 2 Fast and Mini cap resolution at 720p;
// Seedream 5.0 Lite is image-to-image (no duration/resolution/audio/video, has
// quality, different aspect ratios).
const modelSelect = document.getElementById("model");
const resolutionSelect = document.getElementById("resolution");
const qualitySelect = document.getElementById("quality");
const aspectSelect = document.getElementById("aspect_ratio");

const VIDEO_ASPECTS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
// Seedance 2.5 and 2.0 Mini add an "adaptive" ratio (2.0 and Fast don't).
const VIDEO_ASPECTS_ADAPTIVE = [
  "adaptive",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "21:9",
];
const IMAGE_ASPECTS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "2:3",
  "3:2",
  "21:9",
];

// Output-format options by output medium: [value, label].
const IMAGE_FORMATS = [
  ["png", "PNG"],
  ["jpeg", "JPEG"],
];
const VIDEO_FORMATS = [
  ["mp4", "mp4"],
  ["mov", "mov"],
];

// Resolution options by model family: [value, label]. Seedance uses the familiar
// ladder; MiniMax H3 has its own two-tier naming and rejects anything else.
const SEEDANCE_RESOLUTIONS = [
  ["480p", "480p"],
  ["720p", "720p"],
  ["1080p", "1080p"],
  ["4k", "4K"],
];
const H3_RESOLUTIONS = [
  ["768P", "768p"],
  ["2K", "2K"],
];

const isSeedream = () => modelSelect.value.startsWith("seedream/");
const is25 = () => modelSelect.value === "bytedance/seedance-2-5";
// MiniMax H3 (Hailuo 03) — kie.ai splits it into one model id per generation mode,
// so the mode is the model choice rather than a toggle inside one model.
const isH3 = () => modelSelect.value.startsWith("minimax-h3/");
const isH3T2V = () => modelSelect.value === "minimax-h3/text-to-video";
const isH3I2V = () => modelSelect.value === "minimax-h3/image-to-video";
const isH3Ref = () => modelSelect.value === "minimax-h3/reference-to-video";
// Local ComfyUI workflows are selected as `comfy:<file.json>`.
const isComfy = () => modelSelect.value.startsWith("comfy:");
const comfyFile = () => modelSelect.value.slice("comfy:".length);
// Every Seedance video model (2.5 / 2 / Fast / Mini) exposes first/last-frame
// inputs; 2.5-only extras (mp4/mov, adaptive, 30s, return_last_frame) stay on is25.
const isSeedanceVideo = () =>
  modelSelect.value.startsWith("bytedance/seedance-");

// Seedance makes reference images and first/last frames mutually exclusive (the
// API rejects mixing them), so a toggle picks which set is active. Only the active
// set is shown and sent. `frameMode()` is the raw toggle; `usesFrames()` is true
// only when a Seedance video model is active AND the toggle is on frames.
function frameMode() {
  return (
    document.querySelector('input[name="imageSource"]:checked')?.value || "refs"
  );
}
// H3 image-to-video has no reference-image alternative — it is always the frame form.
const usesFrames = () =>
  isH3I2V() || (isSeedanceVideo() && frameMode() === "frames");
// Which reference fields the active model+mode actually sends. Image models take
// neither; H3 takes video/audio only in reference-to-video, and takes reference
// images in that mode alone too.
const usesRefMedia = () => !isSeedream() && (!isH3() || isH3Ref());
const usesRefImages = () => !isT2I() && !isH3T2V() && !usesFrames();
const isI2I = () =>
  isSeedream() && modelSelect.value.endsWith("-image-to-image");
const isT2I = () =>
  isSeedream() && modelSelect.value.endsWith("-text-to-image");
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
// H3 reference-to-video offers it too (and defaults to it); H3 text-to-video does not.
const ADAPTIVE_ASPECT_MODELS = new Set([
  "bytedance/seedance-2-5",
  "bytedance/seedance-2-mini",
  "minimax-h3/reference-to-video",
]);
const hasAdaptiveAspect = () => ADAPTIVE_ASPECT_MODELS.has(modelSelect.value);
// Index into RESOLUTION_ORDER of the current model's ceiling (default: 4k).
const maxResolutionIndex = () =>
  RESOLUTION_ORDER.indexOf(MAX_RESOLUTION[modelSelect.value] || "4k");

// Short suffix distinguishing the non-standard video variants in labels.
const VIDEO_VARIANT_LABEL = {
  "bytedance/seedance-2-5": "2.5",
  "bytedance/seedance-2-fast": "Fast",
  "bytedance/seedance-2-mini": "Mini",
  "minimax-h3/text-to-video": "H3 t2v",
  "minimax-h3/image-to-video": "H3 i2v",
  "minimax-h3/reference-to-video": "H3 ref2v",
};

// Full display name for a video model id.
function videoModelLabel(model) {
  if ((model || "").startsWith("minimax-h3/")) {
    return `MiniMax H3 (${model.slice("minimax-h3/".length)})`;
  }
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
  aspectSelect.value =
    values.includes(cur) ? cur
    : values.includes(preferred) ? preferred
    : values[0];
}

// Repopulate the resolution select for the active model family. Keeps the current
// choice when the new family still offers it, otherwise falls back to `def`.
function setResolutionOptions(values, def) {
  const cur = resolutionSelect.value;
  resolutionSelect.innerHTML = "";
  for (const [v, label] of values)
    resolutionSelect.appendChild(new Option(label, v));
  resolutionSelect.value = values.some(([v]) => v === cur) ? cur : def;
}

// Repopulate the output-format select for the active output medium.
const outputFormatSelect = document.getElementById("output_format");
function setFormatOptions(values, def) {
  const cur = outputFormatSelect.value;
  outputFormatSelect.innerHTML = "";
  for (const [v, label] of values)
    outputFormatSelect.appendChild(new Option(label, v));
  outputFormatSelect.value = values.some(([v]) => v === cur) ? cur : def;
}

// kie.ai form fields hidden entirely when a local ComfyUI workflow is selected.
const KIE_FIELDS = [
  "promptField",
  "imageSourceField",
  "imageField",
  "firstFrameField",
  "lastFrameField",
  "videoField",
  "audioField",
  "optionsRow",
  "checksRow",
];

function applyModelUI() {
  const comfy = isComfy();
  const cc = document.getElementById("comfyControls");
  cc.classList.toggle("hidden", !comfy);
  cc.classList.toggle("comfy-grid", comfy);
  document
    .getElementById("previewMethodField")
    .classList.toggle("hidden", !comfy);
  if (comfy) {
    // Swap the whole kie.ai form for the recognized workflow controls.
    for (const id of KIE_FIELDS)
      document.getElementById(id).classList.add("hidden");
    estimateEl.classList.add("hidden");
    comfyRenderPromise = renderComfyControls(); // async (fetches ComfyUI options); awaited on re-import
    comfyRenderPromise.then(syncPromptTabs, () => {}); // saved-prompts panel → the workflow's prompt
    syncPromptTabs(); // meanwhile, off the (now hidden) kie.ai prompt
    updateModelChrome();
    return;
  }
  for (const id of KIE_FIELDS)
    document.getElementById(id).classList.remove("hidden");
  estimateEl.classList.remove("hidden");

  const seedream = isSeedream();
  const maxResIdx = maxResolutionIndex();
  const frames = is25();
  const h3 = isH3();
  // Reference video/audio belong to Seedance and to H3's reference-to-video only.
  for (const id of ["videoField", "audioField"]) {
    document.getElementById(id).classList.toggle("hidden", !usesRefMedia());
  }
  for (const id of ["resolutionField", "durationField"]) {
    document.getElementById(id).classList.toggle("hidden", seedream);
  }
  // H3 generates audio natively and documents neither web_search nor nsfw_checker.
  for (const id of ["genAudioField", "webSearchField"]) {
    document.getElementById(id).classList.toggle("hidden", seedream || h3);
  }
  document.getElementById("nsfwField").classList.toggle("hidden", h3);
  // H3 image-to-video takes no aspect_ratio — the frames decide it.
  document.getElementById("aspectField").classList.toggle("hidden", isH3I2V());
  // Seedance video models make reference images and first/last frames mutually
  // exclusive, so a toggle chooses which set is shown. `refsHidden` hides
  // reference images (text-to-image, or any Seedance model in frames mode); the
  // frame dropzones show only in that mode. "return last frame" is a 2.5-only
  // output option. H3 needs no toggle: its mode is the model id.
  const seedanceVideo = isSeedanceVideo();
  const framesMode = usesFrames();
  const refsHidden = !usesRefImages();
  document
    .getElementById("imageSourceField")
    .classList.toggle("hidden", !seedanceVideo);
  document.getElementById("imageField").classList.toggle("hidden", refsHidden);
  document.getElementById("qualityField").classList.toggle("hidden", !seedream);
  for (const id of ["firstFrameField", "lastFrameField"]) {
    document.getElementById(id).classList.toggle("hidden", !framesMode);
  }
  document
    .getElementById("returnLastFrameField")
    .classList.toggle("hidden", !frames);
  // Output format applies to Seedream Pro (png/jpeg) and Seedance 2.5 (mp4/mov).
  const showFormat = isSeedreamPro() || frames;
  document
    .getElementById("formatField")
    .classList.toggle("hidden", !showFormat);
  if (frames) setFormatOptions(VIDEO_FORMATS, "mp4");
  else if (isSeedreamPro()) setFormatOptions(IMAGE_FORMATS, "png");
  if (seedream) setQualityLabels();
  setAspectOptions(
    seedream ? IMAGE_ASPECTS
    : hasAdaptiveAspect() ? VIDEO_ASPECTS_ADAPTIVE
    : VIDEO_ASPECTS,
    // 2.5 and H3 reference-to-video are the ones that document adaptive as default
    frames || isH3Ref() ? "adaptive" : "16:9",
  );
  if (h3) {
    setResolutionOptions(H3_RESOLUTIONS, "2K");
  } else {
    setResolutionOptions(SEEDANCE_RESOLUTIONS, "720p");
    // Disable any resolution above this model's ceiling; if the current selection
    // is now disabled, drop to the highest allowed option.
    for (const opt of resolutionSelect.options) {
      opt.disabled = RESOLUTION_ORDER.indexOf(opt.value) > maxResIdx;
    }
    if (RESOLUTION_ORDER.indexOf(resolutionSelect.value) > maxResIdx) {
      resolutionSelect.value = RESOLUTION_ORDER[maxResIdx];
    }
  }
  // Seedance 2.5 allows up to 30s; the other video models cap at 15s.
  const durInput = document.getElementById("duration");
  durInput.max = frames ? 30 : 15;
  if (Number(durInput.value) > Number(durInput.max))
    durInput.value = durInput.max;
  updatePromptCount(); // the cap depends on the selected model
  updateEstimate();
  updateModelChrome();
  syncPromptTabs(); // saved-prompts panel → the kie.ai prompt
}

// Retitle the page and the Generate button for the selected model.
function updateModelChrome() {
  const label = modelSelect.options[modelSelect.selectedIndex].textContent
    .replace(/\s*\(.*\)$/, "")
    .trim();
  if (isComfy()) {
    setBreakableText(document.getElementById("pageTitle"), label);
    document.getElementById("pageSub").textContent =
      `Run ${label} on your local ComfyUI`;
    document.title = `GENie — ${label}`;
    submitBtn.textContent = "Generate";
    return;
  }
  const image = isSeedream();
  const medium = image ? "image" : "video";
  document.getElementById("pageTitle").textContent = label;
  document.getElementById("pageSub").textContent =
    `Generate ${medium} with the ${label} model`;
  document.title = `GENie — ${label}`;
  submitBtn.textContent = image ? "Generate Image" : "Generate Video";
}

// Set `el`'s text with a line-break opportunity after each _ - / . so a workflow name
// like "MiniMax_H3_Ref2Video_Custom" wraps between its parts on a narrow screen
// rather than mid-word.
function setBreakableText(el, text) {
  el.textContent = "";
  for (const part of String(text).split(/(?<=[_\-/.])/)) {
    if (el.childNodes.length) el.appendChild(document.createElement("wbr"));
    el.appendChild(document.createTextNode(part));
  }
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
  continueBanner.textContent =
    armedContinuation.into ?
      `↻ Redoing ${armedContinuation.label} in place — a new seed was rolled. `
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
    if (typeof f.advance === "function" && typeof f.set === "function")
      f.set(randomSeed());
  }
  for (const f of comfyFields) {
    if (f.pin && f.name in (parentValues || {})) f.lock?.(true);
  }
  renderContinueBanner();
}

// --- carry prompt + references across model switches ------------------------------
// The kie.ai form and each ComfyUI workflow's controls are separate forms, so switching
// models (e.g. a low-res local MiniMax H3 draft → the H3 API for the final) would
// otherwise leave the prompt and references behind. While the prompt's lock is on
// (the default), a switch copies them into the newly shown form. Only these travel:
// resolution, duration, etc. mean different things per model/workflow.
const CARRY_KEY = "genie_carry_on_switch";
let carryOnSwitch = true;
try {
  carryOnSwitch = localStorage.getItem(CARRY_KEY) !== "0";
} catch {
  /* storage blocked — default on */
}
const CARRY_KINDS = ["image", "video", "audio"];
let carrySeq = 0; // the latest switch; an older one's late ComfyUI render doesn't apply

// A ComfyUI text token that is the positive prompt (tokenized workflows name it freely).
function isCarryPromptName(name) {
  return /prompt|positive/i.test(name) && !/negative/i.test(name);
}

function paintCarryLock(btn) {
  btn.textContent = carryOnSwitch ? "🔒" : "🔓";
  btn.classList.toggle("on", carryOnSwitch);
  btn.setAttribute("aria-pressed", String(carryOnSwitch));
  btn.title =
    carryOnSwitch ?
      "Locked: the prompt and reference media come with you when you switch models. Click to unlock."
    : "Unlocked: switching models leaves the prompt and reference media behind. Click to lock.";
}

function makeCarryLock(btn = document.createElement("button")) {
  btn.type = "button";
  btn.classList.add("link-btn", "carry-lock");
  paintCarryLock(btn);
  btn.addEventListener("click", () => {
    carryOnSwitch = !carryOnSwitch;
    try {
      localStorage.setItem(CARRY_KEY, carryOnSwitch ? "1" : "0");
    } catch {
      /* storage blocked — non-fatal */
    }
    document.querySelectorAll(".carry-lock").forEach(paintCarryLock);
  });
  return btn;
}
makeCarryLock(document.getElementById("carryLock"));

// Read the prompt + references from the form currently on screen. Called before the
// switch re-shapes anything, so the DOM still reflects the model being left (which is
// why this goes by what's shown rather than by modelSelect, already the new value).
// `media[kind]` is present only when the form had files of that kind, so an empty (or
// missing) field never wipes the destination's — the same rule as an empty prompt.
function snapshotCarry() {
  const media = {};
  if (!comfyControlsEl.classList.contains("hidden")) {
    for (const f of comfyFields) {
      if (
        !CARRY_KINDS.includes(f.mediaKind) ||
        typeof f.peekMedia !== "function"
      )
        continue;
      const files = f.peekMedia();
      if (files.length) (media[f.mediaKind] ||= []).push(...files);
    }
    const p = comfyFields.find((f) => f.isPrompt);
    return { prompt: p ? String(p.peek() ?? "") : null, media, urlOnly: 0 };
  }
  // A list this model hides (e.g. reference images in Seedance frames mode) isn't in use.
  const fieldFor = {
    image: "imageField",
    video: "videoField",
    audio: "audioField",
  };
  let urlOnly = 0; // hosted-URL references with no saved file (a local run can't use them)
  for (const kind of CARRY_KINDS) {
    if (document.getElementById(fieldFor[kind]).classList.contains("hidden"))
      continue;
    const ready = lists[kind].items.filter((i) => i.status === "ready");
    urlOnly += ready.filter((i) => !i.localId).length;
    const files = ready
      .filter((i) => i.localId)
      .map((i) => ({
        id: i.localId,
        url: i.thumb,
        name: i.name,
        tail: i.tailSec || 0,
      }));
    if (files.length) media[kind] = files;
  }
  return { prompt: promptEl.value, media, urlOnly };
}

// Write a snapshot into the form now on screen (after any saved workflow settings, so
// what you carried wins). An empty prompt never overwrites one that's there.
function applyCarry(snap) {
  const prompt = snap.prompt?.trim() ? snap.prompt : null;
  if (isComfy()) {
    const p = comfyFields.find((f) => f.isPrompt);
    if (p && prompt != null) p.set(prompt);
    for (const kind of CARRY_KINDS) {
      if (!snap.media[kind]) continue;
      // Spread across this workflow's fields of the kind, in order (like a re-import).
      let queue = snap.media[kind];
      for (const f of comfyFields) {
        if (f.mediaKind !== kind || typeof f.setMedia !== "function") continue;
        f.setMedia(queue.slice(0, f.capacity || 1));
        queue = queue.slice(f.capacity || 1);
      }
    }
    refreshComfyRefTags();
    if (snap.urlOnly) {
      setError(
        `${snap.urlOnly} URL reference${snap.urlOnly === 1 ? " wasn't" : "s weren't"} carried over — ` +
          `local workflows need a saved file.`,
      );
    }
    return;
  }
  if (prompt != null) {
    promptEl.value = prompt;
    updatePromptCount();
  }
  // Loaded even into a list this model hides (e.g. H3 text-to-video): the kie.ai form
  // keeps it for the next model that takes references, and hidden lists aren't sent.
  for (const kind of CARRY_KINDS) {
    if (!snap.media[kind]) continue;
    lists[kind].items = [];
    for (const m of snap.media[kind]) {
      lists[kind].addFromGallery({
        id: m.id,
        localUrl: m.url,
        name: m.name,
        tail: m.tail,
      });
    }
    lists[kind].render();
  }
  updateEstimate();
}

modelSelect.addEventListener("change", async () => {
  disarmContinuation(); // the controls it referred to are about to be rebuilt
  // kie.ai → kie.ai shares one form, so there's nothing to carry.
  const leavingComfy = !comfyControlsEl.classList.contains("hidden");
  const snap =
    carryOnSwitch && (leavingComfy || isComfy()) ? snapshotCarry() : null;
  const seq = ++carrySeq;
  applyModelUI();
  if (snap) {
    if (isComfy()) await comfyRenderPromise; // controls + saved settings first
    if (seq === carrySeq) applyCarry(snap);
  }
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
// recognized nodes become form controls (see node_types/); on Generate we upload
// any image inputs, post to the server, and reuse the job-card + history flow.
// See docs/COMFYUI.md.
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
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Load the workflow list and (re)build the "Local · ComfyUI" dropdown group.
async function loadWorkflows() {
  try {
    const res = await fetch("/api/workflows");
    comfyWorkflows = (await res.json()).data || [];
  } catch {
    comfyWorkflows = [];
  }
  modelSelect.querySelector("optgroup[data-comfy]")?.remove();
  if (comfyWorkflows.length) {
    const group = document.createElement("optgroup");
    group.label = "Local · ComfyUI";
    group.setAttribute("data-comfy", "");
    for (const w of comfyWorkflows) {
      const opt = new Option(
        w.error ? `${w.name} (invalid JSON)` : w.name,
        `comfy:${w.file}`,
      );
      opt.disabled = !!w.error;
      group.appendChild(opt);
    }
    modelSelect.prepend(group); // local workflows list first, above the kie.ai API group
  }
  restoreLastModel(); // now that comfy options exist, reselect the last-used model
  syncKieAvailability(); // no kie.ai key: fall back to a ComfyUI workflow if needed
  // History cards read `comfyWorkflows` to decide whether a run can be continued, and
  // this fetch races the history one at startup. Lose that race and every card renders
  // against an empty list, so the Continue / Re-roll buttons are missing until
  // something else happens to re-render — the chain tag still shows, which makes it
  // look like the run is chained but uncontinuable. Re-render once the list is in.
  if (historyEntries.length) renderHistory(historyEntries);
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
  const opt = [...modelSelect.options].find(
    (o) => o.value === last && !o.disabled,
  );
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
  // A BOOLEAN input (from /object_info), or one the node_types entry declares a toggle.
  if (token.bool || token.control === "toggle") return "toggle";
  if (/prompt/.test(n)) return "textarea";
  // Online, /object_info is authoritative. A combo is a dropdown of installed
  // choices (checkpoints, LoRAs, VAEs, samplers, schedulers) — UNLESS it's an
  // uploadable media input (LoadImage.image, VHS_LoadVideo.video), which carries
  // `uploadKind` and gets the upload dropzone instead.
  if (token.combo) return token.uploadKind || "select";
  if (token.num) return "number";
  // A recognized control's declared kind beats guessing from its name, which misfires
  // on names like "spectrum_audio_blend_weight" (not an audio upload).
  if (token.control === "number") return "number";
  if (token.control === "text") return token.multiline ? "textarea" : "text";
  if (token.control === "combo") return "text"; // choices unavailable (offline / node not installed)
  // Offline / non-combo fallback by name. A model-file selector input (vae_name,
  // ckpt_name, unet_name, lora_name, clip_name, …) is never a media upload even if
  // its token name contains "video"/"audio" (e.g. `video_vae`).
  const isModelField =
    /_name$/.test(key) ||
    /^(ckpt|unet|vae|lora|clip|model|control_net|style_model|gligen)/.test(key);
  if (!isModelField) {
    if (/audio/.test(n)) return "audio";
    if (/video/.test(n)) return "video";
    if (/(image|img|frame|photo|picture)/.test(n)) return "image";
  }
  if (
    /(seed|steps|cfg|width|height|length|duration|fps|frames|count|denoise|strength|scale|megapixel|batch)/.test(
      n,
    ) ||
    (token.default !== "" && !Number.isNaN(Number(token.default)))
  )
    return "number";
  return "text";
}

// Media control types share one factory (image/video/audio).
const MEDIA_TYPES = new Set(["image", "video", "audio"]);

// Token width hint → columns of a 12-col grid. Prompt always spans full; media and
// scalars default to full unless the token declares a width (e.g. "; 1/4").
const WIDTH_SPAN = {
  "1/2": 6,
  "1/3": 4,
  "1/4": 3,
  "2/3": 8,
  "3/4": 9,
  full: 12,
  1: 12,
};
function comfySpan(token, type) {
  if (type === "textarea") return 12;
  return WIDTH_SPAN[token.width] || 12;
}

const prettyLabel = (name) =>
  name.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

// A single-media (image/video/audio) control. Dropped files are saved to the
// project gallery (same store the kie.ai side uses) so they're reusable and
// included in exports; you can also pick an existing gallery item of that kind.
// At generate time the chosen file is pushed into ComfyUI's input folder by id.
const MEDIA_ARTICLE = {
  image: "an image",
  video: "a video",
  audio: "an audio file",
};
// --- reference labels --------------------------------------------------------
// MiniMax H3 labels references by *presentation* order, not by field: images, then
// for each reference video its soundtrack's <Audio j> (only when that loader's
// soundtrack is wired) immediately before its <Video k>, then standalone audio. So a
// wired soundtrack claims an audio number and a separately attached audio file is
// <Audio 2> — which is invisible in the form unless we show it. Server sends
// `refLabelScheme` so this node-specific rule is only applied where it holds.
let comfyRefLabelScheme = null;

// The per-slot tag for each media field, in presentation order. A wired soundtrack
// takes an audio number without a thumbnail of its own.
function comfyRefTags() {
  const counts = { picture: 0, video: 0, audio: 0 };
  const perField = new Map(); // field -> [tag, …] aligned with its filled slots
  const fieldsOfKind = (kind) =>
    comfyFields.filter((f) => f.mediaKind === kind && f.filledMedia);

  for (const f of fieldsOfKind("image")) {
    perField.set(
      f,
      f.filledMedia().map(() => `<Picture ${++counts.picture}>`),
    );
  }
  for (const f of fieldsOfKind("video")) {
    const tags = [];
    f.filledMedia().forEach((item, i) => {
      if (f.soundtrackAt?.(i)) counts.audio++; // the soundtrack's <Audio j> comes first
      tags.push(`<Video ${++counts.video}>`);
    });
    perField.set(f, tags);
  }
  for (const f of fieldsOfKind("audio")) {
    perField.set(
      f,
      f.filledMedia().map(() => `<Audio ${++counts.audio}>`),
    );
  }
  return perField;
}

// Write the real tags onto the thumbnails. Called from every media field's render, so
// it must not itself trigger a re-render.
function refreshComfyRefTags() {
  syncComfyDefaultNotes(); // what the run falls back to depends on what's filled
  if (comfyRefLabelScheme !== "minimax_h3") return;
  for (const [f, tags] of comfyRefTags()) {
    const labels = f.el.querySelectorAll(".dropzone .thumb.ready .img-label");
    tags.forEach((t, i) => {
      if (labels[i]) labels[i].textContent = t;
    });
  }
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
  const keep = snapTailFrames(
    Math.min(probe.frames, Math.max(1, Math.round(seconds * probe.fps))),
    grid,
  );
  if (keep >= probe.frames)
    return `${total} · whole clip (${probe.frames} frames)`;
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
  input.title =
    "Seconds from the end of the clip to use as the reference. 0 or blank = the whole clip.";
  if (seconds > 0) input.value = String(seconds);
  wrap.append(
    document.createTextNode("use last "),
    input,
    document.createTextNode(" sec"),
  );
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
  let source = null,
    uploadedRef = null;

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
  let tailSec = 0,
    probe;
  const renderTail = () => {
    tailsEl.innerHTML = "";
    if (!token.tail || !source) return;
    if (source.id && probe === undefined) {
      probe = null; // probe once per file; null until it lands
      probeGalleryVideo(source.id).then((p) => {
        probe = p;
        renderTail();
      });
    }
    tailsEl.appendChild(
      makeTailRow({
        label: prettyLabel(token.name),
        seconds: tailSec,
        probe: probe || null,
        grid: token.tail.grid || null,
        onInput: (v) => {
          tailSec = v;
        },
      }),
    );
  };
  const render = () => {
    thumbs.innerHTML = "";
    clearBtn.classList.toggle("hidden", !source);
    if (source) thumbs.appendChild(previewThumb(source.url, source.name, true));
    renderTail();
    refreshComfyRefTags();
  };
  const setSource = (s) => {
    source = s;
    uploadedRef = null;
    probe = undefined;
    render();
  };

  // Save a dropped/browsed file into the project gallery, then use it.
  const take = (file) => {
    if (!file || !file.type.startsWith(`${mediaKind}/`)) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64Data: reader.result,
            fileName: file.name,
            projectId: activeProjectId,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.image?.id)
          throw new Error(data.msg || "Save failed");
        setSource({
          id: data.image.id,
          url: data.image.localUrl || reader.result,
          name: data.image.name,
        });
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
      (i) =>
        (i.kind || "image") === mediaKind &&
        (i.projectId || "default") === activeProjectId,
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
        }),
      );
    }
  };

  dz.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    take(fileInput.files[0]);
    fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((e) =>
    dz.addEventListener(e, (ev) => {
      ev.preventDefault();
      dz.classList.add("dragover");
    }),
  );
  ["dragleave", "drop"].forEach((e) =>
    dz.addEventListener(e, (ev) => {
      ev.preventDefault();
      dz.classList.remove("dragover");
    }),
  );
  dz.addEventListener("drop", (ev) => {
    if (ev.dataTransfer.files?.length) take(ev.dataTransfer.files[0]);
  });
  clearBtn.addEventListener("click", () => setSource(null));
  galleryWrap.addEventListener("toggle", () => {
    if (galleryWrap.open) renderGalleryPicker();
  });

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
      if (seconds > 0) {
        tailSec = seconds;
        renderTail();
      }
    },
    peekMedia: () => {
      if (!source) return [];
      const m = { id: source.id, url: source.url, name: source.name };
      if (tailSec > 0) m.tail = tailSec; // remembered per-file reference tail
      return [m];
    },
    tailSpec: () =>
      tailSec > 0 && source?.id ?
        { [token.name]: { seconds: tailSec, id: source.id } }
      : {},
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
      if (!res.ok || !data.data?.filename)
        throw new Error(data.msg || `Failed to upload ${token.name}`);
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
  comfyDefaultNotes.clear();
  comfyLoraControl = null;
  comfyMediaControl = null;
  comfyBypassControl = null;
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
      `<p class="muted">No editable controls recognized in <b>${escapeHtmlJs(wf.name)}</b>. ` +
      `It will run exactly as saved. Support for a node type is a small file in ` +
      `<code>node_types/</code> — see its README.</p>`;
    return;
  }

  comfyControlsEl.innerHTML = `<p class="muted">Loading options from ComfyUI…</p>`;
  // Enriched tokens (combo file lists + numeric ranges) + installed LoRAs, from
  // ComfyUI's /object_info. Falls back to the raw tokens (offline) — the picker
  // controls then can't populate, and we show an offline notice.
  let meta = {
    offline: true,
    tokens: wf.tokens,
    loraOptions: [],
    bypassable: [],
  };
  try {
    const r = await fetch(
      `/api/comfy/workflow-meta?file=${encodeURIComponent(wf.file)}`,
    );
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
    note.textContent =
      "⚠ ComfyUI is offline — start it to choose models / LoRAs / VAEs / samplers.";
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
          it = {
            kind: "series",
            type,
            base: m[1],
            entries: [],
            order: undefined,
            scanIndex,
          };
          seriesByKey.set(key, it);
          items.push(it);
        }
        it.entries.push({ token, index: Number(m[2]) });
        if (token.order != null && (it.order == null || token.order < it.order))
          it.order = token.order;
        return;
      }
      items.push({
        kind: "single-media",
        type,
        token,
        order: token.order,
        scanIndex,
      });
      return;
    }
    items.push({ kind: "scalar", type, token, order: token.order, scanIndex });
  });
  // A one-entry "series" is just a single control.
  for (const it of items) {
    if (it.kind === "series" && it.entries.length === 1) {
      it.kind = "single-media";
      it.token = it.entries[0].token;
    }
  }
  // Dynamic reference collections (recognized nodes) render as multi-upload controls,
  // ordered in among the rest by their `order`.
  (meta.references || []).forEach((ref, i) => {
    items.push({
      kind: "reference",
      ref,
      order: ref.order,
      scanIndex: 900 + i,
    });
  });
  // Order by the "; #N" hint; items without one keep scan order, after ordered ones.
  items.sort(
    (a, b) => (a.order ?? 1000 + a.scanIndex) - (b.order ?? 1000 + b.scanIndex),
  );

  // The "ComfyUI Settings" drawer is for installed-model-file pickers (checkpoints,
  // VAEs, CLIPs — big `.safetensors` lists) and the toggles for optional patch nodes
  // (e.g. Sage Attention). Plain enum combos like sampler_name / scheduler are
  // generation params and stay in the main form next to steps/seed/duration.
  const bypassIds = new Set((meta.bypassable || []).map((b) => String(b.id)));
  comfyRefLabelScheme = meta.refLabelScheme || null; // null → keep each field's own numbering

  // Recognized controls carry a `group` per source node, so the main form is
  // rendered as one collapsible section per node type — Prompt, KSampler, Latent
  // Image, … — instead of a flat grid. A control without a group (or a workflow
  // with none) falls back to the flat grid. `mainContainer(token)` returns where a
  // control mounts: its group's <details> body in grouped mode, or the flat grid.
  const grouped = tokens.some((t) => t.group);
  const groupBodies = new Map(); // group key → body element (created lazily, in order)
  const groupResets = new Map(); // group key → its summary's Reset button
  // Mark a section's only control, whose label can defer to the section's summary.
  const groupSizes = new Map();
  for (const t of tokens)
    if (t.group)
      groupSizes.set(t.group.key, (groupSizes.get(t.group.key) || 0) + 1);
  for (const t of tokens)
    if (t.group && groupSizes.get(t.group.key) === 1) t.soleInGroup = true;
  // Enable/disable toggles for optional patch nodes (e.g. Sage Attention). A
  // recognized node's toggle sits at the top of its own section, above the controls it
  // hides; the rest land in the Settings drawer below.
  comfyBypassControl =
    (meta.bypassable || []).length ?
      makeComfyBypassControl(meta.bypassable)
    : null;
  const mainContainer = (token) => {
    if (!grouped || !token.group) return comfyControlsEl;
    let body = groupBodies.get(token.group.key);
    if (!body) {
      const details = document.createElement("details");
      details.className = "comfy-node-group";
      details.open = !token.group.collapsed; // loaders / save node start closed
      details.style.gridColumn = "span 12";
      const summary = document.createElement("summary");
      const label = token.group.label || "Options";
      summary.textContent = label;
      // Reset this node's controls to recommended values (see comfyResetValue). A
      // button inside <summary> would also toggle the section, so the click stops here.
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "link-btn comfy-group-reset";
      reset.textContent = "Reset";
      reset.title = "Reset to recommended values (not the workflow's)";
      const key = token.group.key;
      reset.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetComfyGroup(key, label);
      });
      summary.appendChild(reset);
      groupResets.set(key, reset);
      body = document.createElement("div");
      body.className = "comfy-node-group-body comfy-grid";
      details.append(summary, body);
      comfyControlsEl.appendChild(details);
      if (comfyBypassControl && bypassIds.has(String(token.group.key))) {
        body = comfyBypassControl.mountGroup(body, token.group.key);
      }
      groupBodies.set(token.group.key, body);
    }
    return body;
  };

  const settingsScalars = [];
  for (const it of items) {
    if (it.kind === "reference") {
      const ctrl = makeComfyReference(
        it.ref,
        // Only files that are really in ComfyUI's input folder: one that isn't can't be
        // what the run falls back to, and the media panel already shows it as missing.
        (meta.workflowMedia || []).filter(
          (m) =>
            m.reference === (it.ref.label || it.ref.name) &&
            (meta.mediaOptions?.[m.kind] || []).includes(m.file),
        ),
      );
      ctrl.el.style.gridColumn = "span 12";
      comfyControlsEl.appendChild(ctrl.el);
      comfyFields.push(ctrl);
      continue;
    }
    if (it.kind === "series") {
      const entries = it.entries.sort((a, b) => a.index - b.index);
      const ctrl = makeComfyMediaMulti(
        it.base,
        it.type,
        entries.map((e) => e.token.name),
        entries[0].token.tail,
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
    } else if (
      !it.token.group &&
      it.token.combo &&
      (isFilePickerCombo(it.token) ||
        bypassIds.has(String(it.token.nodeId ?? "")))
    ) {
      // Tokenized workflows funnel installed-file pickers + patch-node toggles into the
      // Settings drawer. Recognized controls carry a group and render in their own
      // (collapsed) node section instead, so they skip the drawer.
      settingsScalars.push(it);
    } else {
      // numbers, text, inline-option selects, and non-file object_info combos (sampler)
      renderScalarControl(it.token, it.type, mainContainer(it.token));
    }
  }
  // A section with nothing to reset (only media, or numbers with no known default)
  // keeps a plain header.
  for (const [key, btn] of groupResets) {
    btn.hidden = !comfyFields.some((f) => f.groupKey === key && f.reset);
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
  // Settings-drawer controls of a bypassable node render inside its toggle's group
  // (hidden when disabled); the checkbox sits directly above them.
  for (const it of settingsScalars) {
    const nid = String(it.token.nodeId ?? "");
    if (comfyBypassControl && bypassIds.has(nid)) {
      renderScalarControl(
        it.token,
        it.type,
        comfyBypassControl.mountGroup(body, nid),
      );
    } else {
      renderScalarControl(it.token, it.type, body);
    }
  }
  if (comfyBypassControl) comfyBypassControl.mountRemaining(body); // toggles with no controls
  // LoRAs are always offered, so they live in the main form (not tucked inside the
  // "ComfyUI Settings" drawer). The drawer holds only installed-file pickers and
  // patch-node toggles now, and isn't rendered at all when it has neither.
  if ((meta.workflowMedia || []).length) {
    comfyMediaControl = makeComfyMediaControl(
      meta.workflowMedia,
      meta.mediaOptions,
      !!meta.offline,
    );
    comfyControlsEl.appendChild(comfyMediaControl.el);
  }
  comfyLoraControl = makeComfyLoraControl(
    meta.loraOptions || [],
    !!meta.offline,
    meta.workflowLoras || [],
  );
  comfyLoraControl.setLoras([]); // the workflow's own LoRAs, before any saved loadout
  comfyControlsEl.appendChild(comfyLoraControl.el);
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
    const s = await fetch(
      `/api/comfy/settings?file=${encodeURIComponent(wf.file)}`,
    ).then((r) => r.json());
    if (seq !== comfyRenderSeq) return;
    const settings = s?.data || {};
    prefillComfyControls(settings);
    refreshComfyRefTags();
    if (comfyLoraControl && Array.isArray(settings.loras))
      comfyLoraControl.setLoras(settings.loras);
    if (comfyMediaControl && Array.isArray(settings.workflowMedia))
      comfyMediaControl.setMedia(settings.workflowMedia);
    if (comfyBypassControl && Array.isArray(settings.bypass))
      comfyBypassControl.setDisabled(settings.bypass);
  } catch {
    /* no saved settings — token defaults stand */
  }
}

// A node section's Reset: every control in it goes to its recommended value (the
// node_types entry's, else ComfyUI's node default; prompts and other text clear). Locked
// controls (pinned for an armed continuation) are left alone, and so is the section's
// enable/disable checkbox. Asks first if a typed prompt would be wiped.
function resetComfyGroup(key, label) {
  const fields = comfyFields.filter(
    (f) => f.groupKey === key && f.reset && !f.locked,
  );
  if (!fields.length) return;
  if (
    fields.some((f) => f.wouldClear?.()) &&
    !confirm(`Reset "${label}"?\n\nThis clears the prompt text you've entered.`)
  )
    return;
  for (const f of fields) f.reset();
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
    nodes.set(String(b.id), {
      checkbox: cb,
      controlsEl,
      wrapper,
      mounted: false,
    });
  }
  return {
    // Append the node's group to `container` (once) and return its controls slot.
    mountGroup(container, id) {
      const n = nodes.get(String(id));
      if (!n) return container;
      if (!n.mounted) {
        container.appendChild(n.wrapper);
        n.mounted = true;
      }
      return n.controlsEl;
    },
    // Append any toggles that had no controls to render (bare enable/disable).
    mountRemaining(container) {
      for (const n of nodes.values())
        if (!n.mounted) {
          container.appendChild(n.wrapper);
          n.mounted = true;
        }
    },
    // Ids of nodes to bypass (the unchecked ones).
    getDisabled: () =>
      [...nodes].filter(([, n]) => !n.checkbox.checked).map(([id]) => id),
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
// `workflowLoras` are the LoRA nodes the workflow itself carries (see workflowLoras()
// server-side). They're listed first, marked, and are the workflow's own: unchecking one
// takes it out of the graph for the run, and editing its file or strength rewrites that
// node — so nothing loads that you can't see here.
// The media the workflow loads by itself (see workflowMedia() server-side): a LoadImage
// and friends with a filename baked in. They'd otherwise feed every run invisibly, so
// each is listed with its file — pointable at another file in ComfyUI's input folder,
// or unchecked to leave it out of the run. A loader a reference field already covers
// says so, since dropping your own files there replaces it anyway.
let comfyMediaControl = null;

function makeComfyMediaControl(workflowMedia, mediaOptions, offline) {
  const field = document.createElement("div");
  field.className = "field comfy-wfmedia";
  field.style.gridColumn = "span 12";
  field.innerHTML =
    `<div class="field-head"><span>Media in this workflow ` +
    `<span class="hint">(loaded by the workflow itself — uncheck to leave one out of the run)</span></span></div>` +
    `<div class="wfmedia-rows"></div>`;
  const rowsEl = field.querySelector(".wfmedia-rows");
  const rows = [];

  for (const m of workflowMedia) {
    const row = document.createElement("div");
    row.className = "lora-row wfmedia-row";
    row.dataset.nodeId = m.nodeId;
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "lora-enabled";
    chk.checked = true;
    chk.title = `From the workflow (${m.title}) — unchecked takes it out of the graph for the run`;
    const options = (mediaOptions?.[m.kind] || []).map((o) => ({
      label: o,
      value: o,
    }));
    let sel;
    if (options.length) {
      if (!options.some((o) => o.value === m.file))
        options.unshift({
          label: `${m.file} (not in ComfyUI's input folder)`,
          value: m.file,
        });
      sel = makeSearchableSelect(options, m.file, "Type to filter files…");
      sel.classList.add("lora-name");
    } else {
      // Offline: no file list to choose from, so just show what the workflow carries.
      sel = document.createElement("div");
      sel.className = "lora-name wfmedia-file";
      sel.textContent = m.file;
      sel.value = m.file;
    }
    const where = document.createElement("span");
    where.className = "lora-from";
    const syncWhere = () => {
      const differs = String(sel.value) !== String(m.file);
      where.textContent =
        differs ? "overriding"
        : m.reference ? `${m.reference} reference`
        : m.kind;
      where.classList.toggle("lora-overridden", differs);
      where.title =
        differs ?
          `The workflow loads “${m.file}” here (${m.title}, node ${m.nodeId})`
        : m.reference ?
          `Wired into the ${m.reference} reference — your own files there replace it`
        : `${m.title}, node ${m.nodeId}`;
    };
    syncWhere();
    sel.addEventListener?.("change", syncWhere);
    const syncDim = () => {
      row.classList.toggle("lora-off", !chk.checked);
      syncComfyDefaultNotes(); // an unchecked loader is no longer the fallback
    };
    chk.addEventListener("change", syncDim);
    row.append(chk, sel, where);
    rowsEl.appendChild(row);
    rows.push({ m, chk, sel });
  }

  return {
    el: field,
    // [{ nodeId, file, enabled }] — the server writes these onto the workflow's loaders.
    getMedia: () =>
      rows.map(({ m, chk, sel }) => ({
        nodeId: m.nodeId,
        file: sel.value || m.file,
        enabled: chk.checked,
      })),
    setMedia: (arr) => {
      for (const saved of Array.isArray(arr) ? arr : []) {
        const row = rows.find(
          (r) => String(r.m.nodeId) === String(saved.nodeId),
        );
        if (!row) continue;
        if (saved.file) row.sel.value = saved.file;
        row.chk.checked = saved.enabled !== false;
        row.chk.dispatchEvent(new Event("change"));
        row.sel.dispatchEvent?.(new Event("change", { bubbles: false })); // "overriding" tag
      }
    },
  };
}

function makeComfyLoraControl(loraOptions, offline, workflowLoras = []) {
  const field = document.createElement("div");
  field.className = "field comfy-loras";
  field.style.gridColumn = "span 12";
  field.innerHTML =
    `<div class="field-head"><span>LoRAs <span class="hint">` +
    (workflowLoras.length ?
      `(${workflowLoras.length} already in this workflow, listed first — uncheck to leave one out · strength −5 to 5)`
    : `(added on top of the workflow · strength −5 to 5)`) +
    `</span></span></div>` +
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

  // `from` set = one of the workflow's own LoRA nodes: tagged, and kept in the list
  // (unchecking is what switches it off, so it can always be put back).
  const addRow = (name = "", strength = 1, enabled = true, from = null) => {
    const row = document.createElement("div");
    row.className = "lora-row";
    if (from) {
      row.dataset.nodeId = from.nodeId;
      row.classList.add("lora-baked");
    }
    // A disabled LoRA stays in the loadout (and is saved) but isn't injected — which
    // is different from a strength of 0.
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "lora-enabled";
    chk.checked = enabled !== false;
    chk.title =
      from ?
        `From the workflow (${from.title}) — unchecked takes it out of the graph for the run`
      : "Enable this LoRA — unchecked keeps it in the loadout but doesn't apply it";
    const loraOpts = loraOptions.map((o) => ({ label: o, value: o }));
    if (name && !loraOptions.includes(name))
      loraOpts.push({ label: `${name} (not installed)`, value: name });
    const sel = makeSearchableSelect(
      loraOpts,
      name || "",
      "Type to filter LoRAs…",
    );
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
    if (from) {
      // The workflow owns this one — it goes back if you re-check it, so it isn't dropped
      // from the list; the checkbox is what leaves it out of a run.
      rm.disabled = true;
      rm.title = "From the workflow — uncheck it to leave it out";
    } else {
      rm.title = "Remove LoRA";
      rm.addEventListener("click", () => row.remove());
    }
    const syncDim = () => row.classList.toggle("lora-off", !chk.checked);
    chk.addEventListener("change", syncDim);
    syncDim();
    row.append(chk, sel, str);
    if (from) {
      const tag = document.createElement("span");
      tag.className = "lora-from";
      const syncTag = () => {
        const differs = String(sel.value) !== String(from.name);
        tag.textContent = differs ? "overriding" : "in workflow";
        tag.classList.toggle("lora-overridden", differs);
        tag.title =
          differs ?
            `The workflow loads “${from.name}” here (${from.title}, node ${from.nodeId})`
          : `This LoRA is part of the workflow file (${from.title}, node ${from.nodeId})`;
      };
      syncTag();
      sel.addEventListener("change", syncTag);
      row.appendChild(tag);
    }
    row.appendChild(rm);
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
          ...(r.dataset.nodeId ? { nodeId: r.dataset.nodeId } : {}),
        }))
        .filter((l) => l.name),
    // The workflow's own LoRAs always head the list; `arr` (saved settings, or a
    // re-imported run) supplies their state by nodeId, then the added ones follow.
    setLoras: (arr) => {
      const saved = Array.isArray(arr) ? arr : [];
      rowsEl.innerHTML = "";
      for (const w of workflowLoras) {
        const s = saved.find((x) => String(x.nodeId) === String(w.nodeId));
        addRow(
          s?.name || w.name,
          typeof s?.strength === "number" ? s.strength : w.strength,
          s?.enabled !== false,
          w,
        );
      }
      for (const l of saved.filter((x) => !x.nodeId && x.name))
        addRow(
          l.name,
          typeof l.strength === "number" ? l.strength : 1,
          l.enabled !== false,
        );
    },
  };
}

// A type-to-filter single-select for long option lists (models, LoRAs, samplers…).
// Behaves like a <select> for callers: exposes a `.value` property (get/set) and
// fires "change", so it drops in wherever a native select's `.value` was read.
// `options` are strings or { label, value }.
function makeSearchableSelect(
  options,
  initialValue = "",
  placeholder = "Type to filter…",
) {
  const opts = (options || []).map((o) =>
    typeof o === "string" ? { label: o, value: o } : o,
  );
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
    if (highlight >= 0)
      list.children[highlight]?.scrollIntoView({ block: "nearest" });
  }

  function filter(text) {
    const f = (text || "").trim().toLowerCase();
    matches =
      f ? opts.filter((o) => o.label.toLowerCase().includes(f)) : opts.slice();
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
  input.addEventListener("click", () => {
    if (!isOpen()) open();
  });
  input.addEventListener("input", () => filter(input.value));
  input.addEventListener("blur", () =>
    setTimeout(() => {
      if (isOpen()) close();
    }, 100),
  );
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
      if (isOpen()) {
        e.preventDefault();
        close();
        input.blur();
      }
    }
  });

  input.value = labelFor(current);
  Object.defineProperty(root, "value", {
    get: () => current,
    set: (v) => {
      current = v ?? "";
      input.value = labelFor(current);
    },
    configurable: true,
  });
  return root;
}

// What a node section's Reset puts back in one control — never the workflow's own
// value: the node_types entry's `recommended` value, else ComfyUI's node default
// (steps 20, a filename prefix), else blank for text (a prompt) or the first choice
// for a dropdown (ComfyUI's implicit default, e.g. the first installed model).
// `undefined` means nothing to reset to — a number with no default keeps its value.
function comfyResetValue(token, type, choices) {
  const known = (v) =>
    v !== undefined &&
    v !== null &&
    (type !== "select" || choices.some((o) => o.value === String(v)));
  if (known(token.recommended)) return token.recommended;
  if (known(token.nodeDefault)) return token.nodeDefault;
  if (type === "select") return choices[0]?.value;
  if (type === "text" || type === "textarea") return "";
  return undefined;
}

// A workflow's nodes are the workflow; the files named in them are only a starting
// point, and a name you don't have is quietly replaced by your own selection — no
// warning, nothing to answer. The one thing worth saying is where the UI looks empty
// but the workflow's own file would still be loaded: an untouched reference field (see
// comfyDefaultNotes), which the run silently inherits from the export.
const comfyDefaultNotes = new Set(); // sync() per reference field that can fall back

function syncComfyDefaultNotes() {
  for (const sync of comfyDefaultNotes) sync();
}

// Build one scalar control (select / number / text / textarea) and register it,
// appending it to `container` (the main grid, or the ComfyUI Settings drawer).
function renderScalarControl(token, type, container = comfyControlsEl) {
  const field = document.createElement("div");
  field.className = "field";
  field.style.gridColumn = `span ${comfySpan(token, type)}`;
  const head = document.createElement("div");
  head.className = "field-head";
  const labelText = token.label || prettyLabel(token.name);
  // A control named the same as its section ("Prompt" inside Prompt) needs no label of
  // its own — the section's summary already says it. The head stays for a seed's
  // after-generate/dice controls; otherwise it's removed below.
  // Only for a section's sole control, so a multi-control section keeps every label.
  const echoesGroup =
    !!token.soleInGroup &&
    !!token.group?.label &&
    labelText.trim().toLowerCase() === token.group.label.trim().toLowerCase();
  if (!echoesGroup) head.innerHTML = `<span>${escapeHtmlJs(labelText)}</span>`;
  field.appendChild(head);
  let afterMode = null; // seed "control after generate" <select>, if present

  // A combo token's options come from ComfyUI (plain installed-file names); an
  // author's inline options are "value" or "Label=value" (e.g. Enabled=1|Disabled=0)
  // so the dropdown can show a friendly label while writing a different value.
  const parsedOptions =
    type === "select" ?
      (token.combo ? token.comboOptions || [] : token.options || []).map(
        (o) => {
          if (token.combo) return { label: String(o), value: String(o) };
          const i = String(o).indexOf("=");
          return i >= 0 ?
              { label: o.slice(0, i).trim(), value: o.slice(i + 1).trim() }
            : { label: o, value: o };
        },
      )
    : [];
  // A dropdown whose option values are all numbers should send a number (never for
  // a combo, whose values are filenames/choices).
  const numericSelect =
    token.type !== "str" &&
    type === "select" &&
    !token.combo &&
    parsedOptions.length > 0 &&
    parsedOptions.every(
      (o) => o.value !== "" && !Number.isNaN(Number(o.value)),
    );

  let input;
  if (type === "toggle") {
    // A checkbox, labeled beside it rather than above (no field-head).
    const asBool = (v) => v === true || v === "true" || v === 1 || v === "1";
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = asBool(token.default);
    const label = document.createElement("label");
    label.className = "inline";
    label.append(
      input,
      document.createTextNode(` ${token.label || prettyLabel(token.name)}`),
    );
    head.remove();
    field.classList.add("field-toggle");
    field.appendChild(label);
    container.appendChild(field);
    const resetTo = comfyResetValue(token, type, []);
    const toggleCtrl = {
      name: token.name,
      getValue: async () => input.checked,
      peek: () => input.checked,
      set: (v) => {
        input.checked = asBool(v);
      },
      pin: !!token.pin,
      lock: (on) => {
        input.disabled = !!on;
        toggleCtrl.locked = !!on;
        field.classList.toggle("locked", !!on);
      },
      groupKey: token.group?.key ?? null,
      reset:
        resetTo === undefined ? null : (
          () => {
            input.checked = asBool(resetTo);
          }
        ),
    };
    comfyFields.push(toggleCtrl);
    return;
  }
  // ComfyUI lists a model by its path inside the folder ("Minimax\h3.safetensors"), so a
  // workflow that names the bare file (or was exported with it in another subfolder)
  // matches nothing. The same filename elsewhere in the tree is the file it meant —
  // taken when it's unambiguous, rather than silently falling back to the first entry.
  const baseName = (v) =>
    String(v ?? "")
      .split(/[\\/]/)
      .pop()
      .toLowerCase();
  const sameFileElsewhere = (v) => {
    if (!token.combo || !v) return null;
    const hits = parsedOptions.filter((o) => baseName(o.value) === baseName(v));
    return hits.length === 1 ? hits[0].value : null;
  };
  if (type === "select") {
    const initial =
      parsedOptions.some((o) => o.value === token.default) ?
        token.default
      : (sameFileElsewhere(token.default) ?? parsedOptions[0]?.value ?? "");
    if (parsedOptions.length > 10) {
      // Long lists (models, samplers, …) get a type-to-filter dropdown.
      input = makeSearchableSelect(parsedOptions, initial);
    } else {
      input = document.createElement("select");
      for (const o of parsedOptions)
        input.appendChild(new Option(o.label, o.value));
      input.value = initial;
    }
  } else if (type === "textarea") {
    input = document.createElement("textarea");
    input.rows = /prompt/i.test(token.name) ? 15 : 4; // prompts get room to write in
    input.value = token.default || "";
  } else {
    input = document.createElement("input");
    input.type = type === "number" ? "number" : "text";
    input.value = token.default || "";
    // Numeric range/step from /object_info, when the field carried it.
    if (type === "number") {
      if (token.min != null) input.min = token.min;
      if (token.max != null) input.max = token.max;
      // No step known (offline, or an input /object_info doesn't describe): allow any
      // value, or the browser's default step of 1 rejects decimals like 1.5.
      input.step = token.step != null ? token.step : "any";
    }
    if (type === "number" && token.name.toLowerCase().includes("seed")) {
      // "Control after generate" mirrors ComfyUI's seed widget: how the seed
      // changes for the next run after you queue one.
      afterMode = document.createElement("select");
      afterMode.className = "seed-after";
      afterMode.title = "Control after generate";
      for (const m of ["fixed", "increment", "decrement", "randomize"])
        afterMode.appendChild(new Option(m, m));
      afterMode.value = "fixed";
      const dice = document.createElement("button");
      dice.type = "button";
      dice.className = "link-btn";
      dice.textContent = "🎲";
      dice.title = "Randomize now";
      dice.addEventListener("click", () => {
        input.value = randomSeed();
      });
      head.appendChild(afterMode);
      head.appendChild(dice);
    }
  }
  // The workflow's main prompt (the first one, if a workflow tokenizes several) is
  // what a model switch carries over, so it wears the lock — see carryOnSwitch.
  const isPrompt =
    type === "textarea" &&
    isCarryPromptName(token.name) &&
    !comfyFields.some((f) => f.isPrompt);
  if (isPrompt) {
    const tools = document.createElement("span");
    tools.className = "field-head-tools";
    tools.appendChild(makeCarryLock());
    head.appendChild(tools);
  }
  if (!head.childElementCount) head.remove(); // label suppressed and nothing else in the head
  field.appendChild(input);
  container.appendChild(field);
  if (isPrompt) {
    // Prompt / Saved Prompts tabs + Save, like the kie.ai prompt.
    installPromptTools({
      field,
      head,
      textarea: input,
      labelEl: echoesGroup ? null : head.firstElementChild,
      labelText: echoesGroup ? "Prompt" : labelText,
    });
  }
  const readValue = () =>
    type === "number" || numericSelect ? Number(input.value) : input.value;
  const resetTo = comfyResetValue(token, type, parsedOptions);
  const ctrl = {
    name: token.name,
    isPrompt,
    getValue: async () => readValue(),
    peek: readValue, // sync read, for saving last-used defaults
    set: (v) => {
      input.value = v;
    },
    // Declared "; pin": must not drift between a run and its continuation, so the
    // form locks it while one is armed.
    pin: !!token.pin,
    lock: (on) => {
      input.disabled = !!on;
      ctrl.locked = !!on;
      field.classList.toggle("locked", !!on);
    },
    // The node section's Reset (see resetComfyGroup).
    groupKey: token.group?.key ?? null,
    reset:
      resetTo === undefined ? null : (
        () => {
          input.value = type === "select" ? String(resetTo) : resetTo;
        }
      ),
    // True when Reset would blank a typed multi-line text (a prompt), so it asks first.
    wouldClear: () =>
      type === "textarea" &&
      resetTo === "" &&
      String(input.value).trim() !== "",
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
    ctrl.setAfter = (v) => {
      if (v) afterMode.value = v;
    };
  }
  comfyFields.push(ctrl);
}

// A multi-file control for a numbered token series (picture1, picture2, …). Built
// on the same reference-list component as the kie.ai fields — so it gets drag-to-
// reorder, "view full size", and the gallery picker for free — with numbered
// badges ("Picture 1, 2…"). The Nth file fills the Nth token; unfilled tokens are
// pruned at submit.
let comfyListSeq = 0;
function makeComfyMediaMulti(
  base,
  mediaKind,
  tokenNames,
  tail = null,
  soundtracks = [],
  labelText = null,
) {
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
        if (it?.id)
          list.addFromGallery({
            id: it.id,
            localUrl: it.url,
            name: it.name,
            tail: it.tail,
          });
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
        if (!it) {
          prune.push(tokenNames[i]);
          continue;
        }
        if (!it.localId)
          throw new Error(
            `${label}: drop a file (URL inputs aren't supported for local workflows).`,
          );
        if (!it.comfyRef) {
          const res = await fetch("/api/comfy/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: it.localId }),
          });
          const data = await res.json();
          if (!res.ok || !data.data?.filename)
            throw new Error(data.msg || `Failed to upload ${tokenNames[i]}`);
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
function makeComfyReference(ref, baked = []) {
  const max = ref.max || 9;
  const slotNames = Array.from(
    { length: max },
    (_, i) => `${ref.name}_${i + 1}`,
  );
  const ctrl = makeComfyMediaMulti(
    ref.name,
    ref.kind,
    slotNames,
    null,
    [],
    ref.label,
  );
  ctrl.isMultiMedia = false; // not a token series — don't route through values/prune
  ctrl.isReferenceCollection = true;
  ctrl.collectionName = ref.name;
  // The workflow's own files wired into this reference. While you add none of your
  // own, they're what the run uses — which the field looks empty for, so it says so.
  // (Unchecking one in "Media in this workflow" takes it out, and the note with it.)
  if (baked.length) {
    const note = document.createElement("p");
    note.className = "comfy-missing hidden";
    ctrl.el.appendChild(note);
    const sync = () => {
      const live =
        comfyMediaControl ?
          comfyMediaControl
            .getMedia()
            .filter(
              (m) =>
                baked.some((b) => String(b.nodeId) === String(m.nodeId)) &&
                m.enabled !== false,
            )
        : baked.map((b) => ({ file: b.file }));
      const show = live.length > 0 && ctrl.filledMedia().length === 0;
      note.classList.toggle("hidden", !show);
      if (show) {
        note.textContent =
          `⚠ Nothing loaded here — the run uses what the workflow already has: ` +
          `${live.map((m) => `“${m.file}”`).join(", ")}.`;
      }
    };
    comfyDefaultNotes.add(sync);
  }

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
    if (after && typeof f.setAfter === "function" && f.name in after)
      f.setAfter(after[f.name]);
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
    saved = await fetch("/api/images")
      .then((r) => r.json())
      .then((d) => d.data || []);
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
    for (const f of comfyFields)
      if (typeof f.setTails === "function") f.setTails(entry.input.tails);
  }
}

// Per-workflow config, saved server-side (settings/comfy/<file>.json) so it's
// shared across devices: control values, media picks (by gallery id/url under
// `__media`), seed modes (`__after`), and the dynamic LoRA list. Loaded in
// renderComfyControls; token `=default`s are the base and these override them.
async function saveComfySettings(file) {
  const data = { __media: {}, __after: {} };
  for (const f of comfyFields) {
    if (typeof f.peekMedia === "function")
      data.__media[f.mediaKey] = f.peekMedia();
    else if (typeof f.peek === "function") data[f.name] = f.peek();
    if (typeof f.peekAfter === "function") data.__after[f.name] = f.peekAfter();
  }
  if (comfyLoraControl) data.loras = comfyLoraControl.getLoras();
  if (comfyMediaControl) data.workflowMedia = comfyMediaControl.getMedia();
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
// `promptOverride` (an active saved prompt's export) replaces the main prompt field's value.
async function collectComfyValues(promptOverride = null) {
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
    values[f.name] =
      f.isPrompt && promptOverride != null ?
        promptOverride
      : await f.getValue();
  }
  // Wildcards: fresh picks per call (each queued run), one memo across the fields so a
  // :1 pick in the prompt carries into, say, the negative prompt. `templates` keeps the
  // unresolved text of each field that had tokens (for Re-import).
  const templates = {};
  const memo = new Map();
  for (const [name, v] of Object.entries(values)) {
    if (typeof v !== "string" || !hasWildcards(v)) continue;
    templates[name] = v;
    values[name] = resolveWildcards(v, memo);
  }
  return { values, prune, tails, references, templates };
}

// How many generations to queue (the ×N counter beside Generate). Capped at 20, which
// is also kie.ai's limit on new requests per 10 seconds.
function queueCount() {
  const n = Math.floor(
    Number(document.getElementById("queueCount").value) || 1,
  );
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
  if (armedContinuation && armedContinuation.file !== wf.file)
    disarmContinuation();
  const cont = armedContinuation;
  // Redoing a run in place writes one fixed slot; queueing several would stamp the
  // same one N times.
  const count = cont?.into ? 1 : queueCount();
  // Every row goes to the server: an added LoRA that's off is skipped there, and one of
  // the workflow's own that's off is removed from the graph.
  const allLoras = comfyLoraControl ? comfyLoraControl.getLoras() : [];
  const wfMedia = comfyMediaControl ? comfyMediaControl.getMedia() : [];
  const bypass = comfyBypassControl ? comfyBypassControl.getDisabled() : [];
  const fromSaved =
    comfyFields.some((f) => f.isPrompt) ? runSavedPrompt() : null;
  const promptOverride = fromSaved ? exportSavedPromptText(fromSaved) : null;
  const mediaNotes = loadRunMedia(fromSaved); // before the fields are read below
  if (mediaNotes.length) setError(mediaNotes.join("\n"));
  try {
    for (let i = 0; i < count; i++) {
      const { values, prune, tails, references, templates } =
        await collectComfyValues(promptOverride);
      const mediaIds = { image: [], video: [], audio: [] };
      for (const f of comfyFields) {
        if (f.isMultiMedia || f.isReferenceCollection)
          mediaIds[f.mediaKind]?.push(...f.localIds());
        else if (f.isMedia) {
          const localId = f.localId();
          if (localId) mediaIds[f.mediaKind]?.push(localId);
        }
      }
      const input = { model: `comfy:${wf.file}`, workflow: wf.name, values };
      if (allLoras.length) input.loras = allLoras; // store the full loadout (incl. disabled) for re-import
      if (wfMedia.length) input.workflowMedia = wfMedia; // the workflow's own media, as this run had it
      if (bypass.length) input.bypass = bypass;
      if (Object.keys(templates).length) input.valueTemplates = templates; // Re-import restores the %tokens%
      if (typeof values.prompt === "string" && values.prompt.trim())
        input.prompt = values.prompt.trim();
      if (fromSaved) {
        if (!input.prompt && promptOverride.trim())
          input.prompt = resolveWildcards(promptOverride).trim();
        input.savedPrompt = savedPromptStamp(fromSaved); // History only, not sent to ComfyUI
      }
      await queueComfyRun(
        wf,
        values,
        prune,
        mediaIds,
        input,
        allLoras,
        bypass,
        tails,
        cont,
        references,
        wfMedia,
      );
      // Advance seeds for the next queued run (no-op when the mode is "fixed").
      for (const f of comfyFields)
        if (typeof f.advance === "function") f.advance();
    }
    saveComfySettings(wf.file); // remember the final values + LoRAs (server-side)
    disarmContinuation(); // one arm, one submit
  } catch (err) {
    setError(err.message || String(err)); // e.g. an unknown %wildcard%
  } finally {
    submitBtn.disabled = false;
  }
}

// Queue one ComfyUI run: one request queues it AND creates the pending History
// entry server-side (so a dropped connection can't orphan it — the sweep finishes
// it). Then attach a live status to that pending card, wire Cancel, and poll.
async function queueComfyRun(
  wf,
  values,
  prune,
  mediaIds,
  input,
  loras,
  bypass,
  tails,
  cont,
  references,
  workflowMedia = [],
) {
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
        workflowMedia: workflowMedia || [],
        loras: loras || [],
        bypass: bypass || [],
        tails: tails || {},
        input: job.input,
        mediaLocalIds: job.mediaLocalIds,
        projectId: job.projectId,
        refVideoSeconds: 0,
        previewMethod,
        ...(cont ?
          {
            continueFrom: {
              parentId: cont.parentId,
              from: cont.from,
              slot: cont.into,
            },
          }
        : {}),
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
    if (data.data.warnings?.length)
      setError(`Queued, but: ${data.data.warnings.join(" ")}`);
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
    const res = await fetch(
      `/api/comfy/status?promptId=${encodeURIComponent(job.taskId)}`,
    );
    if (job.cancelled) return; // cancelled while this poll was in flight
    data = await res.json();
    if (res.status >= 400 && res.status < 500) {
      // Definitive client error — the task is gone/invalid.
      await failJob(job, data.msg || `Status check failed (${res.status})`);
      return;
    }
    if (!res.ok || data.code !== 200)
      throw new Error(data.msg || `Status check failed (${res.status})`);
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
        "ComfyUI's output folder it couldn't be copied automatically; re-run to regenerate.",
    );
    return;
  }
  // Still running — surface live step progress (drives the elapsed/ETA clock).
  const prog = data.data?.progress;
  if (live && prog && prog.max > 0)
    live.setProgress(prog.value, prog.max, prog.passes);
  setTimeout(() => pollComfyJob(job), POLL_INTERVAL_MS);
}

// --- prompt length counter -----------------------------------------------
// Caps per the model docs: Seedance 20,000; Seedream Lite 3,000; Pro 5,000;
// MiniMax H3 7,000.
const promptEl = document.getElementById("prompt");
const promptCount = document.getElementById("promptCount");
const promptCapHint = document.getElementById("promptCapHint");

function promptCap() {
  if (isH3()) return 7000;
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

// --- saved prompts ----------------------------------------------------------------
// Each project keeps a list of titled prompts (text + reference media + duration) on
// the server (projects/<slug>/prompts.json). The Prompt field gets two tabs: "Prompt"
// (the textarea) and "Saved Prompts" (cards). Both the kie.ai prompt and a ComfyUI
// workflow's main prompt get the tabs; one shared cards panel moves into whichever is
// on screen. Saving and importing go through snapshotCarry()/applyCarry(), so a saved
// prompt means the same thing to a kie.ai model and a ComfyUI workflow.
let savedPrompts = []; // the active project's, newest first
let savedPromptsSeq = 0; // the latest load; a slower earlier one doesn't overwrite it
// "prompt" | "saved" | "wildcards", shared by every prompt field; remembered per browser
// across reloads. `promptSource` is the last of "prompt"/"saved" that was open: what
// Generate uses — the Wildcards tab is a reference view and doesn't change it.
const PROMPT_TAB_KEY = "genie_prompt_tab";
const PROMPT_SOURCE_KEY = "genie_prompt_source";
let promptTab = "prompt";
let promptSource = "prompt";
try {
  const t = localStorage.getItem(PROMPT_TAB_KEY);
  if (t === "saved" || t === "wildcards") promptTab = t;
  promptSource =
    (
      t === "saved" ||
      (t === "wildcards" && localStorage.getItem(PROMPT_SOURCE_KEY) === "saved")
    ) ?
      "saved"
    : "prompt";
} catch {
  /* storage blocked — start on the Prompt tab */
}
let savedPromptsFilter = "";
const promptHosts = []; // [{ field, textarea, tabs: { prompt, saved } }]

// --- the active saved prompt ---
// One saved prompt per project can be made "active" (▶ on its card). While the Saved
// Prompts tab is showing, Generate sends that prompt's exported text in place of the
// textarea's — nothing else in the form changes, and the textarea keeps your draft —
// and the run records it (input.savedPrompt), so the server links the new History
// card to the prompt once it has an output. Remembered per project, per browser.
const ACTIVE_PROMPT_KEY = "genie_active_saved_prompt";
let activeSavedPromptIds = {}; // projectId → saved prompt id
try {
  activeSavedPromptIds =
    JSON.parse(localStorage.getItem(ACTIVE_PROMPT_KEY) || "{}") || {};
} catch {
  /* storage blocked or corrupt — start empty */
}

function setActiveSavedPrompt(id) {
  if (id) activeSavedPromptIds[activeProjectId] = id;
  else delete activeSavedPromptIds[activeProjectId];
  try {
    localStorage.setItem(
      ACTIVE_PROMPT_KEY,
      JSON.stringify(activeSavedPromptIds),
    );
  } catch {
    /* non-fatal */
  }
  renderSavedPrompts();
}

// The active project's active saved prompt (whether or not its tab is showing).
function activeSavedPrompt() {
  const id = activeSavedPromptIds[activeProjectId];
  return (id && savedPrompts.find((p) => p.id === id)) || null;
}

// What a saved prompt contributes to a run's prompt field: its text, or — for a
// structured format — the text compiled from its fields. The one place every run,
// import and preview gets a saved prompt's text from.
function exportSavedPromptText(p) {
  if (p.type === "minimax") return compileMinimax(p.minimax, p.refs || []);
  if (p.type === "minimax_t2v") return compileMinimaxT2V(p.minimax);
  return p.prompt || "";
}

// The structured formats: both keep their fields in p.minimax (the same shape), and
// differ only in what's compiled from them and which parts the form shows.
const isMmType = (t) => t === "minimax" || t === "minimax_t2v";
const MM_TYPE_LABEL = { minimax: "MiniMax H3", minimax_t2v: "MiniMax T2V" };

// --- MiniMax H3 prompt format ---------------------------------------------------
// A saved prompt of type "minimax" stores fields, not text, and is compiled into the
// six sections of MiniMax's full-reference rewrite format (VIDEO_PROMPT_WRITING_GUIDE_ref_en):
//   subject_definitions  — from the references' gallery key + definition (so a subject
//                          is described once, on its image), plus extra subjects that
//                          have no image
//   summary              — free text (the author writes the "[task type] …" prefix)
//   retention_analysis   — one line per subject, written under that subject in the
//                          form; "(appears in [Shot N])" is added from which shots
//                          mention the subject's <label>
//   detailed_description — a style opening, then [Shot 1] and each cut as
//                          "[Shot N] At MM:SS.mmm, …"
//   overall_soundscape, non_diegetic_music
// Stored shape (p.minimax):
//   { summary, style, shots: [{ at: seconds|null, text }],
//     subjects: [{ key, definition }], retention: { "<label>": "fully_preserved - …" },
//     soundscape, music }
const MM_SECTIONS = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "integrated_multimodal_description",
  "overall_soundscape",
  "non_diegetic_music",
];
const MM_REF_LABEL = { image: "Picture", video: "Video", audio: "Audio" };

function blankMinimax() {
  return {
    summary: "",
    style: "",
    shots: [{ at: null, text: "" }],
    subjects: [],
    retention: {},
    soundscape: "",
    music: "",
  };
}

// A MiniMax prompt in the current shape. Earlier ones kept the summary's task types as
// checkboxes (summaryTypes) and retention as { marker, note }; both fold into text.
function normalizeMinimax(mmIn) {
  const mm = { ...blankMinimax(), ...(mmIn || {}) };
  const types =
    Array.isArray(mm.summaryTypes) ? mm.summaryTypes.filter(Boolean) : [];
  if (
    types.length &&
    !String(mm.summary || "")
      .trimStart()
      .startsWith("[")
  ) {
    mm.summary = `[${types.join(" + ")}] ${mm.summary || ""}`.trim();
  }
  delete mm.summaryTypes;
  mm.retention = Object.fromEntries(
    Object.entries(mm.retention || {}).map(([k, v]) => [
      k,
      typeof v === "string" ? v : (
        `${v?.marker || ""}${v?.note ? ` - ${v.note}` : ""}`.trim()
      ),
    ]),
  );
  return mm;
}

// A subject key as the server stores it (see normalizeMediaKey): one lowercase word, no
// @ or <>. Lowercase so "GENie" on an image and "genie" in a prompt are one subject.
function normKey(k) {
  return String(k ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/^<|>$/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase()
    .slice(0, 40);
}

// 5 → "00:05.000", 62.5 → "01:02.500".
function fmtShotTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

// "5", "5.5", "00:05.000", "1:02.5" → seconds; null if unreadable.
function parseShotTime(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  return Number(m[1] || 0) * 60 + Number(m[2]);
}

// Cuts in playback order: Shot 1 (the opening, no time) stays first; the rest sort by
// time, untimed ones last, ties keeping their order. Returns the sorted array — the
// same one if it was already in order.
function sortedShots(shots) {
  const [first, ...cuts] = shots || [];
  if (!first) return [];
  const key = (s) => (s.at == null ? Infinity : s.at);
  const sorted = cuts
    .map((s, i) => [s, i])
    .sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1])
    .map((x) => x[0]);
  return sorted.every((s, i) => s === cuts[i]) ? shots : [first, ...sorted];
}

const joinList = (a) =>
  a.length < 2 ?
    a.join("")
  : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

// The subjects the prompt defines, in order: references first (grouped by key, so one
// subject can come from several files), then the extra subjects typed on the prompt.
// Each: { label, sources: ["<Picture 1>", …], definition, audio, fromRefs }.
// A reference with neither key nor definition defines nothing (it's still sent as media).
function minimaxSubjects(mm, refs) {
  const n = { image: 0, video: 0, audio: 0 };
  let anon = 0;
  const out = [];
  const byLabel = new Map();
  for (const r of refs) {
    if (r.missing) continue; // skipped on import too, so it takes no <Picture N> number
    const src = `<${MM_REF_LABEL[r.kind] || "Picture"} ${++n[r.kind]}>`;
    const key = normKey(r.key);
    const def = String(r.definition || "").trim();
    if (!key && !def) continue;
    if (!key && r.kind === "audio") {
      out.push({
        label: src,
        sources: [],
        definition: def,
        audio: true,
        fromRefs: true,
      });
      continue;
    }
    const label = key ? `<${key}>` : `<Subject ${++anon}>`;
    let s = byLabel.get(label);
    if (!s) {
      s = { label, sources: [], definition: "", audio: true, fromRefs: true };
      byLabel.set(label, s);
      out.push(s);
    }
    s.sources.push(src);
    if (r.kind !== "audio") s.audio = false;
    if (!s.definition && def) s.definition = def;
  }
  for (const x of mm.subjects || []) {
    const key = normKey(x.key);
    const def = String(x.definition || "").trim();
    if (!key && !def) continue;
    const label = key ? `<${key}>` : null;
    const existing = label && byLabel.get(label);
    if (existing) {
      // The same subject as a reference: a definition typed on this prompt wins over the
      // gallery file's (which stays the fallback for prompts that don't override it).
      if (def) existing.definition = def;
      existing.typed = true;
      continue;
    }
    const s = {
      label,
      sources: [],
      definition: def,
      audio: false,
      fromRefs: false,
    };
    if (label) byLabel.set(label, s);
    out.push(s);
  }
  // Only what's defined becomes a subject. A reference whose key has no definition
  // anywhere (e.g. a second image of a subject, cited as @manuela_sheet inside another
  // subject's definition) is just an @key token — it gets no line of its own.
  return out.filter((s) => String(s.definition || "").trim());
}

// A definition as the end of a sentence: closed with a full stop unless it already is.
const endSentence = (t) => (/[.!?…"”')\]]$/.test(t) ? t : `${t}.`);

// @key tokens: writing @genie anywhere in a MiniMax prompt refers to the reference
// file(s) with that key, and compiles to their current labels ("<Picture 1>", or
// "<Picture 1> and <Picture 2>" for a key on several files). Numbered like
// minimaxSubjects, so re-ordering the references keeps every @key on the right file.
function minimaxMediaTokens(refs) {
  const n = { image: 0, video: 0, audio: 0 };
  const map = new Map(); // key → ["<Picture 1>", …]
  for (const r of refs) {
    if (r.missing) continue;
    const src = `<${MM_REF_LABEL[r.kind] || "Picture"} ${++n[r.kind]}>`;
    const key = normKey(r.key);
    if (key) (map.get(key) || map.set(key, []).get(key)).push(src);
  }
  return map;
}

const MEDIA_TOKEN_RE = /(?<![\p{L}\p{N}_@])@([\p{L}\p{N}_-]+)/gu;
function resolveMediaTokens(text, tokens) {
  if (!tokens?.size) return String(text || "");
  return String(text || "").replace(MEDIA_TOKEN_RE, (m, k) => {
    const src = tokens.get(k.toLowerCase());
    return src ? joinList(src) : m; // an @word that isn't a reference key stays as written
  });
}

// A definition without a lead-in the line adds itself: "<label> is …", "<label>, seen in
// <Picture 1>, is …" or a bare "is …" (common when a whole line was pasted in).
function definitionBody(label, def) {
  let d = String(def || "").trim();
  if (label) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    d = d.replace(
      new RegExp(`^${esc}\\s*(?:,[^,]*,\\s*)?(?:is\\b)?\\s*`, "i"),
      "",
    );
  }
  return d.replace(/^is\s+/i, "").trim();
}

function minimaxSubjectLine(s, tokens = null) {
  if (!s.label) return resolveMediaTokens(s.definition, tokens); // typed without a key: written as-is
  const def = resolveMediaTokens(definitionBody(s.label, s.definition), tokens);
  if (!s.sources.length) return `${s.label} is ${endSentence(def)}`;
  // A definition that already names its files ("… seen in <Picture 1> …") is used as written.
  if (def && s.sources.every((x) => def.includes(x)))
    return `${s.label} is ${endSentence(def)}`;
  const verb =
    s.audio ? "heard in"
    : s.sources.some((x) => x.startsWith("<Audio")) ? "from"
    : "seen in";
  return def ?
      `${s.label}, ${verb} ${joinList(s.sources)}, is ${endSentence(def)}`
    : `${s.label} is ${verb} ${joinList(s.sources)}.`;
}

// The shots (1-based) that mention a subject — by its <label>, or by @key for a keyed
// subject (the reference token) — in any case: <GENie> is <genie>.
function minimaxAppearances(mm, label) {
  const l = label.toLowerCase();
  const key = /^<([\p{L}\p{N}_-]+)>$/u.exec(l)?.[1];
  const at =
    key ?
      new RegExp(`(?<![\\p{L}\\p{N}_@])@${key}(?![\\p{L}\\p{N}_-])`, "u")
    : null;
  return (mm.shots || []).flatMap((s, i) => {
    const t = String(s.text || "").toLowerCase();
    return t.includes(l) || (at && at.test(t)) ? [i + 1] : [];
  });
}

// One retention row per labelled subject: { label, audio, shots, text, line }. The
// author writes the text ("fully_preserved - …"); a subject with none is left out.
// @shots in a retention text: that subject's shots, "[Shot 1], [Shot 3]".
const SHOTS_TOKEN_RE = /(?<![\p{L}\p{N}_@])@shots(?![\p{L}\p{N}_-])/giu;

function minimaxRetention(mm, subjects, tokens = null) {
  return subjects
    .filter((s) => s.label)
    .map((s) => {
      const shots = s.audio ? [] : minimaxAppearances(mm, s.label);
      const list = shots.map((i) => `[Shot ${i}]`).join(", ");
      const raw = String(mm.retention?.[s.label] || "")
        .trim()
        .replace(SHOTS_TOKEN_RE, list || "no shots yet");
      const text = resolveMediaTokens(raw, tokens);
      const where = list ? ` (appears in ${list})` : "";
      return {
        label: s.label,
        audio: s.audio,
        shots,
        text,
        line: text ? `${s.label}${where}: ${text}` : null,
      };
    });
}

// "appears in [Shot 1], [Shot 3]" for the form.
function appearsText(r) {
  if (r.audio) return "audio";
  return r.shots.length ?
      `appears in ${r.shots.map((i) => `[Shot ${i}]`).join(", ")}`
    : "not in any shot yet";
}

function compileMinimax(mmIn, refs) {
  const mm = normalizeMinimax(mmIn);
  const subjects = minimaxSubjects(mm, refs);
  const tokens = minimaxMediaTokens(refs);
  const tok = (t) => resolveMediaTokens(String(t || "").trim(), tokens);
  mm.shots = sortedShots(mm.shots);
  const shots = mm.shots.map((s, i) => {
    const text = tok(s.text);
    return i === 0 ?
        `[Shot 1] ${text}`
      : `[Shot ${i + 1}] At ${fmtShotTime(s.at)}, ${text}`;
  });
  const section = (name, body) =>
    `${name}:\n${String(body || "").trim() || "N/A"}`;
  return [
    section(
      "subject_definitions",
      subjects.map((s) => minimaxSubjectLine(s, tokens)).join("\n"),
    ),
    section("summary", tok(mm.summary)),
    section(
      "retention_analysis",
      minimaxRetention(mm, subjects, tokens)
        .filter((r) => r.line)
        .map((r) => r.line)
        .join("\n"),
    ),
    section(
      "detailed_description",
      [tok(mm.style), ...shots].filter(Boolean).join("\n"),
    ),
    section("overall_soundscape", tok(mm.soundscape)),
    section("non_diegetic_music", tok(mm.music)),
  ].join("\n\n");
}

// A saved prompt of type "minimax_t2v" uses the same fields for MiniMax's text-to-video
// format (VIDEO_PROMPT_WRITING_GUIDE_base_en) — no references, so no subjects, summary
// or retention; just three fields, each "name: text", one paragraph apiece:
//   integrated_multimodal_description — "[Shot 1] <style> <opening>" then each cut as
//                                       "[Shot N] At MM:SS.mmm, …", all in one run
//   overall_soundscape, non_diegetic_music ("N/A" when empty)
function compileMinimaxT2V(mmIn) {
  const mm = normalizeMinimax(mmIn);
  const t = (x) => String(x || "").trim();
  const shots = sortedShots(mm.shots).map((s, i) =>
    i === 0 ?
      ["[Shot 1]", t(mm.style), t(s.text)].filter(Boolean).join(" ")
    : `[Shot ${i + 1}] At ${fmtShotTime(s.at)}, ${t(s.text)}`,
  );
  const field = (name, body) => `${name}: ${t(body) || "N/A"}`;
  return [
    field("integrated_multimodal_description", shots.join(" ")),
    field("overall_soundscape", mm.soundscape),
    field("non_diegetic_music", mm.music),
  ].join("\n\n");
}

// Best-effort: plain prompt text → MiniMax fields (for "Convert to MiniMax" and saving
// in that format). Understands the section headers, [Shot N] At MM:SS.mmm markers,
// "[task + type] summary" and retention lines. A subject line whose key already has a
// definition on a reference's gallery file isn't copied (the gallery one is used).
function parseMinimax(text, refs = []) {
  const mm = blankMinimax();
  text = String(text || "").replace(/\r\n/g, "\n");
  const na = (s) =>
    /^n\/?a$/i.test(String(s || "").trim()) ? "" : String(s || "").trim();

  const re = new RegExp(`^(${MM_SECTIONS.join("|")}):[ \\t]*`, "gm");
  const marks = [];
  let m;
  while ((m = re.exec(text)))
    marks.push({ name: m[1], start: m.index, body: re.lastIndex });
  const parts = {};
  marks.forEach((x, i) => {
    parts[x.name] = text
      .slice(x.body, i + 1 < marks.length ? marks[i + 1].start : text.length)
      .trim();
  });
  if (!marks.length) parts.detailed_description = text.trim();

  const refKeys = new Set(
    refs
      .filter((r) => normKey(r.key) && String(r.definition || "").trim())
      .map((r) => normKey(r.key)),
  );
  for (const line of na(parts.subject_definitions)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const lm = /^<([^>]+)>\s*(?:,[^,]*,\s*)?is\s+([\s\S]*)$/i.exec(line);
    if (!lm) {
      mm.subjects.push({ key: "", definition: line });
      continue;
    }
    if (/^(Picture|Video|Audio) \d+$/i.test(lm[1])) {
      mm.subjects.push({ key: "", definition: line });
      continue;
    }
    const key = normKey(lm[1]);
    if (!refKeys.has(key)) mm.subjects.push({ key, definition: lm[2].trim() });
  }

  mm.summary = na(parts.summary);

  // "<label> (appears in …): text" — the "appears in" part is regenerated, so it's dropped.
  for (const line of na(parts.retention_analysis)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const rm = /^(<[^>]+>)\s*(?:\([^)]*\))?\s*:\s*([\s\S]*)$/.exec(line);
    if (rm) mm.retention[rm[1]] = rm[2].trim();
  }

  const desc = na(
    parts.detailed_description || parts.integrated_multimodal_description,
  );
  const shotRe = /\[Shot (\d+)\]/g;
  const hits = [];
  while ((m = shotRe.exec(desc)))
    hits.push({ start: m.index, body: shotRe.lastIndex });
  if (hits.length) {
    mm.style = desc.slice(0, hits[0].start).trim();
    mm.shots = hits.map((h, i) => {
      let body = desc
        .slice(h.body, i + 1 < hits.length ? hits[i + 1].start : desc.length)
        .trim();
      let at = null;
      const tm = /^At\s+(\d+:\d+(?:\.\d+)?|\d+(?:\.\d+)?)\s*,\s*/i.exec(body);
      if (tm) {
        at = parseShotTime(tm[1]);
        body = body.slice(tm[0].length);
      }
      return { at: i === 0 ? null : (at ?? 0), text: body.trim() };
    });
  } else {
    // No shot markers: a first paragraph is the style opening, the rest is Shot 1 —
    // except that a paragraph opening "At MM:SS.mmm" starts a new shot (a cut).
    const paras = desc
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (paras.length > 1) mm.style = paras.shift();
    mm.shots = [{ at: null, text: "" }];
    for (const para of paras) {
      const tm = /^At\s+(\d+:\d+(?:\.\d+)?)\s*,?\s*/i.exec(para);
      if (tm) {
        mm.shots.push({
          at: parseShotTime(tm[1]),
          text: para.slice(tm[0].length).trim(),
        });
      } else {
        const cur = mm.shots[mm.shots.length - 1];
        cur.text = cur.text ? `${cur.text}\n\n${para}` : para;
      }
    }
  }
  mm.soundscape = na(parts.overall_soundscape);
  mm.music = na(parts.non_diegetic_music);
  mm.shots = sortedShots(mm.shots);
  return mm;
}

// The saved prompt Generate will use right now: only while the Saved Prompts tab is
// the one showing on the prompt field on screen. Null means "use the textarea".
function runSavedPrompt() {
  if (promptSource !== "saved" || !activePromptHost()) return null;
  return activeSavedPrompt();
}

// Stamped on the stored History input (never sent to a model) — what the server's
// auto-link reads.
function savedPromptStamp(p) {
  return { id: p.id, projectId: activeProjectId, title: p.title };
}

const savedPanel = document.createElement("div");
savedPanel.className = "saved-prompts hidden";
savedPanel.innerHTML =
  `<input type="search" class="sp-filter" placeholder="Filter saved prompts…" aria-label="Filter saved prompts" />` +
  `<div class="sp-toolbar"><button type="button" class="link-btn sp-new-mm">＋ New MiniMax prompt</button>` +
  `<button type="button" class="link-btn sp-new-t2v">＋ New MiniMax T2V prompt</button></div>` +
  `<p class="sp-run-note"></p>` +
  `<p class="dz-hint sp-empty"></p>` +
  `<div class="sp-list"></div>`;
const savedFilterEl = savedPanel.querySelector(".sp-filter");
const savedEmptyEl = savedPanel.querySelector(".sp-empty");
const savedRunNoteEl = savedPanel.querySelector(".sp-run-note");
// A blank MiniMax prompt with the form's current references and duration, opened for editing.
savedPanel.querySelector(".sp-new-mm").addEventListener("click", async () => {
  try {
    const draft = currentPromptDraft();
    const created = await promptsApi("/api/prompts", "POST", {
      projectId: activeProjectId,
      title: "New MiniMax prompt",
      type: "minimax",
      prompt: "",
      minimax: blankMinimax(),
      refs: draft.refs,
      duration: draft.duration,
    });
    await loadSavedPrompts();
    openPromptEditor(savedPrompts.find((p) => p.id === created.id) || created);
    peTitle.select();
  } catch (err) {
    alert(err.message || String(err));
  }
});
// A blank MiniMax text-to-video prompt (no references), with the form's duration.
savedPanel.querySelector(".sp-new-t2v").addEventListener("click", async () => {
  try {
    const created = await promptsApi("/api/prompts", "POST", {
      projectId: activeProjectId,
      title: "New MiniMax T2V prompt",
      type: "minimax_t2v",
      prompt: "",
      minimax: blankMinimax(),
      refs: [],
      duration: currentPromptDraft().duration,
    });
    await loadSavedPrompts();
    openPromptEditor(savedPrompts.find((p) => p.id === created.id) || created);
    peTitle.select();
  } catch (err) {
    alert(err.message || String(err));
  }
});
const savedListEl = savedPanel.querySelector(".sp-list");
savedFilterEl.addEventListener("input", () => {
  savedPromptsFilter = savedFilterEl.value.trim().toLowerCase();
  renderSavedPrompts();
});

// --- wildcards ----------------------------------------------------------------------
// Named lists shared by every project (wildcards.json on the server), grouped by
// category: { id, category, key, values: [...] }. A prompt writes %category:key% and
// each run gets one of the values at random — resolveWildcards, applied at Generate, so
// the prompt keeps its tokens and History records both the picks and the template.
// %category:key:1% also remembers its pick for the rest of that run: a later
// %category:key% reuses it (":0", the default, picks afresh every time — never a value
// that list already gave in the run, until they've all been used).
// Managed on the prompt field's third tab.
let wildcards = [];
let wildcardsFilter = "";
const WILDCARD_RE =
  /%([\p{L}\p{N}_-]+):([\p{L}\p{N}_-]+)(?::(1|0|true|false))?%/gu;
const wildcardToken = (w) => `%${w.category}:${w.key}%`;

// As the server stores a category or key (normalizeWildcardName).
function wildcardName(v) {
  return String(v ?? "")
    .trim()
    .replace(/%/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase()
    .slice(0, 60);
}

function findWildcard(category, key) {
  const c = String(category).toLowerCase();
  const k = String(key).toLowerCase();
  return wildcards.find((w) => w.category === c && w.key === k) || null;
}

const hasWildcards = (text) =>
  [...String(text ?? "").matchAll(WILDCARD_RE)].length > 0;
// Whether any of a list's values holds a token of its own.
const wildcardNests = (w) => (w.values || []).some(hasWildcards);

// A random value from the list, avoiding ones already drawn from it in this run (the
// same `memo`), so a token used twice gives two different values; once every value has
// been drawn, the whole list is back in play.
const wcDrawn = new WeakMap(); // memo → Map(id → Set of values drawn)
function wildcardPick(w, id, memo) {
  if (!wcDrawn.has(memo)) wcDrawn.set(memo, new Map());
  const drawn = wcDrawn.get(memo);
  if (!drawn.has(id)) drawn.set(id, new Set());
  const used = drawn.get(id);
  let pool = w.values.filter((v) => !used.has(v));
  if (!pool.length) {
    used.clear();
    pool = w.values;
  }
  const v = pool[Math.floor(Math.random() * pool.length)];
  used.add(v);
  return v;
}

// Swap every %category:key% for a random value from that list. `memo` holds the picks
// a :1 token asked to keep — share one Map across everything in a single run (every
// text field of a workflow). Values may hold tokens of their own, one level deep: a
// wildcard used inside another can't hold tokens itself (`parent` is the outer token),
// which also rules out loops. Throws on a token with no list, an empty one, or one
// nested too deep, so a run never sends a literal %…% to the model.
function resolveWildcards(text, memo = new Map(), parent = null) {
  const s = String(text ?? "");
  if (!s.includes("%")) return s;
  const missing = new Set();
  const out = s.replace(WILDCARD_RE, (m, c, k, flag) => {
    const w = findWildcard(c, k);
    if (!w || !w.values?.length) {
      missing.add(m);
      return m;
    }
    // Every value checked, not just the pick, so the error doesn't come and go at random.
    if (parent && wildcardNests(w)) {
      throw new Error(
        `${parent} uses ${m}, which holds wildcards of its own — wildcards can only be nested one level deep.`,
      );
    }
    const id = `${w.category}:${w.key}`;
    if (memo.has(id)) return memo.get(id);
    const raw = wildcardPick(w, id, memo);
    const v = parent ? raw : resolveWildcards(raw, memo, wildcardToken(w));
    if (flag === "1" || flag === "true") memo.set(id, v);
    return v;
  });
  if (missing.size) {
    const list = [...missing].join(", ");
    throw new Error(
      `Unknown or empty wildcard${missing.size > 1 ? "s" : ""}: ${list} — add ${missing.size > 1 ? "them" : "it"} on the Wildcards tab.`,
    );
  }
  return out;
}

async function loadWildcards() {
  try {
    const res = await fetch("/api/wildcards");
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || "Failed to load wildcards");
    wildcards = data.data || [];
  } catch (err) {
    console.error("Failed to load wildcards:", err);
  }
  renderWildcards();
  wcHlSyncAll(true);
}

const wildcardsPanel = document.createElement("div");
wildcardsPanel.className = "saved-prompts wildcards hidden";
wildcardsPanel.innerHTML =
  `<input type="search" class="sp-filter" placeholder="Filter wildcards…" aria-label="Filter wildcards" />` +
  `<div class="sp-toolbar"><button type="button" class="link-btn wc-new">＋ New wildcard</button></div>` +
  `<p class="sp-run-note wc-note">Write <code>%category:key%</code> in a prompt and each run picks one of its values at random. ` +
  `<code>%category:key:1%</code> keeps its pick: a later <code>%category:key%</code> in the same prompt reuses it. ` +
  `Click a token to copy it; ＋ Insert puts it in the Prompt tab's text.</p>` +
  `<p class="sp-run-note wc-source"></p>` +
  `<p class="dz-hint sp-empty wc-empty"></p>` +
  `<div class="wc-list"></div>`;
const wcFilterEl = wildcardsPanel.querySelector(".sp-filter");
const wcListEl = wildcardsPanel.querySelector(".wc-list");
const wcEmptyEl = wildcardsPanel.querySelector(".wc-empty");
wcFilterEl.addEventListener("input", () => {
  wildcardsFilter = wcFilterEl.value.trim().toLowerCase();
  renderWildcards();
});
wildcardsPanel
  .querySelector(".wc-new")
  .addEventListener("click", () => openWildcardEditor(null));

// Briefly swap a button's text (Copied / Inserted).
function flashText(el, text) {
  const was = el.dataset.label || el.textContent;
  el.dataset.label = was;
  el.textContent = text;
  clearTimeout(el._flash);
  el._flash = setTimeout(() => {
    el.textContent = was;
  }, 1200);
}

// Put text into the Prompt tab's textarea at its caret (the textarea keeps its caret
// while the tab is hidden), with a space before it when it would touch a word.
function insertIntoPrompt(text) {
  const ta = activePromptHost()?.textarea;
  if (!ta) return false;
  const a = ta.selectionStart ?? ta.value.length;
  const b = ta.selectionEnd ?? a;
  const before = ta.value.slice(0, a);
  const pad = before && !/\s$/.test(before) ? " " : "";
  ta.value = before + pad + text + ta.value.slice(b);
  const pos = (before + pad + text).length;
  ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

// Grouped by category (A–Z), keys A–Z within each.
function renderWildcards() {
  syncPromptTabs(); // the tab's count
  const q = wildcardsFilter;
  const shown = wildcards
    .filter(
      (w) =>
        !q ||
        `${w.category}:${w.key}\n${(w.values || []).join("\n")}`
          .toLowerCase()
          .includes(q),
    )
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.key.localeCompare(b.key),
    );
  wcFilterEl.classList.toggle("hidden", wildcards.length < 2 && !q);
  wcEmptyEl.textContent =
    wildcards.length ?
      "No wildcards match."
    : "No wildcards yet — ＋ New wildcard to make a list.";
  wcEmptyEl.classList.toggle("hidden", shown.length > 0);
  wcListEl.innerHTML = "";
  const groups = new Map();
  for (const w of shown)
    (groups.get(w.category) || groups.set(w.category, []).get(w.category)).push(
      w,
    );
  for (const [category, list] of groups) {
    const sec = document.createElement("section");
    sec.className = "wc-cat";
    const head = document.createElement("div");
    head.className = "wc-cat-head";
    const name = document.createElement("span");
    name.className = "wc-cat-name";
    name.textContent = category;
    const count = document.createElement("span");
    count.className = "hint";
    count.textContent = plural(list.length, "list");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "link-btn wc-cat-add";
    add.textContent = "＋ Add to " + category;
    add.addEventListener("click", () => openWildcardEditor(null, category));
    head.append(name, count, add);
    sec.appendChild(head);
    for (const w of list) sec.appendChild(makeWildcardRow(w));
    wcListEl.appendChild(sec);
  }
  syncWildcardSource();
}

// A list: its token (click to copy), value count, ＋ Insert, and a peek at the values.
// Clicking anywhere else opens the editor.
function makeWildcardRow(w) {
  const row = document.createElement("div");
  row.className = "sp-card wc-row";
  row.tabIndex = 0;
  row.title = "Edit this wildcard";
  row.addEventListener("click", () => openWildcardEditor(w));
  row.addEventListener("keydown", (e) => {
    if (e.target === row && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openWildcardEditor(w);
    }
  });
  const head = document.createElement("div");
  head.className = "wc-row-head";
  const token = document.createElement("button");
  token.type = "button";
  token.className = "wc-token";
  token.textContent = wildcardToken(w);
  token.title = "Copy the token";
  token.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(wildcardToken(w));
      flashText(token, "✓ Copied");
    } catch {
      flashText(token, "Copy failed");
    }
  });
  const count = document.createElement("span");
  count.className = "hint wc-count";
  count.textContent = plural((w.values || []).length, "value");
  const ins = document.createElement("button");
  ins.type = "button";
  ins.className = "link-btn wc-insert";
  ins.textContent = "＋ Insert";
  ins.title = "Put the token in the Prompt tab's text, at the cursor";
  ins.addEventListener("click", (e) => {
    e.stopPropagation();
    flashText(
      ins,
      insertIntoPrompt(wildcardToken(w)) ? "✓ Inserted" : "No prompt field",
    );
  });
  head.append(token, count, ins);
  const vals = document.createElement("div");
  vals.className = "sp-snippet wc-values";
  vals.textContent =
    (w.values || []).slice(0, 30).join(" · ") || "(empty — add values)";
  row.append(head, vals);
  return row;
}

// Which text Generate uses, since the Wildcards tab hides both the Prompt and the
// Saved Prompts view.
function syncWildcardSource() {
  const el = wildcardsPanel.querySelector(".wc-source");
  const p = activeSavedPrompt();
  el.textContent =
    promptSource === "saved" && p ?
      `▶ Generate uses the saved prompt “${p.title}”.`
    : "▶ Generate uses the Prompt tab's text.";
}

// --- wildcard editor ---
const wildcardModal = document.getElementById("wildcardModal");
const wcCategory = document.getElementById("wcCategory");
const wcKey = document.getElementById("wcKey");
const wcValues = document.getElementById("wcValues");
const wcTokenPreview = document.getElementById("wcTokenPreview");
const wcError = document.getElementById("wcError");
const wcTryOut = document.getElementById("wcTryOut");
let wcEditing = null; // { w: wildcard|null (new), start: "category|key|values" }

const wcFormState = () =>
  `${wcCategory.value}\n${wcKey.value}\n${wcValues.value}`;
const wcLines = () =>
  wcValues.value
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

function openWildcardEditor(w, category = "") {
  wcCategory.value = w?.category || category;
  wcKey.value = w?.key || "";
  wcValues.value = (w?.values || []).join("\n");
  document.getElementById("wcHeading").textContent =
    w ? "Edit wildcard" : "New wildcard";
  document.getElementById("wcDelete").classList.toggle("hidden", !w);
  document.getElementById("wcCategoryList").innerHTML = [
    ...new Set(wildcards.map((x) => x.category)),
  ]
    .sort()
    .map((c) => `<option value="${escapeHtmlJs(c)}"></option>`)
    .join("");
  wcEditing = { w, start: wcFormState() };
  hide(wcError);
  wcTryOut.textContent = "";
  syncWildcardPreview();
  show(wildcardModal);
  (w ? wcValues
  : category ? wcKey
  : wcCategory
  ).focus();
}

function syncWildcardPreview() {
  const c = wildcardName(wcCategory.value) || "category";
  const k = wildcardName(wcKey.value) || "key";
  wcTokenPreview.innerHTML = `<code>%${escapeHtmlJs(c)}:${escapeHtmlJs(k)}%</code> · ${plural(wcLines().length, "value")}`;
}
[wcCategory, wcKey, wcValues].forEach((el) =>
  el.addEventListener("input", syncWildcardPreview),
);

function closeWildcardEditor({ force = false } = {}) {
  if (!wcEditing) return;
  if (
    !force &&
    wcFormState() !== wcEditing.start &&
    !confirm("Discard your changes to this wildcard?")
  )
    return;
  wcEditing = null;
  hide(wildcardModal);
}

// Why saving this list would nest wildcards more than one level deep, or "" if it wouldn't.
function wildcardNestProblem(category, key, values) {
  const self = `%${category}:${key}%`;
  const refs = (vals) => vals.flatMap((v) => [...v.matchAll(WILDCARD_RE)]);
  const refName = ([, c, k]) => `%${wildcardName(c)}:${wildcardName(k)}%`;
  const tokens = refs(values);
  for (const t of tokens) {
    if (refName(t) === self) return `${self} can't use itself.`;
    const w = findWildcard(t[1], t[2]);
    if (w && wildcardNests(w)) {
      return `${t[0]} holds wildcards of its own, so it can't be used here — wildcards can only be nested one level deep.`;
    }
  }
  if (!tokens.length) return "";
  // This list now holds tokens, so no other list may use it.
  const user = wildcards.find(
    (w) =>
      w.id !== wcEditing?.w?.id &&
      refs(w.values || []).some((t) => refName(t) === self),
  );
  return user ?
      `${wildcardToken(user)} uses ${self}, so ${self} can't hold wildcards — they can only be nested one level deep.`
    : "";
}

async function saveWildcard() {
  if (!wcEditing) return;
  const body = {
    category: wcCategory.value,
    key: wcKey.value,
    values: wcLines(),
  };
  const problem = wildcardNestProblem(
    wildcardName(body.category),
    wildcardName(body.key),
    body.values,
  );
  if (problem) {
    wcError.textContent = problem;
    show(wcError);
    return;
  }
  const btn = document.getElementById("wcSave");
  btn.disabled = true;
  try {
    const w = wcEditing.w;
    await promptsApi(
      w ? `/api/wildcards/${encodeURIComponent(w.id)}` : "/api/wildcards",
      w ? "PUT" : "POST",
      body,
    );
    closeWildcardEditor({ force: true });
    await loadWildcards();
  } catch (err) {
    wcError.textContent = err.message || String(err);
    show(wcError);
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("wcSave").addEventListener("click", saveWildcard);
document
  .getElementById("wcCancel")
  .addEventListener("click", () => closeWildcardEditor());
document.getElementById("wcDelete").addEventListener("click", async () => {
  const w = wcEditing?.w;
  if (
    !w ||
    !confirm(
      `Delete ${wildcardToken(w)}?\n\nPrompts that use it will stop at Generate until it's back.`,
    )
  )
    return;
  try {
    await promptsApi(`/api/wildcards/${encodeURIComponent(w.id)}`, "DELETE");
    closeWildcardEditor({ force: true });
    await loadWildcards();
  } catch (err) {
    wcError.textContent = err.message || String(err);
    show(wcError);
  }
});
// A sample pick from the values as typed (their own tokens resolved against the saved lists).
document.getElementById("wcTry").addEventListener("click", () => {
  const lines = wcLines();
  if (!lines.length) {
    wcTryOut.textContent = "No values yet.";
    return;
  }
  try {
    const self = `%${wildcardName(wcCategory.value) || "category"}:${wildcardName(wcKey.value) || "key"}%`;
    wcTryOut.textContent = `→ ${resolveWildcards(lines[Math.floor(Math.random() * lines.length)], new Map(), self)}`;
  } catch (err) {
    wcTryOut.textContent = err.message;
  }
});
wildcardModal.addEventListener("click", (e) => {
  if (e.target === wildcardModal) closeWildcardEditor();
});
wildcardModal.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeWildcardEditor();
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveWildcard();
  }
  if (e.key === "Enter" && e.target.tagName === "INPUT") {
    e.preventDefault();
    saveWildcard();
  }
});

// --- wildcard autocomplete ---
// In any textarea, typing % (not straight after a letter or digit, so "50%" and a
// token's closing % don't count) opens a list of wildcards: categories first while
// there's no colon ("modern:" → keep typing), then category:key matches, prefix
// matches first. ↑/↓ move, Enter or Tab takes one, Esc closes. Taking a list writes
// the whole %category:key%, replacing what was typed of it.
const wcAc = { el: null, ta: null, start: 0, items: [], index: 0 };
const WC_AC_FRAGMENT =
  /(^|[^\p{L}\p{N}_%])%([\p{L}\p{N}_-]*)(?::([\p{L}\p{N}_-]*))?$/u;

function wcAcEl() {
  if (!wcAc.el) {
    wcAc.el = document.createElement("div");
    wcAc.el.className = "wc-ac hidden";
    wcAc.el.setAttribute("role", "listbox");
    // mousedown, not click: the textarea keeps focus (and its caret).
    wcAc.el.addEventListener("mousedown", (e) => {
      const opt = e.target.closest(".wc-ac-item");
      if (!opt) return;
      e.preventDefault();
      wcAcAccept(Number(opt.dataset.i));
    });
    document.body.appendChild(wcAc.el);
  }
  return wcAc.el;
}

function wcAcClose() {
  wcAc.ta = null;
  wcAc.items = [];
  wcAc.el?.classList.add("hidden");
}

// What to offer for the fragment before the caret, or [] for nothing.
function wcAcItems(cat, key) {
  const rank = (name, q) =>
    !q ? 0
    : name.startsWith(q) ? 0
    : name.includes(q) ? 1
    : -1;
  const byRank = (a, b) => a.r - b.r || a.label.localeCompare(b.label);
  const lists = (w) => ({
    label: wildcardToken(w),
    insert: wildcardToken(w),
    hint: (w.values || []).slice(0, 4).join(" · "),
  });
  if (key == null) {
    // No colon yet: matching categories, then lists whose key (or category) matches.
    const q = cat.toLowerCase();
    const cats = [...new Set(wildcards.map((w) => w.category))]
      .map((c) => ({ c, r: rank(c, q) }))
      .filter((x) => x.r >= 0)
      .map((x) => ({
        r: x.r,
        label: `%${x.c}:`,
        insert: `%${x.c}:`,
        hint: plural(
          wildcards.filter((w) => w.category === x.c).length,
          "list",
        ),
        more: true,
      }))
      .sort(byRank);
    const keys =
      q ?
        wildcards
          .map((w) => ({
            w,
            r: Math.min(
              ...[rank(w.key, q), rank(w.category, q)].map((r) =>
                r < 0 ? 9 : r,
              ),
            ),
          }))
          .filter((x) => x.r < 9)
          .map((x) => ({ r: x.r, ...lists(x.w) }))
          .sort(byRank)
      : [];
    return [...cats, ...keys].slice(0, 12);
  }
  const c = cat.toLowerCase();
  const q = key.toLowerCase();
  return wildcards
    .filter((w) => w.category === c)
    .map((w) => ({ w, r: rank(w.key, q) }))
    .filter((x) => x.r >= 0)
    .map((x) => ({ r: x.r, ...lists(x.w) }))
    .sort(byRank)
    .slice(0, 12);
}

function wcAcUpdate(ta) {
  if (ta.selectionStart !== ta.selectionEnd || !wildcards.length)
    return wcAcClose();
  const before = ta.value.slice(0, ta.selectionStart);
  const m = WC_AC_FRAGMENT.exec(before);
  if (!m) return wcAcClose();
  const items = wcAcItems(m[2], m[3]);
  if (!items.length) return wcAcClose();
  const same =
    wcAc.ta === ta &&
    wcAc.items.map((x) => x.label).join() === items.map((x) => x.label).join();
  wcAc.ta = ta;
  wcAc.start = before.length - m[0].length + m[1].length; // the % itself
  wcAc.items = items;
  if (!same) wcAc.index = 0;
  wcAcRender();
}

function wcAcRender() {
  const el = wcAcEl();
  el.innerHTML = "";
  wcAc.items.forEach((it, i) => {
    const opt = document.createElement("div");
    opt.className = "wc-ac-item" + (i === wcAc.index ? " on" : "");
    opt.dataset.i = String(i);
    opt.setAttribute("role", "option");
    const label = document.createElement("code");
    label.textContent = it.label;
    const hint = document.createElement("span");
    hint.className = "wc-ac-hint";
    hint.textContent = it.hint;
    opt.append(label, hint);
    el.appendChild(opt);
  });
  el.classList.remove("hidden");
  // Just under the caret, kept on screen.
  const { left, top, height } = caretRect(wcAc.ta, wcAc.ta.selectionStart);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const x = Math.max(8, Math.min(left, innerWidth - w - 8));
  const y = top + height + 4 + h > innerHeight ? top - h - 4 : top + height + 4;
  el.style.left = `${x}px`;
  el.style.top = `${Math.max(8, y)}px`;
  el.querySelector(".on")?.scrollIntoView({ block: "nearest" });
}

// Replace the typed fragment (and any rest of the same token after the caret) with
// the choice. execCommand keeps the textarea's undo history and fires "input".
function wcAcAccept(i) {
  const it = wcAc.items[i];
  const ta = wcAc.ta;
  if (!it || !ta) return;
  const rest = /^[\p{L}\p{N}_:-]*%?/u.exec(
    ta.value.slice(ta.selectionStart),
  )[0];
  ta.focus();
  ta.setSelectionRange(
    wcAc.start,
    ta.selectionStart + (it.more ? 0 : rest.length),
  );
  if (!document.execCommand("insertText", false, it.insert)) {
    ta.setRangeText(it.insert, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (it.more)
    wcAcUpdate(ta); // a category: go on to its lists
  else wcAcClose();
}

// The caret's box in viewport coordinates, measured on a hidden copy of the textarea.
function caretRect(ta, pos) {
  const cs = getComputedStyle(ta);
  const div = document.createElement("div");
  for (const p of [
    "boxSizing",
    "width",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "tabSize",
  ])
    div.style[p] = cs[p];
  Object.assign(div.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    borderStyle: "solid",
  });
  // As wide as the text area really is — fractional, and without a scrollbar's width —
  // or long text wraps differently from the textarea.
  div.style.boxSizing = "border-box";
  const borders =
    parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  div.style.width = `${ta.getBoundingClientRect().width - (ta.offsetWidth - ta.clientWidth) + borders}px`;
  div.textContent = ta.value.slice(0, pos);
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  div.appendChild(mark);
  document.body.appendChild(div);
  const r = ta.getBoundingClientRect();
  const out = {
    left: r.left + mark.offsetLeft - ta.scrollLeft,
    top: r.top + mark.offsetTop - ta.scrollTop,
    height: mark.offsetHeight || parseFloat(cs.lineHeight) || 16,
  };
  div.remove();
  return out;
}

document.addEventListener("input", (e) => {
  if (e.target instanceof HTMLTextAreaElement) wcAcUpdate(e.target);
});
document.addEventListener(
  "keydown",
  (e) => {
    if (!wcAc.ta || e.target !== wcAc.ta) return;
    const n = wcAc.items.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      wcAc.index = (wcAc.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      wcAcRender();
    } else if (
      (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) ||
      e.key === "Tab"
    ) {
      wcAcAccept(wcAc.index);
    } else if (e.key === "Escape") {
      wcAcClose();
    } else {
      return;
    }
    // Handled here: not a newline, focus move, or a modal's Esc.
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);
document.addEventListener("focusout", (e) => {
  if (e.target === wcAc.ta) wcAcClose();
});
document.addEventListener("click", (e) => {
  if (wcAc.ta && e.target !== wcAc.ta && !wcAc.el?.contains(e.target))
    wcAcClose();
});
window.addEventListener(
  "scroll",
  (e) => {
    if (!wcAc.el?.contains(e.target)) wcAcClose();
  },
  true,
);
window.addEventListener("resize", () => wcAcClose());

// --- wildcard highlighting ---
// A textarea can't colour words, so each one gets a backdrop: an absolutely placed
// sibling, lined up on the textarea's text box, that repeats the text invisibly with
// every %category:key% wrapped in a <mark> (tinted if the list exists, red if not).
// The textarea turns see-through (the backdrop carries its background) only while its
// text has a token, so an ordinary textarea is untouched. Sibling, not a wrapper:
// several rules style `… > textarea`. Kept in step on input, scroll, resize, and a
// light poll that catches code setting .value and fields being shown or hidden.
const wcHl = new Map(); // textarea → { back, inner, text, geo }
// iOS Safari insets a textarea's text 3px each side, beyond its padding (and it can't
// be styled away), so the backdrop adds the same or its lines wrap differently.
const IS_IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const WC_HL_IOS_INSET = IS_IOS ? 3 : 0;

// iOS zooms in on any field whose text is under 16px when it's tapped, and stays zoomed.
// maximum-scale stops that; iOS still lets the user pinch-zoom regardless.
if (IS_IOS) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, maximum-scale=1.0",
    );
}

function wcHlAttach(ta) {
  if (wcHl.has(ta) || ta.closest(".wc-ac")) return;
  const back = document.createElement("div");
  back.className = "wc-hl hidden";
  back.setAttribute("aria-hidden", "true");
  const inner = document.createElement("div");
  inner.className = "wc-hl-text";
  back.appendChild(inner);
  wcHl.set(ta, { back, inner, text: null, geo: "" });
  ta.addEventListener("input", () => wcHlSync(ta));
  ta.addEventListener("scroll", () => wcHlScroll(ta));
  wcHlSync(ta);
}

function wcHlHtml(text) {
  let html = "";
  let last = 0;
  for (const m of text.matchAll(WILDCARD_RE)) {
    const w = findWildcard(m[1], m[2]);
    const ok = !!w?.values?.length;
    html += escapeHtmlJs(text.slice(last, m.index));
    html += `<mark class="${ok ? "ok" : "bad"}">${escapeHtmlJs(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  // A trailing newline needs something after it to take up its line.
  return html + escapeHtmlJs(text.slice(last)) + "\u200b";
}

function wcHlSync(ta, force = false) {
  const st = wcHl.get(ta);
  if (!st) return;
  if (!ta.isConnected) {
    st.back.remove();
    wcHl.delete(ta);
    return;
  }
  const on = hasWildcards(ta.value) && ta.offsetParent !== null;
  ta.classList.toggle("wc-hl-on", on);
  st.back.classList.toggle("hidden", !on);
  if (!on) return;
  if (st.back.nextSibling !== ta) ta.before(st.back);
  if (force || st.text !== ta.value) {
    st.text = ta.value;
    st.inner.innerHTML = wcHlHtml(ta.value);
  }
  // Lined up on the textarea: the backdrop covers its border box (with its background
  // and corners); the text box sits inside the border, as wide as the text area
  // (clientWidth leaves out a scrollbar), with the same padding and font.
  // Exact (fractional) width: a rounded one can wrap a long line differently.
  const exactW = ta.getBoundingClientRect().width;
  const geo = [exactW, ta.offsetHeight, ta.clientWidth].join();
  if (force || st.geo !== geo) {
    st.geo = geo;
    const cs = getComputedStyle(ta);
    Object.assign(st.back.style, {
      width: `${exactW}px`,
      height: `${ta.offsetHeight}px`,
      borderRadius: cs.borderRadius,
      background: ta.dataset.wcBg || cs.backgroundColor,
    });
    const s = st.inner.style;
    s.left = `${ta.clientLeft}px`;
    s.top = `${ta.clientTop}px`;
    s.width = `${exactW - (ta.offsetWidth - ta.clientWidth)}px`; // less borders and scrollbar
    for (const p of [
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "letterSpacing",
      "lineHeight",
      "textTransform",
      "textIndent",
      "wordSpacing",
      "tabSize",
      "wordBreak",
    ])
      s[p] = cs[p];
    if (WC_HL_IOS_INSET) {
      s.paddingLeft = `${parseFloat(cs.paddingLeft) + WC_HL_IOS_INSET}px`;
      s.paddingRight = `${parseFloat(cs.paddingRight) + WC_HL_IOS_INSET}px`;
    }
  }
  // Placed by where both are on screen, not by offsetLeft/Top: in a scrolling box (the
  // editor modal) the backdrop's containing block isn't the textarea's offsetParent.
  const tr = ta.getBoundingClientRect();
  const br = st.back.getBoundingClientRect();
  const dx = tr.left - br.left;
  const dy = tr.top - br.top;
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    st.back.style.left = `${(parseFloat(st.back.style.left) || 0) + dx}px`;
    st.back.style.top = `${(parseFloat(st.back.style.top) || 0) + dy}px`;
  }
  wcHlScroll(ta);
}

function wcHlScroll(ta) {
  const st = wcHl.get(ta);
  if (st)
    st.inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
}

// Remember each textarea's own background before it's made see-through.
function wcHlRemember(ta) {
  if (!ta.dataset.wcBg) ta.dataset.wcBg = getComputedStyle(ta).backgroundColor;
}

function wcHlSyncAll(force = false) {
  for (const ta of [...wcHl.keys()]) wcHlSync(ta, force);
}

function wcHlScan(root) {
  if (root instanceof HTMLTextAreaElement) {
    wcHlRemember(root);
    wcHlAttach(root);
  } else
    root.querySelectorAll?.("textarea").forEach((ta) => {
      wcHlRemember(ta);
      wcHlAttach(ta);
    });
}
wcHlScan(document.body);
new MutationObserver((muts) => {
  for (const m of muts)
    for (const n of m.addedNodes) if (n.nodeType === 1) wcHlScan(n);
}).observe(document.body, { childList: true, subtree: true });
new ResizeObserver(() => wcHlSyncAll()).observe(document.body);
window.addEventListener("resize", () => wcHlSyncAll());
// Any scroll (the page, a modal) can move a textarea against its backdrop's frame.
let wcHlFrame = 0;
window.addEventListener(
  "scroll",
  () => {
    if (!wcHlFrame)
      wcHlFrame = requestAnimationFrame(() => {
        wcHlFrame = 0;
        wcHlSyncAll();
      });
  },
  true,
);
setInterval(() => wcHlSyncAll(), 400);

// Turn a prompt field's head into Prompt / Saved Prompts / Wildcards tabs and add the Save button.
// `labelEl` (the field's label, if it has one) becomes the first tab; `keep` are nodes
// from the old label that stay beside the tabs (the kie.ai character-cap hint).
function installPromptTools({
  field,
  head,
  textarea,
  labelEl = null,
  labelText = "Prompt",
  keep = [],
}) {
  const tabsEl = document.createElement("span");
  tabsEl.className = "prompt-tabs";
  tabsEl.setAttribute("role", "tablist");
  const mkTab = (tab, text) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "prompt-tab";
    b.setAttribute("role", "tab");
    b.dataset.tab = tab;
    b.textContent = text;
    b.addEventListener("click", () => setPromptTab(tab));
    tabsEl.appendChild(b);
    return b;
  };
  const tabs = {
    prompt: mkTab("prompt", labelText),
    saved: mkTab("saved", "Saved Prompts"),
    wildcards: mkTab("wildcards", "Wildcards"),
  };
  for (const n of keep) tabsEl.appendChild(n);
  if (labelEl) labelEl.replaceWith(tabsEl);
  else head.prepend(tabsEl);

  let tools = head.querySelector(".field-head-tools");
  if (!tools) {
    tools = document.createElement("span");
    tools.className = "field-head-tools";
    head.appendChild(tools);
  }
  const save = document.createElement("button");
  save.type = "button";
  save.className = "link-btn save-prompt-btn";
  save.textContent = "💾 Save prompt";
  save.title =
    "Save this prompt, its reference media and duration to the project's Saved Prompts";
  save.addEventListener("click", openSavePrompt);
  tools.prepend(save);

  // Drop hosts whose field a workflow re-render threw away.
  for (let i = promptHosts.length - 1; i >= 0; i--) {
    if (!promptHosts[i].field.isConnected) promptHosts.splice(i, 1);
  }
  promptHosts.push({ field, textarea, tabs });
  syncPromptTabs();
}

// The prompt field on screen: the kie.ai one, or the active workflow's main prompt.
function activePromptHost() {
  return (
    promptHosts.find(
      (h) => h.field.isConnected && !h.field.closest(".hidden"),
    ) || null
  );
}

function setPromptTab(tab) {
  promptTab = tab;
  if (tab !== "wildcards") promptSource = tab;
  try {
    localStorage.setItem(PROMPT_TAB_KEY, tab);
    localStorage.setItem(PROMPT_SOURCE_KEY, promptSource);
  } catch {
    /* non-fatal */
  }
  syncPromptTabs();
  if (tab === "saved") loadSavedPrompts(); // pick up gallery moves/renames since the last load
  if (tab === "wildcards") loadWildcards();
}

// Paint every prompt field's tabs and put the cards panel in the one on screen.
function syncPromptTabs() {
  const label = `Saved Prompts${savedPrompts.length ? ` (${savedPrompts.length})` : ""}`;
  for (const h of promptHosts) {
    for (const [tab, btn] of Object.entries(h.tabs)) {
      btn.classList.toggle("active", tab === promptTab);
      btn.setAttribute("aria-selected", String(tab === promptTab));
    }
    h.tabs.saved.textContent = label;
    h.tabs.wildcards.textContent = `Wildcards${wildcards.length ? ` (${wildcards.length})` : ""}`;
    h.textarea.classList.toggle("hidden", promptTab !== "prompt");
  }
  const host = activePromptHost();
  if (host && savedPanel.parentElement !== host.field)
    host.field.appendChild(savedPanel);
  if (host && wildcardsPanel.parentElement !== host.field)
    host.field.appendChild(wildcardsPanel);
  savedPanel.classList.toggle("hidden", promptTab !== "saved" || !host);
  wildcardsPanel.classList.toggle("hidden", promptTab !== "wildcards" || !host);
  syncGenerateLabel();
}

installPromptTools({
  field: document.getElementById("promptField"),
  head: document.querySelector("#promptField .field-head"),
  textarea: promptEl,
  labelEl: document.getElementById("promptLabel"),
  keep: [promptCapHint],
});

loadWildcards();

async function loadSavedPrompts() {
  const seq = ++savedPromptsSeq;
  const projectId = activeProjectId;
  try {
    const res = await fetch(
      `/api/prompts?projectId=${encodeURIComponent(projectId)}`,
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || "Failed to load saved prompts");
    if (seq !== savedPromptsSeq) return;
    savedPrompts = data.data || [];
  } catch (err) {
    console.error("Failed to load saved prompts:", err);
    if (seq !== savedPromptsSeq) return;
    savedPrompts = [];
  }
  // Other projects' lists may have changed too (a move/copy lands there).
  projectPromptsCache.clear();
  projectPromptsCache.set(projectId, Promise.resolve(savedPrompts));
  renderSavedPrompts();
  refreshHistoryPromptLinks();
}

// Saved prompts of any project (History can show other projects' cards), fetched once
// and cached until the next loadSavedPrompts.
const projectPromptsCache = new Map(); // projectId → Promise<prompt[]>
function getProjectPrompts(projectId) {
  if (!projectPromptsCache.has(projectId)) {
    projectPromptsCache.set(
      projectId,
      fetch(`/api/prompts?projectId=${encodeURIComponent(projectId)}`)
        .then((r) => r.json())
        .then((d) => d.data || [])
        .catch(() => []),
    );
  }
  return projectPromptsCache.get(projectId);
}

// --- History ↔ saved prompt ---
// A History card's 📌 dropdown links its output to one of its project's saved prompts
// (the output becomes that prompt card's thumbnail). One card per prompt: linking a new
// take replaces the prompt's old one, which is why every dropdown refreshes after a change.
// `onLinked(prompt|null)` runs after every refresh, so the card can show or hide what
// depends on the link (Edit prompt, and what Re-import uses).
function makeHistoryPromptLink(entry, onLinked = () => {}) {
  const projectId = entry.projectId || "default";
  const sel = document.createElement("select");
  sel.className = "hist-project hist-prompt-link";
  sel.appendChild(new Option("📌 Saved prompt…", ""));
  sel.disabled = true;
  sel.refill = async () => {
    const list = await getProjectPrompts(projectId);
    const linked = list.find((p) => p.historyId === entry.id);
    sel.innerHTML = "";
    const first = new Option(
      linked ? "✕ Unlink saved prompt"
      : list.length ? "📌 Link to saved prompt…"
      : "📌 No saved prompts",
      "",
    );
    sel.appendChild(first);
    for (const p of list) sel.appendChild(new Option(`📌 ${p.title}`, p.id));
    sel.value = linked?.id || "";
    sel.disabled = !list.length;
    sel.classList.toggle("linked", !!linked);
    sel.title =
      linked ?
        `Linked to saved prompt "${linked.title}" — this output is its thumbnail`
      : "Link this output to a saved prompt — it becomes that prompt card's thumbnail";
    onLinked(linked || null);
  };
  sel.addEventListener("change", async () => {
    sel.disabled = true;
    try {
      await promptsApi("/api/prompts/link", "POST", {
        projectId,
        historyId: entry.id,
        promptId: sel.value || null,
      });
      projectPromptsCache.delete(projectId);
      if (projectId === activeProjectId)
        await loadSavedPrompts(); // refreshes the dropdowns too
      else refreshHistoryPromptLinks();
    } catch (err) {
      alert(err.message || String(err));
      sel.refill();
    }
  });
  sel.refill();
  return sel;
}

function refreshHistoryPromptLinks() {
  historyEl.querySelectorAll(".hist-prompt-link").forEach((s) => s.refill?.());
}

// JSON request helper for the prompts API: throws the server's message on failure.
async function promptsApi(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || `Request failed (${res.status})`);
  return data.data;
}

// The duration the form would generate: the kie.ai field, or a ComfyUI workflow's
// duration/seconds control. Null when the model has none (e.g. Seedream images).
function currentDuration() {
  if (isComfy()) {
    const f = comfyFields.find(
      (c) =>
        /duration|seconds/i.test(c.name || "") && typeof c.peek === "function",
    );
    const v = f ? Number(f.peek()) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  if (document.getElementById("durationField").classList.contains("hidden"))
    return null;
  const v = Number(document.getElementById("duration").value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function setCurrentDuration(seconds) {
  if (!(seconds > 0)) return;
  if (isComfy()) {
    comfyFields
      .find(
        (c) =>
          /duration|seconds/i.test(c.name || "") && typeof c.set === "function",
      )
      ?.set(seconds);
    return;
  }
  const el = document.getElementById("duration");
  el.value = Math.min(
    Math.max(seconds, Number(el.min) || 1),
    Number(el.max) || seconds,
  );
  updateEstimate();
}

// What Save would store, read from the form on screen.
function currentPromptDraft() {
  const snap = snapshotCarry();
  const refs = CARRY_KINDS.flatMap((kind) =>
    (snap.media[kind] || []).map((m) => ({
      id: m.id,
      kind,
      name: m.name,
      tail: m.tail || 0,
    })),
  );
  return {
    prompt: String(snap.prompt ?? ""),
    refs,
    duration: currentDuration(),
    urlOnly: snap.urlOnly,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function refSummary(refs) {
  const counts = { image: 0, video: 0, audio: 0 };
  for (const r of refs) counts[r.kind] = (counts[r.kind] || 0) + 1;
  const parts = [];
  if (counts.image) parts.push(plural(counts.image, "image"));
  if (counts.video) parts.push(plural(counts.video, "video"));
  if (counts.audio) parts.push(`${counts.audio} audio`);
  return parts.join(", ");
}

// --- save dialog ---
const savePromptModal = document.getElementById("savePromptModal");
const savePromptTitle = document.getElementById("savePromptTitle");
const savePromptSummary = document.getElementById("savePromptSummary");
const savePromptWarn = document.getElementById("savePromptWarn");
const savePromptConfirm = document.getElementById("savePromptConfirm");
const savePromptFormat = document.getElementById("savePromptFormat");
let pendingSave = null;

function openSavePrompt() {
  const draft = currentPromptDraft();
  if (!draft.prompt.trim() && !draft.refs.length) {
    setError("Nothing to save yet — write a prompt first.");
    return;
  }
  pendingSave = draft;
  // Text already laid out in MiniMax's sections is offered as a MiniMax prompt.
  savePromptFormat.value =
    /^(subject_definitions|detailed_description):/m.test(draft.prompt) ?
      "minimax"
    : /^integrated_multimodal_description:/m.test(draft.prompt) ? "minimax_t2v"
    : "default";
  const firstLine = draft.prompt.trim().split(/\n/)[0].replace(/\s+/g, " ");
  savePromptTitle.value =
    firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
  const bits = [
    `${draft.prompt.length.toLocaleString()} characters`,
    refSummary(draft.refs) || "no references",
    draft.duration ? `${draft.duration}s` : null,
  ].filter(Boolean);
  savePromptSummary.textContent = `${projectName(activeProjectId)} · ${bits.join(" · ")}`;
  savePromptWarn.textContent =
    draft.urlOnly ?
      `${plural(draft.urlOnly, "URL reference")} can't be saved (only files saved in the gallery can).`
    : "";
  savePromptWarn.classList.toggle("hidden", !draft.urlOnly);
  show(savePromptModal);
  savePromptTitle.focus();
  savePromptTitle.select();
}

function closeSavePrompt() {
  pendingSave = null;
  hide(savePromptModal);
}

async function confirmSavePrompt() {
  if (!pendingSave) return;
  const title = savePromptTitle.value.trim();
  if (!title) {
    savePromptTitle.focus();
    return;
  }
  savePromptConfirm.disabled = true;
  try {
    const { prompt, refs, duration } = pendingSave;
    const body = {
      projectId: activeProjectId,
      title,
      prompt,
      refs,
      duration,
      type: "default",
    };
    if (savePromptFormat.value === "minimax") {
      // Split the text into MiniMax's fields; subject lines for references that already
      // have a gallery definition aren't copied (that definition is used instead).
      const byId = new Map(galleryItems.map((g) => [g.id, g]));
      const withSubjects = refs.map((r) => ({
        ...r,
        key: byId.get(r.id)?.key || "",
        definition: byId.get(r.id)?.definition || "",
      }));
      Object.assign(body, {
        type: "minimax",
        prompt: "",
        minimax: parseMinimax(prompt, withSubjects),
      });
    } else if (savePromptFormat.value === "minimax_t2v") {
      Object.assign(body, {
        type: "minimax_t2v",
        prompt: "",
        refs: [],
        minimax: parseMinimax(prompt),
      });
    }
    await promptsApi("/api/prompts", "POST", body);
    closeSavePrompt();
    await loadSavedPrompts();
    flashSaveButton();
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    savePromptConfirm.disabled = false;
  }
}

function flashSaveButton() {
  const btn = activePromptHost()?.field.querySelector(".save-prompt-btn");
  if (!btn) return;
  btn.textContent = "✓ Saved";
  setTimeout(() => {
    btn.textContent = "💾 Save prompt";
  }, 1500);
}

savePromptConfirm.addEventListener("click", confirmSavePrompt);
document
  .getElementById("savePromptCancel")
  .addEventListener("click", closeSavePrompt);
savePromptModal.addEventListener("click", (e) => {
  if (e.target === savePromptModal) closeSavePrompt();
});
savePromptModal.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    confirmSavePrompt();
  }
  if (e.key === "Escape") closeSavePrompt();
});

// --- import ---
// Replace the form's prompt, reference media and duration with a saved prompt's.
// Put a saved prompt's references into the form's reference fields, in its order —
// replacing what's there (every kind is listed, empty ones too). `promptText`, when
// given, goes into the prompt field as well. Returns notes on anything that couldn't
// be placed (files gone from the gallery, or more files than the workflow has slots).
function loadSavedPromptMedia(p, promptText = null) {
  const media = { image: [], video: [], audio: [] };
  for (const r of p.refs || []) {
    if (!r.missing)
      media[r.kind]?.push({
        id: r.id,
        url: r.url,
        name: r.name,
        tail: r.tail || 0,
      });
  }
  applyCarry({ prompt: promptText, media, urlOnly: 0 });

  const notes = [];
  const missing = (p.refs || []).filter((r) => r.missing).length;
  if (missing)
    notes.push(
      `${plural(missing, "reference")} no longer in the gallery and ${missing === 1 ? "was" : "were"} skipped.`,
    );
  if (isComfy()) {
    for (const kind of CARRY_KINDS) {
      const room = comfyFields
        .filter((f) => f.mediaKind === kind && typeof f.setMedia === "function")
        .reduce((n, f) => n + (f.capacity || 1), 0);
      if (media[kind].length > room) {
        notes.push(
          `This workflow takes ${room} ${kind} reference${room === 1 ? "" : "s"}; ${media[kind].length - room} didn't fit.`,
        );
      }
    }
  }
  return notes;
}

// A MiniMax prompt's text numbers its <Picture N> labels from its own reference list,
// so generating from one sends those files, in that order: they're loaded into the
// form's reference fields first. (A Default prompt stays text-only.)
function loadRunMedia(p) {
  return p?.type === "minimax" ? loadSavedPromptMedia(p) : [];
}

// `confirmReplace: false` skips the unsaved-prompt check (a History Re-import, which
// has already replaced the form).
async function importSavedPrompt(p, { confirmReplace = true } = {}) {
  const draft = currentPromptDraft();
  const text = exportSavedPromptText(p);
  const unsaved =
    draft.prompt.trim() &&
    draft.prompt !== text &&
    !savedPrompts.some((s) => exportSavedPromptText(s) === draft.prompt);
  if (
    confirmReplace &&
    unsaved &&
    !confirm(
      `Import "${p.title}"?\n\nThis replaces the prompt you have now (it isn't saved).`,
    )
  )
    return;
  hide(errorEl);
  disarmContinuation(); // the form no longer holds what the armed run was built from
  if (isComfy()) await comfyRenderPromise; // controls must exist before they're filled

  const notes = loadSavedPromptMedia(p, text);
  setCurrentDuration(Number(p.duration));
  if (notes.length) setError(notes.join("\n"));
  setPromptTab("prompt");
  activePromptHost()?.field.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

// --- cards ---
// Cards are compact and never expand; clicking one opens the edit modal.
function renderSavedPrompts() {
  syncPromptTabs(); // the tab's count
  const q = savedPromptsFilter;
  const shown =
    q ?
      savedPrompts.filter((p) =>
        `${p.title}\n${exportSavedPromptText(p)}`.toLowerCase().includes(q),
      )
    : savedPrompts;
  savedFilterEl.classList.toggle("hidden", savedPrompts.length < 2 && !q);
  savedEmptyEl.textContent =
    savedPrompts.length ?
      "No saved prompts match."
    : `No saved prompts in ${projectName(activeProjectId)} yet — write one and click 💾 Save prompt.`;
  savedEmptyEl.classList.toggle("hidden", shown.length > 0);
  savedListEl.innerHTML = "";
  for (const p of shown) savedListEl.appendChild(makeSavedPromptCard(p));
  const active = activeSavedPrompt();
  savedRunNoteEl.classList.toggle("on", !!active);
  savedRunNoteEl.textContent =
    !savedPrompts.length ? ""
    : active ?
      `▶ Generate uses “${active.title}” (${active.type === "minimax" ? "its prompt and its references, in order" : "its prompt text only"}) while this tab is open, and links the new History card to it.`
    : "Press ▶ on a card to generate from it while this tab is open. Otherwise Generate uses the Prompt tab's text.";
  savedRunNoteEl.classList.toggle("hidden", !savedPrompts.length);
  syncWildcardSource();
  syncGenerateLabel();
}

// Say on the Generate button when a saved prompt will be used.
function syncGenerateLabel() {
  submitBtn.classList.toggle("from-saved", !!runSavedPrompt());
  submitBtn.title =
    runSavedPrompt() ?
      `Generate from the saved prompt “${runSavedPrompt().title}”`
    : "";
}

// --- manual order ---
// The list is ordered by weight, Drupal-style: lighter on top, heavier sinks. Drag a
// card onto another to put it there, or use its ▲ ▼ buttons (or Alt+↑/↓ on a focused
// card); like Drupal's tabledrag, that renumbers the weights 0, 1, 2… in the new order.
// It's shown at once and saved in the background.
const SP_REORDER_TYPE = "application/x-genie-saved-prompt";

async function moveSavedPrompt(id, toIndex) {
  const from = savedPrompts.findIndex((p) => p.id === id);
  if (from < 0) return;
  toIndex = Math.max(0, Math.min(savedPrompts.length - 1, toIndex));
  if (from === toIndex) return;
  const [moved] = savedPrompts.splice(from, 1);
  savedPrompts.splice(toIndex, 0, moved);
  savedPrompts.forEach((p, i) => {
    p.weight = i;
  });
  renderSavedPrompts();
  savedListEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus();
  try {
    await promptsApi("/api/prompts/reorder", "POST", {
      projectId: activeProjectId,
      ids: savedPrompts.map((p) => p.id),
    });
  } catch (err) {
    alert(`Couldn't save the new order: ${err.message || err}`);
    loadSavedPrompts(); // back to what the server has
  }
}

function wireCardReorder(card, p) {
  card.draggable = true;
  card.addEventListener("keydown", (e) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const i = savedPrompts.findIndex((x) => x.id === p.id);
    moveSavedPrompt(p.id, i + (e.key === "ArrowUp" ? -1 : 1));
  });
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData(SP_REORDER_TYPE, p.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    savedListEl
      .querySelectorAll(".drop-before, .drop-after")
      .forEach((c) => c.classList.remove("drop-before", "drop-after"));
  });
  // Dropping on the top half of a card puts the dragged one above it, bottom half below.
  const lowerHalf = (e) => {
    const r = card.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };
  card.addEventListener("dragover", (e) => {
    if (![...e.dataTransfer.types].includes(SP_REORDER_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const after = lowerHalf(e);
    card.classList.toggle("drop-after", after);
    card.classList.toggle("drop-before", !after);
  });
  card.addEventListener("dragleave", () =>
    card.classList.remove("drop-before", "drop-after"),
  );
  card.addEventListener("drop", (e) => {
    if (![...e.dataTransfer.types].includes(SP_REORDER_TYPE)) return;
    e.preventDefault();
    card.classList.remove("drop-before", "drop-after");
    const id = e.dataTransfer.getData(SP_REORDER_TYPE);
    if (id === p.id) return;
    const from = savedPrompts.findIndex((x) => x.id === id);
    let to =
      savedPrompts.findIndex((x) => x.id === p.id) + (lowerHalf(e) ? 1 : 0);
    if (from < to) to--; // removing the dragged card first shifts everything after it up
    moveSavedPrompt(id, to);
  });
}

function makeCardMoveButtons(p) {
  const wrap = document.createElement("span");
  wrap.className = "sp-move";
  const i = savedPrompts.findIndex((x) => x.id === p.id);
  for (const [text, delta, title] of [
    ["▲", -1, "Move up (Alt+↑)"],
    ["▼", 1, "Move down (Alt+↓)"],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "link-btn";
    b.textContent = text;
    b.title = title;
    b.disabled = i + delta < 0 || i + delta >= savedPrompts.length;
    b.addEventListener("click", (e) => {
      e.stopPropagation(); // not a click on the card (which opens the editor)
      moveSavedPrompt(p.id, i + delta);
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function makeSavedPromptCard(p) {
  const refs = p.refs || [];
  const card = document.createElement("div");
  card.className = "sp-card";
  card.dataset.id = p.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.title = "Click to view, edit or import";
  card.addEventListener("click", () => openPromptEditor(p));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPromptEditor(p);
    }
  });

  const head = document.createElement("div");
  head.className = "sp-head";
  const title = document.createElement("span");
  title.className = "sp-title";
  title.textContent = p.title;
  const meta = document.createElement("span");
  meta.className = "sp-meta";
  meta.textContent = [
    p.duration ? `${p.duration}s` : null,
    refSummary(refs) || null,
    `weight ${p.weight ?? 0}`,
    new Date(p.updatedAt || p.createdAt).toLocaleDateString(),
  ]
    .filter(Boolean)
    .join(" · ");
  // ▶ makes this the prompt Generate uses (while this tab is open); again to stop.
  const isActive = activeSavedPrompt()?.id === p.id;
  card.classList.toggle("run-active", isActive);
  const use = document.createElement("button");
  use.type = "button";
  use.className = "sp-use" + (isActive ? " on" : "");
  use.textContent = isActive ? "▶ Active" : "▶";
  use.title =
    isActive ?
      "Generate uses this prompt while the Saved Prompts tab is open — click to stop"
    : "Use this prompt for Generate (while the Saved Prompts tab is open)";
  use.addEventListener("click", (e) => {
    e.stopPropagation(); // not a click on the card (which opens the editor)
    setActiveSavedPrompt(isActive ? null : p.id);
  });
  head.prepend(use);
  if (isMmType(p.type)) {
    const badge = document.createElement("span");
    badge.className = "sp-type";
    badge.textContent = p.type === "minimax_t2v" ? "MiniMax T2V" : "MiniMax";
    badge.title =
      p.type === "minimax_t2v" ?
        "MiniMax H3 text-to-video format — compiled into its three fields when used"
      : "MiniMax H3 format — compiled into its six sections when used";
    title.prepend(badge);
  }
  head.append(title, meta);
  if (!savedPromptsFilter) {
    // Manual order (off while filtering, when neighbours on screen aren't real neighbours).
    wireCardReorder(card, p);
    head.appendChild(makeCardMoveButtons(p));
  }
  const snippet = document.createElement("div");
  snippet.className = "sp-snippet";
  snippet.textContent = savedPromptSnippet(p) || "(no prompt text)";
  // Text and reference thumbnails; the linked History output (if any) sits to the left.
  const main = document.createElement("div");
  main.className = "sp-card-main";
  main.append(head, snippet);
  if (refs.length) {
    const mini = document.createElement("div");
    mini.className = "sp-mini";
    for (const r of refs.slice(0, 8))
      mini.appendChild(makeRefPreview(r, "sp-mini-thumb"));
    if (refs.length > 8) {
      const more = document.createElement("span");
      more.className = "sp-mini-more";
      more.textContent = `+${refs.length - 8}`;
      mini.appendChild(more);
    }
    main.appendChild(mini);
  }
  if (p.output?.pending) {
    card.classList.add("has-output");
    const ph = document.createElement("div");
    ph.className = "sp-output sp-output-pending";
    ph.textContent = "⏳";
    ph.title = "The linked run is still generating";
    card.appendChild(ph);
  } else if (p.output && !p.output.missing) {
    card.classList.add("has-output");
    card.appendChild(makeOutputPreview(p.output, "sp-output"));
  }
  card.appendChild(main);
  return card;
}

// The linked History output as a still (a video shows its first frame, and plays with
// sound while hovered).
function makeOutputPreview(out, className) {
  const box = document.createElement("div");
  box.className = className;
  box.title = "Output from the linked History card";
  if (out.kind === "image") {
    const im = document.createElement("img");
    im.src = out.url;
    im.loading = "lazy";
    box.appendChild(im);
  } else {
    const v = document.createElement("video");
    v.src = out.url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "metadata";
    // Browsers block sound until the page has had a click; until then, play muted.
    box.addEventListener("mouseenter", () => {
      v.muted = false;
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => {});
      });
    });
    box.addEventListener("mouseleave", () => {
      v.pause();
      v.currentTime = 0;
    });
    box.appendChild(v);
  }
  return box;
}

// A card's one- or two-line teaser: the text, or a MiniMax prompt's opening and first shot.
function savedPromptSnippet(p) {
  if (!isMmType(p.type)) return p.prompt || "";
  const mm = p.minimax || {};
  const shots = mm.shots || [];
  return [
    mm.style,
    shots[0]?.text,
    shots.length > 1 ?
      `(+${shots.length - 1} cut${shots.length > 2 ? "s" : ""})`
    : "",
  ]
    .filter((x) => String(x || "").trim())
    .join(" ");
}

// A small preview of a saved reference (or a "missing" placeholder if its gallery
// file was deleted).
function makeRefPreview(r, className) {
  const box = document.createElement("div");
  box.className = `${className}${r.missing ? " missing" : ""}`;
  box.title =
    r.missing ? `${r.name || "file"} — no longer in the gallery` : r.name || "";
  if (r.missing) box.textContent = "?";
  else
    box.appendChild(makeThumbContent(r.kind, { thumb: r.url, name: r.name }));
  return box;
}

// --- edit modal ---
// Title, prompt text, duration, weight, the reference list and each reference's key +
// definition are edited here and written back together by Save changes. The key and
// definition belong to the gallery file (every prompt using it shares them), so Save
// writes those to the gallery; the rest goes to the saved prompt.
const promptEditModal = document.getElementById("promptEditModal");
const peTitle = document.getElementById("peTitle");
const pePrompt = document.getElementById("pePrompt");
const peDuration = document.getElementById("peDuration");
const peWeight = document.getElementById("peWeight");
const peRefs = document.getElementById("peRefs");
const peRefsEmpty = document.getElementById("peRefsEmpty");
const peMeta = document.getElementById("peMeta");
const peActions = document.getElementById("peActions");
const peSave = document.getElementById("peSave");
const pePicker = document.getElementById("pePicker");
const peOutput = document.getElementById("peOutput");
const pePickerGrid = document.getElementById("pePickerGrid");
const pePickerEmpty = document.getElementById("pePickerEmpty");
const pePickerFile = document.getElementById("pePickerFile");
// editing: { p, projectId, refs, subjects, historyId }
//   historyId — the linked History entry (Unlink clears it; Save writes it)
//   refs     — the working reference list (the picker adds, × removes)
//   subjects — gallery id → { key, definition, origKey, origDefinition }, the working
//              copy of each referenced file's key + definition
let editing = null;
let pickerKind = "all";

const subjectOf = (r) => {
  let s = editing.subjects.get(r.id);
  if (!s) {
    s = {
      key: r.key || "",
      definition: r.definition || "",
      origKey: r.key || "",
      origDefinition: r.definition || "",
    };
    editing.subjects.set(r.id, s);
  }
  return s;
};
const subjectChanged = (s) =>
  s.key !== s.origKey || s.definition !== s.origDefinition;

// `projectId`: the project the prompt belongs to — the active one from the Saved
// Prompts tab, or a History card's (which may be another project's).
function openPromptEditor(p, projectId = activeProjectId) {
  editing = {
    p,
    projectId,
    type: p.type || "default",
    mm: normalizeMinimax(structuredClone(p.minimax || null)), // the MiniMax fields being edited
    refs: (p.refs || []).map((r) => ({ ...r })),
    subjects: new Map(),
    historyId: p.historyId || null,
  };
  peTitle.value = p.title;
  pePrompt.value = p.prompt || "";
  peDuration.value = p.duration || "";
  peWeight.value = p.weight ?? 0;
  peMeta.textContent =
    `Saved ${new Date(p.createdAt).toLocaleString()}` +
    (p.updatedAt && p.updatedAt !== p.createdAt ?
      ` · edited ${new Date(p.updatedAt).toLocaleString()}`
    : "");
  pePicker.open = false;
  renderEditorOutput();
  renderEditorBody();
  show(promptEditModal);
  promptEditModal.querySelector(".modal-box").scrollTop = 0;
  peTitle.focus();
}

// Show the edit form for the prompt's format (plain textarea, or the MiniMax sections).
function renderEditorBody() {
  const mm = isMmType(editing.type);
  document.getElementById("peDefault").classList.toggle("hidden", mm);
  peMinimax.classList.toggle("hidden", !mm);
  // Text-to-video takes no references, so the reference list and picker are hidden.
  document
    .getElementById("peRefsHome")
    .classList.toggle("hidden", editing.type === "minimax_t2v");
  const badge = document.getElementById("peType");
  badge.textContent = MM_TYPE_LABEL[editing.type] || "Default";
  badge.classList.toggle("mm", mm);
  // The reference list lives in its home spot unless the MiniMax ref form takes it —
  // moved back before that form is rebuilt, so clearing the form never drops it.
  if (editing.type !== "minimax")
    document.getElementById("peRefsHome").appendChild(peRefsBlock);
  if (mm) renderMinimaxForm();
  else peMinimax.innerHTML = "";
  renderEditorRefs(); // reference labels follow the format (<Picture 1> vs Image 1)
  renderEditorActions();
}

// The modal's values, shaped like a saved prompt.
function editorValues() {
  const d = Number(peDuration.value);
  const w = Number(peWeight.value);
  return {
    title: peTitle.value.trim(),
    type: editing.type,
    // Left out for MiniMax: the server clears the old text when it stores the type, so a
    // server that doesn't know the format yet keeps the text rather than blanking it.
    prompt: isMmType(editing.type) ? undefined : pePrompt.value,
    minimax: isMmType(editing.type) ? editing.mm : null,
    duration: Number.isFinite(d) && d > 0 ? d : null,
    weight:
      peWeight.value.trim() !== "" && Number.isFinite(w) ? Math.round(w) : 0,
    historyId: editing.historyId,
    refs: editorLiveRefs(), // with unsaved key/definition edits, for Import's compile
  };
}

function editorDirty() {
  if (!editing) return false;
  const v = editorValues();
  const p = editing.p;
  return (
    v.title !== p.title ||
    v.type !== (p.type || "default") ||
    (isMmType(v.type) ?
      JSON.stringify(v.minimax) !==
      JSON.stringify(p.minimax ? normalizeMinimax(p.minimax) : null)
    : v.prompt !== (p.prompt || "")) ||
    v.duration !== (p.duration || null) ||
    v.weight !== (p.weight ?? 0) ||
    v.historyId !== (p.historyId || null) ||
    v.refs.map((r) => r.id).join() !== (p.refs || []).map((r) => r.id).join() ||
    [...editing.subjects.values()].some(subjectChanged)
  );
}

function closePromptEditor({ force = false } = {}) {
  if (!editing) return;
  if (
    !force &&
    editorDirty() &&
    !confirm("Discard your changes to this saved prompt?")
  )
    return;
  editing = null;
  hide(promptEditModal);
}

async function saveEditor() {
  const v = editorValues();
  if (!v.title) {
    peTitle.focus();
    throw new Error("The title can't be empty.");
  }
  // Key + definition edits for files still in the list go to the gallery first, so
  // the prompt reloads with them.
  const inList = new Set(v.refs.map((r) => r.id));
  let galleryChanged = false;
  for (const [id, s] of editing.subjects) {
    if (!inList.has(id) || !subjectChanged(s)) continue;
    const g = await promptsApi(`/api/images/${encodeURIComponent(id)}`, "PUT", {
      key: s.key,
      definition: s.definition,
    });
    Object.assign(s, { key: g.key || "", definition: g.definition || "" });
    Object.assign(s, { origKey: s.key, origDefinition: s.definition });
    galleryChanged = true;
  }
  const saved = await promptsApi(
    `/api/prompts/${encodeURIComponent(editing.p.id)}`,
    "PUT",
    {
      projectId: editing.projectId,
      ...v,
      refs: v.refs.map(({ id, kind, name, tail }) => ({
        id,
        kind,
        name,
        tail,
      })),
    },
  );
  editing.p = saved;
  editing.mm = normalizeMinimax(structuredClone(saved.minimax || null)); // as the server normalized it
  if (galleryChanged) loadGallery();
  await loadSavedPrompts();
  return saved;
}

// The linked History output: a preview (click for full size) and Unlink, or a hint on
// how to link one.
function renderEditorOutput() {
  peOutput.innerHTML = "";
  const out =
    editing.historyId && editing.historyId === editing.p.historyId ?
      editing.p.output
    : null;
  if (out && !out.missing) {
    const prev = makeOutputPreview(out, "pe-output-thumb");
    prev.title = "Open full size";
    prev.addEventListener("click", () =>
      openLightbox(out.kind, out.url, editing.p.title),
    );
    const unlink = document.createElement("button");
    unlink.type = "button";
    unlink.className = "link-btn";
    unlink.textContent = "✕ Unlink";
    unlink.title =
      "Stop using this History output as the card's thumbnail (on Save)";
    unlink.addEventListener("click", () => {
      editing.historyId = null;
      renderEditorOutput();
    });
    peOutput.append(prev, unlink);
    return;
  }
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent =
    editing.p.output?.pending && editing.historyId === editing.p.historyId ?
      "⏳ The linked run is still generating."
    : editing.historyId ?
      "The linked History card is gone (deleted, or its output is missing). Save to clear the link."
    : editing.p.historyId ? "Unlinked — Save to confirm."
    : "None — use the 📌 dropdown on a History card to link its output here.";
  peOutput.appendChild(hint);
  if (editing.historyId) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "link-btn";
    clear.textContent = "✕ Clear link";
    clear.addEventListener("click", () => {
      editing.historyId = null;
      renderEditorOutput();
    });
    peOutput.appendChild(clear);
  }
}

function renderEditorRefs() {
  peRefs.innerHTML = "";
  const seen = { image: 0, video: 0, audio: 0 };
  for (const r of editing.refs) {
    const n = ++seen[r.kind];
    const label =
      editing.type === "minimax" ?
        `<${MM_REF_LABEL[r.kind] || "Picture"} ${n}>`
      : `${KIND_LABEL[r.kind] || "Image"} ${n}`;
    peRefs.appendChild(makeRefTile(r, label));
  }
  peRefsEmpty.classList.toggle("hidden", editing.refs.length > 0);
  if (pePicker.open) renderEditorPicker(); // keep its "added" marks in step
  refreshMinimaxDerived(); // subjects come from the references
}

// A reference in the editor: preview, label and file name, × to drop it from this
// prompt (the file stays in the gallery), and the file's key + definition.
function makeRefTile(r, label) {
  const tile = document.createElement("div");
  tile.className = "sp-ref";
  const prev = makeRefPreview(
    r,
    `thumb sp-ref-thumb${r.kind === "audio" ? " audio-thumb" : ""}`,
  );
  if (!r.missing && r.url)
    prev.appendChild(makeZoomButton(r.kind, r.url, r.name));
  tile.appendChild(prev);

  const info = document.createElement("div");
  info.className = "sp-ref-info";
  const top = document.createElement("div");
  top.className = "sp-ref-top";
  const lab = document.createElement("span");
  lab.className = "sp-ref-label";
  lab.textContent = label;
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "link-btn sp-ref-remove";
  rm.textContent = "×";
  rm.title = "Remove from this prompt (the file stays in the gallery)";
  rm.addEventListener("click", () => {
    editing.refs = editing.refs.filter((x) => x !== r);
    renderEditorRefs();
  });
  top.append(lab, rm);
  info.appendChild(top);
  const name = document.createElement("div");
  name.className = "sp-ref-name";
  name.textContent = r.missing ? `${r.name || "file"} (missing)` : r.name;
  name.title = name.textContent;
  info.appendChild(name);

  if (!r.missing) {
    // The same file can be listed twice; both tiles edit one shared subject.
    const s = subjectOf(r);
    const key = document.createElement("input");
    key.type = "text";
    key.className = "sp-ref-key-input";
    key.placeholder = "@key, e.g. genie";
    key.maxLength = 41;
    key.value = s.key ? `@${s.key}` : "";
    key.dataset.subject = r.id;
    key.title = "What a prompt calls this subject. Saved on the gallery file.";
    key.addEventListener("input", () => {
      s.key = key.value.trim().replace(/^@+/, "");
      peRefs
        .querySelectorAll(
          `.sp-ref-key-input[data-subject="${CSS.escape(r.id)}"]`,
        )
        .forEach((el) => {
          if (el !== key) el.value = key.value;
        });
      refreshMinimaxDerived();
    });
    const def = document.createElement("textarea");
    def.className = "sp-ref-def-input";
    def.rows = 3;
    def.placeholder =
      "Definition — who or what this is, e.g. “a red-haired woman in her 30s, green raincoat”";
    def.value = s.definition;
    def.dataset.subject = r.id;
    def.title =
      "Saved on the gallery file, so every prompt using it shares this.";
    def.addEventListener("input", () => {
      s.definition = def.value;
      peRefs
        .querySelectorAll(
          `.sp-ref-def-input[data-subject="${CSS.escape(r.id)}"]`,
        )
        .forEach((el) => {
          if (el !== def) el.value = def.value;
        });
      refreshMinimaxDerived();
    });
    info.append(key, def);
  }
  tile.appendChild(info);
  return tile;
}

// --- media picker (in the edit modal) ---
// This project's gallery: click a file to add it to the prompt (again to take it out).
// Upload adds new files to the gallery and straight into the prompt.
function addEditorRef(item) {
  editing.refs.push({
    id: item.id,
    kind: item.kind || "image",
    name: item.name,
    url: item.localUrl,
    projectId: item.projectId || "default",
    key: item.key || "",
    definition: item.definition || "",
  });
}

function renderEditorPicker() {
  if (!editing) return;
  pePicker
    .querySelectorAll(".pe-kind")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.kind === pickerKind),
    );
  const inPrompt = new Set(editing.refs.map((r) => r.id));
  const items = galleryItems.filter(
    (i) =>
      (i.projectId || "default") === editing.projectId &&
      (pickerKind === "all" || (i.kind || "image") === pickerKind),
  );
  pePickerGrid.innerHTML = "";
  pePickerEmpty.classList.toggle("hidden", items.length > 0);
  for (const item of items) {
    const added = inPrompt.has(item.id);
    const thumb = makeGalleryThumb(item, {
      title: `${item.name} — click to ${added ? "remove from" : "add to"} this prompt`,
      onPick: (it) => {
        if (editing.refs.some((r) => r.id === it.id))
          editing.refs = editing.refs.filter((r) => r.id !== it.id);
        else addEditorRef(it);
        renderEditorRefs();
      },
      refresh: renderEditorPicker,
    });
    thumb.classList.toggle("picked", added);
    pePickerGrid.appendChild(thumb);
  }
}

// Save dropped/browsed files to this project's gallery, then add them to the prompt.
async function uploadEditorMedia(files) {
  const saved = await uploadToGallery(
    files,
    editing?.projectId || activeProjectId,
  );
  if (!editing) return;
  for (const image of saved) addEditorRef(image);
  renderEditorRefs();
}

pePicker.addEventListener("toggle", () => {
  if (pePicker.open) renderEditorPicker();
});
pePicker.querySelectorAll(".pe-kind").forEach((b) =>
  b.addEventListener("click", () => {
    pickerKind = b.dataset.kind;
    renderEditorPicker();
  }),
);
document
  .getElementById("pePickerUpload")
  .addEventListener("click", () => pePickerFile.click());
pePickerFile.addEventListener("change", () => {
  uploadEditorMedia(pePickerFile.files);
  pePickerFile.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  pePicker.addEventListener(evt, (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    pePicker.classList.add("dragover");
  }),
);
["dragleave", "drop"].forEach((evt) =>
  pePicker.addEventListener(evt, (e) => {
    if (evt === "dragleave" && pePicker.contains(e.relatedTarget)) return;
    pePicker.classList.remove("dragover");
  }),
);
pePicker.addEventListener("drop", (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  pePicker.open = true;
  uploadEditorMedia(e.dataTransfer.files);
});

// --- MiniMax edit form (in the saved-prompt editor) ---
// Edits editing.mm in place. Typing only refreshes what's derived from it (the subject
// lines, "appears in", warnings and the compiled preview) so the field keeps focus;
// adding/removing a subject or cut rebuilds the form.
const peMinimax = document.getElementById("peMinimax");
const peRefsBlock = document.getElementById("peRefsBlock");

// The editor's references as the compiler sees them: each with its working key +
// definition (unsaved edits in the reference tiles included).
function editorLiveRefs() {
  return editing.refs.map((r) => {
    const s = editing.subjects.get(r.id);
    return s ? { ...r, key: normKey(s.key), definition: s.definition } : r;
  });
}

function mmEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function mmSection(name, hint) {
  const sec = mmEl("section", "pe-mm-sec");
  const h = mmEl("div", "pe-mm-name", name);
  if (hint) h.appendChild(mmEl("span", "hint", ` ${hint}`));
  sec.appendChild(h);
  return sec;
}

// A textarea bound to editing.mm[prop] (or to obj[prop] when given).
function mmText(obj, prop, { rows = 3, placeholder = "", cls = "" } = {}) {
  const ta = mmEl("textarea", cls);
  ta.rows = rows;
  ta.placeholder = placeholder;
  ta.value = obj[prop] || "";
  ta.addEventListener("input", () => {
    obj[prop] = ta.value;
    refreshMinimaxDerived();
  });
  return ta;
}

// A subject's retention_analysis line: "(appears in [Shot N])" is shown and compiled
// automatically; the author writes the relationship and note. `getLabel()` is the
// subject's current <label> (null while it has no key — no line then).
function mmRetentionField(getLabel) {
  const mm = editing.mm;
  const wrap = mmEl("div", "pe-mm-retfield");
  wrap.getLabel = getLabel;
  const head = mmEl("div", "pe-mm-rethead");
  head.append(
    mmEl("span", "pe-mm-retname", "retention_analysis"),
    mmEl("span", "pe-mm-appears"),
  );
  const ta = mmEl("textarea", "pe-mm-rettext");
  ta.rows = 2;
  ta.placeholder =
    "e.g. fully_preserved - her face, hair and outfit are kept. (partially_preserved, attribute_transfer, weak_reference; audio: fully_copy, partially_copy, reference) — @shots becomes this subject's shot list";
  ta.value = (getLabel() && mm.retention[getLabel()]) || "";
  ta.addEventListener("input", () => {
    const label = getLabel();
    if (!label) return;
    mm.retention[label] = ta.value;
    refreshMinimaxDerived();
  });
  wrap.append(head, ta);
  return wrap;
}

function renderMinimaxForm() {
  const mm = editing.mm;
  const t2v = editing.type === "minimax_t2v";
  peMinimax.innerHTML = "";

  if (!t2v) renderMinimaxRefParts(mm);

  // detailed_description (integrated_multimodal_description for text-to-video)
  const desc =
    t2v ?
      mmSection(
        "integrated_multimodal_description",
        "— [Shot 1] opens with the style, then each cut in playback order",
      )
    : mmSection(
        "detailed_description",
        "— a style opening, then each shot in playback order",
      );
  desc.appendChild(
    mmText(mm, "style", {
      rows: 2,
      placeholder:
        t2v ?
          "Live-action, cinematic, … (the style — written right after [Shot 1])"
        : "The target video uses a … style. (the opening, before [Shot 1])",
    }),
  );
  renderMinimaxShots(mm, desc, t2v);
  peMinimax.appendChild(desc);

  const snd = mmSection(
    "overall_soundscape",
    "— ambience and physical sounds across the whole video",
  );
  snd.appendChild(
    mmText(mm, "soundscape", {
      rows: 2,
      placeholder: "e.g. Quiet library room tone; pages rustle.",
    }),
  );
  peMinimax.appendChild(snd);
  const mus = mmSection(
    "non_diegetic_music",
    "— music only the audience hears (empty = N/A)",
  );
  mus.appendChild(
    mmText(mm, "music", {
      rows: 2,
      placeholder: "e.g. Heavy metal rock and roll, fast tempo.",
    }),
  );
  peMinimax.appendChild(mus);

  // compiled preview
  const prev = mmEl("details", "pe-mm-preview");
  prev.appendChild(mmEl("summary", null, "Compiled prompt"));
  const pre = mmEl("pre", "pe-mm-compiled");
  pre.id = "mmCompiled";
  prev.appendChild(pre);
  peMinimax.appendChild(prev);

  refreshMinimaxDerived();
}

// The reference format's own sections: subjects (with retention), the reference media
// and the summary — everything above detailed_description.
function renderMinimaxRefParts(mm) {
  // subject_definitions — each subject with its retention_analysis line under it
  const subj = mmSection(
    "subject_definitions",
    "— each subject, with its retention_analysis below it",
  );
  const fromRefs = mmEl("div", "pe-mm-derived");
  fromRefs.id = "mmRefSubjects"; // rows built by refreshMinimaxDerived (they follow the references)
  subj.appendChild(fromRefs);
  const extras = mmEl("div", "pe-mm-list");
  mm.subjects.forEach((s, i) => {
    const row = mmEl("div", "pe-mm-subject");
    const key = mmEl("input", "pe-mm-key");
    key.type = "text";
    key.placeholder = "key, e.g. new";
    key.value = s.key ? `<${s.key}>` : "";
    key.title = "The subject's label — written as <key> in the shots";
    key.addEventListener("input", () => {
      // Renaming carries the subject's retention text over to the new label.
      const before = s.key ? `<${s.key}>` : null;
      s.key = normKey(key.value);
      const after = s.key ? `<${s.key}>` : null;
      if (
        before &&
        after &&
        before !== after &&
        mm.retention[before] != null &&
        mm.retention[after] == null
      ) {
        mm.retention[after] = mm.retention[before];
        delete mm.retention[before];
      }
      refreshMinimaxDerived();
    });
    key.addEventListener("change", () => {
      key.value = s.key ? `<${s.key}>` : "";
    });
    const def = mmText(s, "definition", {
      rows: 5,
      placeholder:
        "who or what it is — e.g. a 20-year-old devil girl with red skin and short black horns.",
    });
    const rm = mmEl("button", "link-btn pe-mm-remove", "×");
    rm.type = "button";
    rm.title = "Remove this subject";
    rm.addEventListener("click", () => {
      mm.subjects.splice(i, 1);
      renderMinimaxForm();
    });
    row.append(
      key,
      def,
      rm,
      mmRetentionField(() => (s.key ? `<${s.key}>` : null)),
    );
    extras.appendChild(row);
  });
  subj.appendChild(extras);
  const addSubj = mmEl(
    "button",
    "link-btn",
    "＋ Add a subject without an image",
  );
  addSubj.type = "button";
  addSubj.addEventListener("click", () => {
    mm.subjects.push({ key: "", definition: "" });
    renderMinimaxForm();
    peMinimax
      .querySelectorAll(".pe-mm-key")
      .item(mm.subjects.length - 1)
      ?.focus();
  });
  subj.appendChild(addSubj);
  peMinimax.appendChild(subj);

  // The references, right under the subjects they define — you look at the images while
  // writing the definitions. (The block itself moves here; see renderEditorBody.)
  const refsSec = mmSection(
    "reference media",
    "— key and definition are saved on the gallery file and feed subject_definitions above. Write @key anywhere in this prompt to refer to a file: it compiles to its <Picture N>, so re-ordering keeps it right.",
  );
  refsSec.classList.add("pe-mm-refs");
  refsSec.appendChild(peRefsBlock);
  peMinimax.appendChild(refsSec);

  // summary
  const sum = mmSection("summary");
  sum.appendChild(
    mmText(mm, "summary", {
      rows: 5,
      placeholder:
        "[reference generation] The target video shows <genie> … — the task type in brackets, then one short paragraph on the video and what each reference is for.",
    }),
  );
  peMinimax.appendChild(sum);
}

// The shot cards and ＋ Add cut, into `desc`.
function renderMinimaxShots(mm, desc, t2v) {
  const shots = mmEl("div", "pe-mm-shots");
  mm.shots.forEach((s, i) => {
    const card = mmEl("div", "pe-mm-shot");
    const head = mmEl("div", "pe-mm-shot-head");
    head.appendChild(mmEl("span", "pe-mm-shot-name", `[Shot ${i + 1}]`));
    if (i > 0) {
      head.appendChild(mmEl("span", "hint", "At"));
      const at = mmEl("input", "pe-mm-at");
      at.type = "text";
      at.inputMode = "decimal";
      at.value = s.at == null ? "" : fmtShotTime(s.at);
      at.placeholder = "00:05.000";
      at.title = "When this cut happens — seconds (5) or MM:SS.mmm (00:05.000)";
      at.addEventListener("input", () => {
        s.at = parseShotTime(at.value);
        refreshMinimaxDerived();
      });
      at.addEventListener("change", () => {
        if (s.at != null) at.value = fmtShotTime(s.at);
        const sorted = sortedShots(mm.shots);
        if (sorted === mm.shots) return;
        mm.shots = sorted;
        renderMinimaxForm();
        const moved =
          peMinimax.querySelectorAll(".pe-mm-shot")[mm.shots.indexOf(s)];
        moved?.classList.add("pe-mm-moved");
        moved?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      const warn = mmEl("span", "pe-mm-warn");
      warn.dataset.shot = String(i);
      const rm = mmEl("button", "link-btn pe-mm-remove", "×");
      rm.type = "button";
      rm.title = "Remove this cut";
      rm.addEventListener("click", () => {
        mm.shots.splice(i, 1);
        renderMinimaxForm();
      });
      head.append(at, warn, rm);
    } else {
      head.appendChild(mmEl("span", "hint", "opening shot — no time"));
    }
    card.append(
      head,
      mmText(s, "text", {
        rows: i === 0 ? 5 : 3,
        placeholder:
          t2v ?
            i === 0 ?
              "a medium-wide shot frames … The camera pushes in slowly as the baker (S1) says: <d>[English] First batch of the morning.</d>"
            : "the camera cuts to a close-up of … (a speaker keeps their (S1) id; lines go in <d>[Language] …</d>)"
          : i === 0 ?
            "What the opening shot shows: composition, who's where (by <key>), action, camera, sound."
          : "e.g. the shot cuts to a low angle shot of <new> laughing.",
      }),
    );
    shots.appendChild(card);
  });
  desc.appendChild(shots);
  const addCut = mmEl("button", "btn-secondary pe-mm-add-cut", "＋ Add cut");
  addCut.type = "button";
  addCut.addEventListener("click", () => {
    const last = Math.max(0, ...mm.shots.slice(1).map((x) => x.at || 0));
    mm.shots.push({ at: last + 5, text: "" });
    renderMinimaxForm();
    const tas = peMinimax.querySelectorAll(".pe-mm-shot textarea");
    tas[tas.length - 1]?.focus();
  });
  desc.appendChild(addCut);
}

// Everything computed from the fields: the reference subject lines, retention rows,
// cut-time warnings and the compiled text.
function refreshMinimaxDerived() {
  if (!editing || !isMmType(editing.type)) return;
  const mm = editing.mm;
  const refs = editorLiveRefs();
  const subjects = minimaxSubjects(mm, refs);

  const rows = new Map(minimaxRetention(mm, subjects).map((r) => [r.label, r]));
  const fromRefs = document.getElementById("mmRefSubjects");
  if (fromRefs) {
    // Subjects defined only on their image (its definition box in reference media) have
    // no row below, so they get a slim one here — just to hold their retention box. A
    // subject also typed below keeps its retention there. Rebuilt only when that set
    // changes, so a retention box keeps focus while typing.
    const typed = new Set(
      mm.subjects.filter((x) => x.key).map((x) => `<${x.key}>`),
    );
    const lines = subjects.filter((x) => x.fromRefs && !typed.has(x.label));
    const sig = lines.map((x) => x.label).join();
    if (fromRefs.dataset.sig !== sig) {
      fromRefs.dataset.sig = sig;
      fromRefs.innerHTML = "";
      for (const x of lines) {
        const row = mmEl("div", "pe-mm-refsubj");
        row.dataset.label = x.label;
        const head = mmEl("div", "pe-mm-refsubj-head");
        head.append(
          mmEl("code", "pe-mm-refsubj-label", x.label),
          mmEl(
            "span",
            "hint",
            "— defined on its image in reference media below",
          ),
        );
        row.append(
          head,
          mmRetentionField(() => x.label),
        );
        fromRefs.appendChild(row);
      }
    }
  }
  // Every retention box's "appears in", from its subject's current label.
  peMinimax.querySelectorAll(".pe-mm-retfield").forEach((w) => {
    const label = w.getLabel?.();
    const r = label && rows.get(label);
    const el = w.querySelector(".pe-mm-appears");
    el.textContent =
      r ? appearsText(r)
      : label ? "add a definition to include it"
      : "give the subject a key first";
    el.classList.toggle("none", !r || (!r.audio && !r.shots.length));
    w.querySelector("textarea").disabled = !label;
  });

  // Cut-time notes: missing, out of order while typing, or a duplicate time. (Past the
  // duration is fine.)
  peMinimax.querySelectorAll(".pe-mm-warn").forEach((w) => {
    const i = Number(w.dataset.shot);
    const at = mm.shots[i]?.at;
    const prevAt = i > 1 ? (mm.shots[i - 1]?.at ?? 0) : 0;
    w.textContent =
      at == null ? "⚠ needs a time"
      : at < prevAt ? "↕ moves into place when you're done"
      : at === prevAt && i > 1 ? "⚠ same time as the previous cut"
      : "";
  });

  const out = document.getElementById("mmCompiled");
  if (out) {
    const text =
      editing.type === "minimax_t2v" ?
        compileMinimaxT2V(mm)
      : compileMinimax(mm, refs);
    out.textContent = text;
    const sum = out.parentElement.querySelector("summary");
    if (sum)
      sum.textContent = `Compiled prompt (${text.length.toLocaleString()} characters)`;
  }
}

// Import / Duplicate / Move / Copy / Delete. Import uses what the modal shows (and
// offers to save edits first); the others act on the saved prompt.
function renderEditorActions() {
  peActions.innerHTML = "";
  const btn = (text, title, onClick, cls = "btn-secondary") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await onClick();
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        b.disabled = false;
      }
    });
    peActions.appendChild(b);
    return b;
  };
  const base = () => `/api/prompts/${encodeURIComponent(editing.p.id)}`;
  const projectId = editing.projectId;
  // The project-level actions work on the saved version — check before dropping edits.
  const okToLeaveEdits = () =>
    !editorDirty() ||
    confirm("You have unsaved changes. Continue without saving them?");

  btn(
    "⤓ Import",
    "Load this prompt, its references and duration into the form",
    async () => {
      let p = { ...editing.p, ...editorValues() };
      if (
        editorDirty() &&
        confirm("Save your changes to this prompt before importing?")
      )
        p = await saveEditor();
      closePromptEditor({ force: true });
      await importSavedPrompt(p);
    },
    "sp-import",
  );
  // Converting between the two MiniMax formats keeps the shared fields (style, cuts,
  // soundscape, music); the reference format's subjects/summary/retention stay stored
  // but unused by text-to-video, so switching back restores them.
  const toT2V = () => {
    if (
      editing.refs.length &&
      !confirm(
        `Convert to MiniMax text-to-video?\n\nIt takes no references — the ${plural(editing.refs.length, "reference")} on this prompt will be removed when you save (the files stay in the gallery).`,
      )
    )
      return false;
    editing.refs = [];
    editing.type = "minimax_t2v";
    renderEditorBody();
    return true;
  };
  if (isMmType(editing.type)) {
    btn(
      "⇄ To plain text",
      "Turn this into a default prompt holding the compiled text (on Save)",
      async () => {
        if (
          !confirm(
            "Convert to a plain-text prompt?\n\nThe compiled MiniMax text becomes the prompt; the sections and cuts are dropped when you save.",
          )
        )
          return;
        pePrompt.value =
          editing.type === "minimax_t2v" ?
            compileMinimaxT2V(editing.mm)
          : compileMinimax(editing.mm, editorLiveRefs());
        editing.type = "default";
        renderEditorBody();
      },
    );
    if (editing.type === "minimax") {
      btn(
        "⇄ To T2V",
        "Switch to MiniMax's text-to-video format — same cuts, soundscape and music, no references (on Save)",
        async () => {
          toT2V();
        },
      );
    } else {
      btn(
        "⇄ To MiniMax ref",
        "Switch to MiniMax's reference format — adds subjects, summary, retention and reference media (on Save)",
        async () => {
          editing.type = "minimax";
          renderEditorBody();
        },
      );
    }
  } else {
    btn(
      "⇄ To MiniMax",
      "Split this prompt into MiniMax H3's sections, shots and subjects (on Save)",
      async () => {
        editing.mm = parseMinimax(pePrompt.value, editorLiveRefs());
        editing.type = "minimax";
        renderEditorBody();
      },
    );
    btn(
      "⇄ To T2V",
      "Split this prompt into MiniMax's text-to-video fields — cuts, soundscape and music, no references (on Save)",
      async () => {
        const before = editing.mm;
        editing.mm = parseMinimax(pePrompt.value);
        if (!toT2V()) editing.mm = before;
      },
    );
  }
  btn(
    "⧉ Duplicate",
    "Make a copy of the saved prompt in this project and open it",
    async () => {
      if (!okToLeaveEdits()) return;
      const copy = await promptsApi(`${base()}/duplicate`, "POST", {
        projectId,
      });
      await loadSavedPrompts();
      const fresh = (await getProjectPrompts(projectId)).find(
        (x) => x.id === copy.id,
      );
      openPromptEditor(fresh || copy, projectId);
    },
  );

  // Move / copy to another project: a dropdown of the other projects, like the gallery's ⇄.
  const others = projects.filter((x) => x.id !== projectId);
  for (const mode of others.length ? ["move", "copy"] : []) {
    const sel = document.createElement("select");
    sel.className = "sp-transfer";
    sel.title =
      mode === "move" ? "Move to another project" : "Copy to another project";
    const ph = new Option(
      mode === "move" ? "⇄ Move to…" : "⎘ Copy to…",
      "",
      true,
      true,
    );
    ph.disabled = true;
    sel.appendChild(ph);
    for (const x of others) sel.appendChild(new Option(x.name, x.id));
    sel.addEventListener("change", async () => {
      const to = sel.value;
      sel.selectedIndex = 0;
      if (!okToLeaveEdits()) return;
      sel.disabled = true;
      try {
        await promptsApi(`${base()}/transfer`, "POST", {
          projectId,
          toProjectId: to,
          mode,
        });
        await loadSavedPrompts();
        if (mode === "move") closePromptEditor({ force: true });
        else alert(`Copied "${editing.p.title}" to ${projectName(to)}.`);
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        sel.disabled = false;
      }
    });
    peActions.appendChild(sel);
  }

  btn(
    "🗑 Delete",
    "Delete this saved prompt (reference files stay in the gallery)",
    async () => {
      if (!confirm(`Delete saved prompt "${editing.p.title}"?`)) return;
      await promptsApi(
        `${base()}?projectId=${encodeURIComponent(projectId)}`,
        "DELETE",
      );
      closePromptEditor({ force: true });
      await loadSavedPrompts();
    },
    "btn-secondary sp-delete",
  );
}

peSave.addEventListener("click", async () => {
  peSave.disabled = true;
  try {
    await saveEditor();
    closePromptEditor({ force: true });
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    peSave.disabled = false;
  }
});
document
  .getElementById("peCancel")
  .addEventListener("click", () => closePromptEditor());
document
  .getElementById("peClose")
  .addEventListener("click", () => closePromptEditor());
promptEditModal.addEventListener("mousedown", (e) => {
  if (e.target === promptEditModal) closePromptEditor();
});
promptEditModal.addEventListener("keydown", (e) => {
  // Esc over a full-size view (opened from a thumbnail here) closes just that view.
  if (e.key === "Escape" && lightbox.classList.contains("hidden"))
    closePromptEditor();
});

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
  let progInfo = null; // { value, max, pass, passes, perPass, stepInPass, anchorT, anchorValue }
  const progStartedAt = job.startedAt || Date.now();
  let progTicker = null;
  // A run whose sampler goes over the steps more than once (Spectrum's capture +
  // replay) reports one combined count, e.g. 8/50 for step 8 of 25 in pass 1. Split it
  // back into passes. The passes can run at very different speeds, so the bar, the
  // percentage and the time left all describe the current pass only.
  const splitPasses = (value, max, passes) => {
    const n =
      Number.isInteger(passes) && passes > 1 && max % passes === 0 ? passes : 1;
    const perPass = max / n;
    const pass = Math.min(n, Math.max(1, Math.ceil(value / perPass)));
    return {
      passes: n,
      perPass,
      pass,
      stepInPass: value - (pass - 1) * perPass,
    };
  };
  const paint = () => {
    if (!progInfo) {
      statusText.textContent = baseStatus;
      return;
    }
    const { value, passes, perPass, pass, stepInPass, anchorT, anchorValue } =
      progInfo;
    const now = Date.now();
    const pct = Math.max(
      0,
      Math.min(100, Math.round((stepInPass / perPass) * 100)),
    );
    const elapsed = fmtDuration(now - progStartedAt);
    let eta = "";
    const dv = value - anchorValue;
    const dt = now - anchorT;
    if (stepInPass < perPass && dv > 0 && dt > 0) {
      const left = fmtDuration((perPass - stepInPass) * (dt / dv));
      eta =
        passes > 1 && pass < passes ?
          ` · ~${left} left in this pass`
        : ` · ~${left} left`;
    }
    const passLabel = passes > 1 ? `pass ${pass} of ${passes} · ` : "";
    statusText.textContent = `${baseStatus} ${passLabel}step ${stepInPass}/${perPass} (${pct}%) · ${elapsed} elapsed${eta}`;
  };

  return {
    el,
    running: true,
    isComfy: (job.input?.model || "").startsWith("comfy:"),
    promptId: job.taskId || null,
    setStatus(text) {
      baseStatus = text;
      paint();
    },
    setProgress(value, max, passes = 1) {
      if (!max || max <= 0) return;
      const split = splitPasses(value, max, passes);
      // Restart the rate clock on a new run or a new pass, so each pass's time left
      // comes from its own speed.
      const restart =
        !progInfo || value < progInfo.value || split.pass !== progInfo.pass;
      progInfo =
        restart ?
          { value, max, ...split, anchorT: Date.now(), anchorValue: value }
        : {
            value,
            max,
            ...split,
            anchorT: progInfo.anchorT,
            anchorValue: progInfo.anchorValue,
          };
      progressBar.style.width = `${Math.max(0, Math.min(100, Math.round((split.stepInPass / split.perPass) * 100)))}%`;
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
      pre.onload = () => {
        if (token === previewToken) previewImg.src = pre.src;
      };
      pre.src = url;
    },
    // Show a Cancel button; `fn` runs once on click.
    enableCancel(fn) {
      cancelBtn.classList.remove("hidden");
      cancelBtn.addEventListener(
        "click",
        async () => {
          cancelBtn.disabled = true;
          statusText.textContent = "Cancelling…";
          await fn();
        },
        { once: true },
      );
    },
    stop() {
      this.running = false;
      clearInterval(progTicker);
      progTicker = null;
    },
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
    try {
      d = JSON.parse(ev.data);
    } catch {
      return;
    }
    // Route by promptId: frames for another tab's run — or for a prompt queued
    // straight from ComfyUI's own UI — simply match nothing here.
    const live = [...liveStatus.values()].find(
      (l) => l.isComfy && l.promptId === d.promptId,
    );
    live?.setPreview(
      `/api/comfy/preview?promptId=${encodeURIComponent(d.promptId)}&seq=${d.seq}`,
    );
  });
  es.addEventListener("error", () => {
    // Per spec a non-2xx response closes the stream for good (signed out, or a server
    // without the route) — accept that and go quiet. A merely dropped connection
    // reconnects on its own and doesn't land here as CLOSED.
    if (es.readyState === EventSource.CLOSED) {
      previewDead = true;
      previewES = null;
    }
  });
}

function closePreviewStream() {
  if (previewES) {
    previewES.close();
    previewES = null;
  }
}

// `prompt`: the text to send — the textarea's, or an active saved prompt's export.
function collectInput(resolved, prompt = promptEl.value) {
  prompt = String(prompt).trim();
  if (isSeedream()) {
    const input = {
      model: modelSelect.value,
      prompt,
      aspect_ratio: aspectSelect.value,
      quality: qualitySelect.value,
      nsfw_checker: document.getElementById("nsfw_checker").checked,
    };
    if (isI2I()) input.image_urls = resolved.image;
    if (isSeedreamPro())
      input.output_format = document.getElementById("output_format").value;
    return input;
  }
  // MiniMax H3: a much smaller parameter set than Seedance — no generate_audio
  // (audio is native), web_search, nsfw_checker, output_format or return_last_frame,
  // and each mode accepts only its own reference fields.
  if (isH3()) {
    const input = {
      model: modelSelect.value,
      prompt,
      duration: Number(document.getElementById("duration").value),
      resolution: resolutionSelect.value,
    };
    if (isH3I2V()) {
      // image-to-video takes a first and/or last frame, and no aspect_ratio.
      if (resolved.firstFrame?.[0])
        input.first_frame_url = resolved.firstFrame[0];
      if (resolved.lastFrame?.[0]) input.last_frame_url = resolved.lastFrame[0];
    } else {
      input.aspect_ratio = aspectSelect.value;
    }
    if (isH3Ref()) {
      input.reference_image_urls = resolved.image;
      input.reference_video_urls = resolved.video;
      input.reference_audio_urls = resolved.audio;
    }
    return input;
  }
  const input = {
    model: modelSelect.value,
    prompt,
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
    input.return_last_frame =
      document.getElementById("return_last_frame").checked;
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
  // An active MiniMax prompt brings its own references (before they're checked below).
  const mediaNotes = loadRunMedia(runSavedPrompt());

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
  const ready = (kind) => lists[kind].items.some((i) => i.status === "ready");
  if (isH3I2V() && !ready("firstFrame") && !ready("lastFrame")) {
    setError(
      "MiniMax H3 image-to-video needs a first frame, a last frame, or both.",
    );
    return;
  }
  // The API rejects a reference-to-video run carrying only audio.
  if (isH3Ref() && !ready("image") && !ready("video")) {
    setError(
      "MiniMax H3 reference-to-video needs at least one reference image or video.",
    );
    return;
  }
  // Pinned now, so switching tabs (or the active prompt) mid-upload can't change the run.
  const fromSaved = runSavedPrompt();
  const promptText =
    fromSaved ? exportSavedPromptText(fromSaved) : promptEl.value;
  // Wildcards: each run of a ×N batch gets its own picks.
  let runPrompts;
  try {
    runPrompts = Array.from({ length: queueCount() }, () =>
      resolveWildcards(promptText),
    );
  } catch (err) {
    setError(err.message || String(err));
    return;
  }
  const longest = Math.max(...runPrompts.map((t) => t.length));
  if (longest > promptCap()) {
    setError(
      `${fromSaved ? `Saved prompt “${fromSaved.title}”` : "Prompt"} is ${longest.toLocaleString()} characters` +
        `${longest !== promptText.length ? " with its wildcards filled in" : ""} — ` +
        `this model's limit is ${promptCap().toLocaleString()}.`,
    );
    return;
  }
  const templated = hasWildcards(promptText);

  hide(errorEl);
  if (mediaNotes.length) setError(mediaNotes.join("\n"));
  // Lock only for the upload→create window so a double-click can't double-submit
  // the same form. It re-enables once the task is created, freeing you to queue
  // another generation while this one keeps polling in the background.
  submitBtn.disabled = true;

  // Only the fields the active model actually sends are uploaded.
  const refMedia = usesRefMedia();
  const mediaLocalIds = {
    image: usesRefImages() ? lists.image.localIds() : [],
    video: refMedia ? lists.video.localIds() : [],
    audio: refMedia ? lists.audio.localIds() : [],
    firstFrame: usesFrames() ? lists.firstFrame.localIds() : [],
    lastFrame: usesFrames() ? lists.lastFrame.localIds() : [],
  };

  // ×N: one batch of identical requests. Each run gets its own job, History card and
  // kie.ai task, but the reference media is uploaded once and shared by all of them.
  const count = runPrompts.length;
  const storedInputFor = (i) => {
    const s = collectInput(
      { image: [], video: [], audio: [], firstFrame: [], lastFrame: [] },
      runPrompts[i],
    );
    if (fromSaved) s.savedPrompt = savedPromptStamp(fromSaved); // History only, not sent to kie.ai
    if (templated) s.promptTemplate = promptText; // History only: Re-import restores the %tokens%
    return s;
  };
  const projectId = activeProjectId; // pin now so a mid-run project switch can't misfile it
  const refSecs = refMedia ? refVideoSeconds() : 0;
  const jobs = [];

  // Create the pending History entries up front (before the upload), so every run has
  // a live card from the start. Their stored input has no hosted URLs yet — reference
  // counts come from mediaLocalIds — and the real (resolved) input is sent to the API.
  for (let i = 0; i < count; i++) {
    const job = {
      jobId: nextJobId++,
      taskId: null,
      input: storedInputFor(i),
      mediaLocalIds,
      balanceBefore: null,
      projectId,
      refSecs,
      startedAt: Date.now(),
    };
    job.historyId = await createHistoryEntry(
      job.input,
      null,
      job.mediaLocalIds,
      job.projectId,
      job.refSecs,
    );
    job.live = createLiveStatus(job);
    if (count > 1) job.live.setStatus(`Waiting (${i + 1} of ${count})…`);
    if (job.historyId) liveStatus.set(job.historyId, job.live);
    jobs.push(job);
  }
  loadHistory();
  const setAllStatus = (text) => jobs.forEach((j) => j.live.setStatus(text));

  // Host reference media on kie.ai now — nothing was sent when they were dropped.
  let resolved;
  try {
    if (allItems().some((i) => i.status === "ready")) {
      setAllStatus(
        count > 1 ?
          `Uploading reference media (shared by ${count} runs)…`
        : "Uploading reference media…",
      );
    }
    resolved = {
      // only upload the reference kinds the selected model+mode actually uses
      // (2.5 forbids mixing reference images with first/last frames)
      image: usesRefImages() ? await lists.image.resolve() : [],
      video: refMedia ? await lists.video.resolve() : [],
      audio: refMedia ? await lists.audio.resolve() : [],
      firstFrame: usesFrames() ? await lists.firstFrame.resolve() : [],
      lastFrame: usesFrames() ? await lists.lastFrame.resolve() : [],
    };
  } catch (err) {
    const msg = err.message || "Failed to upload reference media.";
    for (const job of jobs) await failJob(job, msg);
    submitBtn.disabled = false;
    return;
  }

  // Snapshot the balance so we can measure actual cost on completion. (With
  // overlapping runs this delta is unreliable; the per-task creditsConsumed
  // reported on completion is the primary source and stays accurate.)
  const balanceBefore = await loadCredits();

  try {
    // Create the tasks one after another, lightly spaced: kie.ai allows 20 new
    // requests per 10s and drops (doesn't queue) the rest; createTask also retries
    // on a 429. One task failing to create doesn't stop the rest of the batch.
    for (const [i, job] of jobs.entries()) {
      if (i > 0) await sleep(BATCH_CREATE_SPACING_MS);
      job.balanceBefore = balanceBefore;
      job.live.setStatus("Submitting…");
      try {
        // The real input (hosted URLs, this run's wildcard picks) for the API call.
        job.taskId = await createTask(
          collectInput(resolved, runPrompts[i]),
          job.live,
        );
        job.live.setStatus("Generating… this can take a few minutes.");
        await persistEntryTask(job); // let the server-side sweep finish it if this tab goes away
        pollJob(job);
      } catch (err) {
        await failJob(job, err.message || String(err));
      }
    }
  } finally {
    submitBtn.disabled = false;
  }
});

const BATCH_CREATE_SPACING_MS = 400; // ~2.5 creates/s — well inside 20 per 10s

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
      live.setStatus(
        `Rate-limited — retrying (${attempt + 1}/${RATE_LIMIT_RETRIES})…`,
      );
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
    if (!res.ok || data.code !== 200)
      throw new Error(data.msg || `Status check failed (${res.status})`);
  } catch {
    // Transient (network / 5xx) — leave the entry pending and retry.
    setTimeout(() => pollJob(job), POLL_INTERVAL_MS);
    return;
  }

  const state = data.data?.state;
  if (state === "success") {
    finishLive(job);
    const url = JSON.parse(data.data.resultJson || "{}").resultUrls?.[0];
    if (!url)
      return failJob(job, "Task succeeded but no result URL was returned.");

    // Prefer the API's exact per-task cost (creditsConsumed on recordInfo); fall
    // back to the balance delta for older responses (unreliable when runs overlap).
    const balanceAfter = await loadCredits(); // also refreshes the header balance
    let cost = null;
    const reported = Number(data.data.creditsConsumed);
    if (Number.isFinite(reported) && reported > 0) cost = reported;
    else if (
      typeof balanceBefore === "number" &&
      typeof balanceAfter === "number"
    ) {
      const delta = balanceBefore - balanceAfter;
      if (delta > 0) cost = delta;
    }
    await attachHistoryResult(job, url, cost); // downloads, marks done, refreshes History
    return;
  }
  if (state === "fail") {
    await failJob(
      job,
      data.data?.failMsg ||
        `Generation failed (code ${data.data?.failCode ?? "?"}).`,
    );
    return;
  }
  setTimeout(() => pollJob(job), POLL_INTERVAL_MS);
}

// --- history -------------------------------------------------------------------
// Create a PENDING history entry at submit time so the prompt/settings are saved
// immediately — a run that later fails, stalls, or is cancelled won't lose them.
// Returns the new entry's id (to attach the output to on success).
async function createHistoryEntry(
  input,
  taskId,
  mediaLocalIds,
  projectId,
  refSecs,
) {
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

let lastHistoryLinkKey = "";
async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    historyEntries = data.data || [];
    renderHistory(historyEntries);
    updateEstimate();
    // A run generated from a saved prompt links itself when its output lands — or a
    // linked run just finished — so the saved-prompt cards need a fresh look.
    const linkKey = historyEntries
      .filter(
        (e) =>
          e.savedPromptLinked || savedPrompts.some((p) => p.historyId === e.id),
      )
      .map((e) => `${e.id}:${e.status}`)
      .join();
    if (linkKey !== lastHistoryLinkKey) {
      lastHistoryLinkKey = linkKey;
      loadSavedPrompts();
    }
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
  const byProject =
    filter === "all" ? entries : (
      entries.filter((e) => (e.projectId || "default") === filter)
    );
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
    const isImg =
      (input.model || "").startsWith("comfy:") ?
        isImageFile(src)
      : isImageOutput(input.model);
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
  if (entry.localVideo || entry.resultUrl)
    return [{ resultUrl: entry.resultUrl, localVideo: entry.localVideo }];
  return [];
}

// kind/src/name for one output of an entry (for the lightbox / thumbnails).
function outputMedia(entry, out, index, total) {
  const input = entry.input || {};
  const src = out.localVideo || out.resultUrl; // localVideo is the saved output file
  const kind =
    (input.model || "").startsWith("comfy:") ?
      isImageFile(src) ? "image"
      : "video"
    : isImageOutput(input.model) ? "image"
    : "video";
  const name =
    total > 1 ? `${input.prompt || ""} (${index + 1}/${total})` : input.prompt;
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
  openLightbox(items[index].kind, items[index].src, items[index].name, {
    items,
    index,
  });
}

// Human-readable spend category for a model id, used in the per-project credit
// breakdown. Entries predating model storage were Seedance 2 (matches the
// estimate code's default), Lite/Pro collapse i2i + t2i into one category.
function creditCategory(model) {
  const m = model || "bytedance/seedance-2";
  if (m.startsWith("comfy:")) return "ComfyUI (local)";
  if (m.startsWith("seedream/"))
    return m.includes("5-pro") ? "Seedream Pro" : "Seedream Lite";
  if (m.startsWith("minimax-h3/")) return "MiniMax H3";
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
    (e) => (e.projectId || "default") === activeProjectId,
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
    push(
      "Duration",
      v.duration != null && v.duration !== "" ? `${v.duration}s` : v.duration,
    );
    // Chain position in full, next to the settings it has to stay consistent with.
    const chain = entry.continuation;
    if (chain?.slot) {
      push("Chain slot", chain.slot);
      push(
        "Continues from",
        chain.from ? `slot ${chain.from}` : "— chain start",
      );
    }
  } else if (isImg) {
    push("Aspect ratio", input.aspect_ratio);
    push("Quality", input.quality);
    push("Format", input.output_format);
    push("Seed", input.seed);
  } else {
    push("Resolution", input.resolution);
    push("Aspect ratio", input.aspect_ratio);
    push(
      "Duration",
      input.duration != null && input.duration !== "" ?
        `${input.duration}s`
      : input.duration,
    );
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
        "hist-ref" +
        (r.kind === "image" ? " hist-ref-lg" : "") +
        (r.kind === "audio" ? " audio-thumb" : "");
      cell.title = r.name || r.kind;
      cell.appendChild(
        makeThumbContent(r.kind, { thumb: r.thumb, name: r.name }),
      );
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
    for (const u of urls || [])
      if (u) out.push({ kind, id: null, thumb: u, name: urlBasename(u) });
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
  if (input.reference_video_urls?.length)
    addUrls(input.reference_video_urls, "video");
  else addLocal(mli.video, "video");
  if (input.reference_audio_urls?.length)
    addUrls(input.reference_audio_urls, "audio");
  else addLocal(mli.audio, "audio");
  return out;
}

// Add a reference image to the current form's picture field. In ComfyUI mode this
// is the workflow's first image media field (which needs a local file); otherwise
// it's the kie.ai Reference-images list (which also accepts a hosted URL). Returns
// true on success, false if the field is full or a local file was required but the
// reference is a remote-only URL.
function addRefToPictureField(r) {
  const comfyActive =
    comfyControlsEl && !comfyControlsEl.classList.contains("hidden");
  const comfyImg =
    comfyActive ?
      comfyFields.find(
        (f) => f.mediaKind === "image" && typeof f.addMedia === "function",
      )
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
    return (
      p.searchParams.get("filename") ||
      decodeURIComponent(p.pathname.split("/").pop() || "") ||
      u
    );
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
  const shown = [...pages]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
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
    if (!disabled && !current)
      b.addEventListener("click", () => goHistoryPage(page));
    return b;
  };

  historyPager.appendChild(
    mkBtn("‹ Prev", historyPage - 1, { disabled: historyPage <= 1 }),
  );
  for (const p of historyPageNumbers(historyPage, pageCount)) {
    if (p === null) {
      const gap = document.createElement("span");
      gap.className = "hist-page-gap";
      gap.textContent = "…";
      historyPager.appendChild(gap);
    } else {
      historyPager.appendChild(
        mkBtn(String(p), p, { current: p === historyPage }),
      );
    }
  }
  historyPager.appendChild(
    mkBtn("Next ›", historyPage + 1, { disabled: historyPage >= pageCount }),
  );
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
          entry.status === "pending" ?
            "⏳ Generating…"
          : entry.error || "no output — re-run below";
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
      thumb.className =
        "hist-thumb" + (outs.length > 1 ? " hist-thumb-grid" : "");
      outs.forEach((o, i) => {
        const src = o.localVideo || o.resultUrl;
        if (!src) return;
        const oIsImg =
          comfyEntry ? isImageFile(src) : isImageOutput(input.model);
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
    const cost =
      typeof entry.costCredits === "number" ?
        ` · ${entry.costCredits.toLocaleString()} credits`
      : "";
    // generation run-time (wall time from submit to finished output)
    const rt = entry.runtimeMs ? ` · ⏱ ${fmtDuration(entry.runtimeMs)}` : "";
    // show which project the entry belongs to when viewing all projects
    const proj =
      filter === "all" ? ` · ${projectName(entry.projectId || "default")}` : "";
    if (comfyEntry) {
      const wfName =
        input.workflow ||
        input.model.slice("comfy:".length).replace(/\.json$/i, "");
      meta.textContent = `${date} · ComfyUI · ${wfName}`;
      // Chain position, for a run that has one. "⛓ 6→9" = read slot 6, wrote slot 9;
      // a bare "⛓ 9" is a chain start. What a slot *holds* is the workflow's business
      // — GENie only allocates the integers — so nothing here names it. They are still
      // the only thing that tells two runs of one chain apart, which is why they
      // belong on the card rather than only in history.json.
      const chain = entry.continuation;
      if (chain?.slot) {
        const tag = document.createElement("span");
        tag.className = "hist-chain";
        tag.textContent = `· ⛓ ${chain.from ? `${chain.from}→` : ""}${chain.slot}`;
        tag.title =
          chain.from ?
            `Continues slot ${chain.from} · this run writes slot ${chain.slot}`
          : `Chain start · this run writes slot ${chain.slot}`;
        meta.append(" ", tag);
      }
      meta.append(`${rt}${proj}`);
    } else if (isImg) {
      meta.textContent =
        `${date} · ${seedreamLabel(input.model)} · ${input.quality || "basic"} · ${input.aspect_ratio || "?"}` +
        `${cost}${rt}${proj}`;
    } else {
      const variant =
        VIDEO_VARIANT_LABEL[input.model] ?
          ` · ${VIDEO_VARIANT_LABEL[input.model]}`
        : "";
      // H3 image-to-video has no aspect_ratio at all — leave the segment out rather
      // than printing a "?" for a setting the model never had.
      const ratio = input.aspect_ratio ? ` · ${input.aspect_ratio}` : "";
      meta.textContent =
        `${date}${variant} · ${input.resolution || "?"}${ratio} · ` +
        `${input.duration || "?"}s${cost}${rt}${proj}`;
    }

    const actions = document.createElement("div");
    actions.className = "hist-actions";

    const reimport = document.createElement("button");
    reimport.type = "button";
    reimport.className = "btn-secondary";
    reimport.textContent = "Re-import";
    // Linked to a saved prompt (see makeHistoryPromptLink): Re-import still restores the
    // run's model and settings, then takes the prompt text, references and duration
    // from the saved prompt — its current version, edits included.
    let linkedPrompt = null;
    reimport.addEventListener("click", async () => {
      const p = linkedPrompt;
      await applyEntry(entry);
      if (p) await importSavedPrompt(p, { confirmReplace: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    actions.appendChild(reimport);

    const editPromptBtn = document.createElement("button");
    editPromptBtn.type = "button";
    editPromptBtn.className = "btn-secondary hidden";
    editPromptBtn.innerHTML = '<span class="btn-ico">✎</span> Edit prompt';
    editPromptBtn.addEventListener("click", () => {
      if (linkedPrompt)
        openPromptEditor(linkedPrompt, entry.projectId || "default");
    });
    actions.appendChild(editPromptBtn);
    const onLinked = (p) => {
      linkedPrompt = p;
      editPromptBtn.classList.toggle("hidden", !p);
      editPromptBtn.title =
        p ? `Edit the linked saved prompt "${p.title}"` : "";
      reimport.innerHTML =
        p ? '<span class="btn-ico">📌</span> Re-import' : "Re-import";
      reimport.title =
        p ?
          `Load this run's model and settings with the linked saved prompt "${p.title}" (its text, references and duration)`
        : "Load this run's prompt, references and settings into the form";
    };

    // Continue / Re-roll, for a workflow that declares the continuation tokens and a
    // run that carries a slot. The workflow list is already in memory, so this
    // self-heals: drop the tags from the .json and the buttons disappear.
    const cont = entry.continuation;
    const wfMeta =
      comfyEntry ?
        comfyWorkflows.find(
          (w) => w.file === (input.model || "").slice("comfy:".length),
        )
      : null;
    const roles = wfMeta?.roles || {};
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
          {
            parentId: entry.id,
            from: cont.slot,
            into: null,
            file: wfMeta.file,
            label: when,
          },
          input.values || {},
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
      rollBtn.title =
        "Regenerate this run in place, keeping its place in the chain";
      rollBtn.addEventListener("click", async () => {
        await applyEntry(entry);
        armContinuation(
          {
            parentId: cont.parentId,
            from: cont.from,
            into: cont.slot,
            file: wfMeta.file,
            label: when,
          },
          input.values || {},
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
            `The new result will be saved to the active project "${projectName(activeProjectId)}".\n\nContinue?`,
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
      copyBtn.textContent =
        (await copyText(input.prompt || "")) ? "Copied!" : "Copy failed";
      setTimeout(
        () => (copyBtn.innerHTML = '<span class="btn-ico">⧉</span> Prompt'),
        1200,
      );
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
    const hasSource = !!(
      entry.resultUrl || (entry.outputs || []).some((o) => o.resultUrl)
    );
    if (hasSource) {
      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.className = "btn-secondary";
      refreshBtn.innerHTML = '<span class="btn-ico">⟳</span> Refresh';
      refreshBtn.title =
        "Re-download the output file from the source (fixes a missing or wrong saved file)";
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        const prev = refreshBtn.innerHTML;
        refreshBtn.innerHTML = "Refreshing…";
        try {
          const res = await fetch(`/api/history/${entry.id}/redownload`, {
            method: "POST",
          });
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
          const res = await fetch(`/api/history/${entry.id}/to-gallery`, {
            method: "POST",
          });
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

    if (output) actions.appendChild(makeHistoryPromptLink(entry, onLinked));

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
    projSel.value =
      projSel.querySelector(`option[value="${entryProjectId}"]`) ?
        entryProjectId
      : "default";
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
      if (
        !skipConfirm &&
        !confirm(
          "Delete this history item? This also removes its saved output file and can't be undone.",
        )
      )
        return;
      del.disabled = true;
      try {
        const res = await fetch(`/api/history/${entry.id}`, {
          method: "DELETE",
        });
        if (!res.ok)
          throw new Error(
            (await res.json().catch(() => ({}))).msg || "Delete failed",
          );
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
    favBtn.className =
      "btn-secondary hist-tag-toggle" + (entry.favorite ? " active" : "");
    favBtn.innerHTML = entry.favorite ? "★ Favorite" : "☆ Favorite";
    favBtn.title =
      entry.favorite ?
        "Remove from favorites (moves the file out of favorites/)"
      : "Mark as favorite (moves the file into favorites/)";
    favBtn.addEventListener("click", () => toggleHistoryTag(entry, "favorite"));
    actions.appendChild(favBtn);

    const draftBtn = document.createElement("button");
    draftBtn.type = "button";
    draftBtn.className =
      "btn-secondary hist-tag-toggle" + (entry.draft ? " active" : "");
    draftBtn.innerHTML = "📝 Draft";
    draftBtn.title =
      entry.draft ? "Remove the draft tag" : "Tag this as a draft";
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
          `put its .json back in the workflows folder and reload.`,
      );
      return;
    }
    modelSelect.value = input.model;
    applyModelUI(); // kicks off the async control render (ComfyUI options + settings)
    await comfyRenderPromise; // wait for the controls to exist before filling them
    prefillComfyControls({
      ...(input.values || {}),
      ...(input.valueTemplates || {}),
    });
    if (comfyLoraControl && Array.isArray(input.loras))
      comfyLoraControl.setLoras(input.loras);
    if (comfyMediaControl && Array.isArray(input.workflowMedia))
      comfyMediaControl.setMedia(input.workflowMedia);
    if (comfyBypassControl && Array.isArray(input.bypass))
      comfyBypassControl.setDisabled(input.bypass);
    await restoreComfyMedia(entry); // re-populate the image/video/audio fields
    // "Generate preview" is a persisted global preference — re-import leaves it as-is.
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  modelSelect.value = input.model || "bytedance/seedance-2";
  // Restore the 2.5 image-source mode (frames if the entry saved either keyframe).
  const savedMode =
    input.first_frame_url || input.last_frame_url ? "frames" : "refs";
  const modeRadio = document.querySelector(
    `input[name="imageSource"][value="${savedMode}"]`,
  );
  if (modeRadio) modeRadio.checked = true;
  applyModelUI(); // shape the form (and aspect options) before filling values
  document.getElementById("prompt").value =
    input.promptTemplate || input.prompt || "";
  // applyModelUI already populated this model family's options and picked a
  // default; only override when the saved entry recorded one.
  if (input.resolution) resolutionSelect.value = input.resolution;
  if (input.aspect_ratio) aspectSelect.value = input.aspect_ratio;
  qualitySelect.value = input.quality || "basic";
  // applyModelUI already set the format options + default for this model; only
  // override when the saved entry recorded one.
  if (input.output_format) outputFormatSelect.value = input.output_format;
  updatePromptCount();
  if (input.duration)
    document.getElementById("duration").value = input.duration;
  document.getElementById("generate_audio").checked =
    input.generate_audio !== false;
  document.getElementById("web_search").checked = !!input.web_search;
  document.getElementById("nsfw_checker").checked = !!input.nsfw_checker;
  document.getElementById("return_last_frame").checked =
    !!input.return_last_frame;
  // "Generate preview" is a persisted global preference — re-import leaves it as-is.

  const saved = await fetch("/api/images")
    .then((r) => r.json())
    .then((d) => d.data || []);
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
  for (const entry of historyEntries)
    attached = trackPendingEntry(entry) || attached;
  if (attached) renderHistory(historyEntries); // drop the freshly-attached live status into the cards
  lastPendingKey = pendingKey(
    historyEntries.filter((e) => e.status === "pending"),
  );
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
const pendingKey = (list) =>
  list
    .map((e) => e.id)
    .sort()
    .join(",");

function scheduleSyncPending(delay) {
  clearTimeout(syncPendingTimer);
  syncPendingTimer = setTimeout(syncPending, delay ?? SYNC_PENDING_IDLE_MS);
}

async function syncPending() {
  let pending = [];
  try {
    const res = await fetch("/api/history/pending");
    const data = await res.json();
    if (!res.ok || data.code !== 200)
      throw new Error(data.msg || "sync failed");
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
  scheduleSyncPending(
    pending.length ? SYNC_PENDING_ACTIVE_MS : SYNC_PENDING_IDLE_MS,
  );
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
    // Show the running server's release in the footer (links to the changelog).
    const { version } = await r.json().catch(() => ({}));
    const versionEl = document.getElementById("appVersion");
    if (version && versionEl && !versionEl.childElementCount) {
      const a = document.createElement("a");
      a.href = "https://github.com/resiz3d/genie-ui/blob/main/CHANGELOG.md";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = `v${version}`;
      versionEl.append(" · ", a);
    }
  } catch {
    offlineEl.classList.remove("hidden");
  }
}
setInterval(checkServer, PING_INTERVAL_MS);
window.addEventListener("focus", checkServer);
checkServer(); // once at load too, so the footer version shows right away

// --- host stats readout (CPU / RAM / GPU / VRAM) --------------------------------
// Shown whenever a ComfyUI workflow is selected or a local run is in flight:
// polls every 2s during an active run, every 5s while idle. Hidden (and not polled)
// otherwise, so we don't shell out to nvidia-smi when ComfyUI isn't in play.
const comfyStatsEl = document.getElementById("comfyStats");
const comfyStatsTextEl = document.getElementById("comfyStatsText");
const freeVramBtn = document.getElementById("freeVramBtn");
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
    parts.push(
      `VRAM ${d.vram.pct}% (${gb(d.vram.used)}/${gb(d.vram.total)} GB)`,
    );
  } else {
    parts.push("VRAM –");
  }
  comfyStatsTextEl.textContent = `⚙ ${parts.join("   ·   ")}`;
}

// "Free VRAM": ComfyUI unloads its models and clears its cache between jobs, so with a
// run in flight it only takes effect once that run finishes. The readout refreshes
// shortly after so the drop shows.
freeVramBtn.addEventListener("click", async () => {
  const label = freeVramBtn.textContent;
  const running = [...liveStatus.values()].some((l) => l.isComfy && l.running);
  freeVramBtn.disabled = true;
  freeVramBtn.textContent = "Freeing…";
  let msg;
  try {
    const d = await fetch("/api/comfy/free", { method: "POST" }).then((r) =>
      r.json(),
    );
    msg =
      d?.code === 200 ?
        running ? "Frees after this run"
        : "Freed"
      : "Couldn't free";
  } catch {
    msg = "Couldn't free";
  }
  freeVramBtn.textContent = msg;
  scheduleComfyStats(1500);
  setTimeout(() => {
    freeVramBtn.textContent = label;
    freeVramBtn.disabled = false;
  }, 3000);
});

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
