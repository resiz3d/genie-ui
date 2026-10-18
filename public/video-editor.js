// --- ✂ Video editor: trim clips, cut parts out, join clips, pick frames -------------
// Opened from the header, or from a History card's / Gallery video's ✂ Edit video.
// Clips come from the device's file explorer or from GENie's own videos (History,
// Gallery, earlier edits). The result is saved as a new file in the project's
// edited_videos folder, wherever the user chooses, or — opened from a card — added to
// that card as another video (or, ticked, in place of its video). Picked frames go to
// the gallery as images or download as PNGs. The browser previews the clips itself;
// the server (video-editor.js, ffmpeg) does the re-encode. Without ffmpeg, frames can
// still be picked, at an assumed frame rate.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const API = "/api/video-editor";

  const modal = document.createElement("div");
  modal.id = "videoEditorModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
  <div class="modal-box fp-box ve-box" role="dialog" aria-labelledby="veHeading">
    <div class="pe-head">
      <h3 id="veHeading">✂ Video editor <span class="ve-proj hidden"></span> <span class="hint ve-name"></span></h3>
      <button type="button" class="link-btn pe-close ve-close" title="Close (Esc)">×</button>
    </div>
    <div class="dropzone ve-drop">
      <p class="dz-hint">Drop videos here or <span class="browse">browse</span></p>
    </div>
    <button type="button" class="btn-secondary ve-import" title="Open videos from this project's History, Gallery or earlier edits">📚 Import from GENie…</button>
    <input type="file" class="ve-file" accept="video/*,.mkv,.mov" multiple hidden />
    <div class="ve-editor hidden">
      <div class="ve-clips-row">
        <div class="ve-clips-head">
          <span class="muted ve-clips-title"></span>
          <button type="button" class="btn-secondary ve-prepend" title="Add videos before the first clip — from GENie or from this device">＋ Prepend</button>
          <button type="button" class="btn-secondary ve-append" title="Add videos after the last clip — from GENie or from this device">Append ＋</button>
        </div>
        <div class="ve-clips"></div>
      </div>
      <div class="ve-work">
        <div class="fp-stage">
          <video class="fp-video" playsinline preload="auto"></video>
          <span class="fp-picked-badge ve-cut-badge hidden">✂ Cut</span>
        </div>
        <input type="range" class="fp-scrub ve-scrub" min="0" max="0" step="1" value="0" aria-label="Frame" />
        <div class="ve-track" title="Striped = cut out · white = marked selection"></div>
        <div class="fp-readout">
          <span class="ve-pos">Loading…</span>
          <span class="ve-result muted"></span>
        </div>
        <div class="fp-controls">
          <button type="button" class="btn-secondary ve-first" title="First frame (Home)">⏮</button>
          <button type="button" class="btn-secondary ve-back10" title="Back 10 frames (Shift+←)">−10</button>
          <button type="button" class="btn-secondary ve-back" title="Back 1 frame (←)">−1</button>
          <button type="button" class="btn-secondary ve-play" title="Play what's kept, on into the next clips / pause (Space)">▶︎</button>
          <button type="button" class="btn-secondary ve-fwd" title="Forward 1 frame (→)">+1</button>
          <button type="button" class="btn-secondary ve-fwd10" title="Forward 10 frames (Shift+→)">+10</button>
          <button type="button" class="btn-secondary ve-last" title="Last frame (End)">⏭</button>
        </div>
        <div class="ve-edit">
          <button type="button" class="btn-secondary ve-start" title="Cut off everything in this clip before this frame ([)">⇤ Start here</button>
          <button type="button" class="btn-secondary ve-end" title="Cut off everything in this clip after this frame (])">End here ⇥</button>
          <button type="button" class="btn-secondary ve-in" title="Mark this frame as the first of a part to cut out (I)">Mark in</button>
          <button type="button" class="btn-secondary ve-out" title="Mark this frame as the last of a part to cut out (O)">Mark out</button>
          <button type="button" class="btn-secondary ve-cut" disabled title="Cut out the marked part (X)">✂ Cut selection</button>
          <button type="button" class="btn-secondary ve-split" title="Split this clip in two at this frame, which starts the second part — move, cut or drop each on its own (B)">⫽ Split here</button>
        </div>
        <div class="fp-strip-head">
          <span class="ve-count muted">No cuts in this clip.</span>
          <button type="button" class="link-btn ve-restore hidden">Restore all</button>
        </div>
        <div class="ve-cuts"></div>
        <div class="ve-frames">
          <span class="ve-frames-title">Frames</span>
          <button type="button" class="btn-secondary ve-pick" title="Pick / unpick the frame on screen, to save as an image (Enter)">＋ Pick frame</button>
          <button type="button" class="btn-secondary ve-lastframe" title="Pick this clip's last kept frame — e.g. to start the next generation from it (L)">⇥ Last frame</button>
          <span class="ve-fcount muted">No frames picked.</span>
          <button type="button" class="link-btn ve-fclear hidden">Clear</button>
          <span class="ve-frames-actions">
            <button type="button" class="btn-secondary ve-fdownload" disabled title="Download the picked frames as PNG files">⬇ Download</button>
            <button type="button" class="btn-secondary ve-fsave" disabled title="Save the picked frames to the project's gallery as images">Save to gallery</button>
          </span>
        </div>
        <div class="fp-strip ve-fstrip"></div>
      </div>
    </div>
    <div class="ve-mix hidden">
      <p class="ve-mix-head"></p>
      <ul class="ve-mix-list"></ul>
      <div class="ve-mix-opts">
        <label>Size &amp; frame rate from
          <select class="ve-size" title="Which clip the result takes its size and frame rate from"></select>
        </label>
        <label>Other clips
          <select class="ve-fit" title="How a clip of a different shape meets that size — it is never stretched">
            <option value="fit">Fit — keep everything, add black bars</option>
            <option value="fill">Fill — no bars, crop the edges</option>
          </select>
        </label>
      </div>
    </div>
    <div class="ve-target hidden">
      <label class="inline"><input type="checkbox" class="ve-overwrite" /> <span class="ve-overwrite-label"></span></label>
      <span class="muted ve-thint"></span>
    </div>
    <div class="ve-exports hidden">
      <span class="ve-exports-title">Saved from this project</span>
      <div class="ve-exports-list"></div>
    </div>
    <p class="muted ve-status ve-msg hidden"></p>
    <p class="sp-save-warn hidden ve-err"></p>
    <div class="modal-actions">
      <span class="ve-proj-actions">
        <button type="button" class="btn-secondary ve-popen" title="Open an edit project you saved, to carry on with it">📂 Open project…</button>
        <button type="button" class="btn-secondary ve-psave" disabled title="Save the clips, their order and cuts as a project to come back to and add to — no video is rendered (Ctrl+S)">💾 Save project</button>
      </span>
      <button type="button" class="btn-secondary ve-reset hidden" title="Remove every clip">Start over</button>
      <button type="button" class="btn-secondary ve-close">Close</button>
      <button type="button" class="btn-secondary ve-cancel hidden">Cancel export</button>
      <button type="button" class="btn-secondary ve-saveas" disabled title="Re-encode the result and choose where on this device to save it">Save as…</button>
      <button type="button" class="ve-save" disabled title="Re-encode the result and save it as a new file in this project's output folder (edited_videos) — existing files are never overwritten">💾 Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  // The "add videos" picker: GENie's own videos, or on to the device's file explorer.
  const lib = document.createElement("div");
  lib.id = "videoEditorLibrary";
  lib.className = "modal hidden";
  lib.innerHTML = `
  <div class="modal-box fp-box ve-lib-box" role="dialog" aria-labelledby="veLibHeading">
    <div class="pe-head">
      <h3 id="veLibHeading" class="ve-lib-title">Add videos</h3>
      <button type="button" class="link-btn pe-close ve-lib-close" title="Close (Esc)">×</button>
    </div>
    <div class="ve-lib-bar">
      <button type="button" class="btn-secondary ve-lib-device">📁 From this device…</button>
      <label class="inline" title="Show every project's videos, not only the active project's">
        <input type="checkbox" class="ve-lib-all" /> All projects
      </label>
      <span class="muted ve-lib-count"></span>
    </div>
    <div class="ve-lib-filters">
      <input type="search" class="ve-lib-q" placeholder="Search prompts — -word excludes" title="Every word must appear in the prompt, name or tags; a word starting with - must not" />
      <div class="ve-lib-chips"></div>
      <button type="button" class="link-btn ve-lib-clear hidden">Clear filters</button>
    </div>
    <p class="dz-hint ve-lib-empty hidden"></p>
    <div class="ve-lib-grid"></div>
    <button type="button" class="btn-secondary ve-lib-more hidden">Show more</button>
    <div class="modal-actions">
      <button type="button" class="btn-secondary ve-lib-close">Cancel</button>
      <button type="button" class="ve-lib-add" disabled>Add</button>
    </div>
  </div>`;
  document.body.appendChild(lib);

  // The saved edit projects, to open, rename or delete.
  const projBox = document.createElement("div");
  projBox.id = "videoEditorProjects";
  projBox.className = "modal hidden";
  projBox.innerHTML = `
  <div class="modal-box fp-box ve-projs-box" role="dialog" aria-labelledby="veProjsHeading">
    <div class="pe-head">
      <h3 id="veProjsHeading">Edit projects</h3>
      <button type="button" class="link-btn pe-close ve-projs-close" title="Close (Esc)">×</button>
    </div>
    <p class="dz-hint ve-projs-empty hidden"></p>
    <div class="ve-projs-list"></div>
    <div class="modal-actions">
      <button type="button" class="btn-secondary ve-projs-close">Close</button>
    </div>
  </div>`;
  document.body.appendChild(projBox);

  const el = {};
  for (const k of [
    "name", "drop", "file", "editor", "clips", "prepend", "append", "work", "scrub",
    "track", "pos", "result", "play", "start", "end", "in", "out", "cut", "count",
    "restore", "cuts", "mix", "size", "fit", "msg", "err", "reset", "cancel", "save",
    "saveas", "import", "pick", "lastframe", "fcount", "fclear", "fdownload", "fsave",
    "fstrip", "target", "overwrite", "thint", "proj", "popen", "psave", "exports", "split",
  ])
    el[k] = $(`.ve-${k}`, modal);
  el.badge = $(".ve-cut-badge", modal);
  const v = $("video", modal);

  // A clip: { file | remote, url, name, id, fps, frames, width, height, cur, markIn,
  //   markOut, cuts: [[start, end), …] sorted and merged, ready (on the server and
  //   measured), sent } — `file` is a picked file to upload, `remote` one of GENie's
  //   own videos, used where it lies.
  let clips = []; // in playing order
  let st = null; // the clip on screen — every frame edit applies to it
  let loaded = false; // the player has decoded st
  let playOnLoad = false; // carry playback across a clip boundary
  let job = null; // the running export's id ("starting" before it has one)
  let dirty = false;
  let ffmpegHint = null; // why the server can't export; "" when it can
  let pending = null;
  let seeking = false;
  let addWhere = "append";
  let sizeFrom = null; // the clip the result takes its size from; null = the largest
  let fit = "fit"; // how clips of another shape meet that size: "fit" | "fill"
  // Where Save puts the result when the editor was opened from a card:
  // { kind: "history" | "gallery", id, index, projectId } — null for the plain tool.
  let target = null;
  // Picked frames: { clip (null once its clip has gone), n, base, blob, thumb, last,
  //   savedId }.
  let picks = [];
  let savingFrames = false;
  // The saved edit project open in the editor (null for an unsaved one), and whether
  // it has changed since it was last saved. `dirty` is about the exported video.
  let editId = null;
  let editName = "";
  let projDirty = false;
  let editExports = []; // [{ url, name, at }] — the videos saved from the open project
  const touch = () => {
    dirty = projDirty = true;
  };
  // Where a clip lies on the server for good: one of GENie's own videos, or an upload
  // a saved edit has kept. null for an upload that's still only in the temp folder.
  const serverUrl = (c) => c.keptUrl || (c.remote ? c.url : null);
  const FALLBACK_FPS = 24; // without ffmpeg there's no way to read the real rate

  const live = () => !!st && st.ready && loaded;
  const show = (node, msg) => {
    node.textContent = msg || "";
    node.classList.toggle("hidden", !msg);
  };
  const showErr = (msg) => show(el.err, msg);
  const showStatus = (msg) => show(el.msg, msg);
  const noFfmpeg = () =>
    ffmpegHint ?
      `${ffmpegHint}. Until then you can step through videos and save frames (at an assumed ${FALLBACK_FPS} fps), but not cut, join or save video.`
    : "";
  const baseName = (clip) => String(clip.name || "video").replace(/\.[^.]+$/, "");
  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  // Same frame ↔ time mapping as the frame picker (frames.js).
  const timeOf = (n) => Math.min((n + 0.5) / st.fps, Math.max(0, v.duration - 0.0005));
  const frameAt = (t) => Math.max(0, Math.min(st.frames - 1, Math.floor(t * st.fps + 1e-6)));

  const cutAt = (n) => st.cuts.find(([s, e]) => n >= s && n < e);
  function kept(clip = st) {
    const out = [];
    let at = 0;
    for (const [s, e] of clip.cuts) {
      if (s > at) out.push([at, s]);
      at = e;
    }
    if (at < clip.frames) out.push([at, clip.frames]);
    return out;
  }
  const keptFrames = (clip = st) => kept(clip).reduce((n, [s, e]) => n + e - s, 0);
  const selection = () =>
    st.markIn != null && st.markOut != null ?
      [Math.min(st.markIn, st.markOut), Math.max(st.markIn, st.markOut) + 1]
    : null;

  // A clip's cuts with [s, e) cut out too, sorted and merged.
  function withCut(clip, s, e) {
    s = Math.max(0, s);
    e = Math.min(clip.frames, e);
    if (e <= s) return clip.cuts;
    const merged = [];
    for (const c of [...clip.cuts, [s, e]].sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
      else merged.push([...c]);
    }
    return merged;
  }

  function addCut(s, e) {
    const cuts = withCut(st, s, e);
    if (cuts === st.cuts) return;
    st.cuts = cuts;
    touch();
  }

  const pct = (n) => `${(n / st.frames) * 100}%`;
  function region(cls, [s, e]) {
    const d = document.createElement("span");
    d.className = cls;
    d.style.left = pct(s);
    d.style.width = pct(e - s);
    return d;
  }

  // ------------------------------------------------------------- rendering
  function render() {
    if (!live()) return;
    const n = st.cur;
    el.scrub.value = String(n);
    el.pos.textContent = `Frame ${n + 1} / ${st.frames} · ${fmtTime(n / st.fps)}`;
    el.badge.classList.toggle("hidden", !cutAt(n));
    el.split.disabled = !!job || !splitAt(n);
    el.play.textContent = v.paused ? "▶︎" : "❚❚";
    const picked = picks.some((p) => p.clip === st && p.n === n);
    el.pick.textContent = picked ? "✓ Picked — unpick" : "＋ Pick frame";
    el.pick.classList.toggle("on", picked);
    for (const t of el.fstrip.children) {
      const p = picks[Number(t.dataset.k)];
      t.classList.toggle("cur", !!p && p.clip === st && p.n === n);
    }
    let head = $(".ve-head", el.track);
    if (!head) {
      head = document.createElement("span");
      head.className = "ve-head";
      el.track.appendChild(head);
    }
    head.style.left = pct(n + 0.5);
  }

  // A clip's still: its first kept frame. The <video> is kept on the clip and only
  // re-pointed when that frame moves, so re-rendering the grid doesn't reload it.
  function clipThumb(clip) {
    if (!clip.thumb) {
      clip.thumb = document.createElement("video");
      clip.thumb.muted = true;
      clip.thumb.preload = "metadata";
      clip.thumb.playsInline = true;
    }
    const first = clip.ready && clip.fps ? (kept(clip)[0]?.[0] ?? 0) / clip.fps : 0;
    const src = `${clip.url}#t=${(first + 0.05).toFixed(3)}`;
    if (clip.thumbSrc !== src) {
      clip.thumbSrc = src;
      clip.thumb.src = src;
    }
    return clip.thumb;
  }

  // The clips, in playing order: a wrapping grid of cards (still, number, length,
  // name), dragged to reorder.
  const REORDER = "application/x-genie-clip";
  let dragFrom = -1;
  function renderClips() {
    el.clips.innerHTML = "";
    $(".ve-clips-title", el.editor).textContent =
      clips.length > 1 ? `${plural(clips.length, "clip")} — drag to reorder` : "";
    clips.forEach((clip, i) => {
      const chip = document.createElement("div");
      chip.className = `ve-clip${clip === st ? " active" : ""}`;
      chip.title = `${clip.name} — click to edit this clip`;
      chip.draggable = !job;
      chip.innerHTML =
        `<div class="ve-clip-thumb"><span class="ve-clip-n">${i + 1}</span>` +
        `<span class="ve-clip-dur"></span></div>` +
        `<div class="ve-clip-bar"><span class="ve-clip-name"></span>` +
        `<button type="button" class="link-btn" data-act="left" title="Move earlier">◀</button>` +
        `<button type="button" class="link-btn" data-act="right" title="Move later">▶</button>` +
        `<button type="button" class="link-btn" data-act="dup" title="Duplicate this clip, cuts and all, right after it (D)">⧉</button>` +
        `<button type="button" class="link-btn" data-act="remove" title="Remove this clip">×</button></div>`;
      $(".ve-clip-thumb", chip).prepend(clipThumb(clip));
      chip.addEventListener("dragstart", (e) => {
        dragFrom = i;
        e.dataTransfer.setData(REORDER, String(i));
        e.dataTransfer.effectAllowed = "move";
      });
      chip.addEventListener("dragend", () => {
        dragFrom = -1;
        for (const c of el.clips.children) c.classList.remove("drop-before", "drop-after");
      });
      chip.addEventListener("dragover", (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        e.stopPropagation();
        const r = chip.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        chip.classList.toggle("drop-after", after);
        chip.classList.toggle("drop-before", !after);
      });
      chip.addEventListener("dragleave", () => chip.classList.remove("drop-before", "drop-after"));
      chip.addEventListener("drop", (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        e.stopPropagation();
        const after = chip.classList.contains("drop-after");
        const from = dragFrom;
        dragFrom = -1;
        const [moved] = clips.splice(from, 1);
        clips.splice(clips.indexOf(clip) + (after ? 1 : 0), 0, moved);
        if (clips.indexOf(moved) !== from) touch();
        renderAll();
      });
      $(".ve-clip-name", chip).textContent = clip.name;
      $(".ve-clip-dur", chip).textContent =
        !clip.ready ? `${clip.sent}%`
        : clip.estimated && !clip.measured ? "…"
        : fmtTime(keptFrames(clip) / clip.fps);
      $('[data-act="left"]', chip).disabled = i === 0;
      $('[data-act="right"]', chip).disabled = i === clips.length - 1;
      chip.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (!act) return activate(clip);
        if (job) return;
        if (act === "remove") return removeClip(clip);
        if (act === "dup") return duplicateClip(clip);
        const to = i + (act === "left" ? -1 : 1);
        [clips[i], clips[to]] = [clips[to], clips[i]];
        touch();
        renderAll();
      });
      el.clips.appendChild(chip);
    });
    // Keep the clip on screen in view, scrolling the grid only (not the dialog).
    const a = $(".ve-clip.active", el.clips);
    if (a) {
      if (a.offsetTop < el.clips.scrollTop) el.clips.scrollTop = a.offsetTop;
      else if (a.offsetTop + a.offsetHeight > el.clips.scrollTop + el.clips.clientHeight)
        el.clips.scrollTop = a.offsetTop + a.offsetHeight - el.clips.clientHeight;
    }
  }

  // The clip whose size and frame rate the result takes: the one chosen, else the
  // largest of those that still have something to play.
  function baseClip() {
    const usable = clips.filter((c) => c.ready && keptFrames(c) > 0);
    if (!usable.includes(sizeFrom)) sizeFrom = null;
    return (
      sizeFrom ||
      usable.reduce((a, c) => (a && a.width * a.height >= c.width * c.height ? a : c), null)
    );
  }

  const sizeOf = (c) => `${c.width}×${c.height}`;
  const rateOf = (c) => `${+c.fps.toFixed(3)} fps`;
  // What saving will do to a clip that doesn't match the base, in words.
  function mismatch(c, base) {
    const out = [];
    if (c.width !== base.width || c.height !== base.height) {
      const shape = c.width / c.height / (base.width / base.height);
      const scaled = c.width * c.height < base.width * base.height ? "enlarged" : "shrunk";
      if (Math.abs(shape - 1) < 0.01) out.push(`${scaled} to ${sizeOf(base)}`);
      else if (fit === "fill")
        out.push(
          `${scaled} to fill ${sizeOf(base)}, cropping off its ${shape > 1 ? "left and right edges" : "top and bottom"}`,
        );
      else
        out.push(
          `${scaled} to fit inside ${sizeOf(base)}, with black bars ${shape > 1 ? "above and below" : "at the sides"}`,
        );
    }
    if (c.fps !== base.fps)
      out.push(
        `converted from ${rateOf(c)} to ${rateOf(base)} (frames are ${c.fps > base.fps ? "dropped" : "repeated"}, so motion may judder slightly)`,
      );
    return out.join("; ");
  }

  // The warning shown when the clips don't all match, with what saving will do about
  // it and the two choices that change that.
  function renderMix() {
    const base = baseClip();
    const usable = clips.filter((c) => c.ready && keptFrames(c) > 0);
    const odd = base ? usable.filter((c) => mismatch(c, base)) : [];
    el.mix.classList.toggle("hidden", !odd.length);
    if (!odd.length) return;
    const n = (c) => clips.indexOf(c) + 1;
    $(".ve-mix-head", el.mix).textContent =
      `⚠ These clips don't match. The result will be ${sizeOf(base)} at ${rateOf(base)}, like clip ${n(base)}:`;
    const list = $(".ve-mix-list", el.mix);
    list.innerHTML = "";
    for (const c of odd) {
      const li = document.createElement("li");
      li.textContent = `Clip ${n(c)} (${c.name}, ${sizeOf(c)}, ${rateOf(c)}) will be ${mismatch(c, base)}.`;
      list.appendChild(li);
    }
    el.size.innerHTML = "";
    el.size.add(new Option("the largest clip", ""));
    for (const c of usable)
      el.size.add(new Option(`clip ${n(c)} — ${sizeOf(c)}, ${rateOf(c)}`, String(clips.indexOf(c))));
    el.size.value = sizeFrom ? String(clips.indexOf(sizeFrom)) : "";
    el.fit.value = fit;
    el.size.disabled = el.fit.disabled = !!job;
  }

  // Everything that depends on the cuts and the clip list.
  function renderAll() {
    renderClips();
    const done = clips.filter((c) => c.ready);
    const seconds = done.reduce((t, c) => t + keptFrames(c) / c.fps, 0);
    const edited = clips.length > 1 || clips.some((c) => c.cuts.length);
    el.result.textContent =
      edited && done.length ?
        `Result: ${fmtTime(seconds)}${clips.length > 1 ? ` · ${plural(clips.length, "clip")}` : ""}`
      : "";
    renderMix();
    renderFrames();
    renderTarget();
    el.save.disabled = el.saveas.disabled =
      !!job || !!ffmpegHint || !edited || !clips.length || done.length < clips.length || !(seconds > 0);
    renderProject();
    el.name.textContent = st ? `— ${st.name}` : "";
    el.work.classList.toggle("ve-busy", !live());
    if (!live()) {
      if (st) el.pos.textContent = st.ready ? "Loading…" : "Sending the file to GENie…";
      return;
    }

    el.track.innerHTML = "";
    el.cuts.innerHTML = "";
    for (const c of st.cuts) {
      el.track.appendChild(region("ve-cut-region", c));
      const chip = document.createElement("span");
      chip.className = "ve-chip";
      chip.title = "Click to go there";
      chip.innerHTML = `<span></span><button type="button" class="fp-x" title="Put this part back">×</button>`;
      chip.firstChild.textContent = `${fmtTime(c[0] / st.fps)} – ${fmtTime(c[1] / st.fps)} · ${plural(c[1] - c[0], "frame")}`;
      chip.addEventListener("click", (e) => {
        if (!e.target.closest(".fp-x")) return go(c[0]);
        if (job) return;
        st.cuts = st.cuts.filter((x) => x !== c);
        touch();
        renderAll();
      });
      el.cuts.appendChild(chip);
    }
    const sel = selection();
    if (sel) el.track.appendChild(region("ve-sel", sel));
    else if (st.markIn != null || st.markOut != null) {
      const at = st.markIn ?? st.markOut;
      el.track.appendChild(region("ve-sel", [at, at + 1]));
    }
    const left = keptFrames();
    el.count.textContent =
      st.cuts.length ?
        `${plural(st.cuts.length, "cut")} in this clip · ${plural(st.frames - left, "frame")} removed`
      : "No cuts in this clip.";
    el.restore.classList.toggle("hidden", !st.cuts.length);
    el.cut.disabled = !sel;
    el.in.classList.toggle("on", st.markIn != null);
    el.out.classList.toggle("on", st.markOut != null);
    render();
  }

  // ------------------------------------------------------------- the player
  // Seek to frame n; rapid steps coalesce so the player never falls behind.
  function go(n) {
    if (!live()) return;
    n = Math.max(0, Math.min(st.frames - 1, Math.round(n)));
    if (!v.paused) v.pause();
    st.cur = n;
    render();
    if (seeking) {
      pending = n;
      return;
    }
    seeking = true;
    v.currentTime = timeOf(n);
  }
  v.addEventListener("seeked", () => {
    seeking = false;
    if (pending != null && live()) {
      const n = pending;
      pending = null;
      if (v.paused) return go(n);
    }
    render();
  });

  function playFrom(n) {
    st.cur = n;
    pending = null;
    v.currentTime = timeOf(n);
    v.play().catch(() => {});
  }

  // The next clip that has anything left to play, if playback should run on into it.
  const nextClip = () =>
    clips.slice(clips.indexOf(st) + 1).find((c) => c.ready && keptFrames(c) > 0);

  // This clip has nothing more to play: carry on into the next, or stop on `n`.
  function clipDone(n) {
    const next = nextClip();
    if (next) return activate(next, true);
    v.pause();
    go(n);
  }

  // While playing, follow the player and jump over whatever is cut out, so playback
  // previews the result. Stepped every animation frame, and on timeupdate too since
  // animation frames stop while the tab is in the background.
  function track() {
    if (!live() || v.paused) return false;
    const n = frameAt(v.currentTime);
    const c = cutAt(n);
    if (c && c[1] >= st.frames) {
      clipDone(Math.max(0, c[0] - 1));
      return false;
    }
    if (c && !v.seeking) v.currentTime = timeOf(c[1]);
    else if (!c) st.cur = n;
    render();
    return true;
  }
  const follow = () => track() && requestAnimationFrame(follow);
  v.addEventListener("play", follow);
  v.addEventListener("timeupdate", track);
  v.addEventListener("pause", () => live() && !seeking && !v.ended && go(frameAt(v.currentTime)));
  v.addEventListener("ended", () => live() && clipDone(st.frames - 1));

  function play() {
    if (!live()) return;
    if (!v.paused) return v.pause();
    // From here if anything kept lies ahead, else from this clip's first kept frame.
    const segs = kept();
    if (!segs.length) return;
    const ahead = st.cur < segs[segs.length - 1][1] - 1 && segs.find(([, e]) => e > st.cur);
    playFrom(ahead ? Math.max(st.cur, ahead[0]) : segs[0][0]);
  }

  // Once the clip on screen is both decoded and measured, show it.
  function enter() {
    if (!live()) return;
    // Without ffmpeg the length comes from the browser, in frames at the assumed rate.
    if (st.estimated && !st.measured && Number.isFinite(v.duration))
      Object.assign(st, {
        frames: Math.max(1, Math.round(v.duration * st.fps)),
        width: v.videoWidth,
        height: v.videoHeight,
        measured: true,
      });
    el.scrub.max = String(st.frames - 1);
    renderAll();
    const first = kept()[0];
    if (playOnLoad && first) playFrom(first[0]);
    else go(st.cur);
    playOnLoad = false;
  }
  v.addEventListener("loadeddata", () => {
    loaded = true;
    enter();
  });
  v.addEventListener("error", () => {
    if (st && v.getAttribute("src"))
      showErr(`This browser can't play ${st.name}, so it can't be previewed here.`);
  });

  // Put a clip on screen (and, carrying on from the clip before it, keep playing).
  function activate(clip, thenPlay = false) {
    if (clip === st && loaded && !thenPlay) return;
    if (!v.paused) v.pause();
    st = clip;
    loaded = false;
    playOnLoad = thenPlay;
    pending = null;
    seeking = false;
    showErr("");
    v.src = clip.url;
    v.load();
    renderAll();
  }

  // ------------------------------------------------------------- clips in and out
  function upload(clip) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      clip.xhr = xhr;
      xhr.open("POST", `${API}/upload?name=${encodeURIComponent(clip.name)}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || clip.ready) return;
        clip.sent = Math.round((e.loaded / e.total) * 100);
        if (clips.includes(clip)) renderClips();
      };
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status === 200 && data.data?.id) resolve(data.data);
        else reject(new Error(data.msg || `Upload failed (HTTP ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload failed — is the server still running?"));
      xhr.onabort = () => reject(new Error("aborted"));
      xhr.send(clip.file);
    });
  }

  const forget = (id) =>
    id && fetch(`${API}/source/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});

  // Get a clip onto the server: link one of GENie's own videos, or upload a file.
  const register = (clip) =>
    clip.remote ?
      api(`${API}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: serverUrl(clip) }),
      })
    : upload(clip);

  async function send(clip) {
    if (ffmpegHint) {
      // No ffmpeg on the server: nothing to measure or export with, so the clip is
      // previewed as it is, for stepping through and picking frames.
      Object.assign(clip, { fps: FALLBACK_FPS, estimated: true, ready: true });
      if (clip === st && loaded) enter();
      else renderAll();
      return;
    }
    try {
      const info = await register(clip);
      if (!clips.includes(clip)) return forget(info.id);
      Object.assign(clip, {
        id: info.id,
        fps: info.fps,
        frames: info.frames,
        width: info.width,
        height: info.height,
        ready: true,
      });
      if (clip === st && loaded) enter();
      else renderAll();
    } catch (err) {
      if (err.message === "aborted" || !clips.includes(clip)) return;
      removeClip(clip);
      showErr(`${clip.name}: ${err.message || err}`);
    }
  }

  const newClip = (from) => ({
    id: null,
    fps: 0,
    frames: 1,
    width: 0,
    height: 0,
    cur: 0,
    cuts: [],
    markIn: null,
    markOut: null,
    ready: false,
    sent: 0,
    ...from,
  });

  const addFiles = (files, where) =>
    addClips(
      [...files]
        .filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(f.name))
        .map((file) =>
          newClip({ file, url: URL.createObjectURL(file), name: file.name || "video.mp4" }),
        ),
      where,
    );

  function addClips(added, where) {
    if (!added.length) return;
    if (clips.length) touch();
    clips = where === "prepend" ? [...added, ...clips] : [...clips, ...added];
    el.drop.classList.add("hidden");
    el.import.classList.add("hidden");
    el.editor.classList.remove("hidden");
    el.reset.classList.remove("hidden");
    showStatus("");
    added.forEach(send);
    activate(added[0]);
  }

  // Let go of a clip that has left `clips` — its server source and local file only
  // once no split or duplicate of it still uses them.
  function release(clip) {
    clip.xhr?.abort();
    if (clip.thumb) {
      clip.thumb.removeAttribute("src");
      clip.thumb.load(); // release the decoder
    }
    if (!clips.some((c) => c.id === clip.id)) forget(clip.id);
    if (clip.file && !clips.some((c) => c.url === clip.url)) URL.revokeObjectURL(clip.url);
  }

  // A source the server had swept, sent again: every clip sharing it takes the new id.
  function resend(gone, id) {
    const old = gone.id;
    for (const c of clips) if (c.id === old) c.id = id;
    gone.id = id;
  }

  function unloadPlayer() {
    v.pause();
    v.removeAttribute("src");
    v.load(); // release the decoder
    st = null;
    loaded = false;
    playOnLoad = false;
    pending = null;
    seeking = false;
  }

  // A copy of a ready clip that shares its source (on the server and on the device).
  const copyOf = (clip, over) => {
    const { xhr, thumb, thumbSrc, ...rest } = clip;
    return { ...rest, cuts: clip.cuts.map((r) => [...r]), markIn: null, markOut: null, ...over };
  };

  function duplicateClip(clip) {
    if (job || !clip.ready) return;
    const copy = copyOf(clip);
    clips.splice(clips.indexOf(clip) + 1, 0, copy);
    touch();
    activate(copy);
  }

  // The two parts splitting st at frame n makes — n starts the second — or null when
  // one of them would have nothing to play.
  function splitAt(n) {
    if (!live() || n <= 0 || n >= st.frames) return null;
    const a = withCut(st, n, st.frames);
    const b = withCut(st, 0, n);
    const left = (cuts) => keptFrames({ cuts, frames: st.frames }) > 0;
    return left(a) && left(b) ? [a, b] : null;
  }

  // Split the clip on screen in two at the frame on screen; the second part is a new
  // clip right after it, and goes on screen.
  const split = () => {
    if (!live() || job) return;
    if (!v.paused) {
      v.pause();
      st.cur = frameAt(v.currentTime);
    }
    const parts = splitAt(st.cur);
    if (!parts) return showStatus("Nothing to split here — one part would be empty.");
    const second = copyOf(st, { cuts: parts[1], cur: st.cur });
    st.cuts = parts[0];
    st.markIn = st.markOut = null;
    st.cur = Math.max(0, st.cur - 1);
    clips.splice(clips.indexOf(st) + 1, 0, second);
    touch();
    activate(second);
  };

  function removeClip(clip) {
    const i = clips.indexOf(clip);
    if (i < 0) return;
    clips.splice(i, 1);
    release(clip);
    touch();
    for (const p of picks) if (p.clip === clip) p.clip = null; // keep its frames
    if (!clips.length) return clear({ keepFrames: true, keepTarget: true });
    if (clip === st) activate(clips[Math.min(i, clips.length - 1)]);
    else renderAll();
  }

  // keepFrames: picked frames stay (unlinked from their clips); keepTarget: Save still
  // goes to the card the editor was opened from.
  function clear({ keepFrames = false, keepTarget = false } = {}) {
    if (job && job !== "starting")
      fetch(`${API}/jobs/${job}`, { method: "DELETE", keepalive: true }).catch(() => {});
    job = null;
    const old = clips;
    clips = [];
    old.forEach(release);
    dirty = false;
    editId = null;
    editName = "";
    projDirty = false;
    editExports = [];
    unloadPlayer();
    el.name.textContent = "";
    el.drop.classList.remove("hidden");
    el.import.classList.remove("hidden");
    el.editor.classList.add("hidden");
    el.reset.classList.add("hidden");
    el.cancel.classList.add("hidden");
    el.save.disabled = el.saveas.disabled = true;
    sizeFrom = null;
    renderProject();
    el.mix.classList.add("hidden");
    if (keepFrames) for (const p of picks) p.clip = null;
    else picks = [];
    if (!keepTarget) target = null;
    renderFrames();
    renderTarget();
    showStatus("");
    showErr(noFfmpeg());
  }

  // ------------------------------------------------------------- saving
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = async (url, opts) => {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Object.assign(new Error(data.msg || `HTTP ${res.status}`), { status: res.status, id: data.id });
    return data.data;
  };

  async function startExport(list) {
    const post = () =>
      api(`${API}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: list.map((c) => ({ id: c.id, keep: kept(c) })),
          base: baseClip()?.id,
          fit,
        }),
      });
    // The server sweeps uploads after some hours and forgets its links to GENie's own
    // videos when it restarts; register again whichever it names.
    for (let tries = 0; ; tries++) {
      try {
        return await post();
      } catch (err) {
        const gone = err.status === 404 && list.find((c) => c.id === err.id);
        if (!gone || tries >= list.length) throw err;
        showStatus(`Sending ${gone.name} to GENie again…`);
        resend(gone, (await register(gone)).id);
      }
    }
  }

  // toFile: hand the result to the browser (a save dialog, or its downloads) instead
  // of keeping it in the project's edited_videos folder.
  async function save(toFile) {
    if (job || el.save.disabled) return;
    const toCard = !toFile && target ? { ...target, overwrite: el.overwrite.checked } : null;
    if (
      toCard?.overwrite &&
      !confirm(
        `Replace ${toCard.kind === "history" ? "the card's video" : "this Gallery video"} with the edit? The current file is deleted.`,
      )
    )
      return;
    const list = clips.filter((c) => keptFrames(c) > 0);
    const mine = clips; // the clip list this export belongs to
    const outName = `${list[0].name.replace(/\.[^.]+$/, "")}-edited.mp4`;
    showErr("");

    // Ask where to save first, while the click still counts as a user gesture. Only
    // Chromium offers this, and only to localhost / https pages; elsewhere the result
    // goes through the browser's normal download.
    let handle = null;
    if (toFile && window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: outName,
          types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
        });
      } catch (err) {
        if (err.name === "AbortError") return; // they closed the dialog
      }
    }

    el.save.disabled = el.saveas.disabled = true;
    el.cancel.classList.remove("hidden");
    const still = (id) => clips === mine && job === id;
    let jobId = null;
    let replaced = null; // what an overwrite saved, to carry on editing from
    try {
      job = "starting";
      showStatus("Starting…");
      jobId = (await startExport(list)).jobId;
      if (!still("starting")) throw new Error("cancelled");
      job = jobId;
      for (;;) {
        const state = await api(`${API}/jobs/${jobId}`);
        if (!still(jobId)) throw new Error("cancelled");
        if (state.state === "error") throw new Error(state.error || "The export failed");
        if (state.state === "done") break;
        showStatus(`Encoding… ${Math.round(state.progress * 100)}%`);
        await sleep(400);
      }
      const fileUrl = `${API}/jobs/${jobId}/file?name=${encodeURIComponent(outName)}`;
      if (toCard) {
        showStatus("Saving…");
        const saved = await api(`${API}/jobs/${jobId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: outName, target: toCard }),
        });
        jobId = null; // the server has moved it out of its temp folder
        await recordExport(saved);
        if (saved.kind === "history" && typeof loadHistory === "function") loadHistory();
        if (saved.kind === "gallery" && typeof loadGallery === "function") loadGallery();
        if (toCard.overwrite) replaced = saved;
        else
          showStatus(
            saved.kind === "history" ?
              `Added to the card as video ${saved.index + 1} of ${saved.count}.`
            : `Added to the Gallery as ${saved.name}.`,
          );
      } else if (!toFile) {
        showStatus("Saving…");
        const saved = await api(`${API}/jobs/${jobId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: outName,
            projectId: typeof activeProjectId !== "undefined" ? activeProjectId : "default",
          }),
        });
        jobId = null; // the server has moved it out of its temp folder
        await recordExport(saved);
        showStatus(`Saved to ${saved.folder} as `);
        const a = document.createElement("a");
        a.href = saved.url;
        a.target = "_blank";
        a.textContent = saved.name;
        a.title = "Open the saved video";
        el.msg.append(a, ".");
      } else if (handle) {
        showStatus("Saving…");
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`Couldn't fetch the result (HTTP ${res.status})`);
        await res.body.pipeTo(await handle.createWritable());
        showStatus(`Saved as ${handle.name}.`);
      } else {
        const a = document.createElement("a");
        a.href = fileUrl;
        a.download = outName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showStatus(
          `Sent to this browser's downloads as ${outName} — where it lands is the browser's own "ask where to save" setting.`,
        );
      }
      dirty = false;
    } catch (err) {
      if (jobId) fetch(`${API}/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
      if (clips === mine) {
        showStatus("");
        if (err.message !== "cancelled") showErr(err.message || String(err));
      }
    } finally {
      if (clips === mine) {
        job = null;
        el.cancel.classList.add("hidden");
        renderAll();
      }
    }
    // The card's old file is gone, so carry on from the saved edit: it is the card's
    // video now, uncut. Picked frames stay.
    if (replaced && clips === mine) {
      const card = { ...target, index: replaced.index ?? target.index };
      clear({ keepFrames: true, keepTarget: true });
      target = card;
      renderTarget();
      addClips([newClip({ remote: true, url: replaced.url, name: mine[0]?.name || replaced.name })], "append");
      showStatus(
        replaced.kind === "history" ?
          "Replaced the card's video — now editing the saved version."
        : "Replaced the Gallery video — now editing the saved version.",
      );
    }
  }

  // The "save to the card" choice, shown only when the editor was opened from one.
  function renderTarget() {
    el.target.classList.toggle("hidden", !target);
    const card = target?.kind === "history";
    const over = !!target && el.overwrite.checked;
    $(".ve-overwrite-label", el.target).textContent =
      card ? "Overwrite the card's current video" : "Overwrite the Gallery video";
    el.thint.textContent =
      !target ? ""
      : over ?
        card ? "Save replaces the card's video with the edit and deletes the current file."
        : "Save replaces the Gallery video with the edit (prompts using it get the edit) and deletes the current file."
      : card ? "Save adds the edit to the card as another video; the current one stays."
      : "Save adds the edit to the Gallery as a new video; this one stays.";
    el.save.textContent =
      !target ? "💾 Save"
      : over ? "💾 Overwrite video"
      : card ? "💾 Add to card"
      : "💾 Add to Gallery";
    el.save.title =
      target ? el.thint.textContent : (
        "Re-encode the result and save it as a new file in this project's output folder (edited_videos) — existing files are never overwritten"
      );
  }

  // ------------------------------------------------------------- frames
  const frameFile = (p) =>
    `${p.base}-${p.last ? "last-frame" : `f${String(p.n + 1).padStart(4, "0")}`}.png`;
  const unsavedFrames = () => picks.filter((p) => !p.savedId).length;
  const projectFor = () =>
    target?.projectId || (typeof activeProjectId !== "undefined" ? activeProjectId : "default");

  // The frame on screen as a full-size PNG plus a small thumbnail.
  function grab() {
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const tc = document.createElement("canvas");
    tc.height = 96;
    tc.width = Math.max(1, Math.round((v.videoWidth / v.videoHeight) * tc.height));
    tc.getContext("2d").drawImage(c, 0, 0, tc.width, tc.height);
    return new Promise((resolve, reject) =>
      c.toBlob(
        (blob) =>
          blob ? resolve({ blob, thumb: tc.toDataURL("image/jpeg", 0.8) })
          : reject(new Error("This browser couldn't read the frame.")),
        "image/png",
      ),
    );
  }

  // Resolves once the player has landed on the frame it was sent to.
  const settle = () =>
    new Promise((r) => {
      if (!seeking && pending == null) return r();
      const done = () => {
        if (seeking || pending != null) return;
        v.removeEventListener("seeked", done);
        r();
      };
      v.addEventListener("seeked", done);
    });

  // Pick (or unpick) the frame on screen; `last` picks the clip's last kept frame.
  async function pickFrame(last = false) {
    if (!live()) return;
    if (last) {
      const segs = kept();
      if (!segs.length) return;
      go(segs[segs.length - 1][1] - 1);
    } else if (!v.paused) go(frameAt(v.currentTime)); // settle on a whole frame
    await settle();
    if (!live()) return;
    const clip = st;
    const n = st.cur;
    const at = picks.findIndex((p) => p.clip === clip && p.n === n);
    if (at >= 0) {
      if (last) picks[at].last = true;
      else picks.splice(at, 1);
      return renderAll();
    }
    try {
      const { blob, thumb } = await grab();
      picks.push({ clip, n, base: baseName(clip), blob, thumb, last });
      renderAll();
    } catch (err) {
      showErr(err.message || String(err));
    }
  }

  function showPick(p) {
    if (p.clip === st) return go(p.n);
    p.clip.cur = p.n;
    activate(p.clip);
  }

  function renderFrames() {
    const order = (p) => (p.clip ? clips.indexOf(p.clip) : -1);
    el.fstrip.innerHTML = "";
    picks.sort((a, b) => order(a) - order(b) || a.n - b.n);
    picks.forEach((p, k) => {
      const t = document.createElement("div");
      t.className = `fp-thumb${p.savedId ? " saved" : ""}`;
      t.dataset.k = String(k);
      t.title = `${frameFile(p)}${p.savedId ? " (saved to the gallery)" : ""}${p.clip ? " — click to go there" : ""}`;
      t.innerHTML = `<img alt="" /><span></span><button type="button" class="fp-x" title="Unpick">×</button>`;
      $("img", t).src = p.thumb;
      const where = p.last ? "last" : String(p.n + 1);
      $("span", t).textContent =
        `${p.savedId ? "✓ " : ""}${clips.length > 1 && p.clip ? `${order(p) + 1}:` : ""}${where}`;
      t.addEventListener("click", (e) => {
        if (e.target.closest(".fp-x")) {
          picks = picks.filter((x) => x !== p);
          return renderAll();
        }
        if (p.clip && clips.includes(p.clip)) showPick(p);
      });
      el.fstrip.appendChild(t);
    });
    const c = picks.length;
    const todo = unsavedFrames();
    el.fcount.textContent =
      !c ? "No frames picked." : `${plural(c, "frame")} picked${c - todo ? ` · ${c - todo} saved` : ""}`;
    el.fclear.classList.toggle("hidden", !c);
    el.fdownload.disabled = !c;
    if (!savingFrames) {
      el.fsave.disabled = !todo;
      el.fsave.textContent =
        todo ? `Save ${todo} to gallery`
        : c ? "All saved ✓"
        : "Save to gallery";
    }
    el.pick.disabled = el.lastframe.disabled = !live();
  }

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  // One frame to the gallery, retried: a phone on Wi-Fi drops the odd large upload
  // ("Load failed" in Safari). Returns the new gallery entry's id.
  async function uploadFrame(p, projectId) {
    const base64Data = await blobToDataUrl(p.blob);
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64Data, fileName: frameFile(p), projectId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.image?.id) return data.image.id;
        lastErr = new Error(data.msg || `HTTP ${res.status}`);
        if (res.status >= 400 && res.status < 500) break; // the server refused it — retrying won't help
      } catch (err) {
        lastErr = err; // network drop: try again
      }
      if (attempt < 3) await sleep(attempt * 1500);
    }
    throw lastErr;
  }

  // Saves only the picks that aren't in the gallery yet, so pressing Save again after
  // a failure never duplicates the ones that made it.
  async function saveFrames() {
    if (savingFrames) return;
    const todo = picks.filter((p) => !p.savedId);
    if (!todo.length) return;
    savingFrames = true;
    el.fsave.disabled = true;
    showErr("");
    const projectId = projectFor();
    const failed = [];
    for (let i = 0; i < todo.length; i++) {
      el.fsave.textContent = `Saving ${i + 1} of ${todo.length}…`;
      try {
        todo[i].savedId = await uploadFrame(todo[i], projectId);
      } catch (err) {
        failed.push(`${frameFile(todo[i])} (${err.message || err})`);
      }
      renderFrames(); // ✓ on each thumbnail as it lands
    }
    savingFrames = false;
    if (typeof loadGallery === "function") loadGallery();
    if (failed.length)
      showErr(
        `${failed.join(", ")} didn't save after 3 tries — press Save again to retry just ${failed.length === 1 ? "that one" : "those"}.`,
      );
    renderFrames();
  }

  async function downloadFrames() {
    for (const p of [...picks]) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(p.blob);
      a.download = frameFile(p);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      await sleep(250); // browsers drop rapid-fire downloads
    }
  }

  // ------------------------------------------------------------- edit projects
  // The open project's name in the heading (• while it has unsaved changes), and
  // whether Save project can run: every clip must be on the server — an upload still
  // sending can't be kept yet, and without ffmpeg a device file never gets there.
  function renderProject() {
    el.proj.classList.toggle("hidden", !editId);
    el.proj.textContent = editId ? `📂 ${editName}${projDirty ? " •" : ""}` : "";
    el.proj.title = editId ? (projDirty ? "Edit project — has unsaved changes" : "Edit project — saved") : "";
    el.psave.disabled =
      !!job || !clips.length || clips.some((c) => !serverUrl(c) && !(c.ready && c.id));
    el.psave.textContent = editId && !projDirty ? "💾 Saved" : "💾 Save project";
    renderExports();
  }

  // The open project's saved videos, newest first: click one to watch it, ＋ to add it
  // as a clip after the last one.
  function renderExports() {
    el.exports.classList.toggle("hidden", !editExports.length);
    const list = $(".ve-exports-list", el.exports);
    list.innerHTML = "";
    const items = [...editExports].reverse();
    items.forEach((x, i) => {
      const chip = document.createElement("span");
      chip.className = "ve-chip ve-export";
      chip.title = `${x.name} — click to watch it`;
      chip.innerHTML =
        `<span></span><button type="button" class="fp-x" title="Add this video as a clip after the last one">＋</button>`;
      chip.firstChild.textContent = `${x.name} · ${projDate(x.at)}`;
      chip.addEventListener("click", (e) => {
        if (e.target.closest(".fp-x")) {
          if (!job) addClips([newClip({ remote: true, url: x.url, name: x.name })], "append");
          return;
        }
        if (typeof openLightbox !== "function") return window.open(x.url, "_blank");
        const all = items.map((it) => ({ kind: "video", src: it.url, name: it.name }));
        openLightbox("video", x.url, x.name, { items: all, index: i });
      });
      list.appendChild(chip);
    });
  }

  // List a video just saved (to edited_videos, a card or the Gallery) in the open
  // project. Best effort: the video itself is saved either way.
  async function recordExport(saved) {
    if (!editId || !saved?.url) return;
    try {
      editExports = await api(`${API}/edits/${editId}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: saved.url, name: saved.name }),
      });
      renderExports();
    } catch {}
  }

  async function saveProject() {
    if (el.psave.disabled) return;
    let name = editName;
    if (!editId) {
      name = prompt("Name this edit project:", baseName(clips[0]));
      if (name === null) return;
    }
    const list = clips.slice(); // what is being saved, should the clips change meanwhile
    const mine = clips;
    el.psave.disabled = true;
    showErr("");
    showStatus("Saving the project…");
    const post = () =>
      api(`${API}/edits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editId,
          name,
          projectId: typeof activeProjectId !== "undefined" ? activeProjectId : "default",
          clips: list.map((c) => ({
            url: serverUrl(c) || undefined,
            sourceId: serverUrl(c) ? undefined : c.id,
            name: c.name,
            cuts: c.cuts,
            markIn: c.markIn,
            markOut: c.markOut,
            cur: c.cur,
          })),
          sizeFrom: sizeFrom ? list.indexOf(sizeFrom) : null,
          fit,
        }),
      });
    try {
      let saved;
      // An upload the server has swept since is sent again, as for an export.
      for (let tries = 0; ; tries++) {
        try {
          saved = await post();
          break;
        } catch (err) {
          const gone = err.status === 404 && err.id && list.find((c) => c.id === err.id);
          if (!gone || tries >= list.length) throw err;
          showStatus(`Sending ${gone.name} to GENie again…`);
          resend(gone, (await register(gone)).id);
        }
      }
      // Uploads now lie in the project's sources folder; reopening or re-registering
      // a clip uses that copy. The player keeps the local file it already has.
      saved.clips.forEach((c, i) => {
        if (!serverUrl(list[i])) list[i].keptUrl = c.url;
      });
      if (clips !== mine) return;
      const first = !editId;
      editId = saved.id;
      editName = saved.name;
      projDirty = false;
      showStatus(first ? `Saved as the edit project “${saved.name}”.` : `Saved “${saved.name}”.`);
    } catch (err) {
      if (clips !== mine) return;
      showStatus("");
      showErr(`Couldn't save the project: ${err.message || err}`);
    } finally {
      if (clips === mine) renderAll();
    }
  }

  // Open a saved project in place of what's in the editor.
  async function openProject(id) {
    if (job || !confirmDiscard()) return;
    let edit;
    try {
      edit = await api(`${API}/edits/${encodeURIComponent(id)}`);
    } catch (err) {
      return alert(err.message || String(err));
    }
    closeProjects();
    clear();
    const missing = edit.clips.filter((c) => c.missing);
    const added = edit.clips
      .filter((c) => !c.missing)
      .map((c) =>
        newClip({
          remote: true,
          url: c.url,
          name: c.name,
          cuts: c.cuts.map((r) => [...r]),
          markIn: c.markIn,
          markOut: c.markOut,
          cur: c.cur,
        }),
      );
    editId = edit.id;
    editName = edit.name;
    editExports = edit.exports || [];
    fit = edit.fit === "fill" ? "fill" : "fit";
    if (added.length) {
      addClips(added, "append");
      const base = edit.clips[edit.sizeFrom];
      sizeFrom = base && !base.missing ? added[edit.clips.filter((c) => !c.missing).indexOf(base)] : null;
    }
    dirty = false;
    projDirty = missing.length > 0; // saving drops the missing clips from it
    renderAll();
    if (missing.length)
      showErr(
        `${plural(missing.length, "clip")} of this project ${missing.length === 1 ? "is" : "are"} no longer on disk and ${missing.length === 1 ? "was" : "were"} left out: ${missing.map((c) => c.name).join(", ")}.`,
      );
    else showStatus(`Opened “${edit.name}”.`);
  }

  function projDate(iso) {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  async function openProjects() {
    if (job) return;
    projBox.classList.remove("hidden");
    const list = $(".ve-projs-list", projBox);
    const empty = $(".ve-projs-empty", projBox);
    list.innerHTML = "";
    show(empty, "Loading…");
    let edits;
    try {
      edits = await api(`${API}/edits`);
    } catch (err) {
      return show(empty, `Couldn't list the projects: ${err.message || err}`);
    }
    show(
      empty,
      edits.length ? "" : "No saved edit projects yet — 💾 Save project in the editor keeps one to come back to.",
    );
    for (const e of edits) {
      const row = document.createElement("div");
      row.className = `ve-proj-row${e.id === editId ? " current" : ""}`;
      row.innerHTML =
        `<video muted playsinline preload="metadata"></video>` +
        `<div class="ve-proj-info"><strong></strong><span class="muted"></span></div>` +
        `<button type="button" class="btn-secondary" data-act="open">Open</button>` +
        `<button type="button" class="link-btn" data-act="rename" title="Rename">✎</button>` +
        `<button type="button" class="link-btn" data-act="delete" title="Delete this project">🗑</button>`;
      if (e.firstUrl) $("video", row).src = `${e.firstUrl}#t=0.1`;
      $("strong", row).textContent = e.name;
      $(".ve-proj-info .muted", row).textContent = [
        plural(e.clips, "clip"),
        e.exports && `${plural(e.exports, "saved video")}`,
        e.projectName && `📁 ${e.projectName}`,
        `saved ${projDate(e.updatedAt)}`,
      ]
        .filter(Boolean)
        .join(" · ");
      row.addEventListener("click", async (ev) => {
        const act = ev.target.closest("[data-act]")?.dataset.act;
        if (act === "open") return openProject(e.id);
        if (act === "rename") {
          const name = prompt("Rename this edit project:", e.name)?.trim();
          if (!name || name === e.name) return;
          try {
            await api(`${API}/edits/${e.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            });
            if (e.id === editId) {
              editName = name;
              renderProject();
            }
          } catch (err) {
            alert(err.message || String(err));
          }
          return openProjects();
        }
        if (act === "delete") {
          if (
            !confirm(
              `Delete the edit project “${e.name}”?\n\nVideos you saved from it stay. Clips uploaded from your device for it are deleted (GENie's own videos are never touched).` +
                (e.id === editId ? "\n\nIt's open in the editor, which is emptied." : ""),
            )
          )
            return;
          try {
            await api(`${API}/edits/${e.id}`, { method: "DELETE" });
            if (e.id === editId) clear(); // its kept uploads are gone with it
          } catch (err) {
            alert(err.message || String(err));
          }
          return openProjects();
        }
      });
      list.appendChild(row);
    }
  }

  function closeProjects() {
    projBox.classList.add("hidden");
    $(".ve-projs-list", projBox).innerHTML = ""; // let go of the thumbnails' decoders
  }

  // ------------------------------------------------------------- the picker
  const LIB_PAGE = 24;
  const L = {};
  for (const k of ["title", "device", "all", "count", "empty", "grid", "more", "add", "q", "chips", "clear"])
    L[k] = $(`.ve-lib-${k}`, lib);
  let libWhere = "append";
  let libAll = []; // everything listed for the project(s)
  let libItems = []; // the part of it the filters let through
  let libShown = 0;
  let libPicked = []; // in the order they were clicked, which is the order they're added

  // The picker's filters, kept server-side so they follow you between devices:
  // { q: search text, chips: { "src:History" | "tag:favorite": "in" | "out" } }.
  // Sources: "in" on any of them keeps only those sources. Tags: every "in" tag must
  // be on the video, no "out" tag may be. Search: every word must appear in the
  // prompt, name or tags; a -word must not.
  const LIB_FILTER_KEY = "genie_ve_lib_filter";
  let libFilter = { q: "", chips: {} };
  try {
    const saved = JSON.parse(typeof getPref === "function" ? getPref(LIB_FILTER_KEY, "{}") : "{}");
    libFilter = { q: String(saved.q || ""), chips: { ...saved.chips } };
  } catch {}
  let libFilterSave = null;
  function saveLibFilter() {
    clearTimeout(libFilterSave);
    libFilterSave = setTimeout(() => {
      if (typeof setPref === "function") setPref(LIB_FILTER_KEY, JSON.stringify(libFilter));
    }, 400);
  }

  const lower = (t) => String(t).toLowerCase();
  function libPasses(item) {
    const tags = (item.tags || []).map(lower);
    const srcIn = [];
    for (const [key, state] of Object.entries(libFilter.chips)) {
      const kind = key.slice(0, 4);
      const name = lower(key.slice(4));
      if (kind === "src:") {
        if (state === "in") srcIn.push(name);
        else if (lower(item.source) === name) return false;
      } else if (tags.includes(name) !== (state === "in")) return false;
    }
    if (srcIn.length && !srcIn.includes(lower(item.source))) return false;
    const text = lower([item.label, item.name, ...(item.tags || [])].join("\n"));
    for (const word of lower(libFilter.q).split(/\s+/).filter(Boolean)) {
      if (word.length > 1 && word.startsWith("-")) {
        if (text.includes(word.slice(1))) return false;
      } else if (!text.includes(word)) return false;
    }
    return true;
  }

  // One chip per source and per tag among the listed videos, plus any set chip whose
  // tag isn't among them (so it can still be cleared). Click: off → + → − → off;
  // right-click: straight to − (or back off).
  function renderLibraryChips() {
    const keys = new Map(); // key → label
    for (const src of ["History", "Gallery", "Edited"])
      if (libAll.some((it) => it.source === src)) keys.set(`src:${src}`, src);
    const tags = new Map();
    for (const it of libAll)
      for (const t of it.tags || []) if (!tags.has(lower(t))) tags.set(lower(t), t);
    for (const t of [...tags.values()].sort((a, b) => a.localeCompare(b))) keys.set(`tag:${t}`, t);
    for (const key of Object.keys(libFilter.chips))
      if (![...keys.keys()].some((k) => lower(k) === lower(key))) keys.set(key, key.slice(4));
    L.chips.innerHTML = "";
    for (const [key, label] of keys) {
      const chipKey = Object.keys(libFilter.chips).find((k) => lower(k) === lower(key)) || key;
      const state = libFilter.chips[chipKey] || "";
      const b = document.createElement("button");
      b.type = "button";
      b.className = `ve-lib-chip${key.startsWith("src:") ? " src" : ""}`;
      b.dataset.state = state;
      b.textContent = `${state === "in" ? "+ " : state === "out" ? "− " : ""}${label}`;
      b.title =
        state === "in" ? `Only videos ${key.startsWith("src:") ? "from" : "tagged"} ${label} — click to hide them instead`
        : state === "out" ? `Hiding videos ${key.startsWith("src:") ? "from" : "tagged"} ${label} — click to clear`
        : `Click to show only videos ${key.startsWith("src:") ? "from" : "tagged"} ${label}; right-click to hide them`;
      const set = (next) => {
        if (next) libFilter.chips[chipKey] = next;
        else delete libFilter.chips[chipKey];
        saveLibFilter();
        applyLibraryFilter();
      };
      b.addEventListener("click", () => set(state === "" ? "in" : state === "in" ? "out" : ""));
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        set(state === "out" ? "" : "out");
      });
      L.chips.appendChild(b);
    }
    L.clear.classList.toggle("hidden", !libFilter.q && !Object.keys(libFilter.chips).length);
  }

  // Re-list the grid through the filters; picks are kept even while filtered out.
  function applyLibraryFilter() {
    L.grid.innerHTML = "";
    libShown = 0;
    libItems = libAll.filter(libPasses);
    renderLibraryChips();
    show(
      L.empty,
      !libAll.length ?
        `No videos in ${L.all.checked ? "any project" : "this project"} yet — its History results, Gallery videos and saved edits show up here.`
      : !libItems.length ? "No videos match these filters."
      : "",
    );
    showMoreLibrary();
  }

  function renderLibraryPicks() {
    for (const tile of L.grid.children) {
      const at = libPicked.indexOf(libItems[Number(tile.dataset.i)]);
      tile.classList.toggle("picked", at >= 0);
      $(".ve-lib-pick", tile).textContent = at >= 0 ? String(at + 1) : "";
    }
    L.add.disabled = !libPicked.length;
    L.add.textContent = libPicked.length ? `Add ${plural(libPicked.length, "video")}` : "Add";
  }

  const libDate = (item) =>
    item.date ?
      new Date(item.date).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  // Watch a picker video full size, with sound, in the app's lightbox; its ‹ › step
  // through the picker's videos.
  function previewLibrary(item) {
    if (typeof openLightbox !== "function") return window.open(item.url, "_blank");
    const items = libItems.map((it) => ({
      kind: "video",
      src: it.url,
      name: [it.source, libDate(it), it.label || it.name].filter(Boolean).join(" · "),
    }));
    const index = libItems.indexOf(item);
    openLightbox("video", items[index].src, items[index].name, { items, index });
  }

  // A tile: the video (playing muted while hovered), its source, its date and length,
  // ⛶ to watch it full size, and the pick order once picked. Click picks or unpicks.
  function showMoreLibrary() {
    for (const item of libItems.slice(libShown, libShown + LIB_PAGE)) {
      const tile = document.createElement("div");
      tile.className = "ve-lib-item";
      tile.tabIndex = 0;
      tile.setAttribute("role", "button");
      tile.dataset.i = String(libItems.indexOf(item));
      tile.title = `${item.name}${item.label ? `\n${item.label}` : ""}`;
      tile.innerHTML =
        `<video muted loop playsinline preload="metadata"></video><span class="ve-lib-src"></span>` +
        `<span class="ve-lib-pick"></span>` +
        `<button type="button" class="ve-lib-view" title="Watch it full size, with sound">⛶</button>` +
        `<span class="ve-lib-label"></span>`;
      const vid = $("video", tile);
      vid.src = `${item.url}#t=0.1`;
      $(".ve-lib-src", tile).textContent = item.source;
      const label = $(".ve-lib-label", tile);
      label.textContent = libDate(item) || item.name;
      vid.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(vid.duration))
          label.textContent = [libDate(item), `${vid.duration.toFixed(1)}s`].filter(Boolean).join(" · ");
      });
      tile.addEventListener("mouseenter", () => vid.play().catch(() => {}));
      tile.addEventListener("mouseleave", () => {
        vid.pause();
        vid.currentTime = 0.1;
      });
      $(".ve-lib-view", tile).addEventListener("click", (e) => {
        e.stopPropagation();
        previewLibrary(item);
      });
      const toggle = () => {
        const at = libPicked.indexOf(item);
        if (at >= 0) libPicked.splice(at, 1);
        else libPicked.push(item);
        renderLibraryPicks();
      };
      tile.addEventListener("click", toggle);
      tile.addEventListener("keydown", (e) => {
        if (e.target !== tile || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        toggle();
      });
      L.grid.appendChild(tile);
    }
    libShown = Math.min(libItems.length, libShown + LIB_PAGE);
    L.more.classList.toggle("hidden", libShown >= libItems.length);
    L.count.textContent =
      !libAll.length ? ""
      : `Showing ${libShown} of ${libItems.length}` +
        (libItems.length < libAll.length ? ` (${libAll.length} in all)` : "");
    renderLibraryPicks();
  }

  async function loadLibrary() {
    L.grid.innerHTML = "";
    libAll = [];
    libItems = [];
    libShown = 0;
    libPicked = [];
    L.more.classList.add("hidden");
    L.count.textContent = "";
    show(L.empty, "Loading…");
    renderLibraryPicks();
    const all = L.all.checked;
    const projectId =
      all ? "all"
      : typeof activeProjectId !== "undefined" ? activeProjectId
      : "default";
    try {
      const items = await api(`${API}/library?projectId=${encodeURIComponent(projectId)}`);
      if (lib.classList.contains("hidden") || all !== L.all.checked) return;
      libAll = items;
      applyLibraryFilter();
    } catch (err) {
      show(L.empty, `Couldn't list GENie's videos: ${err.message || err}`);
    }
  }

  function openLibrary(where) {
    if (job) return;
    libWhere = where;
    L.title.textContent =
      !clips.length ? "Open videos"
      : where === "prepend" ? "Add videos before the first clip"
      : "Add videos after the last clip";
    lib.classList.remove("hidden");
    loadLibrary();
  }

  function closeLibrary() {
    lib.classList.add("hidden");
    L.grid.innerHTML = ""; // let go of the thumbnails' decoders
  }

  L.all.addEventListener("change", loadLibrary);
  L.q.value = libFilter.q;
  L.q.addEventListener("input", () => {
    libFilter.q = L.q.value;
    saveLibFilter();
    applyLibraryFilter();
  });
  L.clear.addEventListener("click", () => {
    libFilter = { q: "", chips: {} };
    L.q.value = "";
    saveLibFilter();
    applyLibraryFilter();
  });
  L.more.addEventListener("click", showMoreLibrary);
  L.device.addEventListener("click", () => {
    closeLibrary();
    pick(libWhere)();
  });
  L.add.addEventListener("click", () => {
    const added = libPicked.map((item) => newClip({ remote: true, url: item.url, name: item.name }));
    closeLibrary();
    addClips(added, libWhere);
  });
  lib.querySelectorAll(".ve-lib-close").forEach((b) => b.addEventListener("click", closeLibrary));
  lib.addEventListener("click", (e) => {
    if (e.target === lib) closeLibrary();
  });

  // ------------------------------------------------------------- open / close
  const confirmDiscard = () => {
    const frames = unsavedFrames();
    // An open edit project counts as saved once the project is, video or not.
    const unsaved = editId ? projDirty : dirty;
    if (!unsaved && !frames) return true;
    const what = [
      unsaved && (editId ? `the changes to “${editName}”` : "the edit"),
      frames && plural(frames, "picked frame"),
    ].filter(Boolean);
    return confirm(`Discard ${what.join(" and ")} you haven't saved?`);
  };

  // opts (from a card's ✂ Edit video): { url, name, projectId, card: { kind:
  // "history" | "gallery", id, index } } — opens the editor on that video, with Save
  // going back to the card. Without it, the plain tool.
  async function open(opts) {
    const from = opts?.url ? opts : null;
    if (from && !confirmDiscard()) return;
    modal.classList.remove("hidden");
    if (from || !clips.length) clear();
    try {
      ffmpegHint = (await api(`${API}/status`)).hint || "";
    } catch {
      ffmpegHint = "";
    }
    if (from) {
      showErr(noFfmpeg());
      target = from.card ? { ...from.card, projectId: from.projectId || "default" } : null;
      el.overwrite.checked = false;
      addClips([newClip({ remote: true, url: from.url, name: from.name || "video" })], "append");
    } else if (!clips.length) clear();
    else renderAll();
  }

  function close() {
    if (modal.classList.contains("hidden") || !confirmDiscard()) return;
    clear();
    modal.classList.add("hidden");
  }

  // ------------------------------------------------------------- wiring
  const pick = (where) => () => {
    if (job) return;
    addWhere = where;
    el.file.click();
  };
  el.drop.addEventListener("click", pick("append"));
  el.import.addEventListener("click", () => openLibrary("append"));
  el.append.addEventListener("click", () => openLibrary("append"));
  el.prepend.addEventListener("click", () => openLibrary("prepend"));
  el.file.addEventListener("change", () => {
    addFiles(el.file.files, addWhere);
    el.file.value = "";
  });
  // Files dropped anywhere on the dialog are added after the last clip.
  modal.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.drop.classList.add("dragover");
  });
  modal.addEventListener("dragleave", () => el.drop.classList.remove("dragover"));
  modal.addEventListener("drop", (e) => {
    e.preventDefault();
    el.drop.classList.remove("dragover");
    if (!job) addFiles(e.dataTransfer?.files || [], "append");
  });
  el.reset.addEventListener("click", () => confirmDiscard() && clear());
  el.size.addEventListener("change", () => {
    sizeFrom = el.size.value === "" ? null : clips[Number(el.size.value)];
    touch();
    renderAll();
  });
  el.fit.addEventListener("change", () => {
    fit = el.fit.value;
    touch();
    renderAll();
  });

  el.scrub.addEventListener("input", () => go(Number(el.scrub.value)));
  el.track.addEventListener("click", (e) => {
    if (!live()) return;
    const r = el.track.getBoundingClientRect();
    go(Math.floor(((e.clientX - r.left) / r.width) * st.frames));
  });
  $(".ve-first", modal).addEventListener("click", () => go(0));
  $(".ve-last", modal).addEventListener("click", () => st && go(st.frames - 1));
  $(".ve-back", modal).addEventListener("click", () => st && go(st.cur - 1));
  $(".ve-fwd", modal).addEventListener("click", () => st && go(st.cur + 1));
  $(".ve-back10", modal).addEventListener("click", () => st && go(st.cur - 10));
  $(".ve-fwd10", modal).addEventListener("click", () => st && go(st.cur + 10));
  el.play.addEventListener("click", play);

  // Every edit works on the frame on screen, so settle playback on a frame first.
  const edit = (fn) => () => {
    if (!live() || job) return;
    if (!v.paused) {
      v.pause();
      st.cur = frameAt(v.currentTime);
    }
    fn(st.cur);
    renderAll();
  };
  const startHere = edit((n) => addCut(0, n));
  const endHere = edit((n) => addCut(n + 1, st.frames));
  const markIn = edit((n) => (st.markIn = st.markIn === n ? null : n));
  const markOut = edit((n) => (st.markOut = st.markOut === n ? null : n));
  const cutSelection = edit(() => {
    const sel = selection();
    if (!sel) return;
    addCut(sel[0], sel[1]);
    st.markIn = st.markOut = null;
  });
  el.start.addEventListener("click", startHere);
  el.end.addEventListener("click", endHere);
  el.in.addEventListener("click", markIn);
  el.out.addEventListener("click", markOut);
  el.cut.addEventListener("click", cutSelection);
  el.split.addEventListener("click", split);
  el.restore.addEventListener("click", () => {
    if (!st || job) return;
    st.cuts = [];
    touch();
    renderAll();
  });

  el.pick.addEventListener("click", () => pickFrame());
  el.lastframe.addEventListener("click", () => pickFrame(true));
  el.fsave.addEventListener("click", saveFrames);
  el.fdownload.addEventListener("click", downloadFrames);
  el.fclear.addEventListener("click", () => {
    if (picks.length && confirm("Unpick all frames?")) {
      picks = [];
      renderAll();
    }
  });
  el.overwrite.addEventListener("change", renderTarget);
  el.psave.addEventListener("click", saveProject);
  el.popen.addEventListener("click", openProjects);
  projBox.querySelectorAll(".ve-projs-close").forEach((b) => b.addEventListener("click", closeProjects));
  projBox.addEventListener("click", (e) => {
    if (e.target === projBox) closeProjects();
  });
  el.save.addEventListener("click", () => save(false));
  el.saveas.addEventListener("click", () => save(true));
  el.cancel.addEventListener("click", () => {
    if (!job) return;
    if (job !== "starting") fetch(`${API}/jobs/${job}`, { method: "DELETE" }).catch(() => {});
    job = null; // the save loop sees this and stops
  });
  modal.querySelectorAll(".ve-close").forEach((b) => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  window.addEventListener("pagehide", clear);

  document.addEventListener("keydown", (e) => {
    if (modal.classList.contains("hidden")) return;
    // a preview open in the lightbox handles its own keys (Esc closes just it)
    if (document.getElementById("lightbox")?.classList.contains("hidden") === false) return;
    if (!projBox.classList.contains("hidden")) {
      // the project list is on top: Esc closes it, and the editor's shortcuts wait
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeProjects();
      }
      return;
    }
    if (!lib.classList.contains("hidden")) {
      // the picker is on top: Esc closes it, and the editor's shortcuts wait
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
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      return saveProject();
    }
    if (!live() || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 10 : 1;
    const keys = {
      ArrowLeft: () => go(st.cur - step),
      ArrowRight: () => go(st.cur + step),
      ",": () => go(st.cur - 1),
      ".": () => go(st.cur + 1),
      Home: () => go(0),
      End: () => go(st.frames - 1),
      " ": play,
      "[": startHere,
      "]": endHere,
      i: markIn,
      o: markOut,
      x: cutSelection,
      b: split,
      d: () => duplicateClip(st),
      Enter: () => pickFrame(),
      s: () => pickFrame(),
      l: () => pickFrame(true),
    };
    const fn = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  }, true);

  // ------------------------------------------------------------- entry point
  window.openVideoEditor = open;
  document.getElementById("openVideoEditor")?.addEventListener("click", () => open());
})();
