# Free-Tier Guide — running PasteFetch on $0

**Last updated:** 2026-09-20. Free-plan limits change often — verify against Cloudflare's pricing pages before relying on the numbers here.

This document answers: *"How should this app be tweaked to run a free version on free services?"*

---

## 1. The two hard constraints of "free"

1. **yt-dlp is Python + ffmpeg and needs a real container.** It cannot run on Cloudflare Workers (10 ms CPU, no subprocesses, JS runtime). Any architecture that puts yt-dlp on the edge is fiction.
2. **Free tiers have no bandwidth budget.** Video is heavy. Any design that streams every file through your infrastructure dies the day it gets popular — or worse, gets your account suspended.

**Everything in this repo is shaped by those two facts:**

- **Tiered resolution.** The Worker resolves Tier-1 platforms **natively in TypeScript** (Reddit, Vimeo, Streamable — public JSON endpoints, no backend). Hard platforms go to the **resolver microservice** (yt-dlp + ffmpeg) on a free container host. No resolver deployed? Tier-1 still works, Tier-2 returns an honest "deploy the free resolver add-on" error.
- **Redirect-first downloads.** `/api/download` 302s the browser **directly to the platform CDN** whenever the URL isn't IP-locked. Your infra carries ~zero bytes. Only IP-locked URLs (YouTube's `googlevideo.com`) must stream through the resolver's egress — where the bandwidth is the *container host's* free allowance, not Cloudflare's.

## 2. The free stack

| Component | Service (free tier) | Limit that matters | Why this one |
|---|---|---|---|
| Web app | **Cloudflare Pages** | Unlimited static requests, 500 builds/mo, 20k files | Drag `web/` in, done. Zero build step |
| API | **Cloudflare Workers** | 100k requests/day, 10 ms CPU/req | Our API is I/O-bound (fetch + D1), which is exactly what Workers free is good at |
| State | **Cloudflare D1** | ~5 GB storage, 5M rows read/day, 100k rows written/day | Jobs + rate limits. KV's 1k writes/day is too tight for job tracking; D1's 100k/day is comfortable |
| Bots | **Cloudflare Turnstile** | Free | Invisible checkbox; trigger it only on anomalous traffic |
| Resolver (yt-dlp) | **Hugging Face Space** (CPU basic) or **Koyeb** free instance | Sleeps when idle; shared CPU | Full Docker support (ffmpeg), genuinely free, 1-click deploy from this repo |
| Resolver (better) | **Oracle Cloud Always Free** | 4 ARM cores, 24 GB RAM, 10 TB egress/mo, never sleeps | The single best "free forever" option; needs a card and 30 min of setup |
| CI | **GitHub Actions** | 2k min/mo private, unlimited public repos | Runs typecheck + tests on push |
| Errors | **Sentry** (developer plan) | 5k errors/mo | Worker + web both report here |
| Status page | This repo's `/api/status` + **Better Stack** free | 10 monitors | Canaries already run on a cron — just display them |
| Email (legal/DMCA) | Any free inbox | — | Needed once you run a public instance |

The only thing that genuinely cannot be free forever is a **custom domain** (~$10/yr at Cloudflare Registrar). `*.pages.dev` + `*.workers.dev` subdomains are free and fine to start.

## 3. What changed vs. the paid plan (v1)

| v1 (paid) | v2 (free) | Trade-off accepted |
|---|---|---|
| Hetzner boxes running FastAPI + yt-dlp + ffmpeg | Worker (TS) + tiny resolver microservice on a free container | More moving parts; cold starts on sleeping hosts |
| Stream-through proxy for all downloads | 302-to-CDN first; proxy only when IP-locked | Some platforms may send `Referer`-sensitive CDNs — fallback `?mode=proxy` exists |
| Rotating residential proxy pool for YouTube | BYO-cookies (`YTDLP_COOKIES_FILE`) + honest degradation | YouTube success rate drops; status page shows it truthfully |
| Redis (queue + rate limits) | D1 fixed-window rate limits + lazy job processing on poll | Simpler, no Redis bill; slightly cruder rate limiting |
| Canaries from own infra | Worker cron every 6h → D1 → public `/api/status` | Same promise, zero cost |

## 4. Capacity math on free tiers

- **Workers**: 100k req/day. One resolve ≈ 3–8 requests (resolve + ~4 polls + status). → **~15–25k resolves/day** theoretical.
- **D1 writes**: each resolve ≈ 3–6 rows written (job + result + rate-limit). 100k/day supports ~20k resolves/day. You'd hit Workers' 100k req/day first.
- **D1 reads**: polls dominate; 5M rows/day is far more than needed at this scale.
- **Bandwidth**: ~$0 through Cloudflare because downloads redirect to platform CDNs. Resolver egress only carries YouTube-type traffic — at ~50 MB/download, Oracle's 10 TB/mo ≈ 200k such downloads; HF Space/Koyeb free are far smaller (fine for a personal/hobby instance).
- **Cold starts**: sleeping free containers take 30–60 s to wake. The UI shows "waking the resolver…" for the first request after idle. A Worker cron hitting the resolver `/health` every 5 minutes keeps it warm (honest note: on HF Spaces this is within ToS but check the current policy).

**Realistic free ceiling:** a personal/small-community instance serving hundreds of users a day comfortably. Not a y2mate-scale business — that was never the goal.

## 5. What free cannot fix (expectations, per platform)

| Platform | Expectation on free tiers |
|---|---|
| Reddit, Streamable | ✅ Native extractor, public JSON APIs, excellent reliability |
| Vimeo | 🟡 Native path works for videos that still expose direct MP4s in the player config; many are now HLS-only → hybrid fallback to the resolver (which may need `YTDLP_COOKIES_FILE` — Vimeo's web client often demands login) |
| TikTok | 🟡 Usually works via resolver; occasional signature breakage; datacenter IPs periodically throttled |
| X/Twitter | 🟡 Guest-token flow works most days via yt-dlp |
| Instagram/Facebook | 🟠 Public content only; Meta rate-limits datacenter IPs aggressively |
| **YouTube** | 🔴 The hardest. Datacenter IPs are blocked ("sign in to confirm you're not a bot"), PO tokens required. Mitigations, in order of effectiveness: **(1)** bring-your-own cookies via `YTDLP_COOKIES_FILE`, **(2)** self-host the resolver at home, **(3)** Oracle Always Free (residential-adjacent IP reputation varies). Never promise 100% YouTube uptime — the status page exists precisely for this. |

## 6. Upgrade path (when free stops being enough)

1. **First $5/mo:** Workers Paid (10M req/day, 30 s CPU) — removes request-ceiling anxiety.
2. **First ~$20/mo:** move the resolver to a small VPS (Hetzner CX22) with 20 TB egress — kills cold starts, improves IP reputation vs. shared hosts.
3. **Only if legally advised & demand justifies:** residential proxy pool for YouTube, per the v1 plan.

## 7. Rules for staying free (and within ToS)

- Never cache/serve platform video through the **Cloudflare zone proxy** at volume (CDN ToS §2.8 discourages disproportionate non-HTML content through the proxy). Our design avoids it: Workers redirect or stream modest volumes; heavy streaming happens on the resolver's host.
- Don't run cron loops more aggressive than every 5 minutes.
- Keep D1 writes lean (jobs expire and are pruned by the canary cron).
- Don't attach a paid residential proxy "just to test".
