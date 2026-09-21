import { Router } from "./router";
import { ApiError, type Env, type Format, type ResolvePayload } from "./types";
import {
  corsHeaders,
  ipHashOf,
  jsonError,
  jsonOk,
  nowSec,
  randId,
  readJsonBody,
  saltOf,
  sanitizeFilename,
  sha256Hex,
} from "./util";
import { canonicalForHash, detectPlatform, PLATFORMS } from "./detect";
import { completeJob, createJob, failJob, findRecentDoneByHash, getJob, jobToClient } from "./jobs";
import { checkRate, LIMITS } from "./ratelimit";
import { NATIVE_EXTRACTORS } from "./extractors";
import { resolverResolve, resolverStreamUrl } from "./resolver";
import { getStatuses } from "./status";
import { runCanaries } from "./scheduled";

const router = new Router()
  .on("POST", "/api/resolve", resolveHandler)
  .on("GET", "/api/jobs/:id", jobHandler)
  .on("GET", "/api/download/:job/:format", downloadHandler)
  .on("GET", "/api/status", statusHandler);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    }
    try {
      const res = await router.dispatch(req, env, ctx);
      if (res) return res;
      throw new ApiError(404, "not_found", "No such route");
    } catch (err) {
      if (err instanceof ApiError) return jsonError(req, env, err);
      console.error("unhandled error", err);
      return jsonError(req, env, new ApiError(500, "internal_error", "Something went wrong"));
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCanaries(env));
  },
};

// ── POST /api/resolve ─────────────────────────────────────────────────────────
async function resolveHandler(req: Request, _params: Record<string, string>, env: Env): Promise<Response> {
  const body = await readJsonBody(req);
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (!raw) throw new ApiError(400, "invalid_url", "Missing url");

  const detected = detectPlatform(raw);
  if (!detected) {
    const supported = PLATFORMS.map((p) => p.name).join(", ");
    throw new ApiError(400, "unsupported_platform", `Paste a video link from a supported platform: ${supported}`);
  }
  const { platform, url } = detected;

  // rate limit per IP
  const ipHash = await ipHashOf(req, env);
  const rl = await checkRate(env, `resolve:ip:${ipHash}`, LIMITS.resolve.max, LIMITS.resolve.windowSec);
  if (!rl.ok) {
    throw new ApiError(429, "rate_limited", `Rate limit reached — try again in ${rl.retryAfterSec}s`);
  }

  // dedupe: same URL resolved recently → reuse the job (saves writes + platform hits)
  const urlHash = await sha256Hex(saltOf(env) + canonicalForHash(url));
  const existing = await findRecentDoneByHash(env, urlHash);
  if (existing) return jsonOk(req, env, jobToClient(existing), 200);

  const id = randId("j_");
  await createJob(env, { id, urlHash, platform: platform.id, tier: platform.tier, ipHash });

  // resolve inline (native extractors are 1–2 subrequests; the resolver call
  // runs up to 50s — the client shows a progress state while it waits)
  try {
    let payload: ResolvePayload;
    if (platform.tier === "native") {
      try {
        payload = await nativeResolve(platform.id, url);
      } catch (nativeErr) {
        // Hybrid fallback: native extractors cover the easy cases; when the
        // platform serves HLS-only / auth-walled variants, yt-dlp on the
        // resolver can often still resolve it (with cookies if configured).
        const recoverable =
          nativeErr instanceof ApiError &&
          (nativeErr.code === "no_video_in_post" || nativeErr.code === "platform_error");
        if (env.RESOLVER_URL && recoverable) {
          payload = await resolverResolve(env, url.toString());
        } else {
          throw nativeErr;
        }
      }
    } else {
      payload = await resolverResolve(env, url.toString());
    }
    await completeJob(env, id, payload);
  } catch (err) {
    const apiErr =
      err instanceof ApiError
        ? err
        : new ApiError(502, "platform_error", String((err as Error | undefined)?.message ?? err).slice(0, 200));
    await failJob(env, id, apiErr.code, apiErr.message);
  }

  const job = await getJob(env, id);
  return jsonOk(req, env, job ? jobToClient(job) : { job_id: id, status: "queued" }, 202);
}

