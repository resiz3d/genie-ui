# Kling 4.0 — `kling-4.0/reference-to-video`, `kling-4.0/keyframe-to-video`

Video models. Source: official kie.ai OpenAPI specs at
<https://docs.kie.ai/market/kling/v4-reference-to-video> and
<https://docs.kie.ai/market/kling/v4-keyframe-to-video>, retrieved 2026-10-22. See
[README.md](README.md) for shared endpoints, auth, polling, callbacks, and error codes.

These are the only two Kling 4.0 models kie.ai lists (no text-to-video,
image-to-video or "Flash" endpoint yet). Both reject unknown `input` fields
(`additionalProperties: false`). Audio is native — there is no `generate_audio`,
`web_search` or `nsfw_checker`.

## `kling-4.0/reference-to-video`

| Parameter | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `prompt` | string | **Yes** | — | 1–8,000 chars. Mention assets as `@image_1`, `@video_1`, or an element/voice `@name`; every mention must match an asset in the request. |
| `duration` | integer | No | `5` | 3–30 seconds. |
| `resolution` | string | No | `720p` | `720p` \| `1080p`. |
| `aspect_ratio` | string | No | — | `auto` \| `16:9` \| `9:16` \| `1:1` \| `21:9`. Omitted: `auto` with references, `16:9` without. |
| `image_urls` | string[] | No | `[]` | Up to 10. Sides 300–65536px, aspect 0.40–2.5. |
| `video_urls` | string[] | No | `[]` | Up to 5. Each 2–30s; total ≤ 30s (video elements included). |
| `keep_original_sound` | boolean | No | `false` | Only with `video_urls`. |
| `elements` | object[] | No | `[]` | Up to 7 named subjects — see below. |
| `voices` | object[] | No | `[]` | Up to 3: `{ name, audio_url }`, both required. |

Images, videos, elements and voices together: at most 15. Reference videos plus video
elements: at most 5 clips / 30s.

**`elements[]`:** `name` (required; `^[一-龥A-Za-z0-9_]{1,20}$`, unique case-insensitively
across elements and voices; reserved: `image_N`, `video_N`, `keyframe_N`, `object_N`,
`audio_N`, `first_frame`, `last_frame`), and either `image_urls` (2–4, first is
primary) or `video_url` (one 3–8s single-shot clip, shortest side ≥ 700px), plus
optional `tag` (`character` | `animal` | `prop` | `costume` | `scene` | `effect` |
`others`; video subjects must be `character`), `description` (≤ 100 chars) and
`voice_url` (bound audio; doesn't count toward `voices`).

GENie sends the Reference images / videos lists as `image_urls` / `video_urls` and the
Reference audio list as `voices` named `voice_1`, `voice_2`, … `elements` is not
exposed yet.

```json
{
  "model": "kling-4.0/reference-to-video",
  "input": {
    "prompt": "@Hero sits at the desk in @video_1, picks up the doll from @image_1, and greets using @Narrator",
    "duration": 10,
    "resolution": "1080p",
    "image_urls": ["https://example.com/doll.png"],
    "video_urls": ["https://example.com/room.mp4"],
    "keep_original_sound": false,
    "elements": [
      {
        "name": "Hero",
        "image_urls": ["https://example.com/hero-front.jpg", "https://example.com/hero-side.jpg"],
        "tag": "character",
        "description": "Young man in a red jacket"
      }
    ],
    "voices": [{ "name": "Narrator", "audio_url": "https://example.com/narrator.mp3" }]
  }
}
```

## `kling-4.0/keyframe-to-video`

| Parameter | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `prompt` | string | **Yes** | — | 1–8,000 chars. Mention frames as `@first_frame`, `@keyframe_1` …, `@last_frame`. |
| `duration` | integer | No | `5` | 3–30 seconds. Also caps the total frames (first + middle + last): 3s→4, 4s→5, 5s→6, 6s→7, 7s→8, 8s→9, ≥9s→10. |
| `resolution` | string | No | `720p` | `720p` \| `1080p`. |
| `aspect_ratio` | string | No | — | `auto` \| `16:9` \| `9:16` \| `1:1` \| `21:9`. Only used with no frames (default `16:9`); otherwise the first frame decides. |
| `first_frame_url` | string | No | — | |
| `keyframe_urls` | string[] | No | `[]` | Up to 8 middle frames, in order. |
| `last_frame_url` | string | No | — | |

GENie sends the First / Last frame fields and the image list (relabelled **Middle
keyframes**) as `keyframe_urls`.

## Pricing (kie.ai model page, 2026-10-22)

Per second of output: 720p 28.5 credits (17 with video input), 1080p 42.5 (25.5 with
video input). With video input: rate × (output × 2) when the input is no longer than
the output, otherwise rate × (input + output). 4K / HDR "coming soon".
