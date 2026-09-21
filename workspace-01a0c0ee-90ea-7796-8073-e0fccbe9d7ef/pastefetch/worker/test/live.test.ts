// Live extractor tests — run with:  RUN_LIVE=1 npm test
/**
 * These hit real platforms from this machine. Expect failures when the local
 * IP is rate-limited by a platform (that's the honest-reliability problem the
 * status page exists to surface — not a code bug).
 */
import { describe, expect, it } from "vitest";

const RUN_LIVE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RUN_LIVE === "1";
const d = RUN_LIVE ? describe : describe.skip;

import * as vimeo from "../src/extractors/vimeo";
import * as reddit from "../src/extractors/reddit";
import * as streamable from "../src/extractors/streamable";

d("live extractors", () => {
  it("vimeo responds end-to-end (payload, or an honest HLS-only error)", async () => {
    try {
      const payload = await vimeo.resolve(new URL("https://vimeo.com/76979871"));
      expect(payload.title).toBeTruthy();
      expect(payload.formats.length).toBeGreaterThan(0);
      expect(payload.formats[0]?.url).toMatch(/^https:\/\//);
    } catch (err) {
      // Datacenter IPs / HLS-only videos: the honest failure is an ApiError
      // with a clear code — never a fake success.
      expect((err as { code?: string }).code).toMatch(/no_video_in_post|platform_error/);
    }
  }, 30_000);

  it("reddit resolves a fresh video post end-to-end", async () => {
    const listing = await fetch("https://www.reddit.com/r/aww/hot.json?raw_json=1&limit=50", {
      headers: { "User-Agent": "PasteFetch/0.1 (+live-test)" },
    });
    if (listing.status === 403 || listing.status === 429) {
      console.warn("Reddit rate-limits this IP — skipping (expected on datacenter IPs)");
      return;
    }
    const json = (await listing.json()) as { data: { children: { data: { is_video: boolean; permalink: string } }[] } };
    const post = json.data.children.find((c) => c.data.is_video);
    expect(post).toBeTruthy();
    const payload = await reddit.resolve(new URL("https://www.reddit.com" + post!.data.permalink));
    expect(payload.formats.length).toBeGreaterThan(0);
  }, 30_000);

  it("streamable API is reachable", async () => {
    const res = await fetch("https://api.streamable.com/videos/__canary__", {
      headers: { "User-Agent": "PasteFetch/0.1" },
    });
    expect([200, 404]).toContain(res.status);
  }, 30_000);
});
