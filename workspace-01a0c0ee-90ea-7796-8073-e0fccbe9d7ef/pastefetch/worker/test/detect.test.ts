import { describe, expect, it } from "vitest";
import { canonicalForHash, detectPlatform } from "../src/detect";

describe("detectPlatform", () => {
  const cases: Array<[string, string]> = [
    ["https://www.reddit.com/r/aww/comments/abc123/good_dog/", "reddit"],
    ["https://v.redd.it/abc123", "reddit"],
    ["https://old.reddit.com/r/videos/comments/xyz/", "reddit"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://music.youtube.com/watch?v=x", "youtube"],
    ["https://www.tiktok.com/@user/video/7301234567890123456", "tiktok"],
    ["https://vm.tiktok.com/ZMhKjXqLp/", "tiktok"],
    ["https://www.instagram.com/reel/CxYzAbCdEfG/", "instagram"],
    ["https://x.com/user/status/1234567890", "x"],
    ["https://twitter.com/user/status/1234567890", "x"],
    ["https://www.facebook.com/watch/?v=123", "facebook"],
    ["https://fb.watch/abc123/", "facebook"],
    ["https://vimeo.com/76979871", "vimeo"],
    ["https://player.vimeo.com/video/76979871", "vimeo"],
    ["https://streamable.com/moo", "streamable"],
    ["https://clips.twitch.tv/FunnyClip", "twitch"],
    ["https://www.twitch.tv/videos/123456789", "twitch"],
    ["https://soundcloud.com/artist/track", "soundcloud"],
    ["https://dai.ly/x8abcde", "dailymotion"],
  ];

  for (const [url, expected] of cases) {
    it(`detects ${url} → ${expected}`, () => {
      const detected = detectPlatform(url);
      expect(detected?.platform.id).toBe(expected);
    });
  }

  const rejects = [
    "not a url",
    "ftp://example.com/video",
    "https://evil.com/reddit.com/steal",
    "https://reddit.com.evil.com/post",
    "",
    "https://someunknownplatform.com/watch?v=1",
  ];
  for (const url of rejects) {
    it(`rejects "${url}"`, () => {
      expect(detectPlatform(url)).toBeNull();
    });
  }
});

describe("canonicalForHash", () => {
  it("strips tracking params and fragments", () => {
    const a = canonicalForHash(new URL("https://youtu.be/abc?utm_source=share&si=XYZ&t=30#top"));
    const b = canonicalForHash(new URL("https://youtu.be/abc?t=30"));
    expect(a).toBe(b);
  });
  it("keeps meaningful params", () => {
    expect(canonicalForHash(new URL("https://youtube.com/watch?v=abc&list=xyz"))).toContain("list=xyz");
  });
});
