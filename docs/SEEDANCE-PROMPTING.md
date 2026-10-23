# Prompting Seedance 2.5

How to write prompts for **Seedance 2.5** (`bytedance/seedance-2-5`) in GENie, through
kie.ai. This guide is distilled from Runway's
[Seedance 2.5 prompt guide](https://runway.com/resources/seedance-2-5-prompt-guide)
(read 2026-10-23) and rewritten for the way kie.ai's API names things. The API
details (fields, limits, drafts) are in [kie-api/seedance-2-5.md](kie-api/seedance-2-5.md).

In GENie:

- **＋ Seedance template** on the prompt box inserts a blank prompt in the layout below
  for the selected mode: references, or first/last frames (Ctrl+Z takes it out).
  It is shown for Seedance 2.5 only. Seedance 2, Fast and Mini follow 2.0's rules,
  which differ.
- **✨ Revise with AI → Guide → Seedance 2.5 guide** has the LLM follow these rules
  while it edits a prompt.

## Naming references: use kie.ai's names, not Runway's

Runway's guide writes `@Image 1`. **kie.ai's API documents `@Image1`, with no space**.

| What | Mention it as | Comes from GENie's… |
| --- | --- | --- |
| Reference images | `@Image1`, `@Image2` … | Reference images, in order |
| Reference videos | `@Video1`, `@Video2` … | Reference videos, in order |
| Reference audio | `@Audio1`, `@Audio2` … | Reference audio, in order |

kie.ai's docs only show `@Image1`. `@Video1` and `@Audio1` follow the same pattern.
Re-ordering the thumbnails renumbers them, so check the mentions after you move one.

**First/last frames** can't be combined with any references on 2.5. There are no `@`
mentions in that mode: say what the first frame and the last frame show, and how
the video gets from one to the other.

## The layout

1. **Asset bindings.** One line per reference, binding it to **one** role: subject,
   product, setting, voice, motion, camera move. A loose binding ("use this for
   style") pulls in things you didn't want.
2. **A one-sentence summary.** Subject, location, event, genre or style, and camera
   movement. Without it the shots feel like separate clips.
3. **A timeline** of continuous whole-second beats with **no gaps**, such as
   `BEAT 1 (0s-6s): …`. Each beat covers the visuals, camera, action, dialogue and
   sound. Beats of about 6–8 seconds work well, with a 3–4 second closing beat. The
   timestamps set the pacing; they are not frame-exact cut points.
4. **A consistency line.** What stays constant: camera feel, lighting, environment,
   recurring elements.

A **single continuous take** needs no timeline. Bind the asset, describe the camera's
route in order as one unbroken move, then add a look line and the audio.

```
@Image1: Mara (main character) — short silver hair, green raincoat, brass compass.

Summary: Mara crosses a rain-soaked night market looking for a stall, handheld and close, neo-noir.

BEAT 1 (0s-6s): Medium shot, handheld push-in as Mara weaves between stalls, rain on her hood. Dialogue (Mara): "It was here. I know it was here." SFX: rain on tarps, distant chatter.
BEAT 2 (6s-12s): Lateral tracking alongside her; the silver hair and green raincoat catch the neon. She stops at a dark stall. SFX: a shutter rattles.
BEAT 3 (12s-15s): Low angle as the stall's lantern flickers on over her face.

Consistency: handheld camera, wet neon reflections, the same raincoat and compass throughout.
No subtitles. No background music, environmental sounds only.
```

## Subjects

- Cite a reference by its `@` name. Re-describing it in prose can make the model treat
  it as a new element.
- Name the main subject once with two or three fixed traits, and restate those traits
  at the major beats rather than only at the start.

## Edits and extensions

State the **scope**, the **change from A to B**, and **what stays the same**, and name
the video directly rather than calling it "the reference":

> Preserve the composition, camera position, lighting and performance rhythm of
> @Video1. Only change the jacket from red to navy.

## Camera

Plain film language: locked-off, push-in, pull-away, orbit, half orbit, crane, lateral
tracking, low angle, overhead top-down, macro, whip pan. Unlike 2.0, a beat longer than
about 4 seconds can combine moves. Mark cuts explicitly ("Hard cut to …").

## Dialogue and sound

- Write dialogue as plain labelled lines, such as `Dialogue (Mara): "…"`. Don't use 2.0's
  bracket markup. Name the language when it isn't English or Chinese.
- Sound is generated with the picture (GENie's **Generate audio** checkbox turns it off). Spell
  it out: effects per beat, whether there is music, and how they sit together
  (effects under the voiceover).

## Things to avoid

- References left unbound, or bound loosely.
- Gaps in the timeline. Time that no beat covers is left to the model.
- A missing summary.
- Edit instructions with no scope or no list of what stays the same.
- Broad negative exclusions. Describe what should be seen instead. Keep negatives
  for subtitles and audio: "No subtitles. No background music."
- Vague words like *cinematic* or *premium*. Say what makes the look: materials,
  light, colours, lens, film stock, depth of field.
- Over-packing references. Each one needs a role.

## Limits (kie.ai)

4–30 seconds; 480p, 720p or 1080p; up to 30 reference images, 10 videos and 10 audio
clips (videos ≤ 30s in all, audio ≤ 30s in all); prompts up to 20,480 characters.
