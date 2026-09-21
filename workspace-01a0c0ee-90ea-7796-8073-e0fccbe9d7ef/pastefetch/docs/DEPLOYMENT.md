# Deployment — free-tier, step by step

Total time: ~30 minutes. Costs: $0 (a custom domain later is ~$10/yr).

Prereqs: a GitHub account, a Cloudflare account (free), Node 18+, Python 3.11+ for the resolver.

> **Never use a Global API Key.** Deploy with `wrangler login` (browser OAuth — no key ever exposed) or a narrowly-scoped API token. See `SECURITY.md`.

---

## Part 1 — Worker API (Cloudflare Workers + D1)

```bash
cd worker
npm install

# 1. Log in (browser OAuth, no keys)
npx wrangler login

# 2. Create the D1 database
npx wrangler d1 create pastefetch
#    → copy the printed database_id into wrangler.toml (replace the placeholder)

# 3. Apply the schema (remote)
npx wrangler d1 migrations apply pastefetch --remote

# 4. Set secrets (optional for Tier-1 only usage)
npx wrangler secret put IP_SALT          # long random string: openssl rand -hex 32
npx wrangler secret put ALLOWED_ORIGINS  # e.g. https://pastefetch.pages.dev (default *)

# 5. Deploy
npx wrangler deploy
#    → API is live at https://pastefetch.<your-subdomain>.workers.dev
```

Verify: `curl https://pastefetch.<sub>.workers.dev/api/status` returns platform statuses.

## Part 2 — Web app (Cloudflare Pages)

```bash
# Point the app at your worker URL:
#   edit web/config.js → API_BASE = 'https://pastefetch.<sub>.workers.dev'

npx wrangler pages deploy web --project-name pastefetch
# → https://pastefetch.pages.dev
```

(Alternative: single-deploy mode — uncomment the `[assets]` block in `worker/wrangler.toml`, point it at `../web`, keep `API_BASE = ''` in `config.js`, and the Worker serves both site + API on one domain. Static asset requests on Workers are free; check current limits.)

## Part 3 — Resolver (unlocks YouTube, TikTok, Instagram, X, 1,000+ sites)

Pick **one** free host:

### Option A — Hugging Face Space (easiest)
1. Create a Space → **Docker** → blank, name it e.g. `pastefetch-resolver`.
2. Upload the contents of `resolver/` (Space will build the Dockerfile; it installs ffmpeg).
3. Settings → **Secrets**: add `RESOLVER_TOKEN` = long random string (`openssl rand -hex 32`).
4. Your resolver URL: `https://<username>-pastefetch-resolver.hf.space`.

### Option B — Koyeb / Render (free instance)
Same idea: create a Docker service from `resolver/`, set `RESOLVER_TOKEN`, expose the HTTP port. Render free spins down after 15 min idle (first request then takes ~30–60 s — the UI communicates this).

### Option C — Oracle Cloud Always Free (most reliable, never sleeps)
Create an Always Free ARM instance (Ampere A1), install Docker, run:
```bash
docker run -d --restart=always -p 8000:8000 \
  -e RESOLVER_TOKEN=<your-token> \
  -v $HOME/cookies.txt:/app/cookies.txt \
  $(docker build -q .) 
```
Put it behind Cloudflare (orange cloud off for streaming, or a plain subdomain).

### Wire it to the Worker
```bash
cd worker
npx wrangler secret put RESOLVER_URL    # e.g. https://you-pastefetch-resolver.hf.space
npx wrangler secret put RESOLVER_TOKEN  # same value as the resolver's RESOLVER_TOKEN
npx wrangler deploy
```

### YouTube note
If YouTube returns "sign in to confirm you're not a bot": export your own YouTube cookies (a browser extension that exports Netscape-format `cookies.txt`, from an account you don't mind risking — never your main account), mount/pass them as `YTDLP_COOKIES_FILE=/app/cookies.txt`. This also puts you on firmer legal footing (your session, content you can already access). See `docs/PLAN.md` §6.

## Part 4 — Keep-alive & canaries (already in the repo)

- The Worker's cron (`0 */6 * * *`) runs canaries and prunes expired jobs — nothing to do.
- Optional warm-up for a sleeping resolver: add a second cron (`*/5 * * * *`) hitting the resolver `/health` (sample code in `worker/src/scheduled.ts`, commented).

## Part 5 — Hardening for a public instance (checklist)

- [ ] `ALLOWED_ORIGINS` set to your Pages domain (not `*`)
- [ ] Sentry DSNs wired (web `config.js`, worker `logpush`/tunnel or simple fetch hook)
- [ ] Turnstile site key added for anomaly flows (optional at low traffic)
- [ ] `docs/SECURITY.md` compliance checklist read; DMCA contact published
- [ ] Register your domain and add custom domains to Pages + Worker
- [ ] Status page: link `https://<worker>/api/status` from Better Stack or just the UI chips

## Rollback

Workers keep version history: `npx wrangler deployments list` + `rollback`. D1 migrations are additive in this repo; reversing means dropping the created tables (data is ephemeral by design — jobs expire in 15 min).
