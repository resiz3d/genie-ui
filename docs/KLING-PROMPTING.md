# Prompting Kling 4.0

How to write prompts for **Kling 4.0** in GENie: reference-to-video
(`kling-4.0/reference-to-video`) and keyframe-to-video
(`kling-4.0/keyframe-to-video`), both through kie.ai. This guide is distilled from
Kuaishou's [Kling 4 model user guide](https://kling.ai/quickstart/kling-4-model-user-guide)
(read 2026-10-22) and rewritten for the way kie.ai's API names things. The API
details (fields, limits, pricing) are in [kie-api/kling-4-0.md](kie-api/kling-4-0.md).

In GENie:

- **＋ Kling template** on the prompt box inserts a blank prompt in the layout below
  for whichever Kling mode is selected (Ctrl+Z takes it out).
- **✨ Revise with AI → Guide → Kling 4.0 guide** has the LLM follow these rules while
  it edits a prompt.

## Naming references — use kie.ai's names, not kling.ai's

Kling's own app numbers uploads as `@Image1`, `@Video1`. **kie.ai's API uses
lowercase names with an underscore**, and every `@` mention must match an asset
actually sent, or the request is rejected:

| What | Mention it as | Comes from GENie's… |
| --- | --- | --- |
| Reference images (ref-to-video) | `@image_1`, `@image_2` … | Reference images, in order |
| Reference videos (ref-to-video) | `@video_1`, `@video_2` … | Reference videos, in order |
| Voices (ref-to-video) | `@voice_1`, `@voice_2`, `@voice_3` | Voices (the audio list), in order |
| First frame (keyframes) | `@first_frame` | First frame |
| Middle keyframes (keyframes) | `@keyframe_1` … `@keyframe_8` | Middle keyframes, in order |
| Last frame (keyframes) | `@last_frame` | Last frame |

Re-ordering the thumbnails re-numbers them, so check the mentions after you move one.

## The two modes

They can't be mixed in one run.

- **Reference-to-video**, the default. Images, videos and voices tell the model what
  things look like, how they move, how the camera behaves and how people sound. Use
  it to combine references and explore ideas, and for plain text-to-video (send no
  references). With a video it can also **edit** that video (see below).
- **Keyframe-to-video.** Images only. Each one pins *what is on screen at a point in
  time*, and the prompt describes how the video gets from one to the next. Use it
  when the look is already decided: a storyboard, a before/after, a fixed ending.
  The first frame decides the aspect ratio.

Both run 3–30s at 720p or 1080p, take prompts up to 8,000 characters, and make their
own audio (stereo dialogue, effects and music) with no switch to turn it off. The
only audio you can upload is voices.

## The prompt formula (reference-to-video)

Start with **one clear sentence**: who, where, doing what, feeling what. That alone
often works, because the model fills in the rest. Then add only what changes the
result, in this order:

```
[Asset roles]
@image_1 is <who or what>; keep its <face, hair, outfit…>.
@video_1 sets the <camera movement / action timing / composition>.
@voice_1 is the voice of <who>.

[Overall settings]
Scene and texture: <place, materials, time of day>. Visual style: <…>. Camera tone: <…>.

[Sequence of events]
0–3s: <what we see, the action, the emotion>.
3–7s: <the camera move and what develops>.
7s–end: <the closing shot>.

[Audio]
<who> says in <language>, <how>: "<the line, word for word>". <Ambience>. <Music, or no music>. No subtitles.
```

**Give every reference a job.** A bare `@image_2` with no role makes results
unpredictable. Say what it is for and what to keep from it: "@image_1 is the hero;
keep her face, hair and red jacket exactly", "@video_1 sets the fight choreography
and its timing", "Keep the composition of @image_2 exactly."

**Be concrete.** Words like "premium", "vintage feel" or "cinematic" give the model
nothing to draw. Describe what makes them so: "yellowed walls, worn furniture edges,
warm incandescent light."

**Don't pile on adjectives.** Longer isn't better. Only add details you'd notice if
they were missing.

