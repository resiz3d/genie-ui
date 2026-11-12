// --- ⚙ Settings: one window, a tab per section -------------------------------
// Loaded after app.js (uses its globals: genSettings, applyGenSettings, getPref,
// setPref) and before llm.js, which puts its own form in the LLM tab.
//
//   🖼 Image / Video     — the ComfyUI servers generations run on (one or several)
//   💬 LLM               — the servers ✨ Build with AI, Revise, Analyze and Chat use (llm.js)
//   ☁ Online providers  — API keys for cloud services: kie.ai, which is both an
//                          image/video generator and an LLM, so its key lives here once
//
// Each tab saves on its own. Everything is kept on the server (settings/*.json), so
// nothing here needs .env — and API keys never come back to the browser.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
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
  const showErr = (el, msg) => {
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  };

  const TABS = [
    { id: "generation", icon: "🖼", label: "Image / Video" },
    { id: "llm", icon: "💬", label: "LLM" },
    { id: "providers", icon: "☁", label: "Online providers" },
  ];
  const TAB_KEY = "genie_settings_tab";

  // ------------------------------------------------------------- the window
  const modal = document.createElement("div");
  modal.id = "settingsModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
  <div class="modal-box settings-box" role="dialog" aria-labelledby="settingsHeading">
    <div class="pe-head settings-head">
      <h3 id="settingsHeading">⚙ Settings</h3>
      <button type="button" class="link-btn pe-close settings-close" title="Close (Esc)">×</button>
    </div>
    <div class="settings-body">
      <div class="settings-tabs" role="tablist" aria-orientation="vertical">
        ${TABS.map(
          (t) =>
            `<button type="button" class="settings-tab" role="tab" data-tab="${t.id}" id="settingsTab-${t.id}" aria-controls="settingsPane-${t.id}">` +
            `<span aria-hidden="true">${t.icon}</span> ${h(t.label)}</button>`,
        ).join("")}
      </div>
      <div class="settings-panes">
        ${TABS.map(
          (t) =>
            `<section class="settings-pane llm-box hidden" role="tabpanel" data-tab="${t.id}" id="settingsPane-${t.id}" aria-labelledby="settingsTab-${t.id}"></section>`,
        ).join("")}
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const pane = (id) => $(`.settings-pane[data-tab="${id}"]`, modal);
  const onShow = {}; // tab → loader, run the first time the tab is shown after opening
  const shown = new Set();
  let current = null;

  function select(id) {
    if (!TABS.some((t) => t.id === id)) id = TABS[0].id;
    current = id;
    for (const b of modal.querySelectorAll(".settings-tab")) {
      const on = b.dataset.tab === id;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    }
    for (const p of modal.querySelectorAll(".settings-pane"))
      p.classList.toggle("hidden", p.dataset.tab !== id);
    $(".settings-panes", modal).scrollTop = 0;
    setPref(TAB_KEY, id);
    if (shown.has(id)) return Promise.resolve();
    shown.add(id);
    return Promise.resolve(onShow[id]?.()).catch((err) => console.error(err));
  }
  const isOpen = () => !modal.classList.contains("hidden");
  // Opening starts every tab afresh from what's saved; switching tabs while it's open
  // keeps what was typed in the others.
  function open(id) {
    if (!isOpen()) shown.clear();
    modal.classList.remove("hidden");
    return select(id || current || getPref(TAB_KEY) || TABS[0].id);
  }
  const close = () => modal.classList.add("hidden");

  $(".settings-tabs", modal).addEventListener("click", (e) => {
    const b = e.target.closest(".settings-tab");
    if (b) select(b.dataset.tab);
  });
  // Up / Down (and Left / Right, when the tabs sit in a row on a phone) move between tabs.
  $(".settings-tabs", modal).addEventListener("keydown", (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === current);
    const next = TABS[(i + step + TABS.length) % TABS.length].id;
    select(next);
    $(`.settings-tab[data-tab="${next}"]`, modal).focus();
  });
  $(".settings-close", modal).addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest(".settings-cancel")) close();
  });
  // Capture phase: Esc closes Settings alone, not a window it was opened over.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !isOpen()) return;
      e.stopImmediatePropagation();
      close();
    },
    true,
  );

  window.GENie = window.GENie || {};
  window.GENie.settings = {
    open,
    close,
    select,
    isOpen,
    pane,
    onShow: (id, fn) => (onShow[id] = fn),
  };

  // The way in, from the page header: under the credits pill (which is hidden without
  // a kie.ai key — the link stays).
  const credits = document.getElementById("credits");
  if (credits) {
    const col = document.createElement("div");
    col.className = "llm-head-col";
    credits.before(col);
    const link = document.createElement("button");
    link.type = "button";
    link.className = "link-btn llm-head-settings";
    link.textContent = "⚙ Settings";
    link.title = "ComfyUI servers, LLM servers and online providers";
    link.addEventListener("click", () => open());
    col.append(credits, link);
  }

  // --------------------------------------------------- 🖼 Image / Video tab
  const gen = pane("generation");
  gen.innerHTML = `
    <h4 class="llm-h4 settings-h4">ComfyUI servers</h4>
    <p class="muted settings-intro">Where your image and video workflows run. Add every ComfyUI you use — one on this PC,
      one on RunPod, one on another machine. With more than one, a picker next to <b>Generate</b> chooses which runs the
      next job, and GENie remembers the last one you used.</p>
    <div class="gs-list"></div>
    <p><button type="button" class="btn-secondary gs-add">＋ Add a ComfyUI server</button></p>
    <p class="muted settings-intro">The address is what you'd open ComfyUI's own page with: <code>http://127.0.0.1:8188</code>
      on this PC, or a pod's proxy link such as <code>https://&lt;pod-id&gt;-8188.proxy.runpod.net</code>. Each server
      needs the models and custom nodes its workflows use.</p>
    <p class="sp-save-warn hidden gs-err"></p>
    <div class="modal-actions">
      <button type="button" class="btn-secondary settings-cancel">Cancel</button>
      <button type="button" class="gs-save">💾 Save</button>
    </div>`;
  const gs = { list: $(".gs-list", gen), err: $(".gs-err", gen), save: $(".gs-save", gen) };
  let servers = []; // [{ id, name, url }] being edited

  const authToSend = (sv) => ({
    type: sv.auth.type,
    username: sv.auth.type === "basic" ? sv.auth.username.trim() : "",
    secret: sv.auth.type === "none" ? "" : sv.auth.secret || "",
  });

  function renderServers() {
    gs.list.innerHTML = "";
    servers.forEach((sv, i) => {
      const row = document.createElement("div");
      row.className = "gs-row";
      row.innerHTML = `
        <label>Name <input type="text" class="gs-name" maxlength="60" placeholder="e.g. This PC" /></label>
        <label>Address <input type="text" class="gs-url" autocomplete="off" spellcheck="false" inputmode="url" placeholder="http://127.0.0.1:8188" /></label>
        <span class="gs-row-btns">
          <button type="button" class="btn-secondary gs-test">🔌 Test</button>
          <button type="button" class="btn-secondary gs-del" title="Remove this server">🗑</button>
        </span>
        <div class="gs-auth">
          <label><span>Sign-in <span class="hint">— only if it asks for one</span></span>
            <select class="gs-auth-type">
              <option value="none">None — open access</option>
              <option value="bearer">Access token</option>
              <option value="basic">Username &amp; password</option>
            </select>
          </label>
          <label class="gs-user-wrap">Username
            <input type="text" class="gs-user" autocomplete="off" spellcheck="false" maxlength="200" />
          </label>
          <label class="gs-secret-wrap"><span class="gs-secret-label">Password</span>
            <input type="password" class="gs-secret" autocomplete="new-password" spellcheck="false" />
          </label>
        </div>
        <span class="muted gs-out" role="status"></span>`;
      const name = $(".gs-name", row);
      const url = $(".gs-url", row);
      const out = $(".gs-out", row);
      name.value = sv.name;
      url.value = sv.url;
      name.addEventListener("input", () => (sv.name = name.value));
      url.addEventListener("input", () => {
        sv.url = url.value;
        sv.dirty = true;
        out.textContent = "";
      });
      // The sign-in a protected server asks for: a token (a login custom node such as
      // ComfyUI-Login) or a username and password (a reverse proxy in front of it).
      // The saved token / password never comes back here — blank keeps it.
      const type = $(".gs-auth-type", row);
      const user = $(".gs-user", row);
      const secret = $(".gs-secret", row);
      type.value = sv.auth.type;
      user.value = sv.auth.username;
      secret.value = sv.auth.secret || "";
      const showAuth = () => {
        const t = type.value;
        $(".gs-user-wrap", row).classList.toggle("hidden", t !== "basic");
        $(".gs-secret-wrap", row).classList.toggle("hidden", t === "none");
        $(".gs-secret-label", row).textContent = t === "bearer" ? "Token" : "Password";
        secret.placeholder =
          sv.auth.hasSecret && sv.auth.savedType === t ? "saved — leave blank to keep it" : "";
      };
      showAuth();
      type.addEventListener("change", () => {
        sv.auth.type = type.value;
        sv.dirty = true;
        out.textContent = "";
        showAuth();
      });
      user.addEventListener("input", () => {
        sv.auth.username = user.value;
        sv.dirty = true;
      });
      secret.addEventListener("input", () => {
        sv.auth.secret = secret.value;
        sv.dirty = true;
      });
      const test = $(".gs-test", row);
      test.addEventListener("click", async () => {
        test.disabled = true;
        out.className = "muted gs-out";
        out.textContent = "Connecting…";
        try {
          const d = await api("/api/generation/test-comfy", "POST", {
            id: sv.id,
            url: url.value,
            auth: authToSend(sv),
          });
          out.textContent =
            "✓ Connected" +
            [d.version && ` — ComfyUI ${d.version}`, d.device && ` · ${d.device}`, d.vramGb && ` · ${d.vramGb} GB VRAM`]
              .filter(Boolean)
              .join("");
        } catch (err) {
          out.className = "gs-out llm-bad";
          out.textContent = `✕ ${err.message}`;
        } finally {
          test.disabled = false;
        }
      });
      const del = $(".gs-del", row);
      del.disabled = servers.length <= 1; // there's always somewhere to generate
      del.addEventListener("click", () => {
        if ((sv.name || sv.url) && !confirm(`Remove "${sv.name || sv.url}"?`)) return;
        servers.splice(i, 1);
        renderServers();
      });
      gs.list.appendChild(row);
    });
  }

  onShow.generation = async () => {
    showErr(gs.err, "");
    let g = genSettings;
    try {
      g = await api("/api/generation/settings"); // another device may have changed it
    } catch {
      /* offline — show what the page loaded with */
    }
    servers = g.comfy.instances.map((i) => ({
      ...i,
      auth: { type: "none", username: "", ...i.auth, savedType: i.auth?.type, secret: "" },
    }));
    renderServers();
  };

  $(".gs-add", gen).addEventListener("click", () => {
    servers.push({
      id: `comfy-${Date.now().toString(36)}`,
      name: "",
      url: "",
      auth: { type: "none", username: "", secret: "" },
    });
    renderServers();
    gs.list.lastElementChild.querySelector(".gs-name").focus();
  });

  gs.save.addEventListener("click", async () => {
    showErr(gs.err, "");
    const list = servers.map((sv, i) => ({
      id: sv.id,
      name: sv.name.trim() || `ComfyUI ${i + 1}`,
      url: sv.url.trim(),
      auth: authToSend(sv),
    }));
    const blank = list.find((sv) => !sv.url);
    if (blank) return showErr(gs.err, `"${blank.name}" needs an address — or remove it.`);
    // The picked server's address or sign-in changed: the workflow form asks it again.
    const reload = servers.some((sv) => sv.dirty && sv.id === genSettings.comfy.activeId);
    gs.save.disabled = true;
    try {
      const saved = await api("/api/generation/settings", "PUT", { comfy: { instances: list } });
      await applyGenSettings(saved, reload);
      close();
    } catch (err) {
      showErr(gs.err, err.message);
    } finally {
      gs.save.disabled = false;
    }
  });

  // ------------------------------------------------ ☁ Online providers tab
  const prov = pane("providers");
  prov.innerHTML = `
    <p class="muted settings-intro">Cloud services GENie can use alongside your own hardware. A key entered here is kept on
      this server (<code>settings/</code>) and is never sent back to the browser.</p>
    <div class="llm-s-source">
      <h4 class="llm-h4 settings-h4">kie.ai <span class="hint">— image &amp; video models, and chat models</span></h4>
      <p class="muted settings-intro">One key switches on the cloud <b>image / video</b> models in the Model picker
        (Seedance, Seedream, Kling, MiniMax, Wan) and lets you add kie.ai's <b>chat</b> models (Claude, GPT, Gemini…) as an
        LLM server. Get a key at <a href="https://kie.ai/api-key" target="_blank" rel="noopener">kie.ai/api-key</a>.</p>
      <p class="muted settings-intro">Saving a new key takes you to the <b>LLM</b> tab with a kie.ai server ready — pick a
        model there and save, or just close it if you only want the image / video models.</p>
      <label><span>API key <span class="hint pv-keyhint"></span></span>
        <input type="password" class="pv-key" autocomplete="new-password" spellcheck="false" placeholder="none" />
      </label>
      <label class="inline hidden pv-clear-wrap"><input type="checkbox" class="pv-clear" /> Remove the saved key</label>
      <div class="llm-s-test-row">
        <button type="button" class="btn-secondary pv-llm">＋ Use kie.ai as an LLM server</button>
        <span class="muted pv-status" role="status"></span>
      </div>
    </div>
    <p class="sp-save-warn hidden pv-err"></p>
    <div class="modal-actions">
      <button type="button" class="btn-secondary settings-cancel">Cancel</button>
      <button type="button" class="pv-save">💾 Save</button>
    </div>`;
  const pv = {
    key: $(".pv-key", prov),
    hint: $(".pv-keyhint", prov),
    clearWrap: $(".pv-clear-wrap", prov),
    clear: $(".pv-clear", prov),
    status: $(".pv-status", prov),
    err: $(".pv-err", prov),
    save: $(".pv-save", prov),
    llm: $(".pv-llm", prov),
  };

  function fillProviders(kie) {
    pv.key.value = "";
    pv.clear.checked = false;
    pv.clearWrap.classList.toggle("hidden", !kie.hasKey);
    pv.hint.textContent =
      kie.hasKey ? "— a key is saved; leave blank to keep it"
      : kie.viaLlm ? "— using the key saved on your kie.ai LLM server; enter one here to replace it"
      : "— paste it here";
    pv.status.textContent =
      kie.hasKey || kie.viaLlm ? "✓ kie.ai is switched on" : "No key yet — the kie.ai models are off.";
  }
  onShow.providers = async () => {
    showErr(pv.err, "");
    let g = genSettings;
    try {
      g = await api("/api/generation/settings");
    } catch {
      /* offline */
    }
    fillProviders(g.kie);
  };

  // Saves what's typed (if anything); true when it went through.
  async function saveProviders() {
    showErr(pv.err, "");
    pv.save.disabled = true;
    try {
      const saved = await api("/api/generation/settings", "PUT", {
        kieApiKey: pv.key.value.trim(),
        clearKieKey: pv.clear.checked,
      });
      await applyGenSettings(saved);
      fillProviders(saved.kie);
      document.dispatchEvent(new CustomEvent("genie:gen-settings", { detail: saved }));
      return true;
    } catch (err) {
      showErr(pv.err, err.message);
      return false;
    } finally {
      pv.save.disabled = false;
    }
  }
  // Saving a new key goes straight on to the LLM tab, with a kie.ai server ready and its
  // models listed: pick one and Save there. (Removing a key, or saving with nothing
  // typed, just closes.)
  pv.save.addEventListener("click", async () => {
    const added = !!pv.key.value.trim() && !pv.clear.checked;
    if (!(await saveProviders())) return;
    if (!added) return close();
    await select("llm");
    window.GENie.addLlmServer?.("kieai");
  });
  // Over to the LLM tab with a kie.ai server ready to pick a model for (llm.js). A key
  // typed but not saved yet is saved on the way, so the model list can load.
  pv.llm.addEventListener("click", async () => {
    if ((pv.key.value.trim() || pv.clear.checked) && !(await saveProviders())) return;
    await select("llm");
    window.GENie.addLlmServer?.("kieai");
  });
})();
