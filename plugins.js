// --- 🧩 Local plugins: personal additions that live outside the repo -------------
// Each folder in plugins/ (git-ignored; PLUGINS_DIR in .env points elsewhere) is one
// plugin, with any of:
//   server.js        export default function (app, ctx) — add routes; may be async.
//                    ctx: { outputDir, inputDir, resolveProject, projects, history,
//                    gallery, videoEditor (the export engine video-editor.js returns) }
//   public/          served at /plugins/<folder>/ — public/client.js and
//                    public/style.css, when there, are loaded into the page.
// A folder whose name starts with "_" or "." is skipped (an easy way to turn one off).
// A plugin that fails to load is reported and skipped; GENie starts without it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";

export async function loadPlugins(app, ctx, dir) {
  const loaded = []; // { name, client, style }
  let names = [];
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !/^[_.]/.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {}
  for (const name of names) {
    const root = path.join(dir, name);
    const has = (...p) => fs.existsSync(path.join(root, ...p));
    try {
      if (has("server.js")) {
        const mod = await import(pathToFileURL(path.join(root, "server.js")).href);
        await (mod.default || mod.register)?.(app, ctx);
      }
      if (has("public"))
        app.use(`/plugins/${encodeURIComponent(name)}`, express.static(path.join(root, "public")));
      loaded.push({ name, client: has("public", "client.js"), style: has("public", "style.css") });
      console.log(`  Plugin loaded: ${name}`);
    } catch (err) {
      console.error(`  Plugin ${name} failed to load and was skipped:`, err);
    }
  }

  // The page loads this last; it adds each plugin's style and script.
  app.get("/plugins.js", (req, res) => {
    const tags = loaded.map((p) => ({
      css: p.style ? `/plugins/${encodeURIComponent(p.name)}/style.css` : "",
      js: p.client ? `/plugins/${encodeURIComponent(p.name)}/client.js` : "",
    }));
    res
      .type("js")
      .set("Cache-Control", "no-store")
      .send(
        `for (const p of ${JSON.stringify(tags)}) {\n` +
          `  if (p.css) document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href: p.css }));\n` +
          `  if (p.js) document.body.appendChild(Object.assign(document.createElement("script"), { src: p.js, async: false }));\n` +
          `}\n`,
      );
  });
  return loaded;
}
