# Changelog

All notable changes to GENie are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

**Releasing:** bump `version` in `package.json` (the only place the number lives — the
startup log and the page footer read it), move the **Unreleased** notes under a new
heading for that version with the date, commit, then tag the commit `vX.Y.Z`.

## [Unreleased]

### Added

- **Reference images for ✨ Revise with AI on the prompt box.** Drop, browse, paste or
  pick from the gallery up to 10 images under the instruction; the LLM sees them as
  <Picture 1>, <Picture 2> … and works what it sees into the revised prompt ("describe
  her outfit from the picture"). Dropped and pasted files are saved to the gallery
  like any reference. Needs a vision-capable model.

## [1.5.1] - 2026-10-19

### Fixed

- **A moved History card keeps its reference media.** References are Gallery items,
  and a moved card used to keep pointing at the old project's Gallery — so tidying
  that Gallery took them off the card. Now moving a card (one at a time or with
  ☑ Select) copies each reference it uses into the new project's Gallery and points
  the card at the copy; the original stays for anything else that uses it. Cards
  that share a reference share one copy, and moving a card back uses the original
  again. For cards moved before this, `npm run rehome-refs` (try `-- --dry-run`
  first) gives each card its own copies the same way.
- **Deleting a Gallery file asks first, and says what it breaks.** The × on the
  thumbnails in the reference pickers deleted the file at once — easy to take for
  "remove from this field" — and History cards that used it lost their reference.
  Both deletes now ask, with how many History cards use it as a reference.
- **kie.ai cards show their saved references.** They showed kie.ai's hosted copies,
  which expire after a few days; they now show the Gallery files GENie kept, and
  the hosted links only when no file is left.
- **Recover deleted references from ComfyUI.** `npm run recover-refs` (try
  `-- --dry-run` first) finds the file behind each reference a card lost: ComfyUI
  keeps a copy of every reference it was given, and the card's own output records
  which one. Each is put back in the Gallery under its old id, so the cards and
  saved prompts using it get it back. References only used in kie.ai runs can't be
  recovered this way.

## [1.5.0] - 2026-10-19

### Added

- **Project folders.** The header's project picker now opens a **Projects** browser
  where projects can be filed into folders and sub-folders, as deep as you like.
  **＋ Project** / **＋ Folder** add at the top level; a row's **⋯** renames, moves
  (⇄ Move to…) or deletes it, and a folder's adds a project or sub-folder inside it.
  On desktop, drag a project or folder onto a folder, or onto empty space for the top
  level. The search box finds a project by its name or any folder above it. The
  header shows the active project's folder path, and every project dropdown (History
  filter, Move to…) groups projects under their folder. Deleting a folder moves its
  contents up a level — no project is deleted, and folders never move files on disk.
  Folders live in `project-folders.json`; which ones are open is remembered on the
  server. A new project's name can be a path — `Clients/Acme/Spot 1` — to make the
  folders it needs at the same time.
- **Move many History cards at once.** **☑ Select** (beside the History filter) puts
  a checkbox on each card; tap a card or its box to pick it, Shift-click for a range.
  The bar that stays at the bottom picks the **Page**, **All** the filter shows (every
  page) or **None**, and **⇄ Move N to…** sends them — with their saved files — to
  any project. **📂 Browse projects…** opens the Projects window to pick the
  destination by folder (search works, and **＋ Project** there makes the project
  and moves the cards into it). **＋ New project…** in that list opens the Projects
  window's **New project** form: type a name, tap the folder it goes in (or ⌂ Top
  level, or **＋ Folder** to make one there), and **Create & move** makes it and moves
  the cards in one go. A / in the name makes folders too (`Acme/Spot 1`). Every other
  ＋ for a new project (the header, the Projects window, a folder's ⋯) uses the same
  form. Runs
  still generating can't be picked; a card whose file is in use stays selected to
  try again.
- **✨ Revise with AI on the prompt box.** Tell the LLM what to change in the prompt
  and it rewrites the text in place; pick a **Guide** for it to follow (the video
  prompt guide from ⚙ LLM settings, or a MiniMax H3 Ref2Video / Text2Video guide).
  The guide picked is remembered on the server.
- **📋 Paste media.** Ctrl+V with an image (or files copied in the file manager) on
  the clipboard drops them into a drop zone: the one under the mouse, the one whose
  field was last clicked, or the Gallery — inside an open dialog, that dialog's.
  Where the page may read the clipboard (localhost or HTTPS), image zones also get
  a **paste** link, for phones.
- **🖼 Image editor**, beside the video editor in the header, and as **✂ Crop** on
  History image cards and Gallery images. Open an image from the device or from
  GENie (History, Gallery, earlier crops), and crop it: drag inside the box to move
  it, a corner to resize it, or anywhere else to draw a new one (arrow keys nudge
  it). Lock it to a shape — Original, 1:1, 2:3, 3:4, 16:9, 9:16, 4:3, 3:2 — or leave
  it Free. **💾 Save** puts the crop in the project's `edited_images` folder (or,
  opened from a card, adds it to the card or replaces its image), **＋ Gallery** adds
  it as a reference image, and **Save as…** saves it on this device. The crop keeps
  the image's own format (PNG, JPEG or WebP) and full resolution.
- **Filters in the video editor's Import from GENie picker.** A search box (every
  word must be in the prompt, name or tags; a `-word` must not) and a chip for each
  source and tag in the list — draft, favorite, a workflow's auto-tags. Click a chip
  to show only those videos (**+**), again to hide them (**−**), again to clear it;
  right-click goes straight to hiding. Picks stay picked while filtered out, and the
  filters are remembered on the server, so they follow you to another device.
