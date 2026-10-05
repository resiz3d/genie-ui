// --- 🎞 Frame picker: step through a video frame by frame, pick frames, save them --
// Loaded after app.js and uses its globals (loadGallery, activeProjectId).
// Exposes openFramePicker(url, name, projectId) and makeFramesButton(…), which
// app.js puts beside the ⇥ Last frame buttons. Frames are decoded by the browser
// (no ffmpeg); the server's ffprobe only supplies the real frame rate and count.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const FALLBACK_FPS = 24;

  const modal = document.createElement("div");
  modal.id = "framePickerModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
  <div class="modal-box fp-box" role="dialog" aria-labelledby="fpHeading">
    <div class="pe-head">
      <h3 id="fpHeading">🎞 Frames <span class="hint fp-name"></span></h3>
      <button type="button" class="link-btn pe-close fp-close" title="Close (Esc)">×</button>
    </div>
    <div class="fp-stage">
      <video class="fp-video" muted playsinline preload="auto"></video>
      <span class="fp-picked-badge hidden">✓ Picked</span>
    </div>
    <input type="range" class="fp-scrub" min="0" max="0" step="1" value="0" aria-label="Frame" />
    <div class="fp-ticks"></div>
    <div class="fp-readout">
      <span class="fp-pos">Loading…</span>
      <label class="fp-fps-wrap" title="Frames per second — read from the file when the server has ffprobe">
        <input type="number" class="fp-fps" min="1" max="240" step="any" /> fps
      </label>
    </div>
    <div class="fp-controls">
      <button type="button" class="btn-secondary fp-first" title="First frame (Home)">⏮</button>
      <button type="button" class="btn-secondary fp-back10" title="Back 10 frames (Shift+←)">−10</button>
      <button type="button" class="btn-secondary fp-back" title="Back 1 frame (←)">−1</button>
      <button type="button" class="btn-secondary fp-play" title="Play / pause (Space)">▶︎</button>
      <button type="button" class="btn-secondary fp-fwd" title="Forward 1 frame (→)">+1</button>
      <button type="button" class="btn-secondary fp-fwd10" title="Forward 10 frames (Shift+→)">+10</button>
      <button type="button" class="btn-secondary fp-last" title="Last frame (End)">⏭</button>
    </div>
    <div class="fp-pick-row">
      <button type="button" class="fp-pick" title="Pick / unpick this frame (Enter or S)">＋ Pick this frame</button>
    </div>
    <div class="fp-strip-head">
      <span class="fp-count muted">No frames picked yet.</span>
      <button type="button" class="link-btn fp-clear hidden">Clear all</button>
    </div>
    <div class="fp-strip"></div>
    <p class="sp-save-warn hidden fp-err"></p>
    <div class="modal-actions">
      <button type="button" class="btn-secondary fp-close">Close</button>
      <button type="button" class="btn-secondary fp-download" disabled title="Download the picked frames as PNG files">⬇ Download</button>
      <button type="button" class="fp-save" disabled>Save to gallery</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const el = {
    name: $(".fp-name", modal),
    video: $(".fp-video", modal),
    badge: $(".fp-picked-badge", modal),
    scrub: $(".fp-scrub", modal),
    ticks: $(".fp-ticks", modal),
    pos: $(".fp-pos", modal),
    fps: $(".fp-fps", modal),
    play: $(".fp-play", modal),
    pick: $(".fp-pick", modal),
    count: $(".fp-count", modal),
    clear: $(".fp-clear", modal),
    strip: $(".fp-strip", modal),
    err: $(".fp-err", modal),
    save: $(".fp-save", modal),
    download: $(".fp-download", modal),
  };
  const v = el.video;

  let st = null; // { url, name, projectId, fps, frames, duration, cur, picked: Map }
  let pending = null; // a frame to seek to once the current seek lands
  let seeking = false;

  const showErr = (msg) => {
    el.err.textContent = msg || "";
    el.err.classList.toggle("hidden", !msg);
  };
  const baseName = () => String(st?.name || "video").replace(/\.[^.]+$/, "");
  const frameFile = (n) => `${baseName()}-f${String(n + 1).padStart(4, "0")}.png`;
  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
  };
  // The middle of frame n (so rounding never lands on its neighbour); the last frame
  // is parked just before the end, where every browser still shows it.
  const timeOf = (n) => Math.min((n + 0.5) / st.fps, Math.max(0, st.duration - 0.0005));
  const frameAt = (t) =>
    Math.max(0, Math.min(st.frames - 1, Math.floor(t * st.fps + 1e-6)));

  function setFrames() {
    st.frames = Math.max(1, st.probedFrames && st.probedFps === st.fps ?
      st.probedFrames
    : Math.round(st.duration * st.fps));
    el.scrub.max = String(st.frames - 1);
  }

  function render() {
    if (!st) return;
    const n = st.cur;
    el.scrub.value = String(n);
    el.pos.textContent = `Frame ${n + 1} / ${st.frames} · ${fmtTime(n / st.fps)}`;
    const on = st.picked.has(n);
    el.badge.classList.toggle("hidden", !on);
    el.pick.textContent = on ? "✓ Picked — unpick" : "＋ Pick this frame";
    el.pick.classList.toggle("on", on);
    el.play.textContent = v.paused ? "▶︎" : "❚❚";
    for (const t of el.strip.children) t.classList.toggle("cur", Number(t.dataset.n) === n);
  }

  function renderPicked() {
    const list = [...st.picked.values()].sort((a, b) => a.n - b.n);
    el.strip.innerHTML = "";
    el.ticks.innerHTML = "";
    for (const f of list) {
      const t = document.createElement("div");
      t.className = `fp-thumb${f.savedId ? " saved" : ""}`;
      t.dataset.n = f.n;
      t.title = `Frame ${f.n + 1}${f.savedId ? " (saved to the gallery)" : ""} — click to go there`;
      t.innerHTML = `<img src="${f.thumb}" alt="" /><span>${f.savedId ? "✓ " : ""}${f.n + 1}</span><button type="button" class="fp-x" title="Unpick">×</button>`;
      t.addEventListener("click", (e) => {
        if (e.target.closest(".fp-x")) {
          unpick(f.n);
          return;
        }
        go(f.n);
      });
      el.strip.appendChild(t);
      const tick = document.createElement("span");
      tick.style.left = `${st.frames > 1 ? (f.n / (st.frames - 1)) * 100 : 0}%`;
      el.ticks.appendChild(tick);
    }
    const c = list.length;
    const todo = list.filter((f) => !f.savedId).length;
    el.count.textContent =
      !c ? "No frames picked yet."
      : `${c} frame${c === 1 ? "" : "s"} picked${c - todo ? ` · ${c - todo} saved` : ""}`;
    el.clear.classList.toggle("hidden", !c);
    el.download.disabled = !c;
    if (!st.saving) {
      el.save.disabled = !todo;
      el.save.textContent =
        todo ? `Save ${todo} to gallery`
        : c ? "All saved ✓"
        : "Save to gallery";
    }
    render();
  }

  // Seek to frame n; rapid steps coalesce so the player never falls behind.
  function go(n) {
    if (!st) return;
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
    if (pending != null && st) {
      const n = pending;
      pending = null;
      go(n);
      return;
    }
    render();
  });
  v.addEventListener("timeupdate", () => {
    if (st && !v.paused) {
      st.cur = frameAt(v.currentTime);
      render();
    }
  });
  v.addEventListener("pause", () => st && go(frameAt(v.currentTime))); // snap to a whole frame
  v.addEventListener("play", render);
  v.addEventListener("ended", render);

  // The frame on screen as a full-size PNG plus a small thumbnail.
  function grab() {
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const tc = document.createElement("canvas");
    const h = 96;
    tc.height = h;
    tc.width = Math.max(1, Math.round((v.videoWidth / v.videoHeight) * h));
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

  const settle = () =>
    new Promise((r) => {
      if (!seeking && pending == null) return r();
      const done = () => {
        if (!seeking && pending == null) {
          v.removeEventListener("seeked", done);
          r();
        }
      };
      v.addEventListener("seeked", done);
    });

  async function togglePick() {
    if (!st) return;
    if (!v.paused) {
      v.pause(); // the pause handler snaps to the frame on screen
    }
    await settle();
    const n = st.cur;
    if (st.picked.has(n)) return unpick(n);
    try {
      const { blob, thumb } = await grab();
      st.picked.set(n, { n, blob, thumb });
      renderPicked();
    } catch (err) {
      showErr(err.message || String(err));
    }
  }
  function unpick(n) {
    st.picked.delete(n);
    renderPicked();
  }

  async function open(url, name, projectId) {
    showErr("");
    st = {
      url,
      name,
      projectId: projectId || (typeof activeProjectId !== "undefined" ? activeProjectId : "default"),
      fps: FALLBACK_FPS,
      frames: 1,
      duration: 0,
      cur: 0,
      picked: new Map(),
      probedFps: null,
      probedFrames: null,
    };
    pending = null;
    seeking = false;
    el.name.textContent = name ? `— ${name}` : "";
    el.pos.textContent = "Loading…";
    el.fps.value = "";
    renderPicked();
    modal.classList.remove("hidden");

    const probe = fetch(`/api/video/probe?url=${encodeURIComponent(url)}`)
      .then((r) => r.json().then((d) => (r.ok ? d.data : null)))
      .catch(() => null);
    const meta = new Promise((resolve, reject) => {
      const ok = () => {
        v.removeEventListener("error", bad);
        resolve();
      };
      const bad = () => {
        v.removeEventListener("loadeddata", ok);
        reject(new Error("This browser couldn't decode the video."));
      };
      v.addEventListener("loadeddata", ok, { once: true });
      v.addEventListener("error", bad, { once: true });
    });
    v.src = url;
    v.load();
    try {
      const [p] = await Promise.all([probe, meta]);
      if (!st || st.url !== url) return; // closed or reopened meanwhile
      st.duration = Number.isFinite(v.duration) ? v.duration : p?.duration || 0;
      if (p?.fps) {
        st.fps = st.probedFps = Math.round(p.fps * 1000) / 1000;
        st.probedFrames = p.frames;
        el.fps.title = "Read from the file";
      } else {
        el.fps.title = `Couldn't read the frame rate — assuming ${FALLBACK_FPS}. Change it if stepping skips or repeats frames.`;
        showErr(`Couldn't read this video's frame rate, so ${FALLBACK_FPS} fps is assumed — set the right value beside the frame counter if steps skip or repeat.`);
      }
      el.fps.value = String(st.fps);
      setFrames();
      go(0);
    } catch (err) {
      showErr(err.message || String(err));
    }
  }

  function close() {
    if (!st) return modal.classList.add("hidden");
    if (
      unsavedCount() &&
      !confirm(`Close without saving the ${unsavedCount()} picked frame${unsavedCount() === 1 ? "" : "s"} that ${unsavedCount() === 1 ? "isn't" : "aren't"} in the gallery yet?`)
    )
      return;
    v.pause();
    v.removeAttribute("src");
    v.load(); // release the decoder
    st = null;
    modal.classList.add("hidden");
  }

  // ------------------------------------------------------------- wiring
  el.scrub.addEventListener("input", () => go(Number(el.scrub.value)));
  el.fps.addEventListener("change", () => {
    const f = Number(el.fps.value);
    if (!st || !(f > 0)) return (el.fps.value = st ? String(st.fps) : "");
    const oldFps = st.fps;
    const t = st.cur / oldFps;
    st.fps = f;
    setFrames();
    // Picks keep their time (and their already-grabbed image) under the new rate.
    st.picked = new Map(
      [...st.picked.values()].map((x) => {
        const n = Math.min(st.frames - 1, Math.round((x.n / oldFps) * f));
        return [n, { ...x, n }];
      }),
    );
    renderPicked();
    go(Math.round(t * f));
  });
  $(".fp-first", modal).addEventListener("click", () => go(0));
  $(".fp-last", modal).addEventListener("click", () => st && go(st.frames - 1));
  $(".fp-back", modal).addEventListener("click", () => st && go(st.cur - 1));
  $(".fp-fwd", modal).addEventListener("click", () => st && go(st.cur + 1));
  $(".fp-back10", modal).addEventListener("click", () => st && go(st.cur - 10));
  $(".fp-fwd10", modal).addEventListener("click", () => st && go(st.cur + 10));
  el.play.addEventListener("click", () => {
    if (!st) return;
    if (v.paused) {
      if (st.cur >= st.frames - 1) v.currentTime = 0;
      v.play().catch(() => {});
    } else v.pause();
  });
  el.pick.addEventListener("click", togglePick);
  el.clear.addEventListener("click", () => {
    if (st && confirm("Unpick all frames?")) {
      st.picked.clear();
      renderPicked();
    }
  });
  modal.querySelectorAll(".fp-close").forEach((b) => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  const unsavedCount = () =>
    st ? [...st.picked.values()].filter((f) => !f.savedId).length : 0;

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  // One frame to the gallery, retried: a phone on Wi-Fi drops the odd large upload
  // ("Load failed" in Safari). Returns the new gallery entry's id.
  async function uploadFrame(f, projectId) {
    const base64Data = await blobToDataUrl(f.blob);
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64Data, fileName: frameFile(f.n), projectId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.image?.id) return data.image.id;
        lastErr = new Error(data.msg || `HTTP ${res.status}`);
        if (res.status >= 400 && res.status < 500) break; // the server refused it — retrying won't help
      } catch (err) {
        lastErr = err; // network drop: try again
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
    throw lastErr;
  }

  // Saves only the picks that aren't in the gallery yet, so pressing Save again after
  // a failure never duplicates the ones that made it.
  el.save.addEventListener("click", async () => {
    if (!st || st.saving) return;
    const run = st;
    const todo = [...run.picked.values()].filter((f) => !f.savedId).sort((a, b) => a.n - b.n);
    if (!todo.length) return;
    run.saving = true;
    el.save.disabled = true;
    showErr("");
    const failed = [];
    for (let i = 0; i < todo.length; i++) {
      if (st === run) el.save.textContent = `Saving ${i + 1} of ${todo.length}…`;
      try {
        todo[i].savedId = await uploadFrame(todo[i], run.projectId);
      } catch (err) {
        failed.push(`${todo[i].n + 1} (${err.message || err})`);
      }
      if (st === run) renderPicked(); // ✓ on each thumbnail as it lands
    }
    run.saving = false;
    if (typeof loadGallery === "function") loadGallery();
    if (st !== run) return;
    if (failed.length)
      showErr(
        `Frame${failed.length === 1 ? "" : "s"} ${failed.join(", ")} didn't save after 3 tries — press Save again to retry just ${failed.length === 1 ? "that one" : "those"}.`,
      );
    renderPicked();
  });

  el.download.addEventListener("click", async () => {
    if (!st?.picked.size) return;
    const list = [...st.picked.values()].sort((a, b) => a.n - b.n);
    for (const f of list) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(f.blob);
      a.download = frameFile(f.n);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      await new Promise((r) => setTimeout(r, 250)); // browsers drop rapid-fire downloads
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!st || modal.classList.contains("hidden")) return;
    if (e.target === el.fps) return; // typing a frame rate
    const step = e.shiftKey ? 10 : 1;
    const keys = {
      ArrowLeft: () => go(st.cur - step),
      ArrowRight: () => go(st.cur + step),
      ",": () => go(st.cur - 1),
      ".": () => go(st.cur + 1),
      Home: () => go(0),
      End: () => go(st.frames - 1),
      " ": () => el.play.click(),
      Enter: togglePick,
      s: togglePick,
      S: togglePick,
      Escape: close,
    };
    const fn = keys[e.key];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  }, true);

  // ------------------------------------------------------------- entry points
  window.openFramePicker = open;
  // A "🎞 Frames" button beside the ⇥ Last frame ones.
  window.makeFramesButton = (url, name, projectId, { iconOnly = false } = {}) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary";
    btn.innerHTML = iconOnly ? "🎞" : '<span class="btn-ico">🎞</span> Frames';
    btn.title = "Step through this video frame by frame and save the frames you pick to the gallery";
    btn.addEventListener("click", () => open(url, name, projectId));
    return btn;
  };
})();