**Say it positively.** Kling's guide warns that negative prompts can *add* mistakes.
Write "she is shown in profile while on the phone", not "don't show her face". The
two exclusions worth stating outright are **no subtitles** and **no background
music** (when you don't want them). A short exclusion list still helps with style:
for animation, say it should not look photorealistic.

## Time, shots and cuts

The model plans shots itself (Smart Storyboard is always on). To take control, give
timestamps:

- **Time ranges**: `0–3s: …`, `3–8s: …`, `8s–end: …`. Decimals are fine (`0.0–0.8s`).
- **Multi-shot**: one paragraph per shot, `Shot 1 (0–4s): …`, `Shot 2 (4–9s): …`. Say
  how each cut happens: "hard cut at 4.0s". Motivated cuts work well: a cut on the
  moment someone drops out of frame, or an object wiping across the lens.
- **One take**: "one continuous tracking shot, no cuts, no angle changes."
- **Continuity across cuts**: "Keep the same people, clothing, props and positions in
  every shot; eyelines stay consistent."

Camera language the model understands: handheld (with breath sway and small late
corrections), gimbal, lateral tracking, push in / pull out (give an amount: "a slow
10% push in"), rise, tilt up, pan, whip pan, orbit, low angle, top-down overhead,
extreme long shot, medium close-up, two-shot, close-up, rack focus. A lens helps
pin the look: "50mm equivalent, shallow depth of field".

## Dialogue, voices and sound

- Put speech in quotes, after who says it, in what language and how: `She says in
  slow, clear Spanish: "…"`. Add delivery notes after the line if needed.
- With a voice uploaded: "@voice_1 is the voice of the old man." Then write his lines.
- Several speakers: "When one person speaks, the others stay silent; no overlapping
  dialogue." Add a short pause between turns if timing matters.
- Languages: Chinese, English, Japanese, Korean, Spanish, Portuguese, German, French
  and Hindi, plus some dialects and accents (Cantonese, British or Indian English…).
- Describe ambience, effects and music in words ("quiet room tone, distant traffic";
  "sound effects only, no music"). Music and effects can't be uploaded.
- Subtitles only appear if you ask for them. Specify font, position and timing.

## Keyframe-to-video

Pin the moments, then describe what happens between them and how the camera gets
there:

```
@first_frame: <what it shows>.
@last_frame: <what it shows>.
Overall: <style, lighting, camera tone>. Keep the same people, clothing, props and positions throughout.

0–3s | @first_frame to @keyframe_1: <what happens and how the camera reaches @keyframe_1>.
3–7s | @keyframe_1 to @last_frame: <…>.
```

- **First frame only**: "Start on @first_frame, then <what happens next>."
- **First and last**: "Start on @first_frame (raw iron) and end on @last_frame (a
  finished knife); <the process in between>." Hard cuts forward in time work well
  for a process.
- **Last frame only**: describe what happens *before* it. A transformation into the
  final image ("the scene turns into a painting from the edges inwards") works well.
- Keyframes control actions ("raises a hand at 3s"), entrances and exits, scene
  changes ("the sky darkens at 5s"), framing changes ("wide to close-up at 6s") and
  gradual change from one state to another.
- **The duration caps the frames.** First, middle and last frames together can be at
  most duration + 1 (4 frames at 3s, 6 at 5s), and at most 10 at 9s or more. GENie
  checks this before it sends.

## Editing a video (reference-to-video)

To change a video rather than borrow from it, the prompt has to say **Edit
@video_1**. "Reference @video_1" is read as "use it as a reference" and makes a new
video. End with **Keep everything else unchanged.**

- Replace: "Edit @video_1. Replace the man in the grey coat with @image_1. Keep
  everything else unchanged."
- Remove: "Edit @video_1. Remove the person in the foreground. Keep everything else
  unchanged."
- Restyle: "Edit @video_1 into the felt-craft style of @image_1, keeping the
  composition, camera moves and timing."
- Add: "Edit @video_1. When the box opens at the end, a sleeping kitten lies inside."

Tick **Keep original sound** to keep the video's own soundtrack. The video counts
toward the 5-clip / 30-second limit.

## Checklist before Generate

1. Every `@` mention matches something attached, in the right order.
2. Every reference has a stated role.
3. The timestamps add up to the duration you picked.
4. Dialogue is quoted, with the speaker and language.
5. "No subtitles" is there if you don't want burned-in text.