- **Video editor projects.** **💾 Save project** (or Ctrl+S) keeps the clips, their
  order, cuts and size/fit choices to come back to and add to; **📂 Open project…**
  lists them to open, rename (✎) or delete. Clips uploaded from your device are moved
  into the project's `edited_videos/sources` folder when first saved, so they outlive
  the temp folder's 12-hour sweep. Videos saved while a project is open (to
  edited_videos, a card or the Gallery) are listed in it under **Saved from this
  project**, to watch again or add back as a clip. The heading shows the open
  project, with • while it has unsaved changes. Projects are stored in
  `video-edits.json`.
- **⫽ Split here** (B) and **⧉ Duplicate** (D) in the video editor. Split cuts the
  clip on screen in two at the frame on screen — that frame starts the second part —
  so each part can be moved, cut or dropped on its own; duplicate puts a copy of a
  clip, cuts and all, right after it. Both share the original file, so nothing is
  uploaded or copied again.
- **The video editor's clips are a grid of cards** instead of one sideways-scrolling
  row: each shows a still of where the clip starts, its number and kept length, then
  its name and ◀ ▶ ⧉ × — and can be dragged to a new place. The grid wraps to the
  dialog's width and scrolls up and down past about two rows; ＋ Prepend and
  Append ＋ sit above it.
- **A second Generate bar under the prompt**, so a long form doesn't have to be
  scrolled to its end to run: Generate, ×count, preview mode, the price estimate and
  the ComfyUI stats line (with Free VRAM), all in step with the ones at the bottom —
  change either and both follow. It sits at the bottom of whichever prompt is on
  screen (kie.ai's, or a ComfyUI workflow's), under every prompt tab.
- **⏹ Cancel all queued** and **🧹 Clear all cancelled** above the History cards.
  Cancel all queued cancels every run still waiting in ComfyUI's queue and leaves
  the one generating now alone; Clear all cancelled deletes every cancelled / failed
  card of the project picked in the History filter. Each shows only when it has
  something to do, with a count.

### Changed

- **🗑 on a cancelled or failed History card deletes it straight away** — there's no
  output file to lose, so no confirmation.
- **Room to breathe on wide screens.** From 1200px wide the page is two columns under
  the header, each scrolling on its own and filling the window: the form (with
  ComfyUI stats and errors) on the left, and History on the right, one card per row
  and ending with the footer — split 60/40 in the form's
  favor. While History's column is narrow its cards stack as on a phone (media on
  top). Re-import, Re-run and Continue now scroll only
  the form's column, so History stays where you were. The video editor and its
  Import from GENie picker grow on big screens too. Phones and narrower windows are
  unchanged.

### Fixed

- Deleting a project no longer leaves empty `favorites/`, `drafts/` (and other)
  sub-folders behind in its `output` and `input` folders. A folder that still has a
  file in it is kept.

## [1.4.0] - 2026-10-14

### Changed

- **✨ Build with AI works in two steps, for every format.** *How many* is now **Shot
  count**: the model first writes only a shot list — that many shots, adding up to the
  **Duration** — shown under the form as editable shot cards. Add a **✂ break**
  between shots wherever a new prompt should start, then **✨ Write prompts**: the
  model writes the rest of each prompt (subjects, summary, retention, style,
  soundscape, music) around its shots, which go in exactly as you left them. Breaks
  make a prompt group, one prompt per run of shots; the automatic split every 15
  seconds and the variations count are gone. The shot list is kept on the server per
  project.
- **History cards are regrouped.** The top line holds the kind and workflow tags
  with **☆ favorite** and **📝 draft** as on/off chips, then the date. Under it, one
  row for the output — ⛶ Open, ✂ Edit video, ＋ Gallery (and ⛓ Continue / ↻ Re-roll
  for a chained workflow) — ending in a 🗑 delete icon (Ctrl+click still skips the
  confirmation) and a **⋯** menu holding the rarely used ▶ Re-run, Re-import and
  ⟳ Refresh. A second row holds where the card belongs: the linked saved prompt
  (✎ beside it edits that prompt) and the 📁 project. **⧉ Copy** moved into
  *Settings & full prompt*, beside the prompt it copies. A run with no output keeps
  Re-run and Re-import in view. Several videos on one card stack one above the other.
- **⇥ Last frame and 🎞 Frames are now part of the video editor.** History cards and
  Gallery videos have one **✂ Edit video** button instead (a menu on a card with
  several videos), which opens the editor on that video. Its **Frames** row does what
  the two buttons did: **＋ Pick frame** (Enter) and **⇥ Last frame** (L) pick stills,
  **Save to gallery** adds them as `<name>-f0001.png` / `<name>-last-frame.png`, and
  **⬇ Download** saves them as PNGs. Without ffmpeg you can still pick frames, at an
  assumed 24 fps, as before.

### Removed

- The "over 15s" warning under a MiniMax prompt's shots.

### Added

- **RTX video upscaling.** GENie recognizes NVIDIA's RTX Video nodes
  (comfyui_nvidia_rtx_nodes): **Super Resolution** (scale, quality, strength, image
  encoding), **Frame Generation** (frame-rate multiplier, mode, shot-change options,
  image encoding) and **Video HDR** (contrast, saturation, middle gray, peak luminance,
  output colorspace, debanding), each as its own section. A **Source Video** field on
  Get Video Components takes the video to process (upload or pick from the gallery);
  left empty, the workflow's own Load Video runs. The shipped `rtx_upscale` workflow
  wires its frame-rate multiplier from the Multiplier node, so the one control sets both
  the frames generated and Create Video's fps (source fps × multiplier). Frame
  Generation and Video HDR each have an on/off checkbox; with Frame Generation off,
  its Math Expression goes too and the video keeps the source's frame rate. With Video
  HDR off, Create Video encodes as sRGB for that run.
