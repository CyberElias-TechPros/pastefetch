# API Reference

Base URL: your Worker origin, e.g. `https://pastefetch.<sub>.workers.dev`. All endpoints are CORS-enabled for configured origins (`ALLOWED_ORIGINS`, default `*` in dev).

---

## `POST /api/resolve`

```json
{ "url": "https://www.reddit.com/r/aww/comments/abc123/..." }
```

**202**
```json
{ "job_id": "j_a8f3c2", "status": "queued" }
```
Tier-1 platforms (Reddit/Vimeo/Streamable) usually return `"status": "done"` immediately. Rate limit: **12 resolves / 10 min / IP** (429 + `Retry-After` when exceeded). Identical URLs within 15 minutes return the cached job.

Errors: `400 invalid_url` · `400 unsupported_platform` · `429 rate_limited`

## `GET /api/jobs/:id`

Poll every ~1.2 s. For resolver-tier jobs, **the first poll triggers processing** (serverless-friendly lazy execution).

```json
{
  "job_id": "j_a8f3c2",
  "status": "done",
  "platform": "reddit",
  "title": "…",
  "author": "u/someone",
  "duration_s": 41,
  "thumbnail": "https://…",
  "formats": [
    { "id": "best",   "label": "MP4 · 720p", "container": "mp4", "kind": "video",       "bytes": null },
    { "id": "audio",  "label": "Audio",      "container": "mp3", "kind": "audio",       "bytes": null }
  ]
}
```

`status`: `queued` → `processing` → `done | error`. Jobs and formats **expire after 15 minutes** (`410 gone`).

Error codes on the job: `no_video_in_post` · `platform_error` · `resolver_not_configured` (Tier-2 platform, no resolver deployed — surface the "deploy the resolver" guidance) · `resolver_unreachable` · `resolver_error` · `private_or_auth_required` · `unsupported_url`.

## `GET /api/download/:job_id/:format_id`

Default: **302 redirect** — to the platform CDN when the URL is directly fetchable, or to the resolver's signed `/stream` (which sets `Content-Disposition: attachment`) when the URL is IP-locked (YouTube).

- `?mode=proxy` — stream through the Worker with attachment headers (use if a CDN rejects the redirect; watch bandwidth).
- `?mode=direct` — force the raw 302 (browser may *play* instead of save — the UI's "direct link" affordance).

Filename is sanitized server-side and sent as `filename*` UTF-8.

## `GET /api/status`

```json
{
  "resolver_configured": true,
  "platforms": [
    { "id": "reddit", "name": "Reddit", "tier": "native",   "status": "up",   "detail": null,              "last_checked": 1758382800 },
    { "id": "youtube", "name": "YouTube", "tier": "resolver", "status": "degraded", "detail": "IP challenge", "last_checked": 1758382800 }
  ]
}
```
Statuses: `up | degraded | down | unknown` — refreshed by the canary cron every 6 h. Tier-2 platforms report `unknown` until a resolver is configured.

---

## Resolver contract (`resolver/`)

The Worker calls the resolver; the resolver never talks to browsers except via signed `/stream` redirects.

**`POST /resolve`** — `Authorization: Bearer <RESOLVER_TOKEN>`
```json
{ "url": "https://www.youtube.com/watch?v=…" }
```
→ normalized payload (same shape as the job response above, plus per-format `url`, optional `url2` for remux, `ip_locked: true` for YouTube-class CDNs). Errors mirror the job error codes with `X-Resolver-Error` detail headers.

**`GET /stream?u=…&u2=…&fn=…&e=…&s=…`** — no header auth (it's a 302 target); `s` is an HMAC-SHA256 signature over `u\nu2\nfn\ne` using the shared `RESOLVER_TOKEN`, `e` a unix-seconds expiry (10-minute lifetime). Two URLs → ffmpeg remux (`-c copy`) streamed as fragmented MP4; `t=mp3` → 192 kbps MP3 pipe.

**`GET /health`** — `{ ok, ytdlp_version, ffmpeg, uptime_s }`.

All endpoints enforce a `MAX_BYTES` cap (default 2 GB) and a concurrency semaphore (4).
