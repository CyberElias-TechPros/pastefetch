# PasteFetch — Product & Technical Plan

**Working title:** PasteFetch · **Status:** Planning · **Last updated:** 2026-09-20

> A clean, ad-free web app where you paste a link to any social video and get a file. No fake download buttons, no pop-ups, no accounts required, nothing stored.

---

## 1. Vision

One input box. Paste a link from YouTube, TikTok, Instagram, X, Facebook, Reddit, Vimeo, or Twitch → the app shows you what it found (thumbnail, title, duration) → you pick a quality → the file downloads. Under 10 seconds from paste to file for most links.

**Positioning:** the "clean" downloader. Every competitor (y2mate, savefrom, snaptik…) is an ad-riddled minefield of fake buttons. We win on trust, speed, and honesty — including being honest when a platform is blocking us.

**Non-goals (v1):**
- No re-uploading, converting between arbitrary formats, or editing
- No private/auth-walled content (private accounts, members-only, paywalled)
- No bulk/playlist mode in v1 (abuse magnet)
- No native apps (Apple/Google explicitly ban downloader apps from their stores; web + PWA only)

---

## 2. What "clean" means (UX principles)

1. **One job per screen.** Input → result card → download. Nothing else competes for attention.
2. **Zero dark patterns.** One real download button. No ad slots anywhere near it.
3. **Instant platform detection.** Show the platform badge the moment a valid URL is pasted.
4. **Honest failure states.** "Instagram is asking us to sign in for this post — we can't reach it." with a status-page link. Never a fake error that funnels to an ad.
5. **Privacy by default.** No accounts, no analytics on URLs (only salted hashes in logs), nothing written to disk beyond a RAM temp file with a 10-minute TTL.
6. **Fast by default.** Metadata resolves in < 5 s; download starts streaming immediately (no full server-side download before the browser sees bytes).

A visual wireframe of the target UI is in **`wireframe.html`** (same folder).

---

## 3. Core user flow

```
Paste link ──▶ auto-detect platform ──▶ resolve (spinner, ~2–5 s)
                                                │
              ┌─────────────────────────────────┤
              ▼                                 ▼
        Result card                      Error card
        thumbnail · title · duration     plain-language reason
        quality chips: 1080p / 720p /    + link to platform status
        480p / MP3                       + "try another link"
              │
              ▼
        Click quality ──▶ browser "save as" starts immediately
                          (streamed through our servers, never stored)
```

**Happy path target:** paste → file saving in ≤ 10 s (p50), ≤ 20 s (p95, excluding YouTube).

---

## 4. Feature set

### MVP (launch)
| Feature | Notes |
|---|---|
| Paste-a-link resolve | Auto-trim tracking params, accept share shortlinks (youtu.be, vm.tiktok.com, instagr.am) |
| 8 platforms | YouTube, TikTok, Instagram (public), X/Twitter, Facebook (public), Reddit, Vimeo, Twitch (clips) |
| Quality picker | Progressive MP4 up to 1080p; audio-only MP3 (ffmpeg transcode) |
| Stream-through download | File proxied from platform CDN to user; zero persistence |
| Rate limits | 10 resolves/hr, 5 downloads/day per IP (anonymous) |
| Status page | Live per-platform health (public) — a trust feature, not overhead |
| Legal surface | Own ToS, DMCA agent registered, blocklist for complained URLs |

### v1.1 (first month after launch)
- Clipboard-paste auto-detect ("link detected — fetch it?")
- Download history (local, localStorage only)
- Subtitles download where available
- PWA install (home-screen icon, share-target so you can "share" a link into the app from TikTok/X apps)

### v2 (validate demand first)
- Browser extension (right-click any video → download)
- Accounts + Pro tier ($4/mo: unlimited, 4K, batch of 5, subtitles, API key)
- Public REST API (rate-limited, paid)
- Self-host kit (docker-compose bundle) — also our answer to "YouTube blocks your IPs": power users can self-host with their own IP/cookies

---

## 5. Architecture