- **Auto-tags per workflow.** An **Auto-tags** field at the bottom of a ComfyUI
  workflow's form takes your own comma-separated tags (say `upscaled, video`); every run
  of that workflow gets them on its History card when it finishes. The list is kept in
  the workflow's server-side settings, so it's the same on every device, and saves as
  you edit it.

- **🎬 Previous scene** on a MiniMax prompt's subjects: tick **Previous scene** on a
  subject (or **＋ Add previous scene**) and pick a gallery image — usually the last
  frame of the clip before. It joins the references as `<previous_scene>` on that prompt
  only (its gallery key is left alone), as a reference for the staging and set, not a
  first frame. The definition, a `partially_preserved - keep the staging and the set:`
  retention line and Shot 1's "Continuing from the staging in `<previous_scene>`:" lead
  are filled in for you. **✨ Analyze scene** has a vision LLM write who stands where
  (by `<key>`, screen-left/right, facing whom), the room's fixed details and lighting
  into the retention line, and an opening staging sentence into Shot 1. **Next prompt**
  in a group keeps the subject but clears its frame for the new clip.

- **✂ Video editor**, in the header and as **✂ Edit video** on History cards and
  Gallery videos. Opened from a card, **💾 Add to card** saves the edit to the card as
  another video, and ticking **Overwrite the card's current video** replaces that video
  instead (after a confirmation; the old file is deleted, and ⟳ Refresh can still bring
  a generated original back). For a Gallery video the same choice adds a new Gallery
  video or replaces the file in place, so saved prompts using it get the edit.
  Deleting a card now removes all of its videos, and ⟳ Refresh keeps the ones the
  editor added. Open video files from your
  file explorer (or drop them in), or **📚 Import from GENie** — a picker of the
  project's History results, Gallery videos and earlier edits (tick **All projects**
  for the rest); imported videos are read where they are, not copied. Step through a
  clip frame by frame, then
  **Start here** / **End here** to trim its ends or **Mark in** / **Mark out** →
  **Cut selection** to remove a part from the middle. **Prepend** and **Append** add
  more clips before or after, from the same picker or from your device; the clip strip switches between them, reorders them (◀ ▶)
  and removes them (×), and each clip keeps its own cuts. Play previews the result,
  skipping what's cut and running on into the next clip. **Save** re-encodes it all
  as one file (H.264 MP4, near-lossless) in `output/<project>/edited_videos/`, where
  it shows up in the picker for further edits; a name that's taken gets `-2`, `-3`, …
  so no file is ever overwritten, and the videos you edit are never changed.
  **Save as…** asks where to put it instead — in browsers without a save dialog for
  web pages it goes to the browser's downloads. When clips differ in
  size or frame rate, a warning lists what will happen to each clip, with two choices:
  which clip the result takes its size and frame rate from (the largest, unless you
  pick one) and whether the others **Fit** inside it with black bars or **Fill** it and
  lose their edges — never stretched. A clip without sound gets silence. It adds nothing to the gallery or history. Needs ffmpeg on the PATH, or
  `FFMPEG_PATH` in `.env` — see [`docs/FFMPEG.md`](docs/FFMPEG.md) for installing it
  on Windows, macOS and Linux.
- **⧉ Copy** on a saved prompt's card copies the prompt as Generate would send it —
  compiled, `$variables` filled in and each `%wildcard%` picked afresh — for pasting
  somewhere else.
- **✨ Analyze images** in a MiniMax prompt's `subject_definitions`: a vision LLM looks
  at each reference image that has a `@key` and fills in that subject's definition and
  `retention_analysis`, keeping what you'd already written as its notes. **↶ Undo** puts
  it back. The Gallery's **Edit** dialog has it too, for the definition saved on the
  file. Choose its server and image size in ⚙ LLM settings.
- **CPU only** servers (⚙ LLM settings): a model kept in system RAM skips the GPU
  turn-taking with ComfyUI, runs while a video generates, and stays loaded — made for
  Analyze. **⏏ Unload model** on the server's settings frees its RAM. See
  [`docs/LLM.md`](docs/LLM.md).
- **llama.cpp server (GENie runs it)**, a new server type in ⚙ LLM settings: give it
  the path to `llama-server`, a model `.gguf`, its vision projector and a port, and
  GENie starts it when a job first needs the model and stops it to unload and on exit.
  With **CPU only** it runs with `--device none`, so the model and its projector use no
  VRAM — the recommended server for Analyze.
- **Qwen Image 2.1 Image Edit** ships as a default workflow. Load one or more images
  (up to 16) — each thumbnail shows the `<image1>`, `<image2>` tag to use in the
  prompt — with LoRAs, a custom output size, and pickers for the diffusion model, CLIP,
  VAE and the enhancer's LLM.
- **Prompt enhancers.** A workflow that rewrites the prompt with an LLM gets a
  **Prompt Enhancer** checkbox, and its History card keeps both the prompt you typed
  and the **enhanced prompt** the model was given (under *Settings & full prompt*, and
  in project exports). When the LLM returns nothing — it ran out of tokens while
  thinking, so the image was made from a blank prompt — the card says so; the
  enhancer's **Max length** and **Thinking** are in the form to fix it.
- **Subgraph exports are recognized.** The inner nodes of a subgraph (`459:474`-style
  ids) build the form like any others, and a value the subgraph fed to several inner
  inputs is one control that writes them all.
- Node recognition: `value_through` (follow a value through switches, text previews
  and Generate Text), `reports_text`, the `consumes` match predicate, and reference
  collections that count slots from 1 (`start`) or feed a second node (`mirrors`).
  Save Image (Advanced) exposes its filename prefix. See `node_types/README.md`.

### Fixed

- Save Video's **Codec** wrote to a key ComfyUI ignores; it now sets the real codec
  (`format.codec`), and Container and Codec list their choices.
