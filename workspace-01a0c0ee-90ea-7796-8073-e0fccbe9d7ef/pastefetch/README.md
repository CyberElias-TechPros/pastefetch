<div align="center">

# ⬇︎ PasteFetch

**Any link. One clean download.**

A free, open-source video downloader for social platforms.
No ads · no fake buttons · no accounts · nothing stored.

*Web app (static) + Cloudflare Worker API + yt-dlp resolver microservice — all deployable on **free tiers**.*

</div>

---

## What this is

Paste a link to a video on Reddit, Vimeo, Streamable (native support) or — when the resolver is deployed — **1,000+ sites via yt-dlp** (YouTube, TikTok, Instagram, X, Facebook, Twitch…). The app shows what it found, you pick a quality, the file streams straight to you. Files are **never written to disk** on any server; jobs expire after 15 minutes.

> ⚖️ Only download content you own, have permission to save, or that is free to reuse. Respect each platform's terms of service. See `docs/SECURITY.md` before running a public instance.

## Monorepo layout

```
pastefetch/
├── web/        Static web app (zero build step — plain HTML/CSS/JS, deploy anywhere)
├── worker/     Cloudflare Worker API (TypeScript) + D1 schema + cron canaries + tests
├── resolver/   yt-dlp + ffmpeg microservice (FastAPI, Docker) for hard platforms
├── docs/       Plan, free-tier guide, deployment, API reference, security
└── .github/    CI (typecheck + unit tests on push)
```

## Architecture

```
                 ┌─────────────────────────────┐
                 │  Browser                    │
                 │  web/ (Cloudflare Pages,    │
                 │  or served by the Worker)   │
                 └──────────────┬──────────────┘
                                │ /api/*
                 ┌──────────────▼──────────────┐
                 │  Cloudflare Worker (free)   │
                 │  · detect platform          │
                 │  · rate-limit (D1)          │
                 │  · jobs in D1 (15-min TTL)  │
                 │  · tier-1 extractors:       │
                 │    Reddit, Vimeo, Streamable│
                 │  · /download → 302 or proxy │
                 │  · cron canaries → /status  │
                 └───────┬─────────────────────┘
                         │ hard platforms only (YouTube, TikTok, IG, X…)
                ┌────────▼─────────────────────────────┐
                │  Resolver (free container host:      │
                │  HF Space / Koyeb / Render / Oracle) │
                │  · yt-dlp resolve (metadata+formats) │
                │  · ffmpeg remux / MP3                │
                │  · HMAC-signed /stream proxy         │
                │  · still zero storage                 │
                └──────────────────────────────────────┘
```

**Tiered resolution** is the key idea: the Worker natively resolves platforms with public JSON endpoints (fast, free, no backend needed), and delegates everything else to the yt-dlp resolver only when it's configured. If the resolver isn't deployed, those platforms return an honest, actionable error instead of a fake one.

**Bandwidth strategy:** the download endpoint 302-redirects the browser **directly to the platform CDN** whenever the URL isn't IP-locked (most non-YouTube platforms) — your free tiers carry ~zero bytes. IP-locked URLs (YouTube) stream through the resolver's egress with `Content-Disposition: attachment`, so the browser saves rather than plays the file.

## Quickstart (local)

```bash
# 1. Worker + D1 (requires: wrangler login)
cd worker
npm install
npm run migrate:local     # create schema in local D1
npm run dev               # http://127.0.0.1:8787

# 2. Web app — serve web/ with anything, e.g.
cd ../web && npx serve .  # then open http://localhost:3000

# 3. (optional) Resolver — unlocks YouTube/TikTok/IG/X/etc.
cd ../resolver
pip install -r requirements.txt
uvicorn main:app --port 8000
# then: cd ../worker && wrangler secret put RESOLVER_URL (http://127.0.0.1:8000)
#       wrangler secret put RESOLVER_TOKEN <same value as resolver/.env>
```

Run the test suite: `cd worker && npm test` (unit tests run offline; `RUN_LIVE=1 npm test` adds live extractor tests).

## Deploying (all free)

See **`docs/DEPLOYMENT.md`** for the full step-by-step. Short version:

1. `wrangler d1 create pastefetch` → paste the id into `worker/wrangler.toml`
2. `cd worker && npm run migrate && npm run deploy` → API is live on `*.workers.dev`
3. Put `web/` on Cloudflare Pages (drag-and-drop or `wrangler pages deploy web`) → set `API_BASE` in `web/config.js` to your worker URL
4. (optional, unlocks the hard platforms) Deploy `resolver/` to a free container host → set the `RESOLVER_URL` + `RESOLVER_TOKEN` secrets

## Implementation status (honest)

**Implemented & unit-tested:** platform detection, Reddit/Vimeo/Streamable extractors (parse layer), D1 job store + rate limiting (fixed-window, atomic upsert), HMAC-signed resolver URLs, download redirect/proxy modes, canary cron + `/api/status`, the web app end-to-end (resolve → poll → pick quality → download), demo mode when no API is configured, reduced-motion + keyboard accessibility.

**Implemented, not yet verifiable here (needs your Cloudflare account):** live D1 queries, cron execution, real 302 download flows, Pages deployment.

**Deliberately not built yet** (see `docs/PLAN.md` §roadmap): accounts/Pro tier, browser extension, bulk mode, subtitle downloads, PWA offline, E2E browser tests, DMCA blocklist admin UI (schema + manual SQL path exists in the plan).

**Known reality:** YouTube (and often Instagram) actively block datacenter IPs — including free container hosts. The resolver supports bring-your-own-cookies via the `YTDLP_COOKIES_FILE` env var, and `docs/FREE-TIER-GUIDE.md` sets honest expectations per platform.

## Publishing this repo to GitHub

The repo is initialized with a clean first commit. From inside `pastefetch/`:

```bash
# if you use the GitHub CLI:
gh repo create pastefetch --public --source=. --push

# or manually: create an empty repo on github.com, then:
git remote add origin git@github.com:YOUR_USERNAME/pastefetch.git
git push -u origin main
```

Never commit secrets — `.gitignore` already excludes `.dev.vars`, `.env`, `.wrangler/`, `node_modules/`.

## Docs

- `docs/PLAN.md` — the full product & technical plan (v1 + free-tier pivot addendum)
- `docs/FREE-TIER-GUIDE.md` — what changed vs. a paid stack, limits, capacity math, upgrade path
- `docs/DEPLOYMENT.md` — step-by-step production deployment on free services
- `docs/API.md` — endpoint reference, error codes, resolver contract
- `docs/SECURITY.md` — credential hygiene (read this), threat model, compliance notes

## License

MIT © PasteFetch contributors. Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense).
