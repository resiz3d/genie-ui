# kie.ai Video Upscaler — `video/upscale`

Source: the model page <https://kie.ai/video-upscaler> and <https://kie.ai/pricing>
(retrieved 2026-11-12). No OpenAPI page for this model was found under
docs.kie.ai, so the body below follows the shared Jobs API shape — **medium
confidence** on paper, but a live upscale from GENie succeeded with exactly this
body on 2026-11-12.

## Request

```
POST https://api.kie.ai/api/v1/jobs/createTask
{ "model": "video/upscale", "input": { "video_url": "...", "resolution": "2K" } }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `video_url` | string | yes | Publicly downloadable URL (no login, no short-lived signed link) |
| `resolution` | `1080P` \| `2K` \| `4K` | no (default `2K`) | Target box 1920×1080 / 2560×1440 / 3840×2160 (rotated for portrait); aspect kept, scaled to touch the box |

There is no `upscale_factor` (that's Topaz) and no fps field — frame rate, frame
count and duration are kept.

## Input limits

MP4, MOV or MKV · ≤50 MB · ≤60 s. Over-limit clips are accepted and then **fail as a
task**, so GENie checks them first (`POST /api/upscale/host`).

## Output

MP4 (H.264 + AAC; audio kept if present), uncapped bitrate (a 23 s 2K clip ≈ 150 MB).
Result links expire after 14 days. Poll `recordInfo` as usual; `resultJson.resultUrls[0]`.

## Pricing

Per second of input, billed on the exact duration: 1080P 1.5 credits · 2K 3 · 4K 6
(1 credit ≈ $0.005). A clip already at the target size is still billed. Failed tasks
aren't charged.

## In GENie

Two ways in: the "Video Upscaler" entry in the model list (the form's video field —
one video, Gallery or upload, "use last N sec" trims before hosting), or the
"⇧ Upscale…" menu on History video cards. Both go through `POST /api/upscale/host`
(`{ outputUrl }` or `{ id, tailSec? }`), which checks the limits and hosts the clip.
The result is a new pending History entry with `input.model = "video/upscale"` and
`input.resolution` = the tier. A card-made upscale also keeps the source's prompt and
settings, `upscaleOf` / `upscaleOfOutput` pointing at the source, and `sourceInput`
(the source's own input) so Re-import / Re-run bring back the original run; a
form-made one re-imports as the upscaler with its video (`mediaLocalIds.video`).