- A workflow's core **Load Video** node shows in "Media in this workflow" (it names its
  input `file`, not `video`), and its file list fills from ComfyUI.
- A ComfyUI run with a Load Video no longer saves a copy of its source video as the
  run's first result.

## [1.3.0] - 2026-10-05

### Added

- **Prompt groups** replace shot sections. A group is a named sequence of whole saved
  prompts, each generated as its own clip with its own summary, subjects, retention
  and references. On the Saved Prompts tab a group is a collapsible block with
  numbered prompts; **▶** on its header makes Generate render every prompt in it, in
  order — one run and History card each, at that prompt's own length and with only
  its own images (on both ComfyUI and kie.ai) — and **Render** picks just one of them.
  The cost estimate adds up the group. **＋ Next** adds the next prompt as a copy of
  the last one's subjects, references, style and sound with a blank summary and
  shots; **✎ Rename** renames, **Ungroup** keeps the prompts but drops the group,
  **🗑** deletes the group and its prompts (after a confirm listing them), **▲ ▼**
  move the whole group. On phones these are full-size buttons. In the prompt editor, **📚** puts a prompt in a group, a new
  one, or none; dragging a card among a group's cards adds it, dragging it out
  removes it.
- **Build with AI writes long videos as a group.** A MiniMax build over 15 seconds
  is written clip by clip — each a complete prompt, shown the clips before it — and
  saved as a group, each prompt carrying only the images the model said that clip
  needs (renumbered from `<Picture 1>`). Each variation is its own group.

- **🎞 Frames.** A frame picker beside **⇥ Last frame** on History and Gallery video
  cards: step through the video one frame (or ten) at a time, scrub, or play and
  pause; pick any number of frames (they show as ticks on the scrubber and in a strip
  you can click to jump back to), then save them to the gallery as
  `<name>-f0001.png`… or download them. Frame rate and count come from ffprobe
  (new `/api/video/probe`), with an editable fallback. Keys: ←/→ (Shift for 10),
  Home/End, Space, Enter or S to pick, Esc to close. Each upload retries on its
  own if the connection drops, saved frames get a ✓, and Save only sends the frames
  that aren't in the gallery yet, so a retry never duplicates.
- **✨ Revise with AI**, in the saved-prompt editor. Say what to change ("make her
  lines teasing", "add a cut at 00:06 to a close-up", "slow the pacing") and the LLM
  rewrites the prompt as it stands in the editor, including unsaved edits, seeing
  its reference images. Works on Default, MiniMax H3 and MiniMax T2V prompts. The
  suggestion is shown as a word-level diff against the editor; **Apply to editor**
  puts it in, **Save changes** keeps it, and **↶ Undo** or Cancel throws it away.
  **Try again** asks for another take. **Follow my Rules** adds the project's
  Build-with-AI rules. It runs through the same queue and GPU turn-taking as a
  build, and a MiniMax section the reply leaves empty keeps its current text.

### Removed

- **Shot sections**, added earlier in this release (✂ in the shot editor, section
  headers, the Render-a-section picker). One prompt's shared summary and references
  couldn't fit every clip. Existing sectioned prompts are split into a prompt group
  the first time their project is loaded: one prompt per section, each a full copy
  of the original with that section's shots and length; the first keeps the History
  link.

### Changed

- **The Gallery shows cards, two to a row:** the preview on the left (click to view
  full size); the kind, @key, date, pixel size and video length on the right; and
  a row of actions along the bottom — **＋** use, **✎** edit, **Move to…** and
  **🗑** delete — in place of the icons that sat on each thumbnail. Delete now
  asks first. **Edit** opens a modal with the filename and the file's **@key**
  and **definition** — the same pair the saved-prompt editor edits. The
  "Pick from gallery" pickers inside reference fields keep the compact grid.
- **⇥ Last frame** on a gallery video and on a History video card saves the clip's
  final frame to the gallery as a PNG at the video's own resolution, ready to use
  as the next clip's first frame. It is read in the browser, so no ffmpeg is needed.
- **Seedance form rules match kie.ai's current API docs** (re-read 2026-10-01).
  - **Seedance 2.5:** first/last-frame mode now hides and leaves out reference video
    and audio (the API treats frames and references as mutually exclusive), and a
    last frame without a first frame is refused before submitting. Its reference
    limits are shown and checked as 30 images, 10 videos and 10 audio files, 30s
    total, 200MB per video; the prompt cap is 30,000 characters.
  - **Seedance 2 and 2 Fast** offer the **adaptive** aspect ratio.
  - **Auto duration** — a new checkbox on every Seedance video model sends
    `duration: -1` so the model picks the length (no cost estimate for those runs).
  - **Seedance 2 Fast / Mini:** Web search is left off a run that carries references
    or frames, since those models only accept it for text-to-video.
  - Reference counts and total reference-video seconds over a model's limit are
    refused before anything is uploaded.
  - The NSFW checker switch is unchanged: unchecked still sends
    `nsfw_checker: false`, which turns off kie.ai's filter but not the model
    provider's own moderation.
- **MiniMax shots hold a length, not a start time, and can be re-ordered.** Each
  shot in the saved-prompt editor — Shot 1 included — has a **Length** in seconds;
  the "At MM:SS.mmm" cut times in the compiled prompt are worked out from the order
  and the lengths before each shot. Drag a shot by its **⠿** grip or use **▲ ▼** to
  move it, and **×** removes any shot. The last shot's length can be left empty (it
  runs to the end), each card shows when it starts, and the shots' total is shown
  under the list. The editor's **Duration** field is gone for MiniMax prompts: the
  saved duration now follows the shots. Existing prompts are converted from their
  cut times when opened, and Build / Revise with AI now asks the LLM for each
  shot's seconds.
