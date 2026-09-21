export interface PlatformDef {
  id: string;
  name: string;
  tier: "native" | "resolver";
  hosts: string[];
}

/**
 * Platform registry. Tier "native" = resolved by TypeScript extractors inside
 * the Worker (public JSON endpoints, no backend needed). Tier "resolver" =
 * delegated to the yt-dlp microservice when RESOLVER_URL is configured.
 *
 * SECURITY: resolve() only ever fetches URLs whose hostname matches this
 * allowlist — this is also our SSRF defense. Unknown hosts are rejected.
 */
export const PLATFORMS: PlatformDef[] = [
  { id: "reddit", name: "Reddit", tier: "native", hosts: ["reddit.com", "v.redd.it", "redd.it"] },
  { id: "vimeo", name: "Vimeo", tier: "native", hosts: ["vimeo.com", "player.vimeo.com"] },
  { id: "streamable", name: "Streamable", tier: "native", hosts: ["streamable.com"] },
  { id: "youtube", name: "YouTube", tier: "resolver", hosts: ["youtube.com", "youtu.be", "music.youtube.com"] },
  { id: "tiktok", name: "TikTok", tier: "resolver", hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"] },
  { id: "instagram", name: "Instagram", tier: "resolver", hosts: ["instagram.com", "instagr.am"] },
  { id: "x", name: "X / Twitter", tier: "resolver", hosts: ["x.com", "twitter.com", "t.co"] },
  { id: "facebook", name: "Facebook", tier: "resolver", hosts: ["facebook.com", "fb.watch", "fb.com"] },
  { id: "twitch", name: "Twitch", tier: "resolver", hosts: ["twitch.tv", "clips.twitch.tv"] },
  { id: "dailymotion", name: "Dailymotion", tier: "resolver", hosts: ["dailymotion.com", "dai.ly"] },
  { id: "soundcloud", name: "SoundCloud", tier: "resolver", hosts: ["soundcloud.com"] },
];

export interface Detected {
  platform: PlatformDef;
  url: URL;
}

export function detectPlatform(rawUrl: string): Detected | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  for (const platform of PLATFORMS) {
    const hit = platform.hosts.some((h) => host === h || host.endsWith("." + h));
    if (hit) return { platform, url };
  }
  return null;
}

/** Canonicalize a URL for hashing: drop trackers, fragment, and trailing noise. */
export function canonicalForHash(url: URL): string {
  const c = new URL(url.toString());
  for (const key of [...c.searchParams.keys()]) {
    if (/^(utm_|fbclid|igsh|igshid|si$|feature$)/i.test(key)) c.searchParams.delete(key);
  }
  c.hash = "";
  return c.toString();
}
