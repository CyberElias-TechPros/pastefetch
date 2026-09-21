import type { Env } from "./types";
import { nowSec } from "./util";

/**
 * Atomic fixed-window rate limiter on D1 (single INSERT ... ON CONFLICT).
 * A few writes per request — comfortably inside D1's free daily write budget.
 */
export async function checkRate(
  env: Env,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; count: number; retryAfterSec: number }> {
  const now = nowSec();
  const windowStart = Math.floor(now / windowSec) * windowSec;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(bucket) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start
                    THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`,
  )
    .bind(bucket, windowStart)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return { ok: count <= limit, count, retryAfterSec: windowStart + windowSec - now };
}

export const LIMITS = {
  resolve: { max: 12, windowSec: 600 }, // 12 resolves / 10 min / IP
  download: { max: 60, windowSec: 3600 }, // 60 downloads / hour / IP
} as const;