- **The kie.ai form remembers each model's settings.** Resolution, aspect ratio,
  duration, quality and output format are kept per model on the server
  (`settings/app.json`), so a page reload, or switching to a local workflow or
  another model and back, no longer resets them to the defaults — and the phone and
  every other browser see the same choices. An active prompt group's **Render** pick
  is kept there too. An open tab picks up changes made elsewhere when it is looked at
  again.
- **Every remembered choice is now shared across browsers.** The active project,
  last-used model, open prompt tab, each project's ▶ Active saved prompt, hidden
  History tags, live preview method and the prompt-carry lock moved from the
  browser's storage to the server (`settings/app.json`), so the phone and desktop
  open where the other left off. The page loads them as `settings.js` before the
  app starts; a value an older version stored in the browser is moved up the first
  time it's read.
- **Typing `<` in a prompt offers its tags.** The list under the caret (the one `%`
  and `$` open) shows the subjects in play (`<witch>`), the reference labels
  (`<Picture 1>`) and **dialogue**, which writes `<d>[English] </d>` and leaves the
  caret inside. In the saved-prompt editor it reads that prompt's references and
  subjects; in the Prompt tab, the form's references.
- **Build with AI writes long MiniMax prompts in sections.** With a **Duration**
  over 15 seconds, the LLM is told the video is made as separate clips of up to 15
  seconds (25s → 15 + 10) and numbers each shot's section; it is asked to open
  every section by re-establishing the scene, since each clip is generated on its
  own. A reply without section numbers is split automatically. Revise with AI
  keeps a prompt's sections.
- **Build / Revise with AI: a MiniMax reply that isn't MiniMax JSON is sent back to
  be fixed.** The LLM gets its own reply and is asked to repair the JSON — a
  text-only request, so the reference images aren't processed again — up to 3
  times. If it still can't be read, the reply is discarded and the prompt is
  written again; nothing malformed is saved.

### Added

- **Build with AI: Rules, and a form that follows you between browsers.** A
  **Rules** box sits under Theme for standing instructions (things to always do,
  never do, how to write dialogue…). They're added to the system prompt as firm
  rules that override the default guidance, and recorded on each saved prompt
  (`llm.rules`). The whole form — format, images, description, theme, rules, count,
  duration, title prefix — is now saved on the server per project
  (`projects/<slug>/llm-builder.json`) as you type, so the phone and every other
  browser open it as you left it; it no longer uses the browser's localStorage.
  **↺ Recent builds** refills the form from any of the project's last 20 builds.
  A project that has never had rules starts from the ones you used most recently.

- **Build with AI: Format.** The build dialog can now write **MiniMax H3**
  (reference-to-video) or **MiniMax T2V** (text-to-video) prompts as well as Default
  ones. The MiniMax formats have their own instructions and fill the structured
  fields — subjects, summary, retention, style, shots, soundscape, music — so each
  result opens in the MiniMax editor; T2V hides the image picker and takes no
  references. The last format picked is remembered.

- **✨ Build with AI.** A vision LLM writes prompts for you: on the Saved Prompts
  tab, pick images from the project's gallery (their click order becomes
  `<Picture 1>`, `<Picture 2>`, …), describe what should happen and the theme, and
  choose how many variations. Each one is saved as a Default prompt with the images
  as its references, and a gallery file's key and definition are passed along.
  Works with any OpenAI-compatible server. **⚙ LLM settings** has presets for
  LM Studio, text-generation-webui and Ollama, a model list with vision marked 👁,
  and an editable system prompt. Builds run on the server, so they survive a
  closed tab and can be started from the phone. See [docs/LLM.md](docs/LLM.md).
- **The LLM and ComfyUI take turns on the GPU.** A build waits for ComfyUI's queue
  to empty (plus a grace period), checks free VRAM against the model's size, and
  asks ComfyUI to unload its models when the LLM doesn't fit. A generation that
  starts, whether from GENie or from ComfyUI's own UI, unloads the LLM first. The
  build pauses and picks up the same prompt once ComfyUI is idle. The LLM is
  unloaded when the build finishes.
- **Variables.** A fourth tab beside Wildcards holds named blocks of text: write
  `$name` in any prompt — kie.ai, ComfyUI (every text field) or a saved prompt —
  and Generate swaps in its text. Each project has its own
  (`projects/<slug>/variables.json`); tick **Global** on one to share it with every
  project (`variables.json`), and a project's own variable wins over a global of
  the same name. Rows edit in place and save as you type. A value can hold
  `%wildcards%` and other `$variables`; an unknown variable, or one that uses
  itself, stops the run before anything is sent. `$5` and the like are left
  alone (a name starts with a letter or `_`). Typing `$` suggests variables, and
  they're highlighted green in the text (red when unknown). A deleted project's
  variables move to Default, like its saved prompts.

### Fixed

- A Default saved prompt with references of its own now sends them when it's the
  active prompt (loaded into the workflow's reference fields in order, like a MiniMax
  prompt), instead of sending its text alone with whatever the form held.

- **Wildcard highlighting and zoom on iPhone/iPad.** Highlights no longer drift
  off their words (iOS insets textarea text 3px, and enlarged other text in
  landscape), and tapping a field no longer leaves the page zoomed in.
- **Empty reference slots no longer break a run.** A workflow shared without its
  author's local reference file (`LoadImage` with an empty filename) made ComfyUI
  open its input _folder_ — "LoadImage: [Errno 13] Permission denied:
  …\ComfyUI\input" — on every run that didn't supply that reference. Blank
  slots are now unwired and dropped before the workflow is sent; slots with a real
  filename still run as exported.
- **A workflow's own media is now shown in the UI instead of loading invisibly.**
  A `LoadImage` (or audio/video loader) with a filename baked in fed every run
  with nothing on screen to say so, and failed outright when that file wasn't in
  your ComfyUI input folder. A **Media in this workflow** panel now lists each
  one: point it at another file in your input folder, or uncheck it to take it
  out of the run. A loader a reference field already covers is marked as such,
  since adding your own files there replaces it. Remembered per workflow and
  recorded on the History entry, so Re-import brings the same state back.
