-- PasteFetch D1 schema v1
-- Ephemeral by design: jobs expire after 15 minutes and are pruned by cron.

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,              -- j_<random>
  url_hash      TEXT NOT NULL,                 -- sha256(salt + canonical url)
  platform      TEXT NOT NULL,
  tier          TEXT NOT NULL,                 -- 'native' | 'resolver'
  status        TEXT NOT NULL DEFAULT 'queued',-- queued|processing|done|error
  error_code    TEXT,
  error_detail  TEXT,
  result        TEXT,                          -- JSON payload (formats etc.)
  ip_hash       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_url   ON jobs(url_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_exp   ON jobs(expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,               -- '<action>:ip:<hash>' or ':url:<hash>'
  window_start INTEGER NOT NULL,               -- epoch seconds, fixed window
  count        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_status (
  platform     TEXT PRIMARY KEY,
  status       TEXT NOT NULL,                  -- up|degraded|down|unknown
  detail       TEXT,
  last_checked INTEGER NOT NULL
);
