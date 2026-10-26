# Wan 3.0 — `wan/3-0-video`, `wan/3-0-video-prime`

Video models. Source: official kie.ai OpenAPI specs at
<https://docs.kie.ai/market/wan/3-0-video> and
<https://docs.kie.ai/market/wan/3-0-video-prime>, retrieved 2026-10-26. See
[README.md](README.md) for shared endpoints, auth, polling, callbacks, and error codes.

The two models take the identical `input` schema; only the `model` string differs.
kie.ai calls `wan/3-0-video` the standard model and `wan/3-0-video-prime` the
high-speed one (Prime costs more — see Pricing). One model id covers every mode:
text-to-video, first(/last)-frame-to-video, all-purpose reference, file-to-video and
link-to-video.

| Parameter | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `prompt` | string | text-to-video only | — | ≤ 20,000 chars, Chinese or English. In reference mode, mention media as `Image1` / `Video1` / `Audio1` (array order). |
| `first_frame_url` | string | No | — | JPEG/PNG (no transparency)/BMP/WEBP; sides 240–8000px; aspect ≤ 8:1; ≤ 20MB. Not with any `reference_*_urls`. |
| `last_frame_url` | string | No | — | Use together with `first_frame_url`. Same limits. |
| `reference_image_urls` | string[] | No | — | Up to 10. Same limits as the first frame. |
| `reference_video_urls` | string[] | No | — | Up to 5; each 1–15s, total ≤ 15s; mp4/mov; sides 240–4096px; ≤ 100MB each. Input video + `duration` ≤ 30s. |
| `reference_audio_urls` | string[] | No | — | Up to 5; each 1–15s, total ≤ 15s; wav/mp3; ≤ 15MB. Can be the only media. |
| `reference_file_urls` | string[] | No | — | File-to-video, 1 file (docx/xlsx/pptx/pdf/txt/key/pages/numbers/md …; ≤ 100MB, ≤ 50 pages). Not with `reference_link_urls` or frames. |
| `reference_link_urls` | string[] | No | — | Link-to-video, 1 public page. Not with `reference_file_urls` or frames. |
| `resolution` | string | No | `1080P` | `480P` \| `720P` \| `1080P` (capitals). |
| `aspect_ratio` | string | No | `adaptive` | `adaptive` \| `16:9` \| `4:3` \| `1:1` \| `3:4` \| `9:16`. |
| `duration` | integer | No | `5` | 2–30s without video input; with reference video, input + output ≤ 30. `-1` lets the model choose. |
| `audio` | boolean | No | `true` | Whether the output has an audio track. |
| `seed` | integer | No | random | 0–2147483647. |
| `nsfw_checker` | boolean | No | `false` | Same meaning as on Seedance (kie.ai's own filter only). |

GENie sends the Image source toggle like Seedance 2.5: **Reference images** sends
`reference_image_urls` / `reference_video_urls` / `reference_audio_urls`; **First /
last frames** sends only the frames (and refuses a last frame without a first). The
**Generate audio** checkbox is sent as `audio`. `seed`, `reference_file_urls` and
`reference_link_urls` are not exposed yet.

```json
{
  "model": "wan/3-0-video",
  "input": {
    "prompt": "The woman in Image1 walks through the street from Video1, humming the tune from Audio1.",
    "reference_image_urls": ["https://example.com/woman.png"],
    "reference_video_urls": ["https://example.com/street.mp4"],
    "reference_audio_urls": ["https://example.com/tune.mp3"],
    "resolution": "1080P",
    "aspect_ratio": "adaptive",
    "duration": 10,
    "audio": true
  }
}
```

## Pricing (kie.ai model pages, 2026-10-26)

Billed seconds = output duration + total reference-video duration (with `duration:
-1`, the length the model picks).

| Model | 480P | 720P | 1080P |
| --- | --- | --- | --- |
| `wan/3-0-video` | 8 credits/s | 16 credits/s | 32 credits/s |
| `wan/3-0-video-prime` | 12.2 credits/s | 25.2 credits/s | 50.4 credits/s |