- **A workflow's own LoRAs are now shown in the UI instead of applying invisibly.**
  A workflow exported straight from ComfyUI carries its LoRAs in the graph, and
  GENie's LoRA panel only ever listed the ones you added — so the baked ones
  stacked underneath every run with nothing on screen to say so (and, if the file
  wasn't installed, failed validation with "Value not in list — lora_name"). They
  now head the LoRA list, tagged **in workflow**: change the file or strength and
  that node is rewritten, or uncheck it and the node is taken out of the graph
  for the run (its MODEL and CLIP wiring is reconnected around it). LoRAs you add
  are still spliced in on top, and the state is remembered per workflow.
- **A model the workflow names is found even when it sits in a subfolder.**
  ComfyUI lists a model by its path inside the models folder
  (`Minimax\h3.safetensors`), so a workflow naming the bare filename matched
  nothing and the dropdown quietly fell back to the _first installed model_ —
  which could be a completely different architecture, failing deep in the sampler
  ("SamplerCustomAdvanced: tuple index out of range") rather than up front. The
  same filename elsewhere in the tree is now used, when it's unambiguous.
- **A reference field says when the run would fall back to the workflow's own
  file.** An untouched reference field looks empty while the workflow's baked
  `LoadImage` still feeds the node, so it now reads "Nothing loaded here — the
  run uses what the workflow already has: 'she-hulk.webp'". It appears only when
  that file is really in your ComfyUI input folder, and goes as soon as you add a
  file of your own or uncheck the loader. A file the workflow names but you don't
  have is never warned about — your own selection simply replaces it.
- **The bundled workflows ship without file names.** Every model, CLIP, VAE and
  reference-image field in `workflows/default/` is now empty: the nodes are the
  workflow, the files are yours. GENie fills each dropdown from what ComfyUI has
  installed and drops empty reference slots from the graph, so a default runs
  without chasing someone else's files. What each was built against is recorded
  in `workflows/default/README.md`.
- **The bundled MiniMax H3 Ref2Video workflows no longer ask for files you don't
  have.** The Advanced workflow had a LoRA loader wired to one specific local
  `.safetensors`, which failed validation ("Value not in list — lora_name") for
  anyone else. It's gone: add LoRAs from the UI instead and GENie splices them in
  at generate time, as it does for every other workflow. Their baked reference
  images were cleared too.

## [1.2.0] - 2026-09-21

### Added

- **Add media straight to the gallery.** The Gallery panel has its own drop zone:
  drop images, videos or audio on it (or click to browse) and they're saved to
  the active project — no need to route them through a reference field or a
  History card. The panel is also available for every model now (including
  ComfyUI workflows and text-to-image models), since it's the project's media
  library rather than part of the reference fields.
- **MiniMax T2V saved prompts.** A second MiniMax format for text-to-video, per
  MiniMax's base prompt guide: the same style, cuts, soundscape and music fields
  as the MiniMax form, without references, subjects, summary or retention. It
  compiles to `integrated_multimodal_description`, `overall_soundscape` and
  `non_diegetic_music`. Create one with **＋ New MiniMax T2V prompt**, choose it
  as the format when saving, or switch an existing prompt with **⇄ To T2V** /
  **⇄ To MiniMax ref** in the editor.
- **Wildcards.** A third tab beside Saved Prompts holds named lists of values,
  grouped by category and shared by every project (`wildcards.json`). Write
  `%category:key%` in any prompt — kie.ai, ComfyUI (every text field) or a
  saved prompt — and each run picks one value at random; a ×N batch or queue
  gets fresh picks per run. A token used more than once in a run never repeats a
  value until the list is used up. `%category:key:1%` keeps its pick, so a later
  `%category:key%` in the same run reuses it. Values can contain tokens of their
  own, one level deep: a list used inside another can't hold tokens itself (so
  there are no loops), and the editor won't save one that would. An unknown or
  empty wildcard, or one nested too deep, stops the run before anything is sent.
  History shows the prompt as sent, and Re-import brings back the `%…%`
  template. Tokens copy with a click or go into the prompt with ＋ Insert.
  Typing `%` in any prompt box (including the saved-prompt editor) suggests
  categories and lists as you type; ↑/↓ and Enter or Tab to pick one. Tokens
  are highlighted in the text — tinted when the list exists, red when it doesn't
  (a typo, or a list that was deleted).
  On first start, `wildcards.json` is created from `default.wildcards.json`, a
  starter set of example lists (clothing, rooms, hair, dialogue) kept in the
  repo; your own `wildcards.json` stays out of git.

## [1.1.0] - 2026-09-19

### Added

- **Prompt lock (🔒): keep the prompt and references when switching models.** The
  kie.ai form and each ComfyUI workflow were separate forms, so switching from a
  local draft (e.g. MiniMax H3 on ComfyUI) to the cloud model for the final run
  left your prompt and reference images behind. Now, while the lock on the prompt
  is on (the default, remembered per browser), a switch between ComfyUI and
  kie.ai — or between two workflows — brings the prompt and the reference images,
  videos and audio with it, in order, so `<Picture N>` still points at the same
  file. What you carry beats a workflow's saved settings. An empty prompt or empty
  reference list never wipes the other side's. Resolution, duration and other
  settings stay per model. Hosted-URL references can't go to a local workflow;
  you'll see a note when one is left behind.
