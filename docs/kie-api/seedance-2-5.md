# Seedance 2.5 — `bytedance/seedance-2-5`

Video model. Source: official kie.ai OpenAPI spec at
<https://docs.kie.ai/market/bytedance/seedance-2-5>, retrieved 2026-10-01
(originally captured 2026-08-18). See [README.md](README.md) for shared endpoints,
auth, polling, callbacks, and error codes.

## Three mutually exclusive scenarios

Image-to-video (first frame), image-to-video (first & last frames) and multimodal
reference-to-video (reference images, videos **and audio**) cannot be combined. So
on 2.5 the first/last frames exclude reference video and audio as well as reference
images — stricter than 2.0/Fast/Mini. `last_frame_url` cannot be sent alone;
`first_frame_url` must accompany it.

## `input` parameters

| Parameter | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `prompt` | string | No | (long example) | Text description. Max 20,480 chars (was 30,000 before 2026-10). Reference images with `@Image1`, `@Image2`, … |
| `first_frame_url` | string | No | — | Start keyframe (URL or `asset://{assetId}`). Cannot be used with `reference_image_urls`, `reference_video_urls` or `reference_audio_urls`. |
| `last_frame_url` | string | No | — | End keyframe. **Requires `first_frame_url`.** |
| `reference_image_urls` | string[] | No | — | **Up to 30.** <30MB each. jpeg/png/webp/bmp/tiff/gif; aspect 0.4–2.5; sides 300–6000px. Mutually exclusive with first/last frame. |
| `reference_video_urls` | string[] | No | — | **Up to 10.** ≤200MB each, 2–30s each, **total ≤ 30s**. mp4/mov, 480p/720p, 24–60 fps. Mutually exclusive with first/last frame. |
| `reference_audio_urls` | string[] | No | — | **Up to 10.** ≤15MB each, 2–30s each, **total ≤ 30s**. wav/mp3. Mutually exclusive with first/last frame. |
| `generate_audio` | boolean | No | `true` | Generate AI audio synced to the video (higher cost). |
| `return_last_frame` | boolean | No | `false` | Return the output's last frame. **Cannot be `true` when `draft=true`.** |
| `resolution` | string | No | `720p` | `480p` \| `720p` \| `1080p`. (Despite kie.ai's "4K" marketing, the resolution enum stops at 1080p.) |
| `aspect_ratio` | string | No | `adaptive` | `16:9` \| `4:3` \| `1:1` \| `3:4` \| `9:16` \| `21:9` \| `adaptive`. |
| `duration` | integer | No | `5` | 4–30 seconds, or `-1` for automatic (the model picks; for video editing it matches the input video). |
| `output_format` | string | No | `mp4` | `mp4` \| `mov`. |
| `web_search` | boolean | No | — | Enable online search. |
| `nsfw_checker` | boolean | No | `false` | `false` disables **kie.ai's** content filter; results then come "directly by the model itself", so the model provider's own moderation still applies. |

| `draft` | boolean | No | `false` | Draft mode: **480p only**. The task id stays valid as a draft for 7 days. `return_last_frame` can't be `true` with it. |

## Drafts → `bytedance/seedance-2-5-draft`

Documented 2026-10 (<https://docs.kie.ai/market/bytedance/seedance-2-5-draft>). Run
`bytedance/seedance-2-5` with `draft: true` for a cheap 480p preview, then create a
task on the separate draft model to render the final from it:

| Parameter | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `draft_task_id` | string | **Yes** | — | Task id of the 2.5 draft run. Valid 7 days from the draft's creation. |
| `resolution` | string | **Yes** | — | `1080p` (only value). |
| `output_format` | string | No | — | `mp4` \| `mov`. |
| `return_last_frame` | boolean | No | `false` | |
| `nsfw_checker` | boolean | No | `false` | |

No prompt, duration or aspect ratio — they come from the draft.

```json
{
  "model": "bytedance/seedance-2-5-draft",
  "input": { "draft_task_id": "<draft taskId>", "resolution": "1080p", "output_format": "mp4" }
}
```

GENie: the **Draft (480p preview)** checkbox sends `draft: true`; a finished draft's
History card offers **⇪ Finalize 1080p** while it's under 7 days old.

## Example request

```json
{
  "model": "bytedance/seedance-2-5",
  "input": {
    "prompt": "Reference @Image1 for the character. A martial-arts spear sequence, multi-angle tracking shots.",
    "reference_image_urls": ["https://.../char.png"],
    "generate_audio": true,
    "resolution": "720p",
    "aspect_ratio": "adaptive",
    "duration": 5,
    "output_format": "mp4",
    "nsfw_checker": true
  }
}
```

Response: `{ "code": 200, "msg": "success", "data": { "taskId": "..." } }` —
then poll `recordInfo` (see [README.md](README.md)).

## Notes

- Only Seedance model with `output_format`, `return_last_frame`, `adaptive`
  default, and 30s duration.
- No seed parameter is documented.