```
                        ┌──────────────────────────────────────────┐
                        │            Cloudflare (DNS/DDoS)         │
                        └────────────────────┬─────────────────────┘
                                             │
                        ┌────────────────────▼─────────────────────┐
                        │   Edge: Next.js web app + API routes     │
                        │   UI · POST /api/resolve · Turnstile     │
                        │   per-IP rate limiting (Redis)           │
                        └───────┬──────────────────────┬───────────┘
                                │ enqueue              │ poll / SSE
                     ┌──────────▼─────────┐   ┌────────▼─────────────┐
                     │  Redis (job queue, │   │ Metadata cache       │
                     │  rate-limit state) │   │ (URL hash → JSON,    │
                     └──────────┬─────────┘   │  15-min TTL)         │
                                │ consume     └────────▲─────────────┘
                     ┌──────────▼──────────────────────┴─────────────┐
                     │  Worker pool (N × Python containers)          │
                     │  · yt-dlp resolver (in-process)               │
                     │  · ffmpeg remux/mux (1080p+ = video+audio)    │
                     │  · stream-through proxy → client              │
                     │  · egress proxy pool (YouTube/Meta only)      │
                     │  · canary test runner (every 6 h)             │
                     │  Writes: only /dev/shm temp, 10-min TTL       │
                     └──────────┬────────────────────────────────────┘
                                │
                     ┌──────────▼─────────┐
                     │ Postgres           │
                     │ jobs · formats ·   │
                     │ blocklist · events │
                     └────────────────────┘
```

### Stack choices & rationale
| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui | Fast to ship, one repo with API routes, easy PWA |
| API | FastAPI (Python 3.12) | yt-dlp is Python — import it natively, no subprocess/JSON plumbing |
| Queue | Redis + ARQ | Lighter than Celery, async-native, same Redis doubles for rate limiting |
| Media | httpx streaming + ffmpeg | Stream CDN → client without buffering to disk; ffmpeg only for mux (1080p+ DASH) and MP3 |
| DB | Postgres | Jobs, blocklist, metrics. Boring and right. |
| Hosting | Hetzner (dedicated or CPX), Docker Compose | Egress is the #1 cost: Hetzner includes 20 TB/mo; AWS egress at ~$0.09/GB would kill the unit economics |
| Front-of-house | Cloudflare (proxy, cache off) | DDoS protection. Keep caching off media to stay clear of their ToS on video proxying |

**Engine note:** wrap yt-dlp behind an internal `ExtractorAdapter` interface from day one, so the engine can be swapped or augmented per-platform (e.g., a custom TypeScript extractor à la cobalt) without touching the API layer.

---

## 6. The hard truth about platforms (feasibility table)

Grounded in the current (2026) landscape:

| Platform | Difficulty | Notes & mitigations |
|---|---|---|
| Reddit, Vimeo, Twitch clips | 🟢 Easy | Stable public endpoints; HLS/DASH handled by yt-dlp |
| TikTok | 🟡 Medium | Generally reliable; requires fresh device signatures occasionally |
| X / Twitter | 🟡 Medium | Guest tokens expire; sometimes needs auth fallback |
| Instagram / Facebook | 🟠 Hard | Public reels/posts workable; Meta aggressively rate-limits datacenter IPs; stories/private = out of scope |
| **YouTube** | 🔴 Hardest | Since 2024–25 YouTube blocks datacenter IPs ("Sign in to confirm you're not a bot"), requires PO tokens, and breaks extractors constantly. The public cobalt.tools instance has been blocked from YouTube since mid-2025 and is still blocked in 2026 — proof that a single shared backend at scale gets flagged first. Any plan that assumes set-and-forget YouTube support is wrong. |

### YouTube strategy — pick one (recommended: B)
- **A. Launch without YouTube.** Cheapest, legally cleanest, but you're not "any social network" on day one and YouTube is the #1 demand.
- **B. YouTube as an "bring your own session" feature.** User pastes link + (optionally) connects their own YouTube cookies via a browser extension or one-time paste. Their session, their IP-reputation profile, stronger legal footing ("user directs us to fetch content they can already access"). Proxy pool used only as fallback for logged-out resolve.
- **C. Fight it with infrastructure.** Rotating residential proxy pool (≈ $1–10/GB) for resolve *and* media streaming for YouTube. Works, but media-over-proxy makes YouTube the most expensive platform per download and is a cost time bomb at scale.

Whatever the choice: **the status page must show YouTube health honestly.** Reliability transparency is part of the brand.

---

## 7. API design

### `POST /api/resolve`
```json
{ "url": "https://vm.tiktok.com/ZMhKjXqLp/" }
```
→ `202 Accepted`
```json
{ "job_id": "res_9f2c81", "status": "queued" }
```
Validation: URL must match the allowlist of supported extractor domains (also our SSRF defense — arbitrary URLs are rejected before any fetch).

