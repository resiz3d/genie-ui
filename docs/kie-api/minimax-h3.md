# MiniMax H3 (Hailuo 03) — `minimax-h3/*`

MiniMax H3 is a multimodal video model: 4–15s clips at 768P or 2K with **native**
stereo audio (there is no audio on/off switch — sound is always generated).

kie.ai splits it into **three model ids, one per generation mode**. Unlike Seedance,
the mode is not a flag inside one model, so GENie lists all three in the model
dropdown and shapes the form from the id alone (no "Image source" toggle).

| Model id | Mode |
| --- | --- |
| `minimax-h3/text-to-video` | prompt only |
| `minimax-h3/image-to-video` | first and/or last frame |
| `minimax-h3/reference-to-video` | reference images / videos / audio |

Shared request/response mechanics (auth, `createTask`, `recordInfo`, callbacks,
error codes) are the same for every kie.ai model — see [README.md](README.md).

## Parameter matrix

| Parameter | t2v | i2v | ref2v |
| --- | :---: | :---: | :---: |
| `prompt` (1–7,000 chars) | ✓ required | ✓ required | ✓ required |
| `first_frame_url` | ✗ | ✓ | ✗ |
| `last_frame_url` | ✗ | ✓ | ✗ |
| `reference_image_urls` (≤9) | ✗ | ✗ | ✓ |
| `reference_video_urls` (≤3) | ✗ | ✗ | ✓ |
| `reference_audio_urls` (≤3) | ✗ | ✗ | ✓ |
| `aspect_ratio` | ✓ **required** | ✗ | ✓ (default `adaptive`) |
| `duration` (4–15, integer) | ✓ required | ✓ required | ✓ required |
| `resolution` (`768P` / `2K`) | ✓ (default `2K`) | ✓ (default `2K`) | ✓ (default `2K`) |

There is **no** `generate_audio`, `web_search`, `nsfw_checker`, `output_format`,
`quality` or `return_last_frame` — GENie hides those controls for H3.

**`aspect_ratio` values:** `21:9` `16:9` `4:3` `1:1` `3:4` `9:16`, plus `adaptive`
for reference-to-video only. Text-to-video explicitly does **not** accept
`adaptive`, and image-to-video has no aspect parameter at all (the frames set it).

**`resolution` is named differently from Seedance** — `768P` and `2K`, not the
`480p`/`720p`/`1080p`/`4k` ladder. Sending a Seedance value is rejected, so the
resolution dropdown is repopulated per model family.

## Required-input rules

- **image-to-video:** at least one of `first_frame_url` / `last_frame_url`. Either
  alone is valid; both together define the opening and closing frames.
- **reference-to-video:** at least one of `reference_image_urls` /
  `reference_video_urls`. `reference_audio_urls` **cannot be used alone** — it must
  accompany an image or video reference.

GENie checks both before submitting rather than letting the API reject the run.

## Media limits (reference-to-video)

| | Formats | Size | Duration | Other |
| --- | --- | --- | --- | --- |
| Images (≤9) | JPG, JPEG, PNG, WEBP, HEIC, HEIF | ≤30 MB each | — | side 256–5760 px, aspect 0.4–2.5 |
| Videos (≤3) | MP4, MOV (H.264/H.265, AAC/MP3) | ≤50 MB each | 2–15s each, ≤15s total | side 256–5760 px, aspect 0.4–2.5, 23.976–60 fps |
| Audio (≤3) | WAV, MP3 | ≤15 MB each | 2–15s each, ≤15s total | must accompany an image or video ref |

First/last frames follow the same rules as reference images.

## Example requests

```json
{
  "model": "minimax-h3/text-to-video",
  "input": {
    "prompt": "A cat walking slowly on the beach at sunset, cinematic shot",
    "aspect_ratio": "16:9",
    "duration": 6,
    "resolution": "2K"
  }
}
```

```json
{
  "model": "minimax-h3/image-to-video",
  "input": {
    "prompt": "The character turns around naturally and smiles, camera pushing in",
    "first_frame_url": "https://example.com/first-frame.jpg",
    "last_frame_url": "https://example.com/last-frame.jpg",
    "duration": 6
  }
}
```

```json
{
  "model": "minimax-h3/reference-to-video",
  "input": {
    "prompt": "Generate a continuous cinematic video referencing the input material",
    "reference_image_urls": ["https://example.com/ref-1.jpg"],
    "reference_video_urls": ["https://example.com/ref.mp4"],
    "reference_audio_urls": ["https://example.com/ref.mp3"],
    "aspect_ratio": "adaptive",
    "duration": 6
  }
}
```

## Source & confidence

Retrieved **2026-09-17** from the official kie.ai OpenAPI specs:

- <https://docs.kie.ai/market/minimax-h3/text-to-video>
- <https://docs.kie.ai/market/minimax-h3/image-to-video>
- <https://docs.kie.ai/market/minimax-h3/reference-to-video>

Confidence: **high** — full parameter schemas with types, enums and defaults.

## Note

The `2K` output size isn't stated numerically in the docs. GENie's auto-draft
megapixel estimate assumes a nominal 16:9 2560×1440 for `2K` and 1366×768 for
`768P`; only the auto-draft threshold depends on it.
