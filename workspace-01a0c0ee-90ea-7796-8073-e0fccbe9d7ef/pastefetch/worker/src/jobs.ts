import type { Env, JobRow, ResolvePayload } from "./types";
import { clientFormat, nowSec } from "./util";

export const JOB_TTL_SEC = 900; // 15 minutes — by design, nothing lives longer

export async function createJob(
  env: Env,
  input: { id: string; urlHash: string; platform: string; tier: string; ipHash: string },
): Promise<void> {
  const n = nowSec();
  await env.DB.prepare(
    `INSERT INTO jobs (id, url_hash, platform, tier, status, ip_hash, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
  )
    .bind(input.id, input.urlHash, input.platform, input.tier, input.ipHash, n, n, n + JOB_TTL_SEC)
    .run();
}

export async function getJob(env: Env, id: string): Promise<JobRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first<JobRow>();
  return row ?? null;
}

/** Dedupe: return a recent, non-expired, successful job for the same URL. */
export async function findRecentDoneByHash(env: Env, urlHash: string): Promise<JobRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM jobs WHERE url_hash = ? AND status = 'done' AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(urlHash, nowSec())
    .first<JobRow>();
  return row ?? null;
}

export async function completeJob(env: Env, id: string, result: ResolvePayload): Promise<void> {
  await env.DB.prepare(`UPDATE jobs SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(result), nowSec(), id)
    .run();
}

export async function failJob(env: Env, id: string, code: string, detail: string | null): Promise<void> {
  await env.DB.prepare(`UPDATE jobs SET status = 'error', error_code = ?, error_detail = ?, updated_at = ? WHERE id = ?`)
    .bind(code, detail?.slice(0, 300) ?? null, nowSec(), id)
    .run();
}

export function jobToClient(row: JobRow): {
  job_id: string;
  status: string;
  platform: string;
  error_code?: string | null;
  message?: string | null;
  title?: string;
  author?: string | null;
  duration_s?: number | null;
  thumbnail?: string | null;
  formats?: ReturnType<typeof clientFormat>[];
} {
  const base: Record<string, unknown> = {
    job_id: row.id,
    status: row.status,
    platform: row.platform,
    expires_at: row.expires_at,
  };
  if (row.status === "error") {
    base.error_code = row.error_code;
    base.message = row.error_detail;
    return base as never;
  }
  if (row.status === "done" && row.result) {
    try {
      const payload = JSON.parse(row.result) as ResolvePayload;
      return {
        ...base,
        platform: payload.platform ?? row.platform,
        title: payload.title,
        author: payload.author,
        duration_s: payload.duration_s,
        thumbnail: payload.thumbnail,
        formats: (payload.formats ?? []).map(clientFormat),
      } as never;
    } catch {
      // fall through — corrupt result treated as error
    }
  }
  return base as never;
}