### `GET /api/jobs/{job_id}` (poll every 1.5 s, or SSE)
```json
{
  "job_id": "res_9f2c81",
  "status": "done",
  "platform": "tiktok",
  "title": "Sunrise run through Lagos 🌅",
  "author": "@ade.runs",
  "duration_s": 41,
  "thumbnail": "/thumb/res_9f2c81.jpg",
  "expires_at": "2026-09-20T12:20:11Z",
  "formats": [
    { "id": "f_1080", "label": "1080p", "container": "mp4", "kind": "video+audio", "bytes": 24117248, "recommended": true },
    { "id": "f_720",  "label": "720p",  "container": "mp4", "kind": "video+audio", "bytes": 12834816 },
    { "id": "f_mp3",  "label": "Audio", "container": "mp3", "kind": "audio",       "bytes": 987136 }
  ]
}
```
Jobs expire after 15 minutes; results cached by URL hash so repeat pastes are instant.

### `GET /api/download/{job_id}/{format_id}`
Streams the file: `Content-Type: video/mp4`, `Content-Disposition: attachment; filename="…"`, `Content-Length` when known. For 1080p+ YouTube, ffmpeg remuxes video-only + audio tracks to MP4 (fast copy, no re-encode) into `/dev/shm` and streams it out; temp file is deleted on stream end or TTL.

### `GET /api/status/platforms`
Public JSON feeding the status page: per-platform ok/degraded/down + last checked.

---

## 8. Data model (Postgres)

```sql
jobs            (id, url_hash, platform, status, error_code, ip_hash,
                 created_at, completed_at, expires_at)        -- no raw URLs
formats         (id, job_id, label, container, kind, approx_bytes)
download_events (id, job_id, format_id, bytes_sent, completed, created_at)
blocklist       (id, pattern, source /* dmca|manual */, created_at)
users           (id, email, plan, created_at)                  -- v2 only
```

**Custody rule:** raw URLs and titles live only in Redis (15-min TTL) and `/dev/shm`. Postgres stores salted hashes. This is both a privacy stance and a legal one (no stored infringing copies).

---

## 9. Reliability engineering (this is the actual product)

The extractor layer *will* break — weekly. The product is the operational discipline around that:

1. **Canary suite.** Curated list of ~30 sample URLs across all platforms; automated test run every 6 h from worker containers.
2. **Auto-update pipeline.** Nightly: build candidate image with latest yt-dlp → run canary suite → blue/green swap workers if green → auto-rollback if red. Humans only get paged for persistent failures.
3. **Per-platform egress.** Default: direct egress (Hetzner IPs). YouTube/Meta: route through rotating proxy pool, health-scored; drop bad exits automatically.
4. **Status page + alerts.** Canaries publish to `/status`; users subscribe to per-platform updates. Being *the* downloader that tells the truth builds the moat competitors can't copy (they're monetizing confusion).
5. **Graceful degradation.** If 1080p muxing fails, offer 720p progressive. If resolve fails once, retry once via alternate egress before erroring.

---

## 10. Security & abuse

