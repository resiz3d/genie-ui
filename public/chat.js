// --- 💬 Chat: a conversation with the LLM chosen in ⚙ LLM settings ---------------
// Loaded after app.js and llm.js. The server keeps the chats (llm.js → chats/), so a
// conversation started on the desktop carries on from the phone. Attachments are
// prepared here before they're sent: pictures scaled down to a size a vision model
// takes in, a video turned into a handful of frames, a text file read as text. A
// reply is a job on the LLM queue; its text is polled while it streams in.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const ACTIVE = ["queued", "waiting", "loading", "generating"];
  const MAX_SIDE = 1536; // a picture's longest side as sent
  const FRAME_SIDE = 768; // a video frame's
  const MAX_PICTURES = 10; // the server's limit per message (a video's frames count)
  const MAX_TEXT = 200000;
  const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|js|mjs|cjs|ts|py|html?|css|xml|ya?ml|srt|vtt|log|ini|toml|sh|bat|ps1)$/i;

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

  // ------------------------------------------------------------- markup
  const modal = document.createElement("div");
  modal.id = "chatModal";
  modal.className = "modal hidden chat-modal";
  modal.innerHTML = `
  <div class="modal-box chat-box" role="dialog" aria-labelledby="chatHeading">
    <aside class="chat-side">
      <div class="chat-side-head">
        <b>Chats</b>
        <button type="button" class="btn-secondary chat-new" title="Start a new conversation">＋ New chat</button>
      </div>
      <div class="chat-list"></div>
    </aside>
    <section class="chat-main">
      <div class="chat-head">
        <button type="button" class="link-btn chat-toggle-list" title="Your chats" aria-label="Your chats">☰</button>
        <h3 id="chatHeading" class="chat-title">New chat</h3>
        <button type="button" class="link-btn chat-rename" title="Rename this chat">✎</button>
        <button type="button" class="link-btn chat-opts-btn" title="Instructions for this chat">⚙</button>
        <button type="button" class="link-btn pe-close chat-close" title="Close (Esc)">×</button>
      </div>
      <div class="chat-model muted"></div>
      <div class="chat-opts hidden">
        <label><span>Instructions for this chat <span class="hint">— the system prompt. Blank: a general-purpose assistant.</span></span>
          <textarea class="chat-system" rows="3" placeholder="e.g. You are a cinematographer. Help me plan shots and write video prompts."></textarea>
        </label>
      </div>
      <div class="chat-log" aria-live="polite"></div>
      <div class="chat-composer">
        <div class="chat-attachments"></div>
        <div class="chat-input-row">
          <button type="button" class="btn-secondary chat-attach" title="Attach pictures, videos or text files from this device">📎</button>
          <button type="button" class="btn-secondary chat-lib" title="Attach an image or video from GENie (History, Gallery, edits)">📚</button>
          <textarea class="chat-input" rows="1" placeholder="Message the LLM…"></textarea>
          <button type="button" class="chat-send" title="Send">➤</button>
          <button type="button" class="btn-secondary chat-stop hidden" title="Stop the reply">■</button>
        </div>
        <p class="chat-status muted"></p>
      </div>
      <input type="file" class="chat-file" multiple hidden
        accept="image/*,video/*,text/*,.txt,.md,.json,.csv,.tsv,.js,.ts,.py,.html,.css,.xml,.yaml,.yml,.srt,.vtt,.log" />
    </section>
  </div>`;
  document.body.appendChild(modal);

  const lib = document.createElement("div");
  lib.id = "chatLibrary";
  lib.className = "modal hidden";
  lib.innerHTML = `
  <div class="modal-box fp-box ve-lib-box" role="dialog" aria-labelledby="chatLibHeading">
    <div class="pe-head">
      <h3 id="chatLibHeading">Attach from GENie</h3>
      <button type="button" class="link-btn pe-close chat-lib-close" title="Close (Esc)">×</button>
    </div>
    <div class="ve-lib-bar">
      <label class="inline" title="Show every project's media, not only the active project's">
        <input type="checkbox" class="chat-lib-all" /> All projects
      </label>
      <label class="inline"><input type="checkbox" class="chat-lib-videos" checked /> Videos</label>
      <span class="muted ve-lib-count chat-lib-count"></span>
    </div>
    <p class="dz-hint chat-lib-empty hidden"></p>
    <div class="ve-lib-grid chat-lib-grid"></div>
    <button type="button" class="btn-secondary chat-lib-more hidden">Show more</button>
    <div class="modal-actions">
      <button type="button" class="btn-secondary chat-lib-close">Done</button>
    </div>
  </div>`;
  document.body.appendChild(lib);

  const el = {
    box: $(".chat-box", modal),
    side: $(".chat-side", modal),
    list: $(".chat-list", modal),
    title: $(".chat-title", modal),
    model: $(".chat-model", modal),
    opts: $(".chat-opts", modal),
    system: $(".chat-system", modal),
    log: $(".chat-log", modal),
    atts: $(".chat-attachments", modal),
    input: $(".chat-input", modal),
    send: $(".chat-send", modal),
    stop: $(".chat-stop", modal),
    status: $(".chat-status", modal),
    file: $(".chat-file", modal),
  };

  // ------------------------------------------------------------- state
  let chats = []; // the list: [{ id, title, updatedAt, preview, busy }]
  let chat = null; // the open chat as the server has it; null = a new one, not sent yet
  let newSystem = ""; // a new chat's instructions, until its first message
  let pending = []; // attachments for the next message
  let preparing = 0; // attachments still being read / scaled
  let job = null; // the reply under way
  let pollTimer = null;
  let cfg = null;

  // ------------------------------------------------------------- model line
  async function loadCfg() {
    try {
      cfg = await api("/api/llm/settings");
    } catch {
      /* offline */
    }
    renderModel();
  }
  document.addEventListener("genie:llm-cfg", (e) => {
    cfg = e.detail;
    renderModel();
  });
  function renderModel() {
    const src = cfg?.sources.find((s) => s.id === cfg.activeSourceId) || cfg?.sources[0];
    el.model.innerHTML =
      !cfg ? ""
      : !src ?
        `No LLM server set up — <button type="button" class="link-btn chat-llm-settings">⚙ LLM settings</button>`
      : `Model: <b>${h(src.model || "(none chosen)")}</b> · ${h(src.name)} — ` +
        `<button type="button" class="link-btn chat-llm-settings">change in ⚙ LLM settings</button>`;
    $(".chat-llm-settings", el.model)?.addEventListener("click", () => window.GENie?.openLlmSettings?.());
  }

  // ------------------------------------------------------------- markdown
  // A small, safe subset: everything is escaped first, then fences, inline code,
  // headings, lists, quotes, bold/italic and http(s) links are turned into markup.
  function inline(s) {
    return s
      .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>")
      .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<i>$2</i>")
      .replace(
        /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
        (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`,
      );
  }
  function md(text) {
    const out = [];
    const parts = String(text || "").split(/^```[^\n]*\n?/m);
    // Even parts are prose, odd parts are code (an unclosed fence runs to the end).
    parts.forEach((part, i) => {
      if (i % 2) {
        const code = part.replace(/\n$/, "");
        out.push(
          `<div class="chat-code"><div class="chat-code-bar">` +
            `<button type="button" class="link-btn chat-copy-code">Copy</button>` +
            `<button type="button" class="link-btn chat-use-code" title="Put this in the prompt box">→ Prompt</button></div>` +
            `<pre><code>${h(code)}</code></pre></div>`,
        );
        return;
      }
      let list = null; // "ul" | "ol"
      let para = [];
      const flush = () => {
        if (para.length) out.push(`<p>${para.join("<br>")}</p>`);
        para = [];
      };
      const endList = () => {
        if (list) out.push(`</${list}>`);
        list = null;
      };
      for (const raw of part.split("\n")) {
        const line = h(raw);
        let m;
        if (!raw.trim()) {
          flush();
          endList();
        } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
          flush();
          endList();
          const n = Math.min(6, m[1].length + 2);
          out.push(`<h${n}>${inline(m[2])}</h${n}>`);
        } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
          flush();
          const kind = /^\s*\d/.test(line) ? "ol" : "ul";
          if (list !== kind) {
            endList();
            out.push(`<${kind}>`);
            list = kind;
          }
          out.push(`<li>${inline(m[1])}</li>`);
        } else if ((m = /^&gt;\s?(.*)$/.exec(line))) {
          flush();
          endList();
          out.push(`<blockquote>${inline(m[1])}</blockquote>`);
        } else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(raw)) {
          flush();
          endList();
          out.push("<hr>");
        } else {
          endList();
          para.push(inline(line));
        }
      }
      flush();
      endList();
    });
    return out.join("");
  }

  // The text of a reply as it streams: without its <think> block.
  const visible = (raw) =>
    String(raw || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<think>[\s\S]*$/i, "")
      .replace(/^[\s\S]*<\/think>/i, "")
      .trim();

  // ------------------------------------------------------------- rendering
  const mediaUrl = (file) => `/api/llm/chats/${chat.id}/media/${encodeURIComponent(file)}`;
  const nearBottom = () => el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 80;
  const toBottom = () => (el.log.scrollTop = el.log.scrollHeight);

  function attachmentHtml(a) {
    if (a.kind === "text")
      return `<span class="chat-file-chip" title="${h(a.name)}">📄 ${h(a.name)}</span>`;
    const file = a.kind === "video" ? a.frames[0]?.file : a.file;
    const label = a.kind === "video" ? `▶ ${a.frames.length} frames` : "";
    return (
      `<button type="button" class="chat-thumb" data-kind="${a.kind}" data-files="${h(
        (a.kind === "video" ? a.frames.map((f) => f.file) : [a.file]).join(","),
      )}" title="${h(a.name)}">` +
      `<img src="${h(mediaUrl(file))}" alt="" loading="lazy" />` +
      (label ? `<span class="chat-thumb-badge">${label}</span>` : "") +
      `</button>`
    );
  }

  function messageHtml(m, isLast) {
    if (m.role === "user")
      return (
        `<div class="chat-msg user" data-id="${h(m.id)}">` +
        (m.attachments?.length ? `<div class="chat-msg-atts">${m.attachments.map(attachmentHtml).join("")}</div>` : "") +
        (m.text ? `<div class="chat-bubble">${h(m.text)}</div>` : "") +
        `</div>`
      );
    return (
      `<div class="chat-msg assistant" data-id="${h(m.id)}">` +
      (m.thinking ?
        `<details class="chat-think"><summary>💭 Thinking</summary><div>${h(m.thinking)}</div></details>`
      : "") +
      `<div class="chat-bubble md">${md(m.text)}</div>` +
      `<div class="chat-msg-foot muted">` +
      `<span>${h(m.model || "")}${m.stopped ? " · stopped" : ""}</span>` +
      `<button type="button" class="link-btn chat-copy">Copy</button>` +
      `<button type="button" class="link-btn chat-use" title="Put this reply in the prompt box">→ Prompt</button>` +
      (isLast ? `<button type="button" class="link-btn chat-regen" title="Ask for a different reply">↻ Regenerate</button>` : "") +
      `</div></div>`
    );
  }

  function renderLog() {
    const stick = nearBottom();
    const msgs = chat?.messages || [];
    let html = "";
    if (!msgs.length && !job)
      html =
        `<div class="chat-empty muted"><p>💬 Chat with your LLM.</p>` +
        `<p>Attach pictures 📎, a video (sent as frames), a text file — or pick from GENie 📚. ` +
        `Paste or drop images straight in.</p></div>`;
    const lastAssistant = msgs.length && msgs[msgs.length - 1].role === "assistant";
    msgs.forEach((m, i) => (html += messageHtml(m, i === msgs.length - 1 && lastAssistant && !job)));
    if (job) {
      const text = visible(job.partial);
      const thinking = /<think>(?![\s\S]*<\/think>)/i.test(job.partial || "");
      html +=
        `<div class="chat-msg assistant pending">` +
        `<div class="chat-bubble md">${text ? md(text) : ""}` +
        `<span class="chat-typing">${thinking ? "💭 thinking" : text ? "" : h(job.message || "…")}<i></i><i></i><i></i></span></div>` +
        `</div>`;
    } else if (chat?.lastError) {
      html +=
        `<div class="chat-error"><span>⚠ ${h(chat.lastError.message)}</span>` +
        (msgs[msgs.length - 1]?.role === "user" ?
          `<button type="button" class="btn-secondary chat-retry">↻ Retry</button>`
        : "") +
        `</div>`;
    }
    el.log.innerHTML = html;
    if (stick || !job) toBottom();
  }

  function renderHead() {
    el.title.textContent = chat?.title || "New chat";
    $(".chat-rename", modal).classList.toggle("hidden", !chat);
    if (document.activeElement !== el.system) el.system.value = chat ? chat.system || "" : newSystem;
    const busy = !!job;
    el.send.classList.toggle("hidden", busy);
    el.stop.classList.toggle("hidden", !busy);
    el.send.disabled = preparing > 0;
    el.status.textContent =
      preparing ? `Preparing ${preparing} attachment${preparing === 1 ? "" : "s"}…`
      : busy && job.status !== "generating" ? job.message || ""
      : "";
  }

  function renderList() {
    el.list.innerHTML = chats.length ? "" : `<p class="muted chat-list-empty">No chats yet.</p>`;
    for (const c of chats) {
      const row = document.createElement("div");
      row.className = `chat-item${chat?.id === c.id ? " active" : ""}`;
      row.innerHTML =
        `<button type="button" class="chat-item-open">` +
        `<span class="chat-item-title">${c.busy ? "⏳ " : ""}${h(c.title)}</span>` +
        `<span class="chat-item-when muted">${h(when(c.updatedAt))}</span></button>` +
        `<button type="button" class="link-btn chat-item-del" title="Delete this chat">🗑</button>`;
      $(".chat-item-open", row).addEventListener("click", () => {
        openChat(c.id);
        modal.classList.remove("list-open");
      });
      $(".chat-item-del", row).addEventListener("click", () => removeChat(c));
      el.list.appendChild(row);
    }
  }

  function when(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const today = new Date().toDateString() === d.toDateString();
    return today ?
        d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function renderAttachments() {
    el.atts.innerHTML = "";
    pending.forEach((a, i) => {
      const chip = document.createElement("div");
      chip.className = `chat-att${a.kind === "text" ? " text" : ""}`;
      chip.title = a.name;
      chip.innerHTML =
        a.kind === "text" ? `<span>📄 ${h(a.name)}</span>`
        : `<img src="${h(a.kind === "video" ? a.frames[0].url : a.url)}" alt="" />` +
          (a.kind === "video" ? `<span class="chat-thumb-badge">▶ ${a.frames.length}</span>` : "");
      const x = document.createElement("button");
      x.type = "button";
      x.className = "chat-att-x";
      x.textContent = "×";
      x.title = "Remove";
      x.addEventListener("click", () => {
        pending.splice(i, 1);
        renderAttachments();
      });
      chip.appendChild(x);
      el.atts.appendChild(chip);
    });
    el.atts.classList.toggle("hidden", !pending.length);
  }

  const render = () => {
    renderHead();
    renderLog();
  };

  // ------------------------------------------------------------- attachments
  const pictureCount = (list = pending) =>
    list.reduce((n, a) => n + (a.kind === "image" ? 1 : a.kind === "video" ? a.frames.length : 0), 0);

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("couldn't read the picture"));
      img.src = src;
    });
  }
  function toJpeg(source, w, h0, side) {
    const k = Math.min(1, side / Math.max(w, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h0 * k));
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; // transparent parts of a PNG
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  }
  async function pictureFrom(url) {
    const img = await loadImage(url);
    return toJpeg(img, img.naturalWidth, img.naturalHeight, MAX_SIDE);
  }

  // Frames spread across the video: about one every 1.5 s, 2 to 8 of them.
  async function framesFrom(url) {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    v.src = url;
    const wait = (evt) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("the video took too long to load")), 20000);
        v.addEventListener(evt, () => (clearTimeout(t), resolve()), { once: true });
        v.addEventListener("error", () => (clearTimeout(t), reject(new Error("couldn't read the video"))), { once: true });
      });
    await wait("loadeddata");
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    const n = d ? Math.max(2, Math.min(8, Math.round(d / 1.5))) : 1;
    const frames = [];
    for (let i = 0; i < n; i++) {
      const t = d ? Math.min(d - 0.05, ((i + 0.5) / n) * d) : 0;
      if (Math.abs(v.currentTime - t) > 0.01) {
        v.currentTime = t;
        await wait("seeked");
      }
      frames.push({ t: Math.round(t * 10) / 10, url: toJpeg(v, v.videoWidth, v.videoHeight, FRAME_SIDE) });
    }
    v.removeAttribute("src");
    v.load();
    return { frames, duration: d };
  }

  const isText = (f) =>
    /^text\//.test(f.type) || /json|xml|yaml|javascript/.test(f.type) || TEXT_EXT.test(f.name || "");

  // Files from the device, a drop or a paste.
  async function addFiles(files) {
    for (const f of [...files]) {
      const kind =
        f.type.startsWith("image/") ? "image"
        : f.type.startsWith("video/") ? "video"
        : isText(f) ? "text"
        : null;
      if (!kind) {
        el.status.textContent = `⚠ "${f.name}" can't be attached — pictures, videos and text files only.`;
        continue;
      }
      await addOne(kind, f.name || kind, async () => {
        if (kind === "text") {
          const text = await f.text();
          if (text.length > MAX_TEXT) throw new Error(`"${f.name}" is too long to attach`);
          return { text };
        }
        const url = URL.createObjectURL(f);
        try {
          return kind === "image" ? { url: await pictureFrom(url) } : await framesFrom(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      });
    }
  }

  async function addOne(kind, name, prepare) {
    if (kind !== "text" && pictureCount() >= MAX_PICTURES) {
      el.status.textContent = `⚠ Up to ${MAX_PICTURES} pictures a message (a video's frames count too).`;
      return;
    }
    preparing++;
    renderHead();
    try {
      const a = { kind, name, ...(await prepare()) };
      if (kind === "video" && pictureCount() + a.frames.length > MAX_PICTURES)
        a.frames = a.frames.slice(0, Math.max(1, MAX_PICTURES - pictureCount()));
      pending.push(a);
      renderAttachments();
    } catch (err) {
      el.status.textContent = `⚠ ${name}: ${err.message || err}`;
      preparing--;
      renderHead();
      return;
    }
    preparing--;
    renderHead();
  }

  // ------------------------------------------------------------- the GENie picker
  const L = {
    grid: $(".chat-lib-grid", lib),
    all: $(".chat-lib-all", lib),
    videos: $(".chat-lib-videos", lib),
    count: $(".chat-lib-count", lib),
    empty: $(".chat-lib-empty", lib),
    more: $(".chat-lib-more", lib),
  };
  const LIB_PAGE = 30;
  let libItems = [];
  let libShown = 0;

  function showMoreLibrary() {
    for (const item of libItems.slice(libShown, libShown + LIB_PAGE)) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "ve-lib-item";
      tile.title = `${item.name}${item.label ? `\n${item.label}` : ""}`;
      tile.innerHTML =
        (item.kind === "video" ?
          `<video muted preload="metadata" playsinline></video>`
        : `<img class="ie-lib-thumb" loading="lazy" decoding="async" alt="" />`) +
        `<span class="ve-lib-src"></span><span class="ve-lib-label"></span>`;
      $(item.kind === "video" ? "video" : "img", tile).src = item.url + (item.kind === "video" ? "#t=0.5" : "");
      $(".ve-lib-src", tile).textContent = item.kind === "video" ? `▶ ${item.source}` : item.source;
      $(".ve-lib-label", tile).textContent = item.name;
      tile.addEventListener("click", () => {
        tile.classList.add("picked");
        addOne(item.kind, item.name, async () =>
          item.kind === "video" ? framesFrom(item.url) : { url: await pictureFrom(item.url) },
        );
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
    L.empty.textContent = "Loading…";
    L.empty.classList.remove("hidden");
    const all = L.all.checked;
    const pid = all ? "all" : typeof activeProjectId !== "undefined" ? activeProjectId : "default";
    try {
      const items = await api(
        `/api/image-editor/library?projectId=${encodeURIComponent(pid)}${L.videos.checked ? "&video=1" : ""}`,
      );
      if (lib.classList.contains("hidden")) return;
      libItems = items;
      L.empty.textContent = items.length ? "" : `Nothing in ${all ? "any project" : "this project"} yet.`;
      L.empty.classList.toggle("hidden", !!items.length);
      showMoreLibrary();
    } catch (err) {
      L.empty.textContent = `Couldn't list GENie's media: ${err.message || err}`;
    }
  }
  const closeLibrary = () => {
    lib.classList.add("hidden");
    L.grid.innerHTML = "";
  };
  $(".chat-lib", modal).addEventListener("click", () => {
    lib.classList.remove("hidden");
    loadLibrary();
  });
  lib.querySelectorAll(".chat-lib-close").forEach((b) => b.addEventListener("click", closeLibrary));
  L.all.addEventListener("change", loadLibrary);
  L.videos.addEventListener("change", loadLibrary);
  L.more.addEventListener("click", showMoreLibrary);
  lib.addEventListener("click", (e) => e.target === lib && closeLibrary());

  // ------------------------------------------------------------- talking to the server
  async function loadList() {
    try {
      chats = await api("/api/llm/chats");
    } catch {
      /* offline */
    }
    renderList();
  }

  async function openChat(id) {
    stopPolling();
    try {
      chat = await api(`/api/llm/chats/${id}`);
    } catch (err) {
      el.status.textContent = `⚠ ${err.message}`;
      return;
    }
    job = chat.job;
    renderList();
    render();
    toBottom();
    if (job) poll();
  }

  function newChat() {
    stopPolling();
    chat = null;
    job = null;
    newSystem = "";
    renderList();
    render();
    el.input.focus();
  }

  async function send(extra = {}) {
    const text = el.input.value.trim();
    if (!extra.retry && !extra.regenerate && !text && !pending.length) return el.input.focus();
    if (preparing) return;
    el.send.disabled = true;
    try {
      const out = await api("/api/llm/chats/send", "POST", {
        chatId: chat?.id,
        system: chat ? undefined : newSystem,
        ...(extra.retry || extra.regenerate ? extra : { text, attachments: pending }),
      });
      if (!extra.retry && !extra.regenerate) {
        el.input.value = "";
        pending = [];
        renderAttachments();
        grow();
      }
      chat = out;
      job = out.job;
      render();
      toBottom();
      loadList();
      poll();
    } catch (err) {
      el.status.textContent = `⚠ ${err.message}`;
    } finally {
      el.send.disabled = false;
    }
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function poll() {
    stopPolling();
    if (!job) return;
    const id = job.id;
    try {
      const j = await api(`/api/llm/jobs/${id}`);
      if (job?.id !== id) return; // another chat was opened meanwhile
      job = j;
    } catch {
      job = { ...job, status: "failed" };
    }
    if (ACTIVE.includes(job.status)) {
      render();
      if (!modal.classList.contains("hidden")) pollTimer = setTimeout(poll, 600);
      return;
    }
    // Done, failed or stopped: the chat now has the reply (or the error).
    job = null;
    const cid = chat?.id;
    if (cid) {
      try {
        chat = await api(`/api/llm/chats/${cid}`);
        job = chat.job;
      } catch {
        /* deleted */
      }
    }
    render();
    loadList();
    if (job) poll();
  }

  async function removeChat(c) {
    if (!confirm(`Delete the chat “${c.title}”? Its messages and attachments are removed for good.`)) return;
    try {
      await api(`/api/llm/chats/${c.id}`, "DELETE");
    } catch (err) {
      return alert(err.message);
    }
    if (chat?.id === c.id) newChat();
    loadList();
  }

  // The prompt box gets a reply (or one of its code blocks).
  function useAsPrompt(text) {
    const ta = document.getElementById("prompt");
    if (!ta) return;
    if (ta.value.trim() && ta.value.trim() !== text.trim() && !confirm("Replace what's in the prompt box?")) return;
    ta.value = text.trim();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    ta.scrollIntoView({ behavior: "smooth", block: "center" });
    ta.focus({ preventScroll: true });
  }
  // A reply with exactly one code block is usually "here's your prompt": that block.
  function promptOf(m) {
    const blocks = [...String(m.text).matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)];
    return blocks.length === 1 ? blocks[0][1] : m.text;
  }
  const copy = async (text, btn) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = old), 1200);
  };

  // ------------------------------------------------------------- open / close
  async function open(opts = {}) {
    modal.classList.remove("hidden");
    document.body.classList.add("chat-open");
    loadCfg();
    await loadList();
    if (opts.chatId) await openChat(opts.chatId);
    else if (!chat && chats.length) await openChat(chats[0].id);
    else {
      render();
      if (job) poll();
    }
    for (const url of opts.attach || [])
      addOne(/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) ? "video" : "image", url.split("/").pop().split("?")[0], async () =>
        /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) ? framesFrom(url) : { url: await pictureFrom(url) },
      );
    if (!matchMedia("(pointer: coarse)").matches) el.input.focus();
  }
  function close() {
    modal.classList.add("hidden");
    modal.classList.remove("list-open");
    document.body.classList.remove("chat-open");
    stopPolling(); // the reply carries on on the server; reopening picks it up
  }

  // ------------------------------------------------------------- wiring
  const grow = () => {
    el.input.style.height = "auto";
    el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
  };
  el.input.addEventListener("input", grow);
  el.input.addEventListener("keydown", (e) => {
    // Enter sends on a keyboard; on a phone it's a new line (the ➤ button sends).
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      if (!job) send();
    }
  });
  el.send.addEventListener("click", () => send());
  el.stop.addEventListener("click", async () => {
    if (!job) return;
    try {
      await api(`/api/llm/jobs/${job.id}/cancel`, "POST");
    } catch {
      /* already over */
    }
    poll();
  });
  $(".chat-attach", modal).addEventListener("click", () => el.file.click());
  el.file.addEventListener("change", () => {
    const files = [...el.file.files];
    el.file.value = "";
    addFiles(files);
  });
  // Drops — and pastes, which paste.js hands to the open dialog as a drop.
  ["dragenter", "dragover"].forEach((evt) =>
    el.box.addEventListener(evt, (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      el.box.classList.add("dragover");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    el.box.addEventListener(evt, (e) => {
      if (evt === "dragleave" && el.box.contains(e.relatedTarget)) return;
      el.box.classList.remove("dragover");
    }),
  );
  el.box.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });

  $(".chat-new", modal).addEventListener("click", () => {
    newChat();
    modal.classList.remove("list-open");
  });
  $(".chat-toggle-list", modal).addEventListener("click", () => modal.classList.toggle("list-open"));
  $(".chat-close", modal).addEventListener("click", close);
  $(".chat-opts-btn", modal).addEventListener("click", () => {
    el.opts.classList.toggle("hidden");
    if (!el.opts.classList.contains("hidden")) el.system.focus();
  });
  $(".chat-rename", modal).addEventListener("click", async () => {
    if (!chat) return;
    const t = prompt("Name this chat:", chat.title || "");
    if (t == null || !t.trim()) return;
    try {
      chat = { ...(await api(`/api/llm/chats/${chat.id}`, "PUT", { title: t })), job: chat.job };
      renderHead();
      loadList();
    } catch (err) {
      alert(err.message);
    }
  });
  let sysTimer = null;
  el.system.addEventListener("input", () => {
    if (!chat) return void (newSystem = el.system.value);
    clearTimeout(sysTimer);
    const id = chat.id;
    sysTimer = setTimeout(() => {
      api(`/api/llm/chats/${id}`, "PUT", { system: el.system.value })
        .then((c) => chat?.id === id && (chat.system = c.system))
        .catch((err) => (el.status.textContent = `⚠ ${err.message}`));
    }, 600);
  });

  el.log.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.classList.contains("chat-retry")) return void send({ retry: true });
    if (t.classList.contains("chat-regen")) return void send({ regenerate: true });
    if (t.classList.contains("chat-thumb")) {
      const files = t.dataset.files.split(",");
      // A video's frames step through in the lightbox like a little slideshow.
      const items = files.map((f) => ({ kind: "image", src: mediaUrl(f), name: t.title }));
      return void openLightbox("image", items[0].src, t.title, items.length > 1 ? { items, index: 0 } : null);
    }
    if (t.classList.contains("chat-copy-code") || t.classList.contains("chat-use-code")) {
      const code = t.closest(".chat-code").querySelector("code").textContent;
      return void (t.classList.contains("chat-use-code") ? useAsPrompt(code) : copy(code, t));
    }
    const id = t.closest(".chat-msg")?.dataset.id;
    const m = chat?.messages.find((x) => x.id === id);
    if (!m) return;
    if (t.classList.contains("chat-copy")) copy(m.text, t);
    if (t.classList.contains("chat-use")) useAsPrompt(promptOf(m));
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
    // Tapping the conversation closes the chat list drawer (phones).
    else if (modal.classList.contains("list-open") && !el.side.contains(e.target) && !e.target.closest(".chat-toggle-list"))
      modal.classList.remove("list-open");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!lib.classList.contains("hidden")) return closeLibrary();
    if (modal.classList.contains("hidden")) return;
    // A dialog opened over the chat (⚙ LLM settings, the lightbox) closes first.
    const over = [...document.querySelectorAll(".modal:not(.hidden), .lightbox:not(.hidden)")].some(
      (m) => m !== modal && m !== lib && m.getClientRects().length,
    );
    if (!over) close();
  }, true); // capture: see the lightbox before its own Escape handler hides it

  window.GENie = window.GENie || {};
  // For plugins and other panels: open the chat, optionally on a chat or with media
  // (served URLs) attached to the next message.
  window.GENie.chat = { open };
  document.getElementById("openChat")?.addEventListener("click", () => open());
})();
