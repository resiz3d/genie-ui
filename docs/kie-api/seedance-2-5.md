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
| `prompt` | string | No | (long example) | Text description. Max 30,000 chars. Reference images with `@Image1`, `@Image2`, … |
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

### `draft` (undocumented in the param table)

The docs mention `draft` only in passing, under `return_last_frame`: *"When
draft=true, this parameter cannot be set to true."* No `draft` field is otherwise
listed — no type, default, or description. Understood intent (per project notes):
generate a cheap low-quality preview, then re-run at full quality if approved.
Not yet exposed by the tool; treat as unconfirmed until kie.ai documents it.

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