- **SSRF:** URL allowlist (supported platforms' domains only) before any fetch; block private IP ranges.
- **Rate limiting:** Redis token buckets per IP + per URL-hash (stop one viral video from being resolved 10k×).
- **Bot defense:** Cloudflare Turnstile triggered by anomaly (not by default — friction kills "clean").
- **Abuse controls:** per-file caps on free tier (60 min / 2 GB), no bulk mode, no API without key, obvious scrapers get 429s not bans.
- **Filename sanitization** on `Content-Disposition` (header injection).
- **Secrets:** cookie jars (if option B) encrypted at rest, per-user, auto-purged.

---

## 11. Legal & compliance (read before building, not after)

This category carries real, non-theoretical risk. Honest assessment:

1. **Platform ToS.** Downloading is prohibited by the ToS of YouTube, Meta, TikTok, and X. ToS bind *users*; the operator's exposure is indirect (tortious-interference / breach theories) but has been actively tested — the RIAA got youtube-dl removed from GitHub in 2020 (later reinstated), and rights holders continue to pressure similar tooling.
2. **Copyright.** Secondary-liability risk is managed the way safe-harbor-adjacent services manage it:
   - Store nothing (transient streaming only — this matters enormously)
   - Register a DMCA agent (US), honor takedowns within 24 h, blocklist complained URLs
   - Terminate repeat infringers (v2: accounts)
   - **Do not induce:** no marketing copy like "rip any video" — position as a utility for content you own, licensed, or that is freely savable; state this in onboarding and footer
3. **Anti-circumvention (DMCA §1201).** The most aggressive theory (circumventing "technical protection measures"). Mitigations: we only fetch content the platform serves to ordinary browsers; no DRM circumvention ever; consider excluding the most-attacked platform (YouTube) from the public instance initially.
4. **Privacy.** GDPR/NDPR (Nigeria): minimal data, hashed URLs, no third-party trackers (aligns with "clean" positioning). Cookie banner avoided by using no non-essential cookies.
5. **Practical musts:** own ToS + acceptable-use policy; lawyer review before public launch; check hosting AUP (Hetzner is generally fine; some clouds are not); web-only distribution avoids app-store bans.

**Strategic takeaway:** the leanest legal posture is *personal-utility positioning + zero storage + fast takedowns + honest scope*. The riskiest posture is *mass-market "download anything" branding with persistent storage*. Build the first one.

---

## 12. Infrastructure & cost (launch scale)

| Item | Spec | Cost/month |
|---|---|---|
| Hetzner CPX41 (16 vCPU, 32 GB) | API + 4 workers + ffmpeg | ~€45 |
| Hetzner CX22 | Postgres + Redis | ~€8 |
| Bandwidth | Included 20 TB/mo | €0 (then ~€1/TB) |
| Residential proxy (YouTube/Meta only) | ~200 GB | ~$200–400 |
| Cloudflare | Free tier | $0 |
| Sentry + uptime tooling | Free tiers | $0 |
| **Total** | | **≈ $300–500/mo** |

Sustains roughly 100k downloads/mo at ~50 MB average (≈ 5 TB). Break-even math for a $4 Pro tier: ~100–150 Pro users covers infra. **Watch the proxy line:** if YouTube media (not just metadata) must flow through paid proxies, cost per YouTube download is ~$0.05–0.50 — meter it, cap it on free tier.

---

## 13. Roadmap

| Phase | Duration | Exit criteria |
|---|---|---|
| **0. Spike** | 1 week | Run yt-dlp from a Hetzner box against a canary list of 10 platforms. Document what actually works. (This week will change your roadmap — do it first.) |
| **1. MVP** | 3 weeks | Resolve → download working for 8 platforms (YouTube per chosen strategy), clean UI per wireframe, rate limits, zero-persistence verified |
| **2. Reliability** | 2 weeks | Canary suite + auto-update pipeline + public status page + alerting |
| **3. Legal hardening + beta** | 1 week | ToS, DMCA agent, blocklist flow, lawyer review, invite-only beta (500 users) |
| **4. Public launch** | — | Launch on HN/Reddit/X with "no ads, no fake buttons" as the hook |
| **5. v1.1 → v2** | ongoing | History, PWA, extension, Pro tier, API — gated on retention data |

---

## 14. Success metrics

- **Resolve success rate:** ≥ 97% (non-YouTube), ≥ 85% (YouTube) — tracked per platform, shown publicly
- **Latency:** p50 paste→file ≤ 10 s; p95 ≤ 20 s
- **Reliability:** extractor breakage → fix deployed in < 24 h (auto-update makes this achievable)
- **Trust:** D7 retention ≥ 15%; < 1% support complaints about ads/clutter (should be 0 — there are none)
- **Unit economics:** infra cost per successful download ≤ $0.005 (excl. YouTube-proxy downloads)
- **Compliance:** takedown response < 24 h, 100%

---

## 15. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| YouTube blocks our egress IPs at scale | High | High | Strategy B (user sessions), proxy pool, honest status page, self-host kit as escape valve |
| yt-dlp extractor breakage windows | Certain (weekly) | Medium | Auto-update + canaries + rollback; adapter interface for custom extractors |
| Rights-holder legal action | Medium | High | Zero storage, DMCA process, non-inducing positioning, lawyer review, optional YouTube exclusion |
| Bandwidth/proxy cost blowout | Medium | High | Free-tier caps, per-platform cost metering, cheap-egress hosting |
| Free service gets farmed by scrapers | High | Medium | Rate limits, Turnstile on anomaly, no anonymous bulk, API keys |
| Meta/IG requires login for more content | Medium | Medium | Scope to public content; same bring-your-own-session pattern as YouTube if demand justifies |
| Hosting/CDN AUP friction | Low | Medium | Vet AUPs pre-launch; keep media un-cached at CF |

---

## 16. Open decisions

1. **YouTube strategy** — A (skip), B (bring-your-own-session), or C (proxy war)? → *Recommend B, decided after the Phase-0 spike.*
2. **TikTok watermark** — default to the standard watermarked stream, or the no-watermark variant (extra ToS exposure, big user demand)? → *Recommend: offer standard only at launch; revisit with counsel.*
3. **Name/domain + jurisdiction** of the operating entity.
4. **Monetization timing** — launch free-only for trust-building, or Day-1 Pro tier?

---

*Companion file: `wireframe.html` — clickable UI mockup of the target experience.*
