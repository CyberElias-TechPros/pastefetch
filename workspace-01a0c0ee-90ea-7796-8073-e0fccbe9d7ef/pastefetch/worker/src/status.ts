import { PLATFORMS } from "./detect";
import type { Env } from "./types";
import { nowSec } from "./util";

export interface PlatformStatusClient {
  id: string;
  name: string;
  tier: "native" | "resolver";
  status: "up" | "degraded" | "down" | "unknown";
  detail: string | null;
  last_checked: number | null;
}

export async function getStatuses(env: Env): Promise<{
  resolver_configured: boolean;
  platforms: PlatformStatusClient[];
}> {
  const result = await env.DB.prepare(`SELECT * FROM platform_status`).all<{
    platform: string;
    status: string;
    detail: string | null;
    last_checked: number;
  }>();
  const byId = new Map(result.results.map((r) => [r.platform, r]));

  return {
    resolver_configured: Boolean(env.RESOLVER_URL),
    platforms: PLATFORMS.map((p) => {
      const row = byId.get(p.id);
      return {
        id: p.id,
        name: p.name,
        tier: p.tier,
        status: (row?.status ?? "unknown") as PlatformStatusClient["status"],
        detail: row?.detail ?? null,
        last_checked: row?.last_checked ?? null,
      };
    }),
  };
}

export async function setStatus(
  env: Env,
  platform: string,
  status: PlatformStatusClient["status"],
  detail: string | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO platform_status (platform, status, detail, last_checked) VALUES (?, ?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET status = excluded.status, detail = excluded.detail, last_checked = excluded.last_checked`,
  )
    .bind(platform, status, detail?.slice(0, 200) ?? null, nowSec())
    .run();
}