- **Saved Prompts.** A **💾 Save prompt** button on the prompt saves the prompt
  text, its reference images/videos/audio and the duration under a title you
  choose, per project (`projects/<project>/prompts.json`). The prompt's header is
  now two tabs, **Prompt** and **Saved Prompts**; the second lists the project's
  saved prompts as compact cards (filterable; the tab you were on is remembered
  across reloads), ordered Drupal-style by **weight**: lighter (lower) rises to
  the top, heavier sinks, default 0. Drag a
  card, or use its ▲ ▼ (Alt+↑/↓), to reorder — that renumbers the weights 0, 1,
  2… in the new order. Clicking a card opens an editor for its title, prompt,
  duration, weight and references — × drops one, and **＋ Add media** picks more
  from the project's gallery (click again to take one out) or uploads/drops new
  files straight into the prompt — with
  **Import** (into the current model or workflow — replaces the prompt,
  references and duration), **Duplicate**, **Move to…** / **Copy to…** another
  project and **Delete**. Works for kie.ai models and for a ComfyUI workflow's
  main prompt. References point at gallery files (nothing is duplicated); one
  deleted from the gallery shows as missing and is skipped on import. Deleting a
  project moves its saved prompts to Default.
- **Link a History card to a saved prompt.** A finished History card has a
  **📌 Saved prompt** dropdown: pick one of its project's saved prompts and that
  output (image, or video — it plays with sound on hover) becomes the prompt card's
  thumbnail, and shows in the prompt's editor under **Output**. Each prompt shows
  one take, so linking another replaces it; unlink from the dropdown or the
  editor. A duplicated or copied prompt starts unlinked; deleting the History
  entry drops the thumbnail. On a linked card, **📌 Re-import** restores the run's
  model and settings but takes the prompt text, references and duration from
  the saved prompt (its current version), and **✎ Edit prompt** opens that
  prompt's editor — even when the card is from another project.
- **Generate straight from a saved prompt.** Press **▶** on a saved-prompt card to
  make it the project's active prompt (remembered per browser). While the **Saved
  Prompts** tab is open, Generate (marked 📌) sends that prompt's text in place of
  the Prompt tab's; settings stay as the form has them, and your draft in the
  Prompt tab is untouched. A Default prompt sends only its text (references come
  from the form); a MiniMax prompt also loads its own references into the form's
  reference fields, in its order, since its `<Picture N>` labels are numbered from
  them. Switch back to the Prompt
  tab and Generate uses the textarea again. Works for kie.ai models and ComfyUI
  workflows. The run's History card links itself to the saved prompt once it has
  an output, so a failed or cancelled run never replaces the prompt's thumbnail.
- **Saved prompt formats: Default and MiniMax H3.** A saved prompt now has a
  format, and each format has its own edit form. **Default** is the plain text as
  before. **MiniMax H3** stores fields instead of text and compiles them into the
  six sections of MiniMax's full-reference prompt format whenever the prompt is
  used (Generate, Import, preview) — the compiled text isn't stored, so nothing is
  kept twice:
  - `subject_definitions` comes from the references' gallery key + definition
    (`<genie>, seen in <Picture 1>, is …`), plus subjects without an image typed
    on the prompt (e.g. `<new>`). Keys ignore case (`GENie` and `genie` are
    one subject; keys are stored lowercase), a definition typed on the prompt
    overrides the image's gallery one, and a definition that already starts with
    `<genie> is …` (or just `is …`) isn't doubled. Only subjects with a definition get
    a line: a reference whose key isn't defined anywhere (say a second image of
    a subject, cited as `@manuela_sheet` in `<manuela>`'s definition) is just an
    `@key` token.
  - **@key tokens:** write `@genie` anywhere in a MiniMax prompt to mean the
    reference file with that key; it compiles to its current label (`<Picture 1>`,
    or `<Picture 1> and <Picture 2>` for a key on several files), so re-ordering
    the references keeps every mention on the right file. A shot that mentions
    `@genie` counts as `<genie>` appearing in it.
  - The **reference media** (their thumbnails, key and definition boxes, and
    ＋ Add media) sit between subject_definitions and summary in this form, so the
    images are in view while you write the definitions.
  - `summary`: free text — you write the `[reference generation] …` prefix.
  - `retention_analysis`: written under each subject, right below its definition
    (e.g. `fully_preserved - …`); "(appears in [Shot N])" is added from which
    shots mention the subject's `<label>`, and `@shots` in the text becomes that
    same list (`[Shot 1], [Shot 3]`).
  - `detailed_description`: a style opening, Shot 1, and a list of **cuts** you add
    and remove, each with a time — compiled as `[Shot N] At 00:05.000, …`. Cuts
    keep themselves in time order: change a cut's time and it moves (and renumbers)
    into place when you finish typing.
  - `overall_soundscape` and `non_diegetic_music`.
    The editor shows the compiled prompt live. **＋ New MiniMax prompt** (Saved
    Prompts tab) starts one from the form's references; the Save dialog has a
    **Format** choice (picked for you when the text already has MiniMax sections);
    and **⇄ To MiniMax** / **⇄ To plain text** convert an existing prompt, splitting
    text on its section headers, `[Shot N]` markers and "At 00:15.000" paragraphs.
- **Subject key and definition on gallery media.** Each gallery file can now carry
  a key (e.g. `@genie`) and a definition of what it shows. Every reference in
  the saved-prompt editor has a key field and a definition box, saved with
  **Save changes**. They're stored on the gallery item, so every prompt using that
  file shares them. Groundwork for LLM-assisted prompting.

## [1.0.1] - 2026-09-17

### Added

- **MiniMax H3 (Hailuo 03) on kie.ai** — three new cloud models in the model
  dropdown: **text-to-video**, **image-to-video** (first and/or last frame) and
  **reference-to-video** (up to 9 images, 3 videos and 3 audio references). 4–15s
  clips at **768P or 2K** with native audio, so the form drops the Generate-audio,
  Web-search and NSFW-checker switches for these models, swaps in H3's own
  resolution tiers, and hides Aspect ratio for image-to-video (which has no such
  parameter). GENie also checks H3's input rules before submitting: image-to-video
  needs a frame, and reference-to-video needs an image or video reference — audio
  can't stand alone. API details are in [docs/kie-api/minimax-h3.md](docs/kie-api/minimax-h3.md).
