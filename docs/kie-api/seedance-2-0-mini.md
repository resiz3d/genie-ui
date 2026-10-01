# Seedance 2.0 Mini — `bytedance/seedance-2-mini`

Video model. Source: official kie.ai OpenAPI spec at
<https://docs.kie.ai/market/bytedance/seedance-2-mini>, retrieved 2026-10-01
(replacing the 2026-08-18 playground-form capture). See [README.md](README.md)
for shared endpoints, auth, polling, and error codes.

**Model id:** `bytedance/seedance-2-mini`

Faster/cheaper than 2.0 and 2.0 Fast, with output quality kie.ai describes as
comparable to 2.0 Fast. Caps resolution at 720p.

## `input` parameters

| Parameter | Type | Options / limits |
| --- | --- | --- |
| `prompt` | string | Text description of the video. 3–20,000 chars. |
| `first_frame_url` | string | Start keyframe (URL or `asset://{assetId}`). Mutually exclusive with `reference_image_urls`. |
| `last_frame_url` | string | End keyframe. |
| `reference_image_urls` | string[] | Up to 9. <30MB each. jpeg/png/webp/bmp/tiff/gif. Mutually exclusive with first/last frame. |
| `reference_video_urls` | string[] | Up to 3. ≤50MB each, 2–15s each, **total ≤ 15s**. mp4/mov. |
| `reference_audio_urls` | string[] | Up to 3. ≤15MB each, 2–15s each, **total ≤ 15s**. wav/mp3. |
| `generate_audio` | boolean | Default `true`. Generate AI audio synced to the video. |
| `resolution` | string | `480p` \| `720p`. |
| `aspect_ratio` | string | `16:9` \| `4:3` \| `1:1` \| `3:4` \| `9:16` \| `21:9` \| `adaptive`. |
| `duration` | integer | 4–15 seconds, or `-1` (automatic). Default `5`. |
| `web_search` | boolean | Enable online search. **Text-to-video only.** |
| `nsfw_checker` | boolean | Default `false`. `false` disables **kie.ai's** content filter; the model provider's own moderation still applies. |

## Difference from 2.0 / Fast

- Same schema as Fast, minus the deprecated `return_last_frame`.

## Not supported (present on 2.5 only)

- `output_format` (mp4/mov) — not offered.
- `return_last_frame` — not offered.
