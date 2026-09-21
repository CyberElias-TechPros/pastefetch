import { describe, expect, it } from "vitest";
import { parseStreamable } from "../src/extractors/streamable";

describe("parseStreamable", () => {
  it("extracts full + mobile formats and upgrades protocol-relative URLs", () => {
    const payload = parseStreamable({
      data: {
        title: "Nice clip",
        user: { username: "clipper" },
        duration: 12,
        thumbnail_url: "https://cdn.streamable.com/video/poster/abc.jpg",
        files: {
          mp4: { url: "//cdn.streamable.com/video/mp4/abc.mp4", height: 1080 },
          "mp4-mobile": { url: "https://cdn.streamable.com/video/mp4/abc-mobile.mp4", height: 360 },
        },
      },
    });
    expect(payload.platform).toBe("streamable");
    expect(payload.formats).toHaveLength(2);
    expect(payload.formats[0]?.url).toBe("https://cdn.streamable.com/video/mp4/abc.mp4");
    expect(payload.formats[0]?.label).toBe("MP4 · 1080p");
    expect(payload.formats[1]?.label).toBe("MP4 · 360p");
    expect(payload.thumbnail).toBe("https://cdn.streamable.com/video/poster/abc.jpg");
    expect(payload.duration_s).toBe(12);
  });

  it("throws when there are no files", () => {
    expect(() => parseStreamable({ data: { files: {} } })).toThrowError(/no downloadable/i);
  });
});
