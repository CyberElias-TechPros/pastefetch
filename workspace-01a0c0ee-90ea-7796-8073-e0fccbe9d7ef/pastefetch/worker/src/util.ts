import { ApiError, type Env, type Format } from "./types";

const enc = new TextEncoder();

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return hex(digest);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function randId(prefix: string): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w\s.\-()]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned.length ? cleaned : "video";
}

export function saltOf(env: Env): string {
  return env.IP_SALT || "dev-insecure-salt";
}

export async function ipHashOf(req: Request, env: Env): Promise<string> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
  return sha256Hex(saltOf(env) + ":" + ip);
}

/** CORS headers honoring ALLOWED_ORIGINS (default: *). */
export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = allowed.includes("*") || (origin && allowed.includes(origin));
  return {
    ...(ok ? { "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : origin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function jsonOk(req: Request, env: Env, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req, env) },
  });
}

export function jsonError(req: Request, env: Env, err: ApiError): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(req, env),
  };
  if (err.status === 429) headers["Retry-After"] = "60";
  return new Response(JSON.stringify({ error: err.code, message: err.message }), { status: err.status, headers });
}

/** Strip server-only fields before sending a format to the client. */
export function clientFormat(f: Format): Omit<Format, "url" | "url2" | "proxy" | "transcode"> {
  const { url: _u, url2: _u2, proxy: _p, transcode: _t, ...rest } = f;
  return rest;
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new ApiError(400, "invalid_json", "Body must be JSON");
  }
}
