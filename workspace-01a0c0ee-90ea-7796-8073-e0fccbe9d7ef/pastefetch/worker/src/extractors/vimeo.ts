import { ApiError, type ResolvePayload } from "../types";

const UA = "Mozilla/5.0 (compatible; PasteFetch/0.1; +https://github.com/pastefetch/pastefetch)";

/**
 * Vimeo native extractor via the public player config endpoint.
 * Works for most public, non-DRM, non-HLS-only videos.
 */

export async function resolve(url: URL): Promise<ResolvePayload> {
  const id = url.pathname.match(/(?:video\/)?(\d{6,})/)?.[1];
  if (!id) throw new ApiError(400, "unsupported_url", "Could not find a Vimeo video id in that link");

  const res = await fetch(`https://player.vimeo.com/video/${id}/config`, {
    headers: { "User-Agent": UA, Referer: "https://player.vimeo.com/" },
  });
  if (res.status === 404) throw new ApiError(422, "no_video_in_post", "That Vimeo video does not exist");
  if (!res.ok) throw new ApiError(502, "platform_error", `Vimeo responded ${res.status}`);

  const json = (await res.json()) as unknown;
  return parseVimeo(json);
}

/** Pure parser — unit-tested with fixtures in test/vimeo.test.ts. */
export function parseVimeo(config: unknown): ResolvePayload {
  const c = (config ?? {}) as Record<string, any>;
  const video = (c.video ?? {}) as Record<string, any>;
  const progressive = Array.isArray(c.request?.files?.progressive) ? c.request.files.progressive : [];

  const formats: ResolvePayload["formats"] = progressive
    .filter((f: Record<string, unknown>) => typeof f.url === "string" && f.mime === "video/mp4")
    .sort((a: Record<string, number>, b: Record<string, number>) => (b.height ?? 0) - (a.height ?? 0))
    .map((f: Record<string, any>) => ({
      id: `v${f.height}`,
      label: `MP4 · ${f.height}p`,
      container: "mp4" as const,
      kind: "video+audio" as const,
      bytes: null,
      url: f.url as string,
    }));

  if (!formats.length) {
    throw new ApiError(
      422,
      "no_video_in_post",
      "This video has no direct file (it may be HLS-only, private, or DRM-protected)",
    );
  }

  const thumbs = (video.thumbs ?? {}) as Record<string, string>;
  const thumbnail = Object.keys(thumbs)
    .sort((a, b) => Number(b) - Number(a))
    .map((k) => thumbs[k])
    .find((t) => typeof t === "string") ?? null;

  return {
    platform: "vimeo",
    title: typeof video.title === "string" && video.title ? video.title : "Vimeo video",
    author: typeof video.owner?.name === "string" ? video.owner.name : null,
    duration_s: typeof video.duration === "number" ? video.duration : null,
    thumbnail,
    formats,
  };
}
