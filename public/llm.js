// --- ✨ Build with AI: vision-LLM prompt builder + LLM settings --------------
// Loaded after app.js and uses its globals (activeProjectId, galleryItems,
// savedPanel, loadSavedPrompts, setPromptTab, openPromptEditor, savedPrompts).
// The server does the work (llm.js): this file only starts builds, shows their
// progress, holds the shot list between a build's two steps, and edits
// settings/llm.json.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const gb = (bytes) => (bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "");
  const ACTIVE = ["queued", "waiting", "loading", "generating"];

  async function api(url, method = "GET", body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || `Request failed (${res.status})`);
    return data.data;
  }

  let cfg = null; // public settings from the server
  let models = []; // models of the builder's source, from the last listing
  let modelsErr = "";
  let status = { jobs: [], inUse: null, gpu: null };
  const seenCreated = new Map(); // jobId → prompts already picked up
  const seenStatus = new Map(); // jobId → its status when last seen

  async function loadCfg() {
    cfg = await api("/api/llm/settings");
    return cfg;
  }
  const activeSource = () =>
    cfg?.sources.find((s) => s.id === cfg.activeSourceId) || cfg?.sources[0] || null;

  // ------------------------------------------------------------- markup
  const buildModal = document.createElement("div");
  buildModal.id = "llmBuildModal";
  buildModal.className = "modal hidden";
  buildModal.innerHTML = `
  <div class="modal-box llm-box" role="dialog" aria-labelledby="llmBuildHeading">
    <div class="pe-head">
      <h3 id="llmBuildHeading">✨ Build prompts with AI</h3>
      <span>
        <button type="button" class="link-btn llm-open-settings" title="LLM settings">⚙ LLM settings</button>
        <button type="button" class="link-btn pe-close llm-close" title="Close (Esc)">×</button>
      </span>
    </div>
    <p class="muted llm-intro">A vision model looks at the images you pick and writes a <b>shot list</b> from your
      description and theme. Edit the shots and add breaks where a new prompt should start; the model then writes the rest of
      each prompt around its shots, without changing them, and saves it to <b class="llm-proj"></b>'s Saved Prompts with the
      images as its references.</p>
    <div class="llm-recent-row">
      <select class="llm-recent" title="Fill the form from an earlier build in this project"></select>
      <span class="muted llm-saved-note"></span>
    </div>
    <div class="llm-source-row">
      <label>LLM
        <select class="llm-b-source"></select>
      </label>
      <div class="llm-model-line muted"></div>
    </div>
    <label><span>Format <span class="hint">— what kind of saved prompt it writes</span></span>
      <select class="llm-format">
        <option value="default">Default — plain prompt text</option>
        <option value="minimax">MiniMax H3 — reference-to-video (subjects, shots, retention…)</option>
        <option value="minimax_t2v">MiniMax T2V — text-to-video (no images)</option>
      </select>
    </label>
    <div class="llm-images">
      <div class="pe-refs-head">Images <span class="hint">— click to pick, in order: they become &lt;Picture 1&gt;, &lt;Picture 2&gt;…</span></div>
      <p class="dz-hint llm-noimg hidden">No images in this project's gallery yet — add some in the Gallery section of the form.</p>
      <div class="thumbs gallery llm-grid"></div>
    </div>
    <label><span>What should happen <span class="hint">— a short description</span></span>
      <textarea class="llm-desc" rows="3" placeholder="e.g. She notices the tiny man on her desk, picks him up and inspects him curiously"></textarea>
    </label>
    <label><span>Theme <span class="hint">— style, mood, genre</span></span>
      <input type="text" class="llm-theme" maxlength="2000" placeholder="e.g. playful, warm office lighting, handheld camera" />
    </label>
    <label><span>Rules <span class="hint">— what to always do, never do, how to write dialogue… The model treats these as firm rules.</span></span>
      <textarea class="llm-rules" rows="5" placeholder="e.g.&#10;- Write dialogue as: &lt;name&gt; says, &quot;…&quot;&#10;- Never describe the camera cutting away during the action&#10;- Keep every character's outfit exactly as in the images"></textarea>
    </label>
    <div class="llm-row3">
      <label title="How many shots the shot list has.">Shot count
        <input type="number" class="llm-count" min="1" max="60" step="1" value="3" />
      </label>
      <label title="The whole video's length: the shots' lengths add up to it.">Duration (s)
        <input type="number" class="llm-dur" min="1" step="1" placeholder="—" />
      </label>
      <label>Title prefix
        <input type="text" class="llm-prefix" maxlength="100" placeholder="optional" />
      </label>
    </div>
    <p class="sp-save-warn hidden llm-b-err"></p>
    <div class="modal-actions">
      <button type="button" class="btn-secondary llm-close">Close</button>
      <button type="button" class="llm-go">✨ Build shot list</button>
    </div>
    <div class="llm-shots hidden">
      <div class="pe-refs-head">Shot list <span class="hint">— edit the shots, then add a break wherever a new prompt should start. The shots go into the prompts exactly as they are here.</span></div>
      <label>Video title
        <input type="text" class="llm-sl-title" maxlength="120" placeholder="names the prompt, or the prompt group" />
      </label>
      <div class="llm-sl-list"></div>
      <div class="llm-sl-foot">
        <button type="button" class="btn-secondary llm-sl-add">＋ Add shot</button>
        <span class="hint llm-sl-total"></span>
      </div>
      <p class="sp-save-warn hidden llm-sl-err"></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary llm-sl-clear">🗑 Discard list</button>
        <button type="button" class="llm-sl-go">✨ Write prompts</button>
      </div>
    </div>
    <div class="llm-jobs"></div>
  </div>`;
  document.body.appendChild(buildModal);

  const setModal = document.createElement("div");
  setModal.id = "llmSettingsModal";
  setModal.className = "modal hidden";
  setModal.innerHTML = `
  <div class="modal-box llm-box" role="dialog" aria-labelledby="llmSetHeading">
    <div class="pe-head">
      <h3 id="llmSetHeading">⚙ LLM settings</h3>
      <button type="button" class="link-btn pe-close llm-s-close" title="Close (Esc)">×</button>
    </div>
    <div class="llm-source-row">
      <label>Server
        <select class="llm-s-pick"></select>
      </label>
      <span class="llm-s-btns">
        <button type="button" class="btn-secondary llm-s-add">＋ Add</button>
        <button type="button" class="btn-secondary llm-s-del">🗑 Remove</button>
      </span>
    </div>
    <div class="llm-s-source">
      <div class="pe-row">
        <label>Name <input type="text" class="llm-s-name" maxlength="80" /></label>
        <label>Type
          <select class="llm-s-kind"></select>
        </label>
      </div>
      <label class="llm-s-url-wrap"><span>Server URL <span class="hint">— the OpenAI-compatible address, with or without /v1</span></span>
        <input type="text" class="llm-s-url" placeholder="http://127.0.0.1:1234" autocomplete="off" />
      </label>
      <label class="llm-s-key-wrap"><span>API key <span class="hint llm-s-keyhint"></span></span>
        <input type="password" class="llm-s-key" autocomplete="new-password" placeholder="none" />
      </label>
      <label class="inline hidden llm-s-clearkey-wrap"><input type="checkbox" class="llm-s-clearkey" /> Remove the saved key</label>
      <div class="llm-s-llama hidden">
        <label><span>llama-server program <span class="hint">— the full path to llama-server (llama-server.exe on Windows)</span></span>
          <input type="text" class="llm-s-exe" autocomplete="off" spellcheck="false" placeholder="C:\\llama.cpp\\llama-server.exe" />
        </label>
        <label><span>Model file <span class="hint">— the .gguf to serve</span></span>
          <input type="text" class="llm-s-mpath" autocomplete="off" spellcheck="false" placeholder="C:\\models\\Qwen3-VL-8B-Instruct-Q4_K_M.gguf" />
        </label>
        <label><span>Vision projector <span class="hint">— the model's mmproj .gguf; leave empty for a text-only model</span></span>
          <input type="text" class="llm-s-mmproj" autocomplete="off" spellcheck="false" placeholder="C:\\models\\mmproj-Qwen3-VL-8B-Instruct-F16.gguf" />
        </label>
        <div class="pe-row">
          <label><span>Port <span class="hint">— one nothing else uses</span></span>
            <input type="number" class="llm-s-port" min="1" max="65535" step="1" />
          </label>
          <label><span>Extra arguments <span class="hint">— e.g. --threads 12</span></span>
            <input type="text" class="llm-s-extra" autocomplete="off" spellcheck="false" />
          </label>
        </div>
        <p class="muted llm-s-llama-hint"></p>
      </div>
      <div class="llm-s-test-row">
        <button type="button" class="btn-secondary llm-s-test">🔌 Test &amp; list models</button>
        <button type="button" class="btn-secondary hidden llm-s-unload" title="A CPU-only server keeps its model loaded between jobs. This unloads it now, freeing the RAM; the next job loads it again.">⏏ Unload model</button>
        <span class="muted llm-s-test-out"></span>
      </div>
      <label class="llm-s-model-wrap">Model
        <select class="llm-s-model-pick hidden"></select>
        <input type="text" class="llm-s-model" autocomplete="off" spellcheck="false" placeholder="test the server to list its models, or type an id" />
      </label>
      <p class="muted llm-s-model-info"></p>
      <div class="pe-row">
        <label title="How much free VRAM the model needs before GENie loads it. 0 = the model file size plus the headroom below."><span>VRAM needed (GB) <span class="hint">0 = auto</span></span>
          <input type="number" class="llm-s-vram" min="0" step="0.5" />
        </label>
        <label><span>Context length <span class="hint">tokens</span></span>
          <input type="number" class="llm-s-ctx" min="0" step="1024" />
        </label>
      </div>
      <label class="inline" title="For a model kept in system RAM (no GPU layers). GENie then doesn't wait for ComfyUI or check VRAM before using it, a generation doesn't interrupt it, and it stays loaded. Its jobs run alongside a GPU build."><input type="checkbox" class="llm-s-cpu" /> CPU only <span class="hint">— runs in system RAM: no turn-taking with ComfyUI, and it stays loaded</span></label>
      <details class="llm-adv">
        <summary>Load options (advanced)</summary>
        <label><span class="hint llm-s-args-hint"></span>
          <textarea class="llm-s-args" rows="3" spellcheck="false" placeholder="{}"></textarea>
        </label>
      </details>
    </div>
    <h4 class="llm-h4">Sharing the GPU with ComfyUI</h4>
    <label class="inline"><input type="checkbox" class="llm-o-free" /> Unload ComfyUI's models when the LLM doesn't fit</label>
    <label class="inline"><input type="checkbox" class="llm-o-unload" /> Unload the LLM when a build finishes</label>
    <div class="llm-row3">
      <label title="After ComfyUI's queue empties, wait this long before reloading the LLM — so a quick next generation doesn't make it load and unload again.">Resume after idle (s)
        <input type="number" class="llm-o-delay" min="0" step="5" />
      </label>
      <label title="Give up if there still isn't enough free VRAM after this long.">Wait for VRAM (min)
        <input type="number" class="llm-o-wait" min="1" step="1" />
      </label>
      <label title="Added to the model file size when VRAM needed is auto — room for the context and the vision projector.">Headroom (GB)
        <input type="number" class="llm-o-head" min="0" step="0.5" />
      </label>
    </div>
    <h4 class="llm-h4">✨ Analyze images <span class="hint">— in the prompt editor: fills in subject definitions and retention</span></h4>
    <div class="pe-row">
      <label>Server
        <select class="llm-o-analyze"></select>
      </label>
      <label title="Images are scaled down to this before they're sent. Smaller is faster — on a CPU most of the time goes into reading the image."><span>Image size <span class="hint">px, longest side</span></span>
        <input type="number" class="llm-o-asize" min="256" max="2048" step="64" />
      </label>
    </div>
    <h4 class="llm-h4">Writing</h4>
    <div class="pe-row">
      <label>Temperature <input type="number" class="llm-o-temp" min="0" max="2" step="0.05" /></label>
      <label>Max tokens per prompt <input type="number" class="llm-o-tok" min="64" step="256" /></label>
    </div>
    <label><span>Instructions <span class="hint">— the system prompt for the Default format (the MiniMax formats use their own). Keep the JSON reply format at the end.</span></span>
      <textarea class="llm-o-instr" rows="10"></textarea>
    </label>
    <p><button type="button" class="link-btn llm-o-reset">↺ Reset instructions to default</button></p>
    <p class="sp-save-warn hidden llm-s-err"></p>
    <div class="modal-actions">
      <button type="button" class="btn-secondary llm-s-close">Cancel</button>
      <button type="button" class="llm-s-save">💾 Save</button>
    </div>
  </div>`;
  document.body.appendChild(setModal);

  // Entry point on the Saved Prompts tab, plus a progress line under the toolbar.
  const toolbar = savedPanel.querySelector(".sp-toolbar");
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "link-btn llm-open";
  openBtn.textContent = "✨ Build with AI";
  openBtn.title =
    "Have a vision LLM (LM Studio, text-generation-webui, Ollama…) write prompts from images, a description and a theme";
  toolbar.prepend(openBtn);
  const note = document.createElement("div");
  note.className = "llm-note hidden";
  toolbar.after(note);

  // ------------------------------------------------------------ builder
  const b = {
    source: $(".llm-b-source", buildModal),
    modelLine: $(".llm-model-line", buildModal),
    grid: $(".llm-grid", buildModal),
    noimg: $(".llm-noimg", buildModal),
    desc: $(".llm-desc", buildModal),
    theme: $(".llm-theme", buildModal),
    count: $(".llm-count", buildModal),
    dur: $(".llm-dur", buildModal),
    prefix: $(".llm-prefix", buildModal),
    err: $(".llm-b-err", buildModal),
    go: $(".llm-go", buildModal),
    jobs: $(".llm-jobs", buildModal),
    proj: $(".llm-proj", buildModal),
    format: $(".llm-format", buildModal),
    images: $(".llm-images", buildModal),
    rules: $(".llm-rules", buildModal),
    recent: $(".llm-recent", buildModal),
    savedNote: $(".llm-saved-note", buildModal),
  };
  // T2V takes no references: the picker is hidden and nothing picked is sent.
  const syncFormat = () =>
    b.images.classList.toggle("hidden", b.format.value === "minimax_t2v");
  b.format.addEventListener("change", () => {
    syncFormat();
    saveDraftSoon();
  });
  syncFormat();
  let picked = []; // gallery ids, in order

  // ---- the form, remembered on the server per project (every browser sees it) ----
  let recent = []; // earlier builds' inputs, newest first
  let formProject = null; // the project the form currently holds
  let draftTimer = null;

  function formValues() {
    return {
      format: b.format.value,
      description: b.desc.value,
      theme: b.theme.value,
      rules: b.rules.value,
      shotCount: Number(b.count.value) || 1,
      duration: b.dur.value ? Number(b.dur.value) : null,
      titlePrefix: b.prefix.value,
      imageIds: picked,
    };
  }

  function fillBuildForm(f) {
    const has = (v) => [...b.format.options].some((o) => o.value === v);
    b.format.value = has(f.format) ? f.format : "default";
    b.desc.value = f.description || "";
    b.theme.value = f.theme || "";
    b.rules.value = f.rules || "";
    b.count.value = f.shotCount || 3;
    b.dur.value = f.duration || "";
    b.prefix.value = f.titlePrefix || "";
    picked = [...(f.imageIds || [])];
    syncFormat();
    renderGrid();
  }

  function saveDraftSoon() {
    if (!formProject) return;
    clearTimeout(draftTimer);
    b.savedNote.textContent = "";
    draftTimer = setTimeout(saveDraftNow, 800);
  }
  async function saveDraftNow() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!formProject) return;
    try {
      await api("/api/llm/builder", "PUT", { projectId: formProject, draft: formValues() });
      b.savedNote.textContent = "✓ saved";
    } catch (err) {
      b.savedNote.textContent = `⚠ not saved: ${err.message}`;
    }
  }

  const when = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  function renderRecent() {
    b.recent.innerHTML = "";
    b.recent.appendChild(
      new Option(recent.length ? `↺ Recent builds (${recent.length})…` : "↺ No earlier builds in this project yet", ""),
    );
    recent.forEach((r, i) => {
      const what = (r.description || r.theme || "(images only)").replace(/\s+/g, " ").slice(0, 70);
      const fmt = r.format === "minimax" ? " · MiniMax" : r.format === "minimax_t2v" ? " · T2V" : "";
      b.recent.appendChild(
        new Option(`${when(r.at)} — ${what}${fmt} · ${r.shotCount} shot${r.shotCount === 1 ? "" : "s"}`, String(i)),
      );
    });
    b.recent.disabled = !recent.length;
  }
  b.recent.addEventListener("change", () => {
    const r = recent[Number(b.recent.value)];
    b.recent.value = "";
    if (!r) return;
    fillBuildForm(r);
    saveDraftNow();
  });

  // Load this project's form from the server (the first time, a project with no
  // saved form gets the rules used most recently anywhere).
  async function loadForm() {
    const projectId = activeProjectId;
    formProject = null;
    try {
      const d = await api(`/api/llm/builder?projectId=${encodeURIComponent(projectId)}`);
      if (projectId !== activeProjectId) return;
      recent = d.recent || [];
      shotList = d.shotList || null;
      renderShots();
      if (d.draft) fillBuildForm(d.draft);
      else {
        // First time here. The format picked in older versions was kept per browser.
        let format = "default";
        try {
          format = localStorage.getItem("genie.llmFormat") || "default";
        } catch {
          /* storage unavailable */
        }
        const dur = typeof currentDuration === "function" ? currentDuration() : null;
        fillBuildForm({ format, rules: d.lastRules || "", shotCount: 3, duration: dur });
      }
      renderRecent();
      b.savedNote.textContent = "";
      formProject = projectId;
    } catch (err) {
      showErr(b.err, err.message);
    }
  }

  for (const el of [b.desc, b.theme, b.rules, b.count, b.dur, b.prefix])
    el.addEventListener("input", saveDraftSoon);

  const projectImages = () =>
    (typeof galleryItems !== "undefined" ? galleryItems : []).filter(
      (i) =>
        (i.projectId || "default") === activeProjectId &&
        (i.kind === "image" || String(i.mime || "").startsWith("image/")),
    );

  function renderGrid() {
    const imgs = projectImages();
    picked = picked.filter((id) => imgs.some((i) => i.id === id));
    b.noimg.classList.toggle("hidden", imgs.length > 0);
    b.grid.innerHTML = "";
    for (const it of imgs) {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "thumb llm-pick";
      const n = picked.indexOf(it.id);
      if (n >= 0) t.classList.add("on");
      t.title = `${it.name}${it.key ? ` — @${it.key}` : ""}${it.definition ? `\n${it.definition}` : ""}`;
      t.innerHTML =
        `<img src="${h(it.localUrl)}" alt="" loading="lazy" />` +
        (n >= 0 ? `<span class="llm-badge">Picture ${n + 1}</span>` : "") +
        (it.key ? `<span class="llm-key">@${h(it.key)}</span>` : "");
      t.addEventListener("click", () => {
        const i = picked.indexOf(it.id);
        if (i >= 0) picked.splice(i, 1);
        else if (picked.length >= 10) return alert("Up to 10 images per build.");
        else picked.push(it.id);
        renderGrid();
        renderModelLine();
        saveDraftSoon();
      });
      b.grid.appendChild(t);
    }
  }

  function fillSourceSelect(sel, value) {
    sel.innerHTML = "";
    for (const s of cfg.sources) sel.appendChild(new Option(s.name, s.id));
    sel.value = value;
  }

  async function refreshModels() {
    const src = activeSource();
    models = [];
    modelsErr = "";
    renderModelLine("checking…");
    if (!src) return renderModelLine();
    try {
      const d = await api("/api/llm/models", "POST", { sourceId: src.id });
      models = d.models || [];
      status.gpu = d.gpu || status.gpu;
    } catch (err) {
      modelsErr = err.message;
    }
    renderModelLine();
  }

  function renderModelLine(extra) {
    const src = activeSource();
    let html = "";
    if (!src) html = "No LLM server set up — open ⚙ LLM settings.";
    else if (!src.model && src.kind !== "openai")
      html = `No model chosen for ${h(src.name)} — <button type="button" class="link-btn llm-open-settings">pick one in ⚙ LLM settings</button>.`;
    else {
      const m = models.find((x) => x.id === src.model);
      const bits = [`Model: <b>${h(src.model || "server default")}</b>`];
      if (extra) bits.push(h(extra));
      else if (modelsErr) bits.push(`<span class="llm-bad">⚠ ${h(modelsErr)}</span>`);
      else if (m) {
        if (m.vision === true) bits.push("👁 vision");
        if (m.sizeBytes) bits.push(gb(m.sizeBytes));
        if (m.loaded) bits.push("● loaded");
      } else if (models.length && src.model)
        bits.push(`<span class="llm-bad">⚠ not found on this server</span>`);
      if (m && m.vision === false && picked.length)
        bits.push(`<span class="llm-bad">⚠ this model can't see images</span>`);
      if (status.gpu)
        bits.push(`GPU: ${(status.gpu.freeMiB / 1024).toFixed(1)} of ${(status.gpu.totalMiB / 1024).toFixed(0)} GB free`);
      html = bits.join(" · ");
    }
    b.modelLine.innerHTML = html;
    b.modelLine
      .querySelectorAll(".llm-open-settings")
      .forEach((x) => x.addEventListener("click", openSettings));
  }

  async function openBuilder() {
    b.err.classList.add("hidden");
    b.proj.textContent = typeof projectName === "function" ? projectName(activeProjectId) : "this project";
    buildModal.classList.remove("hidden");
    renderGrid();
    renderJobs();
    loadForm(); // always fresh: another browser may have changed it
    try {
      await loadCfg();
      fillSourceSelect(b.source, cfg.activeSourceId);
      refreshModels();
    } catch (err) {
      showErr(b.err, err.message);
    }
    pollSoon();
  }
  const closeBuilder = () => {
    if (draftTimer) saveDraftNow(); // don't lose the last keystrokes
    if (shotTimer) saveShotsNow();
    buildModal.classList.add("hidden");
  };

  function showErr(el, msg) {
    el.textContent = msg;
    el.classList.toggle("hidden", !msg);
  }

  b.source.addEventListener("change", async () => {
    try {
      cfg = await api("/api/llm/settings", "PUT", { activeSourceId: b.source.value });
      refreshModels();
    } catch (err) {
      showErr(b.err, err.message);
    }
  });

  b.go.addEventListener("click", async () => {
    showErr(b.err, "");
    const src = activeSource();
    if (!src) return showErr(b.err, "Set up an LLM server first (⚙ LLM settings).");
    if (shotList && !confirm("Write a new shot list? It replaces the one below, with its edits and breaks."))
      return;
    clearTimeout(shotTimer); // the new list replaces whatever was about to be saved
    shotTimer = null;
    b.go.disabled = true;
    try {
      const job = await api("/api/llm/shots", "POST", {
        projectId: activeProjectId,
        sourceId: src.id,
        imageIds: b.format.value === "minimax_t2v" ? [] : picked,
        format: b.format.value,
        description: b.desc.value,
        theme: b.theme.value,
        rules: b.rules.value,
        shotCount: Number(b.count.value) || 1,
        duration: b.dur.value ? Number(b.dur.value) : null,
        titlePrefix: b.prefix.value,
      });
      seenStatus.set(job.id, job.status);
      status.jobs = [job, ...status.jobs.filter((j) => j.id !== job.id)];
      renderJobs();
      pollSoon();
      clearTimeout(draftTimer); // the server saved these inputs with the build
      draftTimer = null;
      api(`/api/llm/builder?projectId=${encodeURIComponent(activeProjectId)}`)
        .then((d) => {
          recent = d.recent || [];
          renderRecent();
        })
        .catch(() => {});
    } catch (err) {
      showErr(b.err, err.message);
    } finally {
      b.go.disabled = false;
    }
  });

  openBtn.addEventListener("click", openBuilder);
  buildModal.querySelectorAll(".llm-close").forEach((x) => x.addEventListener("click", closeBuilder));
  $(".llm-open-settings", buildModal).addEventListener("click", openSettings);
  buildModal.addEventListener("click", (e) => {
    if (e.target === buildModal) closeBuilder();
  });

  // ------------------------------------------------- step 2: the shot list
  // What step 1 wrote, for the user to edit and break up: a break after a shot means
  // the next one starts a new prompt. Kept on the server per project like the form
  // (so the phone sees it too); ✨ Write prompts sends it back as it stands, and the
  // shots go into the saved prompts exactly as they are here.
  const sl = {
    box: $(".llm-shots", buildModal),
    title: $(".llm-sl-title", buildModal),
    list: $(".llm-sl-list", buildModal),
    total: $(".llm-sl-total", buildModal),
    err: $(".llm-sl-err", buildModal),
    go: $(".llm-sl-go", buildModal),
  };
  let shotList = null; // { title, shots: [{ len, text, brk }] }
  let shotTimer = null;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const secs = (n) => `${+Number(n).toFixed(3)}s`;

  function saveShotsSoon() {
    if (!formProject) return;
    clearTimeout(shotTimer);
    shotTimer = setTimeout(saveShotsNow, 800);
  }
  async function saveShotsNow() {
    clearTimeout(shotTimer);
    shotTimer = null;
    if (!formProject) return;
    try {
      await api("/api/llm/builder", "PUT", { projectId: formProject, shotList });
    } catch (err) {
      showErr(sl.err, `⚠ The shot list wasn't saved: ${err.message}`);
    }
  }

  // The list changed shape (a shot or break added, moved or removed): redraw and save.
  function shotsChanged() {
    renderShots();
    saveShotsSoon();
  }

  function renderShots() {
    sl.box.classList.toggle("hidden", !shotList);
    if (!shotList) return;
    showErr(sl.err, "");
    if (document.activeElement !== sl.title) sl.title.value = shotList.title || "";
    const shots = shotList.shots;
    shots[shots.length - 1].brk = false;
    sl.list.innerHTML = "";
    shots.forEach((s, i) => {
      if (i === 0 || shots[i - 1].brk) {
        // A prompt starts here.
        const head = el("div", `llm-sl-group${i ? " brk" : ""}`);
        head.append(el("b", "llm-sl-gname"), el("span", "hint llm-sl-gsum"));
        if (i) {
          const rm = el("button", "link-btn", "× Remove break");
          rm.type = "button";
          rm.title = "Join these shots onto the prompt above";
          rm.addEventListener("click", () => {
            shots[i - 1].brk = false;
            shotsChanged();
          });
          head.appendChild(rm);
        }
        sl.list.appendChild(head);
      } else {
        const gap = el("div", "llm-sl-gap");
        const add = el("button", "link-btn", "✂ Break here");
        add.type = "button";
        add.title = `Start a new prompt at shot ${i + 1}`;
        add.addEventListener("click", () => {
          shots[i - 1].brk = true;
          shotsChanged();
        });
        gap.appendChild(add);
        sl.list.appendChild(gap);
      }

      const card = el("div", "pe-mm-shot");
      const head = el("div", "pe-mm-shot-head");
      const len = el("input", "pe-mm-at");
      len.type = "text";
      len.inputMode = "decimal";
      len.value = s.len == null ? "" : String(s.len);
      len.placeholder = "5";
      len.title = "How long this shot lasts — seconds (5) or MM:SS (00:05.5).";
      len.addEventListener("input", () => {
        s.len = parseShotTime(len.value) || null;
        refreshShots();
        saveShotsSoon();
      });
      len.addEventListener("change", () => {
        if (s.len != null) len.value = String(s.len);
      });
      const tools = el("span", "pe-mm-shot-tools");
      // A shot moves through the list; the breaks stay where they are.
      for (const [text, delta, title] of [
        ["▲", -1, "Move up"],
        ["▼", 1, "Move down"],
      ]) {
        const mv = el("button", "link-btn", text);
        mv.type = "button";
        mv.title = title;
        mv.disabled = i + delta < 0 || i + delta >= shots.length;
        mv.addEventListener("click", () => {
          const o = shots[i + delta];
          [s.len, o.len] = [o.len, s.len];
          [s.text, o.text] = [o.text, s.text];
          shotsChanged();
          sl.list.querySelectorAll(".pe-mm-shot")[i + delta]?.classList.add("pe-mm-moved");
        });
        tools.appendChild(mv);
      }
      if (shots.length > 1) {
        const rm = el("button", "link-btn pe-mm-remove", "×");
        rm.type = "button";
        rm.title = "Remove this shot";
        rm.addEventListener("click", () => {
          if (s.brk && i > 0) shots[i - 1].brk = true; // the break stays in place
          shots.splice(i, 1);
          shotsChanged();
        });
        tools.appendChild(rm);
      }
      head.append(
        el("span", "pe-mm-shot-name", `[Shot ${i + 1}]`),
        el("span", "hint", "Length"),
        len,
        el("span", "hint", "s"),
        el("span", "hint llm-sl-start"),
        el("span", "pe-mm-warn"),
        tools,
      );
      const ta = el("textarea");
      ta.rows = 3;
      ta.value = s.text;
      ta.placeholder = "What this shot shows: who does what, the camera, the lighting and mood.";
      ta.addEventListener("input", () => {
        s.text = ta.value;
        refreshShots();
        saveShotsSoon();
      });
      card.append(head, ta);
      sl.list.appendChild(card);
    });
    refreshShots();
  }

  // Everything worked out from the shots: start times, each prompt's span, the total.
  function refreshShots() {
    if (!shotList) return;
    const shots = shotList.shots;
    const cards = sl.list.querySelectorAll(".pe-mm-shot");
    const heads = sl.list.querySelectorAll(".llm-sl-group");
    let t = 0;
    let g = -1;
    let from = 0;
    let gsum = 0;
    const closeGroup = (to) => {
      if (g < 0) return;
      heads[g].querySelector(".llm-sl-gname").textContent = `Prompt ${g + 1}`;
      heads[g].querySelector(".llm-sl-gsum").textContent =
        `${from === to ? `shot ${from + 1}` : `shots ${from + 1}–${to + 1}`} · ${secs(gsum)}`;
    };
    shots.forEach((s, i) => {
      if (i === 0 || shots[i - 1].brk) {
        closeGroup(i - 1);
        g++;
        from = i;
        gsum = 0;
      }
      cards[i].querySelector(".llm-sl-start").textContent =
        i === 0 ? "opening shot" : `starts ${fmtShotTime(t)}`;
      cards[i].querySelector(".pe-mm-warn").textContent =
        s.len == null ? "⚠ needs a length"
        : !s.text.trim() ? "⚠ empty"
        : "";
      t += Number(s.len) || 0;
      gsum += Number(s.len) || 0;
    });
    closeGroup(shots.length - 1);
    const n = g + 1;
    sl.total.textContent =
      `${shots.length} shot${shots.length === 1 ? "" : "s"}, ${secs(t)} in all — ` +
      (n === 1 ? "one prompt. Add breaks to split it into a prompt group." : `a group of ${n} prompts.`);
    sl.go.textContent = n === 1 ? "✨ Write the prompt" : `✨ Write ${n} prompts`;
  }

  async function loadShotList(reveal) {
    const projectId = activeProjectId;
    try {
      const d = await api(`/api/llm/builder?projectId=${encodeURIComponent(projectId)}`);
      if (projectId !== activeProjectId) return;
      shotList = d.shotList || null;
      renderShots();
      if (reveal && shotList) sl.box.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (err) {
      showErr(b.err, err.message);
    }
  }

  sl.title.addEventListener("input", () => {
    if (!shotList) return;
    shotList.title = sl.title.value;
    saveShotsSoon();
  });
  $(".llm-sl-add", buildModal).addEventListener("click", () => {
    if (!shotList) return;
    shotList.shots.push({ len: 5, text: "", brk: false });
    shotsChanged();
    const tas = sl.list.querySelectorAll(".pe-mm-shot textarea");
    tas[tas.length - 1]?.focus();
  });
  $(".llm-sl-clear", buildModal).addEventListener("click", () => {
    if (!shotList || !confirm("Discard this shot list?")) return;
    shotList = null;
    renderShots();
    saveShotsNow();
  });
  sl.go.addEventListener("click", async () => {
    showErr(sl.err, "");
    const src = activeSource();
    if (!src) return showErr(sl.err, "Set up an LLM server first (⚙ LLM settings).");
    sl.go.disabled = true;
    try {
      if (shotTimer) await saveShotsNow();
      const job = await api("/api/llm/build", "POST", {
        projectId: activeProjectId,
        sourceId: src.id,
        imageIds: b.format.value === "minimax_t2v" ? [] : picked,
        format: b.format.value,
        description: b.desc.value,
        theme: b.theme.value,
        rules: b.rules.value,
        titlePrefix: b.prefix.value,
        title: shotList.title,
        shots: shotList.shots,
      });
      seenStatus.set(job.id, job.status);
      status.jobs = [job, ...status.jobs.filter((j) => j.id !== job.id)];
      renderJobs();
      b.jobs.scrollIntoView({ block: "nearest", behavior: "smooth" });
      pollSoon();
    } catch (err) {
      showErr(sl.err, err.message);
    } finally {
      sl.go.disabled = false;
    }
  });

  // ------------------------------------------------------------- jobs
  const STATUS_ICON = {
    queued: "⏳",
    waiting: "⏸",
    loading: "📥",
    generating: "✍️",
    done: "✅",
    failed: "⚠",
    cancelled: "✕",
  };

  function jobRow(j, compact = false) {
    const row = document.createElement("div");
    row.className = `llm-job ${j.status}`;
    const active = ACTIVE.includes(j.status);
    const what =
      j.kind === "revise" ? `✏️ Revise “${j.title || "prompt"}”: ${j.instruction}`
      : j.kind === "analyze" ? `🔎 Analyze images: ${j.description}`
      : j.kind === "shots" ? `🎬 Shot list: ${[j.description, j.theme].filter(Boolean).join(" · ") || "(images only)"}`
      : [j.description, j.theme].filter(Boolean).join(" · ") || "(images only)";
    row.innerHTML =
      `<div class="llm-job-head"><span>${STATUS_ICON[j.status] || ""} <b>${j.done}/${j.count}</b> ` +
      `<span class="llm-job-what">${h(what)}</span></span>` +
      (active ? `<button type="button" class="link-btn llm-cancel">Cancel</button>` : "") +
      `</div><div class="muted llm-job-msg">${h(j.message || "")}</div>` +
      (!compact && j.created.length ?
        `<div class="llm-job-made">${j.created
          .map((c) => `<button type="button" class="link-btn llm-made" data-id="${h(c.id)}">${h(c.title)}</button>`)
          .join("")}</div>`
      : "");
    row.querySelector(".llm-cancel")?.addEventListener("click", async () => {
      try {
        await api(`/api/llm/jobs/${j.id}/cancel`, "POST");
        poll();
      } catch (err) {
        alert(err.message);
      }
    });
    row.querySelectorAll(".llm-made").forEach((x) =>
      x.addEventListener("click", async () => {
        closeBuilder();
        setPromptTab("saved");
        await loadSavedPrompts();
        const p = savedPrompts.find((s) => s.id === x.dataset.id);
        if (p) openPromptEditor(p);
      }),
    );
    return row;
  }

  function renderJobs() {
    const mine = status.jobs.filter((j) => j.projectId === activeProjectId);
    b.jobs.innerHTML = mine.length ? `<div class="pe-refs-head">Builds</div>` : "";
    for (const j of mine.slice(0, 8)) b.jobs.appendChild(jobRow(j));

    const live = status.jobs.filter((j) => ACTIVE.includes(j.status));
    note.innerHTML = "";
    note.classList.toggle("hidden", !live.length);
    for (const j of live) note.appendChild(jobRow(j, true));
  }

  // Poll while something is running (or the builder is open).
  let timer = null;
  async function poll() {
    clearTimeout(timer);
    timer = null;
    try {
      status = await api("/api/llm/status");
    } catch {
      /* offline — try again later */
    }
    let refresh = false;
    let newShots = false;
    for (const j of status.jobs) {
      // A shot list this tab watched being written is ready: show it.
      const was = seenStatus.get(j.id);
      if (j.kind === "shots" && j.status === "done" && was && was !== "done" && j.projectId === activeProjectId)
        newShots = true;
      seenStatus.set(j.id, j.status);
      const had = seenCreated.get(j.id);
      if (had !== undefined && j.created.length > had && j.projectId === activeProjectId) refresh = true;
      seenCreated.set(j.id, j.created.length);
    }
    if (refresh) loadSavedPrompts();
    if (newShots) loadShotList(true);
    renderJobs();
    if (!buildModal.classList.contains("hidden")) renderModelLine();
    const busy = status.jobs.some((j) => ACTIVE.includes(j.status));
    if (busy || !buildModal.classList.contains("hidden")) timer = setTimeout(poll, busy ? 2000 : 5000);
  }
  function pollSoon() {
    clearTimeout(timer);
    timer = setTimeout(poll, 300);
  }
  // Pick up a build started on another device (the phone) or before a reload.
  (async () => {
    try {
      status = await api("/api/llm/status");
      for (const j of status.jobs) {
        seenCreated.set(j.id, j.created.length);
        seenStatus.set(j.id, j.status);
      }
      renderJobs();
      if (status.jobs.some((j) => ACTIVE.includes(j.status))) pollSoon();
    } catch {
      /* no server yet */
    }
  })();
  setInterval(() => {
    if (!timer) poll(); // cheap heartbeat: notices builds started elsewhere
  }, 30000);

  // ----------------------------------------------------------- settings
  const s = {
    pick: $(".llm-s-pick", setModal),
    name: $(".llm-s-name", setModal),
    kind: $(".llm-s-kind", setModal),
    url: $(".llm-s-url", setModal),
    key: $(".llm-s-key", setModal),
    keyhint: $(".llm-s-keyhint", setModal),
    clearWrap: $(".llm-s-clearkey-wrap", setModal),
    clear: $(".llm-s-clearkey", setModal),
    test: $(".llm-s-test", setModal),
    unloadBtn: $(".llm-s-unload", setModal),
    testOut: $(".llm-s-test-out", setModal),
    model: $(".llm-s-model", setModal),
    modelInfo: $(".llm-s-model-info", setModal),
    modelPick: $(".llm-s-model-pick", setModal),
    vram: $(".llm-s-vram", setModal),
    ctx: $(".llm-s-ctx", setModal),
    args: $(".llm-s-args", setModal),
    argsHint: $(".llm-s-args-hint", setModal),
    cpu: $(".llm-s-cpu", setModal),
    exe: $(".llm-s-exe", setModal),
    mpath: $(".llm-s-mpath", setModal),
    mmproj: $(".llm-s-mmproj", setModal),
    port: $(".llm-s-port", setModal),
    extra: $(".llm-s-extra", setModal),
    llamaHint: $(".llm-s-llama-hint", setModal),
    analyze: $(".llm-o-analyze", setModal),
    asize: $(".llm-o-asize", setModal),
    free: $(".llm-o-free", setModal),
    unload: $(".llm-o-unload", setModal),
    delay: $(".llm-o-delay", setModal),
    wait: $(".llm-o-wait", setModal),
    head: $(".llm-o-head", setModal),
    temp: $(".llm-o-temp", setModal),
    tok: $(".llm-o-tok", setModal),
    instr: $(".llm-o-instr", setModal),
    err: $(".llm-s-err", setModal),
  };
  let draft = null; // { activeSourceId, sources: [...] } being edited
  let editingId = null;
  let testModels = [];

  const ARGS_HINT = {
    lmstudio: 'JSON merged into LM Studio\'s load request, e.g. {"flash_attention": true, "offload_kv_cache_to_gpu": true}',
    textgen: 'JSON sent as the load "args", e.g. {"ctx_size": 16384, "mmproj": "mmproj-F16.gguf"} — replaces the context length above',
    ollama: 'JSON sent as Ollama "options", e.g. {"num_gpu": 99}',
    openai: "Not used — GENie doesn't load or unload models on this kind of server.",
  };
  // With "CPU only" ticked: GENie adds the no-GPU-layers option itself.
  const ARGS_HINT_CPU = {
    textgen: 'JSON sent as the load "args" — gpu_layers 0 is added for you. A vision model still gets its projector (mmproj, about 1 GB) put on the GPU: text-generation-webui has no load option for that. To use no VRAM at all, use the "llama.cpp server (GENie runs it)" type instead.',
    ollama: 'JSON sent as Ollama "options" — num_gpu 0 is added for you.',
    lmstudio: "JSON merged into LM Studio's load request. Set this model's GPU offload to 0 in LM Studio itself.",
  };
  const argsHint = () =>
    (s.cpu.checked && ARGS_HINT_CPU[s.kind.value]) || ARGS_HINT[s.kind.value] || "";
  // "llama.cpp server (GENie runs it)" has no server to point at: it gets the program
  // and files to launch instead of a URL, key, model list and load options.
  const isLlama = () => s.kind.value === "llamacpp";
  const fileName = (p) => p.trim().replace(/^"(.*)"$/, "$1").split(/[\\/]/).pop();
  function showKindFields() {
    const on = isLlama();
    $(".llm-s-llama", setModal).classList.toggle("hidden", !on);
    for (const c of [".llm-s-url-wrap", ".llm-s-key-wrap", ".llm-s-model-wrap", ".llm-adv"])
      $(c, setModal).classList.toggle("hidden", on);
    const src = draft?.sources.find((x) => x.id === editingId);
    s.clearWrap.classList.toggle("hidden", on || !src?.hasApiKey);
    s.test.textContent = on ? "🔌 Check the files" : "🔌 Test & list models";
    s.llamaHint.textContent =
      "GENie starts llama-server on 127.0.0.1 at this port when a job first needs the model, and stops it to unload the model and when GENie exits. " +
      (s.cpu.checked ?
        "With CPU only ticked it adds --device none, so the model and its projector use no VRAM."
      : "Tick CPU only below to keep it off the GPU (GENie adds --device none); otherwise llama-server decides how much goes to the GPU, or say so here, e.g. -ngl 99.") +
      ` Its output is saved in settings/llamacpp-${Number(s.port.value) || 8090}.log.`;
  }
  // "Analyze images" server: the builds' one, or any server by name.
  function fillAnalyzePick(value = s.analyze.value) {
    s.analyze.innerHTML = "";
    s.analyze.appendChild(new Option("The one builds use", ""));
    for (const x of draft.sources)
      s.analyze.appendChild(new Option(x.cpuOnly ? `${x.name} (CPU)` : x.name, x.id));
    s.analyze.value = draft.sources.some((x) => x.id === value) ? value : "";
  }

  function readForm() {
    const src = draft.sources.find((x) => x.id === editingId);
    if (!src) return;
    src.name = s.name.value.trim() || src.name;
    src.kind = s.kind.value;
    src.baseUrl = s.url.value.trim();
    if (s.key.value.trim()) src.apiKey = s.key.value.trim();
    src.clearApiKey = s.clear.checked;
    src.exePath = s.exe.value.trim();
    src.modelPath = s.mpath.value.trim();
    src.mmprojPath = s.mmproj.value.trim();
    src.port = Number(s.port.value) || 8090;
    src.extraArgs = s.extra.value.trim();
    if (isLlama()) s.model.value = fileName(src.modelPath); // its model is the file
    src.model = s.model.value.trim();
    src.vramGb = Number(s.vram.value) || 0;
    src.contextLength = Number(s.ctx.value) || 0;
    src.loadArgs = s.args.value;
    src.cpuOnly = s.cpu.checked;
  }

  function fillForm() {
    fillSourceSelect(s.pick, editingId);
    fillAnalyzePick();
    const src = draft.sources.find((x) => x.id === editingId);
    const on = !!src;
    setModal.querySelector(".llm-s-source").classList.toggle("hidden", !on);
    if (!on) return;
    s.name.value = src.name;
    s.kind.value = src.kind;
    s.url.value = src.baseUrl;
    s.key.value = src.apiKey || "";
    s.keyhint.textContent =
      src.hasApiKey ? "— a key is saved; leave blank to keep it" : "— only if the server requires one";
    s.clearWrap.classList.toggle("hidden", !src.hasApiKey);
    s.clear.checked = !!src.clearApiKey;
    s.model.value = src.model;
    s.vram.value = src.vramGb || 0;
    s.ctx.value = src.contextLength || 0;
    s.args.value = src.loadArgs || "";
    s.cpu.checked = !!src.cpuOnly;
    s.exe.value = src.exePath || "";
    s.mpath.value = src.modelPath || "";
    s.mmproj.value = src.mmprojPath || "";
    s.port.value = src.port || 8090;
    s.extra.value = src.extraArgs || "";
    showKindFields();
    s.argsHint.textContent = argsHint();
    s.testOut.textContent = "";
    testModels = [];
    showUnload();
    fillModelPick([]);
    renderModelInfo();
  }

  function renderModelInfo() {
    const m = testModels.find((x) => x.id === s.model.value.trim());
    if (!m) {
      s.modelInfo.textContent = testModels.length && s.model.value.trim() ? "⚠ Not one of this server's models." : "";
      return;
    }
    const bits = [m.name];
    bits.push(m.vision === true ? "👁 vision" : m.vision === false ? "no vision — can't see images" : "vision: unknown");
    if (m.sizeBytes) bits.push(gb(m.sizeBytes));
    if (m.loaded) bits.push("● loaded now");
    s.modelInfo.textContent = bits.join(" · ");
  }

  // ⏏ Unload: for a CPU-only server GENie loads models on, while its model is loaded.
  function showUnload() {
    const src = draft?.sources.find((x) => x.id === editingId);
    const loaded = !!src && testModels.some((m) => m.id === src.model && m.loaded);
    s.unloadBtn.classList.toggle("hidden", !(loaded && src.cpuOnly && cfg.kinds[src.kind]?.managed));
  }
  async function unloadSource() {
    s.unloadBtn.disabled = true;
    let note = "";
    try {
      const d = await api("/api/llm/unload", "POST", { sourceId: editingId });
      note = d?.unloaded ? "⏏ Unloaded." : "It wasn't loaded.";
    } catch (err) {
      note = `✕ ${err.message}`;
    }
    s.unloadBtn.disabled = false;
    await testSource();
    s.testOut.textContent = `${note} ${s.testOut.textContent}`;
  }

  async function testSource() {
    readForm();
    const src = draft.sources.find((x) => x.id === editingId);
    s.testOut.textContent = "Connecting…";
    s.test.disabled = true;
    try {
      const d = await api("/api/llm/models", "POST", { source: src });
      testModels = d.models || [];
      const sorted = [...testModels].sort((a, b) => (b.vision === true) - (a.vision === true) || a.id.localeCompare(b.id));
      fillModelPick(sorted);
      const nVision = testModels.filter((m) => m.vision === true).length;
      s.testOut.textContent =
        src.kind === "llamacpp" ?
          `✓ Files found — ${testModels[0]?.loaded ? "running now" : "not running: GENie starts it when a job needs it"}`
        : `✓ Connected — ${testModels.length} model${testModels.length === 1 ? "" : "s"}` +
          (nVision ? `, ${nVision} with vision (👁)` : "") +
          (d.gpu ? ` · GPU ${(d.gpu.freeMiB / 1024).toFixed(1)} GB free` : "");
      if (!s.model.value && sorted[0]) s.model.value = sorted.find((m) => m.vision)?.id || "";
      renderModelInfo();
    } catch (err) {
      testModels = [];
      s.testOut.textContent = `✕ ${err.message}`;
    } finally {
      s.test.disabled = false;
      showUnload();
    }
  }

  // A real dropdown of the server's models (a <datalist> doesn't show on iPhone).
  // The text box below stays for an id that isn't listed.
  function fillModelPick(list) {
    s.modelPick.innerHTML = "";
    s.modelPick.classList.toggle("hidden", !list.length);
    if (!list.length) return;
    s.modelPick.appendChild(new Option(`— choose one of ${list.length} models —`, ""));
    for (const m of list) {
      const extra = [m.vision === true ? "👁" : "", gb(m.sizeBytes), m.loaded ? "● loaded" : ""].filter(Boolean);
      s.modelPick.appendChild(new Option(extra.length ? `${m.name} (${extra.join(" · ")})` : m.name, m.id));
    }
    syncModelPick();
  }
  function syncModelPick() {
    const v = s.model.value.trim();
    s.modelPick.value = [...s.modelPick.options].some((o) => o.value === v) ? v : "";
  }

  async function openSettings() {
    showErr(s.err, "");
    try {
      await loadCfg();
    } catch (err) {
      return alert(err.message);
    }
    draft = {
      activeSourceId: cfg.activeSourceId,
      sources: cfg.sources.map((x) => ({ ...x, apiKey: "" })),
    };
    editingId = cfg.activeSourceId;
    s.kind.innerHTML = "";
    for (const [k, v] of Object.entries(cfg.kinds)) s.kind.appendChild(new Option(v.label, k));
    const o = cfg.options;
    s.free.checked = o.freeComfyVram;
    s.unload.checked = o.unloadWhenDone;
    s.delay.value = o.resumeDelaySec;
    s.wait.value = o.vramWaitMin;
    s.head.value = o.headroomGb;
    s.temp.value = o.temperature;
    s.tok.value = o.maxTokens;
    s.instr.value = o.instructions;
    s.asize.value = cfg.analyzeImageSize;
    fillAnalyzePick(cfg.analyzeSourceId);
    fillForm();
    setModal.classList.remove("hidden");
    const cur = draft.sources.find((x) => x.id === editingId);
    if (cur?.kind === "llamacpp" ? cur.exePath && cur.modelPath : cur?.baseUrl) testSource();
  }
  const closeSettings = () => setModal.classList.add("hidden");

  s.pick.addEventListener("change", () => {
    readForm();
    editingId = s.pick.value;
    fillForm();
    testSource();
  });
  s.kind.addEventListener("change", () => {
    const k = s.kind.value;
    showKindFields();
    s.argsHint.textContent = argsHint();
    const port = cfg.kinds[k]?.port;
    // Switching type on an untouched default URL moves it to that server's usual port.
    if (port && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(s.url.value.trim()))
      s.url.value = `http://127.0.0.1:${port}`;
  });
  s.model.addEventListener("input", () => {
    syncModelPick();
    renderModelInfo();
  });
  s.modelPick.addEventListener("change", () => {
    if (s.modelPick.value) s.model.value = s.modelPick.value;
    renderModelInfo();
  });
  s.port.addEventListener("input", showKindFields);
  s.cpu.addEventListener("change", () => {
    readForm();
    showKindFields();
    s.argsHint.textContent = argsHint();
    fillAnalyzePick();
  });
  s.name.addEventListener("change", () => {
    readForm();
    fillAnalyzePick();
  });
  s.test.addEventListener("click", testSource);
  s.unloadBtn.addEventListener("click", unloadSource);
  $(".llm-s-add", setModal).addEventListener("click", () => {
    readForm();
    const id = `src-${Date.now().toString(36)}`;
    draft.sources.push({
      id,
      name: "New server",
      kind: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      apiKey: "",
      model: "",
      vramGb: 0,
      contextLength: 8192,
      loadArgs: "",
      cpuOnly: false,
      exePath: "",
      modelPath: "",
      mmprojPath: "",
      port: 8090,
      extraArgs: "",
    });
    editingId = id;
    fillForm();
    s.name.select();
  });
  $(".llm-s-del", setModal).addEventListener("click", () => {
    if (draft.sources.length <= 1) return alert("Keep at least one server.");
    const src = draft.sources.find((x) => x.id === editingId);
    if (!confirm(`Remove "${src?.name}"?`)) return;
    draft.sources = draft.sources.filter((x) => x.id !== editingId);
    editingId = draft.sources[0].id;
    fillForm();
  });
  $(".llm-o-reset", setModal).addEventListener("click", () => {
    s.instr.value = cfg.defaultInstructions;
  });
  $(".llm-s-save", setModal).addEventListener("click", async () => {
    readForm();
    showErr(s.err, "");
    const bad = draft.sources.find((x) => {
      if (!String(x.loadArgs || "").trim()) return false;
      try {
        JSON.parse(x.loadArgs);
        return false;
      } catch {
        return true;
      }
    });
    if (bad) return showErr(s.err, `"${bad.name}": Load options must be valid JSON.`);
    try {
      cfg = await api("/api/llm/settings", "PUT", {
        activeSourceId: editingId,
        analyzeSourceId: s.analyze.value,
        analyzeImageSize: Number(s.asize.value) || undefined,
        sources: draft.sources,
        options: {
          freeComfyVram: s.free.checked,
          unloadWhenDone: s.unload.checked,
          resumeDelaySec: Number(s.delay.value),
          vramWaitMin: Number(s.wait.value),
          headroomGb: Number(s.head.value),
          temperature: Number(s.temp.value),
          maxTokens: Number(s.tok.value),
          instructions: s.instr.value,
        },
      });
      closeSettings();
      if (!buildModal.classList.contains("hidden")) {
        fillSourceSelect(b.source, cfg.activeSourceId);
        refreshModels();
      }
    } catch (err) {
      showErr(s.err, err.message);
    }
  });
  // A way in from the page header, under the credits pill (which is hidden without a
  // kie.ai key — the link stays).
  const credits = document.getElementById("credits");
  if (credits) {
    const col = document.createElement("div");
    col.className = "llm-head-col";
    credits.before(col);
    const link = document.createElement("button");
    link.type = "button";
    link.className = "link-btn llm-head-settings";
    link.textContent = "⚙ LLM settings";
    link.title = "The LLM servers GENie uses for ✨ Build with AI, Revise and Analyze";
    link.addEventListener("click", openSettings);
    col.append(credits, link);
  }
  setModal.querySelectorAll(".llm-s-close").forEach((x) => x.addEventListener("click", closeSettings));
  setModal.addEventListener("click", (e) => {
    if (e.target === setModal) closeSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!setModal.classList.contains("hidden")) closeSettings();
    else if (!buildModal.classList.contains("hidden")) closeBuilder();
  });

  // The project switcher changes what the builder shows.
  document.getElementById("projectSelect")?.addEventListener("change", () => {
    if (draftTimer) saveDraftNow(); // still aimed at the old project
    if (shotTimer) saveShotsNow();
    shotList = null;
    renderShots();
    picked = [];
    formProject = null;
    if (!buildModal.classList.contains("hidden")) {
      b.proj.textContent = projectName(activeProjectId);
      renderGrid();
      loadForm();
    }
    renderJobs();
  });

  // ------------------------------------------------- ✏️ Revise with AI (editor)
  // A panel in the saved-prompt editor: say what to change, the LLM rewrites the
  // prompt as it stands in the editor (saved or not), and the result is shown next to
  // what's there now. Apply puts it in the editor — Save changes keeps it, Cancel or
  // ↶ Undo throws it away. The job runs on the server like a build (same GPU turn-
  // taking), so a pending revision survives closing and reopening the editor.
  const rev = document.createElement("details");
  rev.className = "llm-rev";
  rev.innerHTML = `
    <summary>✨ Revise with AI <span class="hint">— tell the LLM what to change</span></summary>
    <div class="llm-rev-body">
      <textarea class="llm-rev-ask" rows="3" placeholder="e.g. Make her lines teasing and playful · add a cut at 00:06 to a close-up of her face · slow the pacing down"></textarea>
      <div class="llm-rev-bar">
        <label class="inline" title="Also follow the Rules from this project's ✨ Build with AI form"><input type="checkbox" class="llm-rev-rules" checked /> Follow my Rules</label>
        <span class="llm-rev-btns">
          <button type="button" class="btn-secondary llm-rev-cancel hidden">Stop</button>
          <button type="button" class="llm-rev-go">✨ Revise</button>
        </span>
      </div>
      <p class="muted llm-rev-status"></p>
      <div class="llm-rev-result hidden">
        <div class="pe-refs-head">Suggested revision <span class="hint">— <ins>added</ins> / <del>removed</del> compared with the editor</span></div>
        <div class="llm-rev-diff"></div>
        <div class="llm-rev-actions">
          <button type="button" class="btn-secondary llm-rev-discard">✕ Discard</button>
          <button type="button" class="btn-secondary llm-rev-again">↻ Try again</button>
          <button type="button" class="llm-rev-apply">✓ Apply to editor</button>
        </div>
      </div>
      <p class="llm-rev-applied hidden">Applied — press <b>Save changes</b> to keep it. <button type="button" class="link-btn llm-rev-undo">↶ Undo</button></p>
    </div>`;
  peActions.after(rev);
  const r = {
    ask: $(".llm-rev-ask", rev),
    rules: $(".llm-rev-rules", rev),
    go: $(".llm-rev-go", rev),
    stop: $(".llm-rev-cancel", rev),
    status: $(".llm-rev-status", rev),
    result: $(".llm-rev-result", rev),
    diff: $(".llm-rev-diff", rev),
    applied: $(".llm-rev-applied", rev),
  };
  // Per saved prompt (this tab): { jobId, job, undo, before }
  const revState = new Map();
  let revTimer = null;
  const curId = () => (typeof editing !== "undefined" && editing ? editing.p.id : null);
  const isStructured = () => editing && editing.type !== "default" && typeof isMmType === "function" && isMmType(editing.type);

  // What the editor holds now, as text for the diff.
  function mmText(mm) {
    if (!mm) return "";
    const out = [];
    const sec = (name, v) => v && String(v).trim() && out.push(`${name}: ${String(v).trim()}`);
    for (const x of mm.subjects || []) sec(`Subject <${String(x.key || "").replace(/^<|>$/g, "")}>`, x.definition);
    sec("Summary", mm.summary);
    for (const [k, v] of Object.entries(mm.retention || {})) sec(`Retention ${k.startsWith("<") ? k : `<${k}>`}`, v);
    sec("Style", mm.style);
    (mm.shots || []).forEach((x, i) =>
      sec(x.len == null ? `Shot ${i + 1}` : `Shot ${i + 1} (${x.len}s)`, x.text),
    );
    sec("Soundscape", mm.soundscape);
    sec("Music", mm.music);
    return out.join("\n\n");
  }
  const editorText = () => (isStructured() ? mmText(editing.mm) : pePrompt.value);
  // A MiniMax reply with a field left empty keeps the editor's text for it — models
  // sometimes drop fields they weren't asked to change, and that shouldn't blank them.
  function mergedMm(resMm) {
    const cur = editing?.mm || {};
    const mm = normalizeMinimax(structuredClone(resMm));
    for (const k of ["summary", "style", "soundscape", "music"])
      if (!String(mm[k] || "").trim() && String(cur[k] || "").trim()) mm[k] = cur[k];
    if (!Object.keys(mm.retention || {}).length && Object.keys(cur.retention || {}).length)
      mm.retention = structuredClone(cur.retention);
    if (!(mm.subjects || []).length && (cur.subjects || []).length)
      mm.subjects = structuredClone(cur.subjects);
    return mm;
  }
  const resultText = (res) => (res.minimax ? mmText(mergedMm(res.minimax)) : res.prompt || "");

  // Word-level diff (LCS) → HTML with <ins>/<del>. Falls back to plain text when huge.
  function diffHtml(a, b) {
    const ta = a.split(/(\s+)/), tb = b.split(/(\s+)/);
    if (ta.length * tb.length > 6e6) return `<span>${h(b)}</span>`;
    const n = ta.length, m = tb.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i][j] = ta[i] === tb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0, html = "";
    const run = { t: null, s: "" };
    const flush = () => {
      if (!run.s) return;
      html += run.t === "=" ? h(run.s) : `<${run.t}>${h(run.s)}</${run.t}>`;
      run.s = "";
    };
    const push = (t, s) => {
      if (run.t !== t) flush();
      run.t = t;
      run.s += s;
    };
    while (i < n && j < m) {
      if (ta[i] === tb[j]) push("=", ta[i++]), j++;
      else if (L[i + 1][j] >= L[i][j + 1]) push("del", ta[i++]);
      else push("ins", tb[j++]);
    }
    while (i < n) push("del", ta[i++]);
    while (j < m) push("ins", tb[j++]);
    flush();
    return html;
  }

  function renderRev() {
    const id = curId();
    const st = id && revState.get(id);
    const job = st?.job;
    const running = job && ACTIVE.includes(job.status);
    r.go.disabled = !!running;
    r.go.textContent = running ? "Working…" : "✨ Revise";
    r.stop.classList.toggle("hidden", !running);
    r.status.textContent =
      !job ? ""
      : job.status === "done" ? ""
      : job.status === "failed" ? `⚠ ${job.error || job.message}`
      : job.status === "cancelled" ? "Stopped."
      : `${STATUS_ICON[job.status] || ""} ${job.message}`;
    const res = job?.status === "done" && !st.appliedJob ? job.result : null;
    r.result.classList.toggle("hidden", !res);
    if (res) r.diff.innerHTML = diffHtml(st.before ?? editorText(), resultText(res));
    r.applied.classList.toggle("hidden", !st?.undo);
  }

  async function pollRev() {
    clearTimeout(revTimer);
    revTimer = null;
    const pending = [...revState.values()].filter((st) => st.job && ACTIVE.includes(st.job.status));
    for (const st of pending) {
      try {
        st.job = await api(`/api/llm/jobs/${st.jobId}`);
      } catch (err) {
        st.job = { ...st.job, status: "failed", error: err.message };
      }
    }
    renderRev();
    if ([...revState.values()].some((st) => st.job && ACTIVE.includes(st.job.status)))
      revTimer = setTimeout(pollRev, 1500);
  }

  async function startRev() {
    if (!editing) return;
    const instruction = r.ask.value.trim();
    if (!instruction) return r.ask.focus();
    const id = curId();
    try {
      if (!cfg) await loadCfg();
      const src = activeSource();
      if (!src) throw new Error("Set up an LLM server first (✨ Build with AI → ⚙ LLM settings).");
      const v = editorValues();
      const before = editorText();
      const job = await api("/api/llm/revise", "POST", {
        projectId: editing.projectId,
        promptId: id,
        sourceId: src.id,
        format: v.type,
        title: v.title,
        prompt: isStructured() ? "" : pePrompt.value,
        minimax: isStructured() ? editing.mm : null,
        refs: v.refs,
        duration: v.duration,
        instruction,
        useRules: r.rules.checked,
      });
      const old = revState.get(id);
      revState.set(id, { jobId: job.id, job, before, undo: old?.undo || null });
      renderRev();
      pollRev();
    } catch (err) {
      r.status.textContent = `⚠ ${err.message}`;
    }
  }

  function applyRev() {
    const id = curId();
    const st = id && revState.get(id);
    const res = st?.job?.result;
    if (!res) return;
    if (isStructured()) {
      if (!res.minimax) return alert("The revision isn't in this prompt's MiniMax format.");
      const undoMm = structuredClone(editing.mm);
      const mm = mergedMm(res.minimax);
      // A subject the reply just repeats from a reference (same key and definition)
      // stays on the gallery file instead of becoming an override on this prompt.
      const refDefs = new Map(
        editorLiveRefs().filter((x) => x.key).map((x) => [normKey(x.key), String(x.definition || "").trim()]),
      );
      mm.subjects = (mm.subjects || []).filter(
        (x) => !(refDefs.has(normKey(x.key)) && refDefs.get(normKey(x.key)) === String(x.definition || "").trim()),
      );
      editing.mm = mm;
      renderMinimaxForm();
      st.undo = { mm: undoMm };
    } else {
      st.undo = { prompt: pePrompt.value };
      pePrompt.value = res.prompt || "";
      pePrompt.dispatchEvent(new Event("input", { bubbles: true }));
    }
    st.appliedJob = st.jobId;
    renderRev();
  }

  function undoRev() {
    const id = curId();
    const st = id && revState.get(id);
    if (!st?.undo) return;
    if (st.undo.mm) {
      editing.mm = st.undo.mm;
      renderMinimaxForm();
    } else {
      pePrompt.value = st.undo.prompt;
      pePrompt.dispatchEvent(new Event("input", { bubbles: true }));
    }
    st.undo = null;
    st.appliedJob = null; // the suggestion can be applied again
    renderRev();
  }

  r.go.addEventListener("click", startRev);
  r.ask.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) startRev();
  });
  r.stop.addEventListener("click", async () => {
    const st = revState.get(curId());
    if (!st) return;
    try {
      st.job = await api(`/api/llm/jobs/${st.jobId}/cancel`, "POST");
    } catch {
      /* already over */
    }
    renderRev();
  });
  $(".llm-rev-apply", rev).addEventListener("click", applyRev);
  $(".llm-rev-again", rev).addEventListener("click", startRev);
  $(".llm-rev-discard", rev).addEventListener("click", () => {
    const id = curId();
    const st = revState.get(id);
    if (!st) return;
    if (st.undo) {
      st.job = null; // keep Undo available
      st.appliedJob = null;
    } else revState.delete(id);
    renderRev();
  });
  $(".llm-rev-undo", rev).addEventListener("click", undoRev);

  // ------------------------------------------- ✨ Analyze images (editor)
  // In a MiniMax prompt's subject_definitions: the LLM looks at each keyed reference
  // image and writes that subject's definition and retention line. One subject per
  // request (several images sharing a key go together), filled into the editor as each
  // comes back; ↶ Undo puts back what was there. Nothing is saved until Save changes.
  // Per saved prompt (this tab): { jobId, job, applied, undo, note }
  const anState = new Map();
  let anTimer = null;

  // The subjects to look at: every image reference with a key, grouped by key, with
  // what's written for it now (the model keeps those facts and builds on them).
  // `only`: just that key (✨ Analyze scene). The Previous scene frame goes as a scene,
  // with the other subjects' definitions so the model can name who is where.
  function analyzeSubjects(only = null) {
    const mm = editing.mm;
    const refs = editorLiveRefs();
    const byKey = new Map();
    for (const ref of refs) {
      const key = normKey(ref.key);
      if (ref.missing || ref.kind !== "image" || !key) continue;
      if (only && key !== only) continue;
      let sub = byKey.get(key);
      if (!sub) {
        sub = { key, refs: [], note: "", retention: mm.retention?.[`<${key}>`] || "" };
        byKey.set(key, sub);
      }
      sub.refs.push(ref);
      if (ref.scene) sub.scene = true;
      if (!sub.note) sub.note = String(ref.definition || "").trim();
    }
    for (const sub of byKey.values()) {
      const typed = (mm.subjects || []).find((x) => normKey(x.key) === sub.key);
      if (String(typed?.definition || "").trim()) sub.note = typed.definition.trim();
      if (!sub.scene) continue;
      // The filled-in templates say nothing about this frame — not notes.
      if (sub.note === PREV_SCENE_DEF) sub.note = "";
      if (sub.retention.trim() === PREV_SCENE_RET.trim()) sub.retention = "";
      sub.others = minimaxSubjects(mm, refs)
        .filter((x) => x.label && x.label !== `<${sub.key}>` && !x.audio)
        .map((x) => ({ key: x.label.slice(1, -1), definition: x.definition }));
    }
    return [...byKey.values()];
  }

  // A JPEG data: URL of the image at most `max` px on its longest side.
  async function scaledImage(url, max) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; // behind transparency, which JPEG doesn't have
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  }

  // Put the job's finished subjects into the editor (each once). A subject already
  // typed on the prompt is filled in where it is; otherwise it gets a row.
  function applyAn(st) {
    const subs = st?.job?.result?.subjects;
    if (!subs || !editing || !isMmType(editing.type)) return false;
    const mm = editing.mm;
    let changed = false;
    for (const [key, res] of Object.entries(subs)) {
      if (st.applied.has(key) || !res?.definition) continue;
      st.undo ||= {
        subjects: structuredClone(mm.subjects),
        retention: structuredClone(mm.retention),
        shots: structuredClone(mm.shots),
      };
      let row = mm.subjects.find((x) => normKey(x.key) === key);
      if (!row) mm.subjects.push((row = { key, definition: "" }));
      row.definition = res.definition;
      if (res.retention) mm.retention[`<${key}>`] = res.retention;
      // A scene's opening staging goes right after Shot 1's lead, before what the
      // author wrote there (a re-run replaces the sentence it put there last time).
      if (res.kind === "scene" && res.shot1 && mm.shots[0]) {
        const lead = prevSceneShotLead(key);
        let rest = String(mm.shots[0].text || "");
        if (rest.startsWith(lead.trim())) rest = rest.slice(lead.trim().length).trimStart();
        if (row.sceneShot1 && rest.startsWith(row.sceneShot1))
          rest = rest.slice(row.sceneShot1.length).trimStart();
        mm.shots[0].text = `${lead}${res.shot1}${rest ? ` ${rest}` : " "}`;
        row.sceneShot1 = res.shot1;
      }
      st.applied.add(key);
      changed = true;
    }
    if (changed) renderMinimaxForm();
    return changed;
  }

  function paintAn(el = peMinimax.querySelector(".llm-an")) {
    if (!el) return;
    const st = anState.get(curId());
    const job = st?.job;
    const running = !!st?.starting || (job && ACTIVE.includes(job.status));
    const go = $(".llm-an-go", el);
    go.disabled = running;
    go.textContent = running ? "Analyzing…" : "✨ Analyze images";
    $(".llm-an-stop", el).classList.toggle("hidden", !(job && ACTIVE.includes(job.status)));
    $(".llm-an-undo", el).classList.toggle("hidden", running || !st?.undo);
    const filled = st ? [...st.applied].map((k) => `<${k}>`).join(", ") : "";
    $(".llm-an-status", el).textContent =
      !st ? ""
      : st.note ? st.note
      : !job ? ""
      : job.status === "done" ? `✓ Filled in ${filled || "nothing"} — check them, then Save changes.`
      : job.status === "failed" ? `⚠ ${job.error || job.message}`
      : job.status === "cancelled" ? (filled ? `Stopped after ${filled}.` : "Stopped.")
      : `${STATUS_ICON[job.status] || ""} ${job.message}`;
  }

  async function pollAn() {
    clearTimeout(anTimer);
    anTimer = null;
    for (const [id, st] of anState) {
      if (!st.job || !ACTIVE.includes(st.job.status)) continue;
      try {
        st.job = await api(`/api/llm/jobs/${st.jobId}`);
      } catch (err) {
        st.job = { ...st.job, status: "failed", error: err.message };
      }
      if (id === curId()) applyAn(st);
    }
    paintAn();
    if ([...anState.values()].some((st) => st.job && ACTIVE.includes(st.job.status)))
      anTimer = setTimeout(pollAn, 1500);
  }

  async function startAn(only = null) {
    if (!editing) return;
    const id = curId();
    if (anState.get(id)?.job && ACTIVE.includes(anState.get(id).job.status)) return;
    const st = { jobId: null, job: null, applied: new Set(), undo: null, note: "", starting: true };
    try {
      const subs = analyzeSubjects(typeof only === "string" ? only : null);
      if (!subs.length)
        throw new Error(
          typeof only === "string" ?
            "Pick the previous scene's frame first."
          : "Give an image a @key in reference media first — that's the subject it defines.",
        );
      anState.set(id, st);
      st.note = "Preparing the images…";
      paintAn();
      await loadCfg();
      const subjects = [];
      for (const sub of subs) {
        const images = [];
        for (const ref of sub.refs.slice(0, 4)) {
          // No scaled copy (the image wouldn't decode)? The server sends the file itself.
          const url = await scaledImage(ref.url, cfg.analyzeImageSize || 768).catch(() => "");
          images.push({ id: ref.id, url });
        }
        subjects.push({
          key: sub.key,
          note: sub.note,
          retention: sub.retention,
          images,
          ...(sub.scene ? { scene: true, others: sub.others } : {}),
        });
      }
      const job = await api("/api/llm/analyze", "POST", {
        projectId: editing.projectId,
        promptId: id,
        subjects,
      });
      Object.assign(st, { jobId: job.id, job, note: "", starting: false });
      paintAn();
      pollAn();
    } catch (err) {
      Object.assign(st, { note: `⚠ ${err.message}`, starting: false });
      anState.set(id, st);
      paintAn();
    }
  }

  // ✨ Analyze scene (app.js's Previous scene panel): just that subject.
  window.genieAnalyze = (key) => {
    startAn(key);
    peMinimax.querySelector(".llm-an")?.scrollIntoView({ block: "nearest" });
  };

  // Called by app.js while it builds the subject_definitions section.
  window.genieAnalyzeBar = () => {
    const el = document.createElement("div");
    el.className = "llm-an";
    el.innerHTML = `
      <button type="button" class="btn-secondary llm-an-go" title="A vision LLM looks at each reference image that has a @key and writes that subject's definition and retention_analysis. What's written there now is kept as its notes. Pick the server in ⚙ LLM settings.">✨ Analyze images</button>
      <button type="button" class="link-btn llm-an-stop hidden">Stop</button>
      <span class="muted llm-an-status"></span>
      <button type="button" class="link-btn llm-an-undo hidden" title="Put the definitions and retention lines back as they were">↶ Undo</button>`;
    $(".llm-an-go", el).addEventListener("click", startAn);
    $(".llm-an-stop", el).addEventListener("click", async () => {
      const st = anState.get(curId());
      if (!st?.jobId) return;
      try {
        st.job = await api(`/api/llm/jobs/${st.jobId}/cancel`, "POST");
      } catch {
        /* already over */
      }
      paintAn();
    });
    $(".llm-an-undo", el).addEventListener("click", () => {
      const st = anState.get(curId());
      if (!st?.undo || !editing) return;
      editing.mm.subjects = st.undo.subjects;
      editing.mm.retention = st.undo.retention;
      editing.mm.shots = st.undo.shots;
      anState.delete(curId());
      renderMinimaxForm();
    });
    paintAn(el);
    return el;
  };

  // ---------------------------------------- ✨ Analyze (gallery Edit modal)
  // The same look at an image, for the definition saved on the gallery file itself —
  // the one every prompt using the file shares. Fills the Definition box (what's there
  // is kept as notes); Save keeps it. One at a time: closing the modal, or opening
  // another file, stops it.
  const galModal = document.getElementById("galleryEditModal");
  const galBar = document.createElement("div");
  galBar.className = "llm-an llm-an-gallery";
  galBar.innerHTML = `
    <button type="button" class="btn-secondary llm-an-go" title="A vision LLM looks at this image and writes its definition. What's written there now is kept as its notes. Pick the server in ⚙ LLM settings.">✨ Analyze</button>
    <button type="button" class="link-btn llm-an-stop hidden">Stop</button>
    <span class="muted llm-an-status"></span>
    <button type="button" class="link-btn llm-an-undo hidden" title="Put the definition back as it was">↶ Undo</button>`;
  galModal?.querySelector(".modal-actions")?.before(galBar);
  let gal = null; // { itemId, key, jobId, job, before, note, starting }
  let galTimer = null;
  const galOpen = () => (typeof galleryEditing !== "undefined" && galleryEditing ? galleryEditing : null);
  const galActive = () => !!gal?.job && ACTIVE.includes(gal.job.status);

  function paintGal() {
    const item = galOpen();
    galBar.classList.toggle("hidden", !item || (item.kind || "image") !== "image");
    const st = gal && item && gal.itemId === item.id ? gal : null;
    const job = st?.job;
    const running = !!st?.starting || (!!st && galActive());
    const go = $(".llm-an-go", galBar);
    go.disabled = running;
    go.textContent = running ? "Analyzing…" : "✨ Analyze";
    $(".llm-an-stop", galBar).classList.toggle("hidden", !(st && galActive()));
    $(".llm-an-undo", galBar).classList.toggle("hidden", running || st?.before == null || job?.status !== "done");
    $(".llm-an-status", galBar).textContent =
      !st ? ""
      : st.note ? st.note
      : !job ? ""
      : job.status === "done" ? "✓ Filled in — check it, then Save."
      : job.status === "failed" ? `⚠ ${job.error || job.message}`
      : job.status === "cancelled" ? "Stopped."
      : `${STATUS_ICON[job.status] || ""} ${job.message}`;
  }

  function stopGal() {
    clearTimeout(galTimer);
    galTimer = null;
    if (galActive()) api(`/api/llm/jobs/${gal.jobId}/cancel`, "POST").catch(() => {});
    gal = null;
  }

  async function pollGal() {
    clearTimeout(galTimer);
    galTimer = null;
    const st = gal;
    if (!st?.jobId) return;
    if (galOpen()?.id !== st.itemId) return stopGal(); // the modal moved on
    try {
      st.job = await api(`/api/llm/jobs/${st.jobId}`);
    } catch (err) {
      st.job = { ...st.job, status: "failed", error: err.message };
    }
    if (gal !== st) return; // stopped meanwhile
    if (galOpen()?.id !== st.itemId) return stopGal();
    const res = st.job.result?.subjects?.[st.key];
    if (st.job.status === "done" && res?.definition) galleryEditDef.value = res.definition;
    paintGal();
    if (galActive()) galTimer = setTimeout(pollGal, 1500);
  }

  async function startGal() {
    const item = galOpen();
    if (!item) return;
    stopGal();
    const st = (gal = {
      itemId: item.id,
      key: normKey(galleryEditKey.value) || "subject", // only a label for the request
      jobId: null,
      job: null,
      before: galleryEditDef.value,
      note: "Preparing the image…",
      starting: true,
    });
    paintGal();
    try {
      await loadCfg();
      const url = await scaledImage(item.localUrl, cfg.analyzeImageSize || 768).catch(() => "");
      const job = await api("/api/llm/analyze", "POST", {
        projectId: item.projectId || activeProjectId,
        subjects: [{ key: st.key, note: st.before.trim(), images: [{ id: item.id, url }] }],
      });
      if (gal !== st) return void api(`/api/llm/jobs/${job.id}/cancel`, "POST").catch(() => {});
      Object.assign(st, { jobId: job.id, job, note: "", starting: false });
      paintGal();
      pollGal();
    } catch (err) {
      Object.assign(st, { note: `⚠ ${err.message}`, starting: false });
      paintGal();
    }
  }

  $(".llm-an-go", galBar).addEventListener("click", startGal);
  $(".llm-an-stop", galBar).addEventListener("click", async () => {
    const st = gal;
    if (!st?.jobId) return;
    clearTimeout(galTimer);
    try {
      st.job = await api(`/api/llm/jobs/${st.jobId}/cancel`, "POST");
    } catch {
      /* already over */
    }
    paintGal();
  });
  $(".llm-an-undo", galBar).addEventListener("click", () => {
    if (!gal || galOpen()?.id !== gal.itemId) return;
    galleryEditDef.value = gal.before;
    gal = null;
    paintGal();
  });
  if (typeof openGalleryEdit === "function") {
    const orig = openGalleryEdit;
    openGalleryEdit = function (...args) {
      const out = orig.apply(this, args);
      if (gal && gal.itemId !== galOpen()?.id) stopGal();
      else if (gal && !galActive()) gal = null; // reopened: the box holds the saved text again
      paintGal();
      return out;
    };
  }
  // Closed (Cancel, Save, Esc, a click outside) with a job still running: stop it.
  if (galModal)
    new MutationObserver(() => {
      if (galModal.classList.contains("hidden") && gal) stopGal();
    }).observe(galModal, { attributes: true, attributeFilter: ["class"] });

  // Opening another prompt shows that prompt's revision state (and a fresh box).
  if (typeof openPromptEditor === "function") {
    const orig = openPromptEditor;
    openPromptEditor = function (...args) {
      const out = orig.apply(this, args);
      // An analysis that finished while this prompt was closed goes in now; one that
      // was already applied (or undone) is over with.
      const an = anState.get(curId());
      if (an && !applyAn(an) && !(an.job && ACTIVE.includes(an.job.status))) {
        anState.delete(curId());
        paintAn();
      }
      r.ask.value = "";
      const st = revState.get(curId());
      rev.open = !!st;
      if (st && !st.undo && st.job?.status === "done") st.before = editorText();
      renderRev();
      return out;
    };
  }
})();