- **Free VRAM** in the ComfyUI host-stats strip — unloads ComfyUI's models and clears
  its cache. With a run in flight it takes effect once that run finishes; the next
  run reloads its models.
- **Reset** on each recognized node's section header — puts that section's controls
  back to recommended values, never the workflow's own baked ones. The value comes
  from a new `recommended` field in `node_types/`, else ComfyUI's node default from
  `/object_info`; text clears, a dropdown takes its first choice, and a number with
  neither keeps its value. Controls locked by an armed continuation are left alone,
  and it asks first if a typed prompt would be wiped.
- **Model Sparse Attention** (ComfyUI core's `BlockSparseAttention`) is recognized,
  replacing the deprecated kijai `SolAttnPatch` entry. Its `method` is a DynamicCombo,
  so recognition now resolves the dotted inputs an API export stores for those
  (`selection.tau`) from the chosen option's schema.
- Spectrum MiniMax H3 exposes **model-aware mode** and its **risk threshold**.

### Changed

- A ComfyUI run that goes over its sampler steps twice now shows it on the card:
  **pass 1 of 2 · step 8/25** instead of **step 8/50**, with the bar and time left
  for the current pass. The time left used to assume the fast second pass took as
  long as the first. This applies to MiniMax H3 workflows using Spectrum with
  **Offline smoothing replay** on; other nodes can opt in through a new
  `progress_passes` field in `node_types/`.
- Extra LoRAs splice onto the workflow's model loader (or the last LoRA already
  stacked on it) instead of wherever the model chain was first found, so they sit
  **ahead of** MODEL patches like attention backends, sparse attention and Spectrum
  rather than between those and the sampler.
- A ComfyUI number input whose step `/object_info` doesn't describe now accepts
  decimals instead of being rounded to whole numbers by the browser.

## [1.0.0] - 2026-09-13

First versioned release. GENie is a local front-end and project manager for your own
ComfyUI, with kie.ai cloud models (Seedance video, Seedream images) as an optional
second path.

### Highlights

- **Zero-authoring ComfyUI workflows** — drop a raw _File → Export (API)_ `.json` in
  `workflows/` and the form is built from recognized nodes, one collapsible section
  per node. Support for a node type is a small JSON file in `node_types/`.
- **Projects, History and gallery** — every run (local or cloud) is filed per project
  with its prompt, settings, references and result, with Re-import, Re-run and Export.
- **Live runs** — sampler progress, latent previews, host CPU/GPU/VRAM stats, dynamic
  LoRAs, on/off toggles for optional patch nodes, and Continue for stateful workflows.
- **kie.ai cloud (optional)** — Seedance 2.5 / 2 / 2 Fast / 2 Mini and Seedream 5.0
  Lite / Pro, with a live credit balance and measured cost estimates.

### Added in the run-up to 1.0.0

- **Batches for kie.ai** — the ×N counter beside Generate queues up to 20 identical
  runs in one click. Reference media is uploaded once and shared by the batch, one
  task per run is created (spaced to stay under kie.ai's rate limit), and the cost
  estimate shows the batch total.
- **Runs without a kie.ai key** — GENie now starts and works as a ComfyUI-only
  front-end. The kie.ai models are listed but disabled with a hint, the credit pills
  are hidden, and kie.ai routes return a clear "no key configured" error.
- **New recognized nodes** — `PathchSageAttentionKJ`, `ModelAttentionBackend`,
  `SolAttnPatch`, `SpectrumApplyMiniMaxH3` and `VHS_VideoCombine`.
- **Recognition features** — a `node_types` entry can mark a node `bypassable` (and
  `bypassed_by_default`) so a raw export gets an on/off toggle; `BOOLEAN` inputs render
  as checkboxes; per-format widgets (VHS `crf` / `pix_fmt`) pick up their options and
  ranges from ComfyUI.
- **Version in the footer** — the page footer shows the running version and links
  here.

### Changed

- The Model dropdown lists **Local · ComfyUI** first, with the cloud models grouped
  under **kie.ai API**.
- The header balance is labelled **kie.ai credits**.
- Phone layout: the header stacks under the title, and page, form and section padding
  is thinner.
- A section's only control no longer repeats the section's name as its label (e.g.
  "Prompt" inside Prompt), and prompt boxes open at 15 rows.
- The "Prompt tags — …" summary under MiniMax H3 references is gone; each thumbnail
  still shows its tag.
- The shipped `MiniMax_H3_Ref2Video.json` workflow is now `MiniMax H3 Ref2Video Basic`,
  alongside a new `MiniMax H3 Ref2Video Advanced`. History runs of the old name can't
  be re-imported.

### Fixed

- The server exited at startup without `KIE_API_KEY`, although the docs called the
  key optional.
- A long ComfyUI workflow name (no spaces) widened the whole page on phones.
- The ComfyUI ×N and Preview controls, and the History header, ran off narrow screens.
- A failed run's long error message (e.g. kie.ai's "Timeout while downloading url=…")
  took over its History card and crushed the buttons beside it.

[Unreleased]: https://github.com/resiz3d/genie-ui/compare/v1.5.1...HEAD
[1.5.1]: https://github.com/resiz3d/genie-ui/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/resiz3d/genie-ui/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/resiz3d/genie-ui/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/resiz3d/genie-ui/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/resiz3d/genie-ui/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/resiz3d/genie-ui/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/resiz3d/genie-ui/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/resiz3d/genie-ui/releases/tag/v1.0.0
