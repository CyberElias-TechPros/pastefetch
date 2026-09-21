import { describe, expect, it } from "vitest";
import { parseReddit } from "../src/extractors/reddit";

function redditListing(data: Record<string, unknown>) {
  return [{ data: { children: [{ kind: "t3", data }] } }, { data: { children: [] } }];
}

describe("parseReddit", () => {
  it("extracts a native reddit video post", () => {
    const payload = parseReddit(
      redditListing({
        title: "Good dog waits patiently",
        author: "doglover",
        subreddit: "aww",
        is_video: true,
        thumbnail: "https://a.thumbs.redditmedia.com/abc.jpg",
        media: {
          reddit_video: {
            fallback_url: "https://v.redd.it/abc123/DASH_720.mp4?source=fallback",
            duration: 41,
            height: 720,
            width: 1280,
          },
        },
        preview: { images: [{ source: { url: "https://preview.redd.it/abc.jpg" } }] },
      }),
    );
    expect(payload.platform).toBe("reddit");
    expect(payload.title).toBe("Good dog waits patiently");
    expect(payload.author).toBe("u/doglover · r/aww");
    expect(payload.duration_s).toBe(41);
    expect(payload.formats).toHaveLength(1);
    expect(payload.formats[0]?.label).toBe("MP4 · 720p");
    expect(payload.formats[0]?.url).toContain("v.redd.it/abc123/DASH_720.mp4");
  });

  it("uses crosspost parent media when present", () => {
    const payload = parseReddit(
      redditListing({
        title: "Repost of a classic",
        author: "reposter",
        subreddit: "videos",
        crosspost_parent_list: [
          {
            title: "Original",
            media: { reddit_video: { fallback_url: "https://v.redd.it/orig/DASH_720.mp4", duration: 10, height: 720 } },
          },
        ],
      }),
    );
    expect(payload.formats[0]?.url).toContain("v.redd.it/orig");
  });

  it("uses preview video when main media is missing (gif posts)", () => {
    const payload = parseReddit(
      redditListing({
        title: "Cool gif",
        author: "gifposter",
        is_video: false,
        preview: {
          reddit_video_preview: { fallback_url: "https://v.redd.it/gif123/DASH_480.mp4", duration: 5, height: 480 },
          images: [],
        },
      }),
    );
    expect(payload.formats[0]?.label).toBe("MP4 · 480p");
  });

  it("throws a friendly error for image galleries", () => {
    expect(() =>
      parseReddit(redditListing({ title: "Gallery", author: "a", is_gallery: true })),
    ).toThrowError(/gallery/i);
  });

  it("throws a friendly error when there is no video", () => {
    expect(() => parseReddit(redditListing({ title: "Text post", author: "a" }))).toThrowError(/no downloadable video/i);
  });
});
