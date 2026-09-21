import { ApiError, type Env } from "./types";
import { NATIVE_EXTRACTORS } from "./extractors";
import { PLATFORMS } from "./detect";
import { setStatus } from "./status";
import { nowSec } from "./util";

const UA = "PasteFetch/0.1 (+https://github.com/pastefetch/pastefetch)";

/**
 * Canary suite — runs on the Worker cron (every 6h):
 *   1. prove each native extractor still works end-to-end
 *   2. prove the resolver (if configured) is alive
 *   3. prune expired jobs and stale rate-limit rows
 * Results feed the public /api/status endpoint (honesty is the brand).
 */
export async function runCanaries(env: Env): Promise<void> {
  await Promise.all([canaryVimeo(env), canaryReddit(env), canaryStreamable(env), canaryResolver(env), prune(env)]);
}

async function canaryVimeo(env: Env): Promise<void> {
  try {
    // A stable, classic public video. Many Vimeo videos are HLS-only now —
    // the native path covers those that still expose direct MP4s.
    await NATIVE_EXTRACTORS.vimeo!.resolve(new URL("https://vimeo.com/76979871"));
    await setStatus(env, "vimeo", "up");
  } catch (err) {
    if (err instanceof ApiError && err.code === "no_video_in_post") {
      await setStatus(
        env,
        "vimeo",
        "degraded",
        "canary video is HLS-only — native path limited; resolver (with cookies) recommended",
      );
    } else {
      await setStatus(env, "vimeo", "down", errMsg(err));
    }
  }
}

async function canaryReddit(env: Env): Promise<void> {
  try {
    // Find a fresh video post on r/aww and resolve it — true end-to-end test.
    const res = await fetch("https://www.reddit.com/r/aww/hot.json?raw_json=1&limit=50", {
      headers: { "User-Agent": UA },
    });
    if (res.status === 403 || res.status === 429) {
      await setStatus(env, "reddit", "degraded", "Reddit is rate-limiting this server IP");
      return;
    }
    if (!res.ok) throw new Error(`listing ${res.status}`);
    const json = (await res.json()) as { data?: { children?: { data?: { is_video?: boolean; permalink?: string } }[] } };
    const post = json.data?.children?.find((c) => c.data?.is_video === true && c.data?.permalink);
    if (!post?.data?.permalink) {
      await setStatus(env, "reddit", "up", "reachable (no video sample in listing)");
      return;
    }
    await NATIVE_EXTRACTORS.reddit!.resolve(new URL("https://www.reddit.com" + post.data.permalink));
    await setStatus(env, "reddit", "up");
  } catch (err) {
    await setStatus(env, "reddit", "down", errMsg(err));
  }
}

async function canaryStreamable(env: Env): Promise<void> {
  try {
    // A 404 from the API still proves the API is reachable and sane.
    const res = await fetch("https://api.streamable.com/videos/__canary__", { headers: { "User-Agent": UA } });
    if (res.ok || res.status === 404) await setStatus(env, "streamable", "up");
    else await setStatus(env, "streamable", "degraded", `API responded ${res.status}`);
  } catch (err) {
    await setStatus(env, "streamable", "down", errMsg(err));
  }
}

async function canaryResolver(env: Env): Promise<void> {
  const resolverTier = PLATFORMS.filter((p) => p.tier === "resolver");
  if (!env.RESOLVER_URL) {
    for (const p of resolverTier) await setStatus(env, p.id, "unknown", "resolver not configured");
    return;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(env.RESOLVER_URL.replace(/\/+$/, "") + "/health", { signal: controller.signal });
      if (!res.ok) throw new Error(`health ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; ffmpeg?: boolean };
      const status = body.ffmpeg === false ? "degraded" : "up";
      const detail = body.ffmpeg === false ? "resolver up, ffmpeg missing" : null;
      for (const p of resolverTier) await setStatus(env, p.id, status, detail);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    for (const p of resolverTier) await setStatus(env, p.id, "down", "resolver unreachable");
  }
}

async function prune(env: Env): Promise<void> {
  const now = nowSec();
  await env.DB.prepare(`DELETE FROM jobs WHERE expires_at < ?`).bind(now).run();
  await env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?`).bind(now - 86_400).run();
}

function errMsg(err: unknown): string {
  return String((err as Error | undefined)?.message ?? err).slice(0, 200);
}
