export interface Env {
  DB: D1Database;
  /** Base URL of the yt-dlp resolver microservice (unlocks Tier-2 platforms). */
  RESOLVER_URL?: string;
  /** Shared secret with the resolver. */
  RESOLVER_TOKEN?: string;
  /** Comma-separated allowed CORS origins. Default "*" (dev). */
  ALLOWED_ORIGINS?: string;
  /** Salt for hashing IPs/URLs. */
  IP_SALT?: string;
}

/** Format exposed to the client (server-only fields stripped before sending). */
export interface Format {
  id: string;
  label: string;
  container: "mp4" | "mp3" | "m4a" | "webm" | "gif" | "jpg";
  kind: "video" | "audio" | "video+audio" | "image";
  bytes: number | null;
  /** Server-only: direct CDN URL. */
  url?: string;
  /** Server-only: second stream to remux (adaptive video + audio). */
  url2?: string;
  /** Server-only: force routing through the resolver's /stream. */
  proxy?: "resolver" | "none";
  /** Server-only: ffmpeg target (e.g. "mp3"). */
  transcode?: string | null;
}

export interface ResolvePayload {
  platform: string;
  title: string;
  author: string | null;
  duration_s: number | null;
  thumbnail: string | null;
  formats: Format[];
  /** True when CDN URLs are locked to the resolving IP (YouTube). */
  ip_locked?: boolean;
}

export interface JobRow {
  id: string;
  url_hash: string;
  platform: string;
  tier: string;
  status: string;
  error_code: string | null;
  error_detail: string | null;
  result: string | null;
  ip_hash: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}
