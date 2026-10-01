# kie.ai API reference (Seedance / Seedream / MiniMax H3)

Local copies of the kie.ai model API docs this tool talks to, so we don't have to
re-check the web. One file per model family:

- [seedance-2-5.md](seedance-2-5.md) — `bytedance/seedance-2-5`
- [seedance-2-0.md](seedance-2-0.md) — `bytedance/seedance-2` and `bytedance/seedance-2-fast`
- [seedance-2-0-mini.md](seedance-2-0-mini.md) — `bytedance/seedance-2-mini`
- [minimax-h3.md](minimax-h3.md) — `minimax-h3/text-to-video`,
  `minimax-h3/image-to-video`, `minimax-h3/reference-to-video`

Seedream (image) models are used by the tool too but aren't documented here yet.

## Sources & confidence

| Model | Source | Confidence |
| --- | --- | --- |
| Seedance 2.5 / 2.0 / Fast / Mini | Official OpenAPI specs under <https://docs.kie.ai/market/bytedance/> (retrieved 2026-10-01) | High — full schemas with types/enums/defaults |
| MiniMax H3 | Official OpenAPI specs under <https://docs.kie.ai/market/minimax-h3/> (retrieved 2026-09-17; re-checked 2026-10-01, unchanged) | High — full schemas with types/enums/defaults |

The index of every doc page is <https://docs.kie.ai/llms.txt>; append `.md` to a
page URL for its raw OpenAPI spec.

## Shared request/response mechanics (all models)

kie.ai uses one unified Jobs API; only the `model` string and the `input` object
differ per model.

**Auth:** `Authorization: Bearer YOUR_API_KEY` on every request. Key from
<https://kie.ai/api-key>.

**Create a task**

```
POST https://api.kie.ai/api/v1/jobs/createTask
Content-Type: application/json

{ "model": "<model-id>", "input": { ... }, "callBackUrl": "<optional>" }
```

Response: `{ "code": 200, "msg": "success", "data": { "taskId": "..." } }`

**Query a task**

```
GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<taskId>
```

`data.state` is `waiting` | `success` | `fail`. On success, `data.resultJson` is a
JSON **string** like `{"resultUrls":["https://.../out.mp4"]}`. Other fields:
`failCode`, `failMsg`, `costTime` (seconds), `completeTime`, `createTime` (epoch ms).

**Callback:** if `callBackUrl` is set, kie.ai POSTs the same body as the query
response on completion (success or fail); its `param` field holds the full create
request. Otherwise poll `recordInfo`.

**Error codes:** 200 ok · 400 bad params · 401 auth · 402 insufficient balance ·
404 not found · 422 validation failed · 429 rate limit · 500 server error.
Rate limit is ~20 new requests / 10s; rejected requests are **not** queued.

## Parameter matrix (video models)

| Parameter | 2.5 | 2.0 | Fast | Mini |
| --- | :---: | :---: | :---: | :---: |
| `prompt` | ✓ | ✓ | ✓ | ✓ |
| `first_frame_url` / `last_frame_url` | ✓ | ✓ | ✓ | ✓ |
| `reference_image_urls` | ✓ (≤30) | ✓ (≤9) | ✓ (≤9) | ✓ (≤9) |
| `reference_video_urls` | ✓ (≤10, total ≤30s, ≤200MB) | ✓ (≤3, total ≤15s, ≤50MB) | same | same |
| `reference_audio_urls` | ✓ (≤10, total ≤30s) | ✓ (≤3, total ≤15s) | same | same |
| `generate_audio` | ✓ | ✓ | ✓ | ✓ |
| `web_search` | ✓ | ✓ | t2v only | t2v only |
| `nsfw_checker` | ✓ | ✓ | ✓ | ✓ |
| `resolution` | 480p–1080p | 480p–4k | 480p/720p | 480p/720p |
| `aspect_ratio` (+`adaptive`) | ✓ (default) | ✓ | ✓ | ✓ |
| `duration` | 4..30 or −1 | 4..15 or −1 | 4..15 or −1 | 4..15 or −1 |
| prompt max chars | 30,000 | 20,000 | 20,000 | 20,000 |
| `output_format` (mp4/mov) | ✓ | ✗ | ✗ | ✗ |
| `return_last_frame` | ✓ | deprecated | deprecated | ✗ |

**Mutual exclusivity:** `reference_image_urls` and the first/last frames cannot be
combined. The tool enforces this with an "Image source" toggle. On **2.5** the
frames also exclude reference **video** and **audio**, and a last frame needs a
first frame; on 2.0/Fast/Mini video and audio stay available alongside either
choice.

**`nsfw_checker`:** `false` turns off kie.ai's own content filter only — results are
then "returned directly by the model itself", so the model provider's moderation can
still reject a prompt. The API default is `false`; the tool always sends the
checkbox's value explicitly.
