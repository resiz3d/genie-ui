# Seedance 2.0 & 2.0 Fast — `bytedance/seedance-2`, `bytedance/seedance-2-fast`

Video models. Source: official kie.ai OpenAPI specs at
<https://docs.kie.ai/market/bytedance/seedance-2> and
<https://docs.kie.ai/market/bytedance/seedance-2-fast>, retrieved 2026-10-01
(replacing the 2026-08-18 playground-form capture). See [README.md](README.md) for
shared endpoints, auth, polling, and error codes.

**Model ids:**

- Standard: `bytedance/seedance-2`
- Fast: `bytedance/seedance-2-fast`

The two share one schema except where the table says otherwise.

## `input` parameters

| Parameter | Type | Options / limits |
| --- | --- | --- |
| `prompt` | string | Text description of the video. 3–20,000 chars. |
| `first_frame_url` | string | Start keyframe (URL or `asset://{assetId}`). Mutually exclusive with `reference_image_urls`. |
| `last_frame_url` | string | End keyframe. |
| `reference_image_urls` | string[] | Up to 9. <30MB each. jpeg/png/webp/bmp/tiff/gif; aspect 0.4–2.5; sides 300–6000px. Mutually exclusive with first/last frame. |
| `reference_video_urls` | string[] | Up to 3. ≤50MB each, 2–15s each, **total ≤ 15s**. mp4/mov, 480p/720p, 24–60 fps. |
| `reference_audio_urls` | string[] | Up to 3. ≤15MB each, 2–15s each, **total ≤ 15s**. wav/mp3. |
| `generate_audio` | boolean | Default `true`. Generate AI audio synced to the video. |
| `resolution` | string | Standard: `480p` \| `720p` \| `1080p` \| `4k`. Fast: `480p` \| `720p`. Default `720p`. |
| `aspect_ratio` | string | `16:9` \| `4:3` \| `1:1` \| `3:4` \| `9:16` \| `21:9` \| `adaptive`. Default `16:9`. |
| `duration` | integer | 4–15 seconds, or `-1` (automatic). Default `5`. |
| `web_search` | boolean | Enable online search. **Fast: text-to-video only.** |
| `nsfw_checker` | boolean | Default `false`. `false` disables **kie.ai's** content filter; results then come "directly by the model itself", so the model provider's own moderation still applies. |
| `return_last_frame` | boolean | Listed on Standard and Fast but marked **deprecated** — the tool does not send it. |

## Not supported (present on 2.5 only)

- `output_format` (mp4/mov) — not offered.

## Notes

- Multimodal: mixes text + image + video + audio references; strong at replicating
  camera motion/pacing from a reference video.
- Unlike 2.5, the spec does not say first/last frames exclude reference video/audio
  here, so the tool keeps those available in frames mode.
