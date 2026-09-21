import { ApiError, type ResolvePayload } from "../types";

const UA = "PasteFetch/0.1 (+https://github.com/pastefetch/pastefetch)";

/** Streamable native extractor via the public API. */

export async function resolve(url: URL): Promise<ResolvePayload> {
  const code = url.pathname.split("/").filter(Boolean).pop();
  if (!code) throw new ApiError(400, "unsupported_url", "Could not find a Streamable code in that link");

  const res = await fetch(`https://api.streamable.com/videos/${encodeURIComponent(code)}`, {
    headers: { "User-Agent": UA },
  });
  if (res.status === 404) throw new ApiError(422, "no_video_in_post", "That Streamable video does not exist");
  if (!res.ok) throw new ApiError(502, "platform_error", `Streamable responded ${res.status}`);

  const json = (await res.json()) as unknown;
  return parseStreamable(json);
}

/** Pure parser — unit-tested with fixtures in test/streamable.test.ts. */
export function parseStreamable(json: unknown): ResolvePayload {
  const d = ((json as Record<string, any>)?.data ?? {}) as Record<string, any>;
  const files = (d.files ?? {}) as Record<string, any>;

  const pick = (key: string) => {
    const url = typeof files[key]?.url === "string" ? (files[key].url as string) : null;
    return url ? (url.startsWith("//") ? "https:" + url : url) : null;
  };

  const formats: ResolvePayload["formats"] = [];
  const full = pick("mp4");
  const mobile = pick("mp4-mobile");
  if (full) {
    formats.push({ id: "full", label: `MP4 · ${files["mp4"]?.height ?? ""}p`.replace(" · p", ""), container: "mp4", kind: "video+audio", bytes: null, url: full });
  }
  if (mobile && mobile !== full) {
    formats.push({ id: "mobile", label: `MP4 · ${files["mp4-mobile"]?.height ?? 360}p`, container: "mp4", kind: "video+audio", bytes: null, url: mobile });
  }
  if (!formats.length) throw new ApiError(422, "no_video_in_post", "No downloadable file on this Streamable page");

  function str(v: unknown): string {
    return typeof v === "string" ? v : "";
  }

  return {
    platform: "streamable",
    title: typeof d.title === "string" && d.title ? d.title : "Streamable clip",
    author: typeof d.user?.username === "string" ? `@${d.user.username}` : null,
    duration_s: typeof d.duration === "number" ? d.duration : null,
    thumbnail: str(d.thumbnail_url) || null,
    formats,
  };
}