async function nativeResolve(platformId: string, url: URL): Promise<ResolvePayload> {
  const extractor = NATIVE_EXTRACTORS[platformId];
  if (!extractor) throw new ApiError(500, "internal_error", `No native extractor for ${platformId}`);
  return extractor.resolve(url);
}

// ── GET /api/jobs/:id ─────────────────────────────────────────────────────────
async function jobHandler(req: Request, params: Record<string, string>, env: Env): Promise<Response> {
  const job = await getJob(env, params.id ?? "");
  if (!job) throw new ApiError(404, "not_found", "No such job");
  if (job.expires_at < nowSec()) throw new ApiError(410, "gone", "This job expired — resolve the link again");
  return jsonOk(req, env, jobToClient(job));
}

// ── GET /api/download/:job/:format ────────────────────────────────────────────
async function downloadHandler(req: Request, params: Record<string, string>, env: Env): Promise<Response> {
  const job = await getJob(env, params.job ?? "");
  if (!job) throw new ApiError(404, "not_found", "No such job");
  if (job.expires_at < nowSec()) throw new ApiError(410, "gone", "This job expired — resolve the link again");
  if (job.status !== "done" || !job.result) {
    throw new ApiError(409, "not_ready", `Job is ${job.status}`);
  }

  const payload = JSON.parse(job.result) as ResolvePayload;
  const fmt = payload.formats.find((f) => f.id === (params.format ?? ""));
  if (!fmt?.url) throw new ApiError(404, "unknown_format", "No such format for this job");

  const ipHash = await ipHashOf(req, env);
  const rl = await checkRate(env, `dl:ip:${ipHash}`, LIMITS.download.max, LIMITS.download.windowSec);
  if (!rl.ok) throw new ApiError(429, "rate_limited", `Too many downloads — try again in ${rl.retryAfterSec}s`);

  const filename = `${sanitizeFilename(payload.title || "pastefetch")}.${containerExt(fmt)}`;
  const mode = new URL(req.url).searchParams.get("mode") ?? "auto";

  // IP-locked CDNs (YouTube), remux jobs, and transcodes must stream through
  // the resolver's egress with attachment headers.
  const needsResolver = payload.ip_locked === true || fmt.proxy === "resolver" || Boolean(fmt.url2) || Boolean(fmt.transcode);
  if (needsResolver && env.RESOLVER_URL) {
    const streamUrl = await resolverStreamUrl(env, fmt, filename);
    return Response.redirect(streamUrl, 302);
  }

  if (mode === "proxy") return proxyStream(fmt, filename);

  // default: send the browser straight to the platform CDN (zero our bandwidth)
  return Response.redirect(fmt.url, 302);
}

async function proxyStream(fmt: Format, filename: string): Promise<Response> {
  const upstream = await fetch(fmt.url as string, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PasteFetch/0.1)" },
  });
  if (!upstream.ok || !upstream.body) {
    throw new ApiError(502, "platform_error", `CDN responded ${upstream.status}`);
  }
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "Content-Disposition": contentDisposition(filename),
    "Cache-Control": "no-store",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  return new Response(upstream.body, { status: 200, headers });
}

function containerExt(fmt: Format): string {
  return { mp4: "mp4", mp3: "mp3", m4a: "m4a", webm: "webm", gif: "gif", jpg: "jpg" }[fmt.container] ?? "mp4";
}

function contentDisposition(filename: string): string {
  // RFC 5987: ASCII fallback + UTF-8 form
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// ── GET /api/status ───────────────────────────────────────────────────────────
async function statusHandler(req: Request, _params: Record<string, string>, env: Env): Promise<Response> {
  return jsonOk(req, env, await getStatuses(env));
}
