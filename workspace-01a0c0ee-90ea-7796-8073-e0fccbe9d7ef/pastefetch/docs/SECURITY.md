# Security & Responsible Operation

## ⚠️ Credential hygiene (read first)

- **Never use a Cloudflare Global API Key.** It grants unrestricted account access and cannot be scoped. If you have ever pasted one anywhere (chat, ticket, commit), **rotate it immediately**: dash.cloudflare.com → My Profile → API Tokens → *Global API Key* → Change.
- Prefer **`wrangler login`** (browser OAuth, no secret handled by you) or, for CI, a scoped **API Token** with only `Workers Scripts:Edit` + `D1:Edit` on one account.
- The same rule applies to GitHub PATs, npm tokens, and resolver tokens: scoped, short-lived, never in chat or commits.
- This repo's `.gitignore` blocks `.dev.vars`, `.env*`, `cookies.txt`, `*.pem`. Keep it that way.

## Threat model (what we defend against)

| Threat | Defense |
|---|---|
| SSRF via the resolve endpoint | Strict allowlist: URLs must match a supported platform's hostname before any fetch; private/loopback IPs unreachable by design (fetch only happens against the matched public host) |
| Abusive volume / free-tier exhaustion | D1 fixed-window rate limits (12 resolves/10 min/IP, 60 downloads/h/IP), URL-hash dedupe cache, job TTL of 15 min, D1 writes kept minimal |
| Leeching (third parties hotlinking our download endpoint) | Downloads require a valid, unexpired job id; jobs are single-IP-ish (rate-limited) and expire |
| Forged resolver calls | Bearer shared secret + HMAC-signed, 10-min-expiry stream URLs |
| Header/filename injection | Filenames sanitized (length, path chars, control chars); `filename*` RFC 5987 encoding |
| XSS from platform metadata | All titles/authors rendered via `textContent` in the web app — never `innerHTML` |
| Token/secret leakage in logs | Logs store URL hashes only, never raw URLs, titles, or IPs (salted SHA-256) |

## Privacy posture

- No accounts, no trackers, no third-party scripts in `web/` (system fonts, zero external requests).
- Nothing is persisted: metadata lives in D1 for 15 minutes (pruned by cron); media only ever streams through memory (`/dev/shm` temp on the resolver, deleted on stream end).
- GDPR/NDPR-friendly by construction: nothing to disclose because nothing is kept.

## Responsible-operation checklist for a public instance

1. Publish Terms of Use requiring users to download only content they own, license, or may lawfully save.
2. Register a DMCA agent (US ~$6/yr) if US-facing; publish a takedown email; honor within 24 h.
3. Maintain a blocklist (URL-pattern table in the plan; add a D1 table + admin route when needed).
4. Do not market the service as infringing-content tooling — "clean utility for links you're allowed to save".
5. Read `docs/PLAN.md` §11 (legal landscape) and get counsel before scaling beyond a hobby project.
6. Keep the status page honest. If a platform blocks us, say so publicly — it's the brand.

## Known accepted risks (documented, not hidden)

- Tier-2 platforms' CDNs sometimes reject browser redirects (`Referer` checks). Fallback: `?mode=proxy`.
- The Worker `?mode=proxy` streams platform video through Cloudflare; at hobby scale this is fine, but keep volumes modest and prefer redirects (see FREE-TIER-GUIDE §7).
- A shared `RESOLVER_TOKEN` between Worker and resolver is symmetric-auth MVP pragmatism; rotate it and (if you grow) switch to per-request signing keys.
