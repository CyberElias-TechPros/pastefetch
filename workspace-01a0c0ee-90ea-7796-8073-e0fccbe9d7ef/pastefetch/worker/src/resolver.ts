import { ApiError, type Env, type Format, type ResolvePayload } from "./types";
import { hmacHex, nowSec } from "./util";

const RESOLVER_TIMEOUT_MS = 50_000;

/** Call the yt-dlp resolver microservice to resolve a Tier-2 platform URL. */
export async function resolverResolve(env: Env, url: string): Promise<ResolvePayload> {
  if (!env.RESOLVER_URL) {
    throw new ApiError(
      503,
      "resolver_not_configured",
      "This platform needs the free resolver add-on — see docs/DEPLOYMENT.md, Part 3",
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVER_TIMEOUT_MS);
  try {
    const res = await fetch(env.RESOLVER_URL.replace(/\/+$/, "") + "/resolve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESOLVER_TOKEN ?? ""}`,
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new ApiError(502, "resolver_error", "Worker↔resolver token mismatch");
      }
      const code = typeof body.error === "string" && body.error ? body.error : "resolver_error";
      throw new ApiError(res.status === 422 ? 422 : 502, code, String(body.detail ?? "Resolver failed"));
    }
    if (!Array.isArray(body.formats) || body.formats.length === 0) {
      throw new ApiError(422, "no_video_in_post", "No downloadable formats found");
    }
    return body as unknown as ResolvePayload;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error | undefined)?.name === "AbortError") {
      throw new ApiError(504, "resolver_unreachable", "Resolver timed out — it may be waking up from sleep, retry in a minute");
    }
    throw new ApiError(504, "resolver_unreachable", "Could not reach the resolver");
  } finally {
    clearTimeout(timer);
  }
}

/** Build an HMAC-signed, 10-minute /stream URL on the resolver (302 target). */
export async function resolverStreamUrl(env: Env, fmt: Format, filename: string): Promise<string> {
  const base = (env.RESOLVER_URL ?? "").replace(/\/+$/, "");
  const expires = nowSec() + 600;
  const message = [fmt.url ?? "", fmt.url2 ?? "", fmt.transcode ?? "", filename, String(expires)].join("\n");
  const sig = await hmacHex(env.RESOLVER_TOKEN ?? "", message);

  const u = new URL(base + "/stream");
  u.searchParams.set("u", fmt.url ?? "");
  if (fmt.url2) u.searchParams.set("u2", fmt.url2);
  if (fmt.transcode) u.searchParams.set("t", fmt.transcode);
  u.searchParams.set("fn", filename);
  u.searchParams.set("e", String(expires));
  u.searchParams.set("s", sig);
  return u.toString();
}
