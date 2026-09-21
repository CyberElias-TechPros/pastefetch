# PasteFetch resolver (yt-dlp microservice)

Small FastAPI service that does the heavy lifting for platforms the Worker
can't resolve natively (YouTube, TikTok, Instagram, X, Facebook, Twitch,
Dailymotion, SoundCloud, and the rest of yt-dlp's 1,000+ sites).

- `POST /resolve` — metadata + formats (Bearer auth)
- `GET /stream?u=…&u2=…&t=…&fn=…&e=…&s=…` — HMAC-signed stream: direct pipe,
  ffmpeg remux (`u2`), HLS/DASH conversion, or MP3 transcode (`t=mp3`)
- `GET /health` — versions + ffmpeg presence

**Zero storage** — media only ever moves through pipes.

## Env vars

| Var | Purpose |
|---|---|
| `RESOLVER_TOKEN` | Shared secret with the Worker (set this in production) |
| `YTDLP_COOKIES_FILE` | Path to Netscape `cookies.txt` — big YouTube/Vimeo success-rate booster |
| `MAX_BYTES` | Per-download cap (default 2 GiB) |
| `CONCURRENCY` | Parallel resolve/stream cap (default 4) |
| `PORT` | Listen port (default 7860 — Hugging Face Spaces default) |

## Run locally

```bash
pip install -r requirements.txt
RESOLVER_TOKEN=dev-secret uvicorn main:app --port 8000
curl localhost:8000/health
```

## Deploy (pick one free option)

- **Hugging Face Space (easiest):** New Space → Docker → upload this folder → add `RESOLVER_TOKEN` in Settings → Secrets. URL: `https://<user>-<space>.hf.space`
- **Koyeb / Render:** Docker service from this folder, set `RESOLVER_TOKEN`, expose HTTP port.
- **Oracle Always Free:** Docker on an ARM VM (never sleeps, 10 TB egress).
- **Your own machine:** run locally and point the Worker's `RESOLVER_URL` at it (tunnel with Cloudflare Tunnel if you want it reachable).

## YouTube tips

Datacenter IPs are heavily blocked ("Sign in to confirm you're not a bot").
Best options, in order: (1) run the resolver at home, (2) Oracle free VM,
(3) export your YouTube cookies to `cookies.txt` and mount them — use a
throwaway account, cookies on flag IPs get invalidated.
