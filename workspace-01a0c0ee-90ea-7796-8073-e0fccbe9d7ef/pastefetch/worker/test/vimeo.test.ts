import { describe, expect, it } from "vitest";
import { parseVimeo } from "../src/extractors/vimeo";

const vimeoConfig = {
  video: {
    title: "The Mountain",
    owner: { name: "Terje Sørgjerd" },
    duration: 187,
    thumbs: { base: "https://i.vimeocdn.com/video/123456789-base", 640: "https://i.vimeocdn.com/video/123456789-d_640" },
  },
  request: {
    files: {
      progressive: [
        { url: "https://vimeo.com/…/720.mp4", mime: "video/mp4", height: 720, width: 1280 },
        { url: "https://vimeo.com/…/1080.mp4", mime: "video/mp4", height: 1080, width: 1920 },
        { url: "https://vimeo.com/…/360.mp4", mime: "video/mp4", height: 360, width: 640 },
        { url: "https://vimeo.com/…/hls.m3u8", mime: "application/vnd.apple.mpegurl", height: 1080 },
      ],
    },
  },
};

describe("parseVimeo", () => {
  it("extracts mp4 formats sorted best-first, ignoring non-mp4", () => {
    const payload = parseVimeo(vimeoConfig);
    expect(payload.platform).toBe("vimeo");
    expect(payload.title).toBe("The Mountain");
    expect(payload.author).toBe("Terje Sørgjerd");
    expect(payload.duration_s).toBe(187);
    expect(payload.formats.map((f) => f.id)).toEqual(["v1080", "v720", "v360"]);
    expect(payload.thumbnail).toContain("-d_640");
  });

  it("throws a friendly error for HLS-only videos", () => {
    const hlsOnly = { video: { title: "X" }, request: { files: { progressive: [] } } };
    expect(() => parseVimeo(hlsOnly)).toThrowError(/HLS-only|direct file/i);
  });
});
