# Prompting Qwen Image 2.1 Edit

How to write prompts for the **Qwen Image 2.1 Image Edit** ComfyUI workflow in GENie
(`default/qwen_image_2_1_image_edit`). This guide is distilled from PixelDojo's
[Qwen Image 2.1 prompting guide](https://pixeldojo.ai/guides/qwen-image-2-1-prompting-guide)
(read 2026-10-26) and rewritten for the way GENie's workflow names its images. The
workflow itself is described in [COMFYUI.md](COMFYUI.md).

In GENie, **✨ Revise with AI → Guide → Qwen Image 2.1 Edit guide** has the LLM follow
these rules while it edits a prompt. Leave **Length** blank; it is for video.

## Naming images: `<image1>`, not "image 1"

PixelDojo's guide writes "image 1", "image 2". **GENie's workflow numbers its pictures
`<image1>`, `<image2>` …** in the order they are loaded, and each thumbnail shows its
tag. Re-ordering the thumbnails renumbers them, so check the tags after you move one.
This follows the workflow's own prompt enhancer, whose system prompt requires the tags
for two or more images and **no tag for a single image**: call it "the image".

Say which image is the canvas whose composition survives and what each of the others
supplies. To keep a person's likeness, point at their image rather than describing
their face in words; a description makes the model redraw the face.

With no images loaded the prompt makes a picture from the text; with images loaded it
becomes an instruction about them.

## Edits

- **Give each image one job:** the subject, the product, the face, the setting or the
  style.
- **Name the change first, then what stays the same** (the room, lighting, camera
  angle, face, label):

  ```
  Change her jacket to red leather. Keep her face, pose, the room, the lighting and the camera angle the same.
  ```

- **For a major rewrite**, describe the new picture in full instead of a small edit.
- **Combining:** say what comes from which image and where it goes, then the light and
  backdrop: `Place the bottle from <image1> on the marble counter from <image2>, soft window light from the left, warm beige backdrop.`
- **Keeping a person or product:** say it is the same person or product from
  `<imageN>`, name the features to keep (face, hair, logo, label), and describe the new
  scene in full as if from scratch.
- **Restyling:** `Redraw <image1> in the style of <image2>.` For new words on a sign or
  product, quote them exactly.

## The five-part prompt

1. **The piece:** what you're making, in a few words (a concert poster, a product hero
   shot, an editorial portrait).
2. **The subject:** specific enough to picture.
3. **Setting and action:** where it is and what happens.
4. **The words:** all printed text in double quotes, with where it goes.
5. **The finish:** light, lens, palette, texture.

Write it as one detailed run of comma-separated specifics; there is no length limit.

## Text in the picture

- Every word in double quotes, with its position: across the top, small at the bottom,
  on the label.
- Short lines; capitals set most cleanly.
- Name a type style: bold condensed, classic serif, hand-lettered, clean sans serif.
- Dense small print needs a larger output size.

## Style, light and finish

- **One light source** and its quality: soft window light from one side, raking
  late-afternoon sun.
- A **lens** (85mm), depth of field, a **palette** (a two-colour scheme), **texture**
  (film grain, screen-print grain).
- **Materials** carry the styling: pale oak, linen, walnut, ceramic.
- For **scale**, pair something huge with something tiny.

## LoRAs

Write the LoRA's trigger word where the subject goes, and describe only the scene, not
the features the LoRA already carries. Lower the strengths when stacking a subject LoRA
with a style LoRA.
