import { ApiError, type ResolvePayload } from "../types";

const UA = "PasteFetch/0.1 (+https://github.com/pastefetch/pastefetch)";

/**
 * Reddit native extractor.
 * Public .json endpoints work without auth for most server IPs (Reddit does
 * rate-limit some datacenter ranges — the canary surfaces this as `down`).
 */

export async function resolve(url: URL): Promise<ResolvePayload> {
  let target = url;
  const host = url.hostname.toLowerCase();

  if (host === "v.redd.it" || host === "redd.it" || host.endsWith(".v.redd.it")) {
    const res = await fetch(url.toString(), { redirect: "manual", headers: { "User-Agent": UA } });
    const location = res.headers.get("location");
    if (!location) throw new ApiError(502, "platform_error", "Could not expand v.redd.it link");
    target = new URL(location);
  }

  const jsonUrl = permalinkToJson(target);
  const res = await fetch(jsonUrl.toString(), {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });
  if (res.status === 403 || res.status === 429) {
    throw new ApiError(502, "platform_error", "Reddit is rate-limiting this server's IP right now");
  }
  if (!res.ok) throw new ApiError(502, "platform_error", `Reddit responded ${res.status}`);

  const json = (await res.json()) as unknown;
  return parseReddit(json);
}

function permalinkToJson(u: URL): URL {
  const c = new URL(u.toString());
  c.protocol = "https:";
  c.host = "www.reddit.com";
  c.searchParams.set("raw_json", "1");
  c.pathname = c.pathname.replace(/\/+$/, "") + ".json";
  return c;
}

/** Pure parser — unit-tested with fixtures in test/reddit.test.ts. */
export function parseReddit(json: unknown): ResolvePayload {
  const listing = asArray(json)[0] as { data?: { children?: unknown[] } } | undefined;
  const child = listing?.data?.children?.[0] as { data?: Record<string, unknown> } | undefined;
  let d = child?.data ?? null;

  // crossposts carry their media on the parent
  const crosspost = asArray(d?.crosspost_parent_list)[0] as Record<string, unknown> | undefined;
  if (crosspost && !d?.media && !d?.secure_media) d = { ...crosspost, ...d };

  if (!d || typeof d !== "object") throw new ApiError(422, "no_video_in_post", "No post data found");
  if (d.is_gallery === true) throw new ApiError(422, "no_video_in_post", "This post is an image gallery, not a video");

  const title = str(d.title) || "Reddit video";
  const author = d.author ? `u/${str(d.author)}` : null;
  const subreddit = d.subreddit ? `r/${str(d.subreddit)}` : null;
  const meta = (d.media ?? d.secure_media ?? {}) as Record<string, unknown>;
  const preview = (d.preview ?? {}) as Record<string, unknown>;

  const rv = (meta.reddit_video ?? null) as Record<string, unknown> | null;
  const rvp = (preview.reddit_video_preview ?? null) as Record<string, unknown> | null;
  const videoUrl = str(rv?.fallback_url) || str(rvp?.fallback_url);

  const previewImages = asArray(preview.images);
  const firstImage = previewImages[0] as { source?: { url?: unknown } } | undefined;
  const sourceImage = str(firstImage?.source?.url);
  const thumbnail = str(d.thumbnail).startsWith("http") ? str(d.thumbnail) : sourceImage || null;

  const formats: ResolvePayload["formats"] = [];
  if (videoUrl) {
    formats.push({
      id: "best",
      label: `MP4 · ${rv?.height ?? rvp?.height ?? 720}p`,
      container: "mp4",
      kind: "video+audio",
      bytes: null,
      url: videoUrl.split("?")[0] + "?source=fallback", // fallback_url is already muxed mp4
    });
  }
  // direct media the post links to (mp4/gif links)
  const dest = str(d.url_overridden_by_dest) || str(d.url);
  if (dest && /\.(mp4|gifv?)(\?|$)/i.test(dest) && !formats.length) {
    formats.push({
      id: "best",
      label: "MP4",
      container: dest.endsWith(".gif") || dest.endsWith(".gifv") ? "gif" : "mp4",
      kind: "video",
      bytes: null,
      url: dest.replace(/\.gifv$/, ".mp4"),
    });
  }
  // images last — still useful, but never pretend it's a video
  if (!formats.length && sourceImage) {
    formats.push({ id: "image", label: "Image · full size", container: "jpg", kind: "image", bytes: null, url: sourceImage });
  }
  if (!formats.length) {
    throw new ApiError(422, "no_video_in_post", "This post has no downloadable video");
  }

  return {
    platform: "reddit",
    title,
    author: author ? `${author}${subreddit ? ` · ${subreddit}` : ""}` : subreddit,
    duration_s: num(rv?.duration) ?? num(rvp?.duration),
    thumbnail,
    formats,
  };
}

// ── tiny safe accessors (strict-mode friendly) ───────────────────────────────
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
