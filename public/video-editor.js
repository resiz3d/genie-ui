// --- ✂ Video editor: trim clips, cut parts out, join clips, save the result ---------
// A standalone tool, opened from the header: it takes files from the device's file
// explorer (not the gallery) and saves the result wherever the user chooses. The
// browser previews the files itself; the server (video-editor.js, ffmpeg) does the
// re-encode.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const API = "/api/video-editor";

  const modal = document.createElement("div");
  modal.id = "videoEditorModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
  <div class="modal-box fp-box ve-box" role="dialog" aria-labelledby="veHeading">
    <div class="pe-head">
      <h3 id="veHeading">✂ Video editor <span class="hint ve-name"></span></h3>
      <button type="button" class="link-btn pe-close ve-close" title="Close (Esc)">×</button>
    </div>
    <div class="dropzone ve-drop">
      <p class="dz-hint">Drop videos here or <span class="browse">browse</span></p>
    </div>
    <input type="file" class="ve-file" accept="video/*,.mkv,.mov" multiple hidden />
    <div class="ve-editor hidden">
      <div class="ve-clips-row">
        <button type="button" class="btn-secondary ve-prepend" title="Add videos before the first clip">＋ Prepend</button>
        <div class="ve-clips"></div>
        <button type="button" class="btn-secondary ve-append" title="Add videos after the last clip">Append ＋</button>
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
        </div>
        <div class="fp-strip-head">
          <span class="ve-count muted">No cuts in this clip.</span>
          <button type="button" class="link-btn ve-restore hidden">Restore all</button>
        </div>
        <div class="ve-cuts"></div>
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
    <p class="muted ve-status ve-msg hidden"></p>
    <p class="sp-save-warn hidden ve-err"></p>
    <div class="modal-actions">
      <button type="button" class="btn-secondary ve-reset hidden" title="Remove every clip">Start over</button>
      <button type="button" class="btn-secondary ve-close">Close</button>
      <button type="button" class="btn-secondary ve-cancel hidden">Cancel export</button>
      <button type="button" class="ve-save" disabled title="Re-encode the result and choose where to save it">💾 Save as…</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const el = {};
  for (const k of [
    "name", "drop", "file", "editor", "clips", "prepend", "append", "work", "scrub",
    "track", "pos", "result", "play", "start", "end", "in", "out", "cut", "count",
    "restore", "cuts", "mix", "size", "fit", "msg", "err", "reset", "cancel", "save",
  ])
    el[k] = $(`.ve-${k}`, modal);
  el.badge = $(".ve-cut-badge", modal);
  const v = $("video", modal);

  // A clip: { file, url, name, id, fps, frames, width, height, cur, markIn, markOut,
  //   cuts: [[start, end), …] sorted and merged, ready (uploaded and measured), sent }
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

  const live = () => !!st && st.ready && loaded;
  const show = (node, msg) => {
    node.textContent = msg || "";
    node.classList.toggle("hidden", !msg);
  };
  const showErr = (msg) => show(el.err, msg);
  const showStatus = (msg) => show(el.msg, msg);
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

  function addCut(s, e) {
    s = Math.max(0, s);
    e = Math.min(st.frames, e);
    if (e <= s) return;
    const merged = [];
    for (const c of [...st.cuts, [s, e]].sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
      else merged.push([...c]);
    }
    st.cuts = merged;
    dirty = true;
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
    el.play.textContent = v.paused ? "▶︎" : "❚❚";
    let head = $(".ve-head", el.track);
    if (!head) {
      head = document.createElement("span");
      head.className = "ve-head";
      el.track.appendChild(head);
    }
    head.style.left = pct(n + 0.5);
  }

  // The clip strip: one chip per clip, in playing order.
  function renderClips() {
    el.clips.innerHTML = "";
    clips.forEach((clip, i) => {
      const chip = document.createElement("div");
      chip.className = `ve-clip${clip === st ? " active" : ""}`;
      chip.title = `${clip.name} — click to edit this clip`;
      chip.innerHTML =
        `<span class="ve-clip-n">${i + 1}</span><span class="ve-clip-name"></span>` +
        `<span class="ve-clip-dur muted"></span>` +
        `<button type="button" class="link-btn" data-act="left" title="Move earlier">◀</button>` +
        `<button type="button" class="link-btn" data-act="right" title="Move later">▶</button>` +
        `<button type="button" class="link-btn" data-act="remove" title="Remove this clip">×</button>`;
      $(".ve-clip-name", chip).textContent = clip.name;
      $(".ve-clip-dur", chip).textContent =
        clip.ready ? fmtTime(keptFrames(clip) / clip.fps) : `${clip.sent}%`;
      $('[data-act="left"]', chip).disabled = i === 0;
      $('[data-act="right"]', chip).disabled = i === clips.length - 1;
      chip.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (!act) return activate(clip);
        if (job) return;
        if (act === "remove") return removeClip(clip);
        const to = i + (act === "left" ? -1 : 1);
        [clips[i], clips[to]] = [clips[to], clips[i]];
        dirty = true;
        renderAll();
      });
      el.clips.appendChild(chip);
    });
    $(".ve-clip.active", el.clips)?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
    el.save.disabled =
      !!job || !!ffmpegHint || !edited || !clips.length || done.length < clips.length || !(seconds > 0);
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
        dirty = true;
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

  async function send(clip) {
    try {
      const info = await upload(clip);
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

  function addFiles(files, where) {
    const added = [...files]
      .filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(f.name))
      .map((file) => ({
        file,
        url: URL.createObjectURL(file),
        name: file.name || "video.mp4",
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
      }));
    if (!added.length) return;
    dirty = dirty || clips.length > 0;
    clips = where === "prepend" ? [...added, ...clips] : [...clips, ...added];
    el.drop.classList.add("hidden");
    el.editor.classList.remove("hidden");
    el.reset.classList.remove("hidden");
    showStatus("");
    added.forEach(send);
    activate(added[0]);
  }

  function release(clip) {
    clip.xhr?.abort();
    forget(clip.id);
    URL.revokeObjectURL(clip.url);
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

  function removeClip(clip) {
    const i = clips.indexOf(clip);
    if (i < 0) return;
    clips.splice(i, 1);
    release(clip);
    if (!clips.length) return clear();
    if (clip === st) activate(clips[Math.min(i, clips.length - 1)]);
    else renderAll();
  }

  function clear() {
    if (job && job !== "starting")
      fetch(`${API}/jobs/${job}`, { method: "DELETE", keepalive: true }).catch(() => {});
    job = null;
    clips.forEach(release);
    clips = [];
    dirty = false;
    unloadPlayer();
    el.name.textContent = "";
    el.drop.classList.remove("hidden");
    el.editor.classList.add("hidden");
    el.reset.classList.add("hidden");
    el.cancel.classList.add("hidden");
    el.save.disabled = true;
    sizeFrom = null;
    el.mix.classList.add("hidden");
    showStatus("");
    showErr(ffmpegHint || "");
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
    // The server sweeps uploads after some hours; send again whichever it names.
    for (let tries = 0; ; tries++) {
      try {
        return await post();
      } catch (err) {
        const gone = err.status === 404 && list.find((c) => c.id === err.id);
        if (!gone || tries >= list.length) throw err;
        showStatus(`Sending ${gone.name} to GENie again…`);
        gone.id = (await upload(gone)).id;
      }
    }
  }

  async function save() {
    if (job || el.save.disabled) return;
    const list = clips.filter((c) => keptFrames(c) > 0);
    const mine = clips; // the clip list this export belongs to
    const outName = `${list[0].name.replace(/\.[^.]+$/, "")}-edited.mp4`;
    showErr("");

    // Ask where to save first, while the click still counts as a user gesture. Only
    // Chromium offers this, and only to localhost / https pages; elsewhere the result
    // goes through the browser's normal download.
    let handle = null;
    if (window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: outName,
          types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
        });
      } catch (err) {
        if (err.name === "AbortError") return; // they closed the dialog
      }
    }

    el.save.disabled = true;
    el.cancel.classList.remove("hidden");
    const still = (id) => clips === mine && job === id;
    let jobId = null;
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
      if (handle) {
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
  }

  // ------------------------------------------------------------- open / close
  const confirmDiscard = () => !dirty || confirm("Discard the edit you haven't saved?");

  async function open() {
    modal.classList.remove("hidden");
    if (!clips.length) clear();
    try {
      ffmpegHint = (await api(`${API}/status`)).hint || "";
    } catch {
      ffmpegHint = "";
    }
    if (!clips.length) clear();
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
  el.append.addEventListener("click", pick("append"));
  el.prepend.addEventListener("click", pick("prepend"));
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
    dirty = true;
    renderAll();
  });
  el.fit.addEventListener("change", () => {
    fit = el.fit.value;
    dirty = true;
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
  el.restore.addEventListener("click", () => {
    if (!st || job) return;
    st.cuts = [];
    renderAll();
  });

  el.save.addEventListener("click", save);
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
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return close();
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
    };
    const fn = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  }, true);

  // ------------------------------------------------------------- entry point
  window.openVideoEditor = open;
  document.getElementById("openVideoEditor")?.addEventListener("click", open);
})();
