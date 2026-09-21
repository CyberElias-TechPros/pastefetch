import { describe, expect, it } from "vitest";
import { hmacHex, sanitizeFilename, sha256Hex } from "../src/util";

describe("sanitizeFilename", () => {
  it("removes path traversal and dangerous characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFilename('bad"name\r\n.mp4')).not.toContain('"');
    expect(sanitizeFilename("ok-name (1080p).mp4")).toBe("ok-name (1080p).mp4");
  });
  it("caps length and falls back safely", () => {
    expect(sanitizeFilename("x".repeat(500))).toHaveLength(80);
    expect(sanitizeFilename("///")).toBe("video");
  });
});

describe("crypto helpers", () => {
  it("sha256Hex is deterministic and hex-encoded", async () => {
    const h = await sha256Hex("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("hello")).toBe(h);
    expect(await sha256Hex("world")).not.toBe(h);
  });

  it("hmacHex matches a known RFC 4231-style vector shape and varies per input", async () => {
    const a = await hmacHex("secret", "u\nu2\nt\nfile.mp4\n1700000000");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacHex("secret", "u\nu2\nt\nfile.mp4\n1700000001")).not.toBe(a);
    expect(await hmacHex("other", "u\nu2\nt\nfile.mp4\n1700000000")).not.toBe(a);
  });
});
