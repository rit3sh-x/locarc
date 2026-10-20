import { describe, expect, test } from "bun:test";
import { fingerprint, normalizeMessage, redact, sampleStack, topFrame } from "./errorFingerprint";

describe("redaction", () => {
  test.each([
    ["an email", "No Operator ops@example.org found", "No Operator <email> found"],
    ["a password field", 'body {"password":"hunter22"}', 'body {"password":"<redacted>"}'],
    [
      "a bearer token",
      "Authorization: Bearer abc.def-ghi",
      "Authorization: <redacted> abc.def-ghi",
    ],
    ["a JWT", "token eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl", "token <jwt>"],
    [
      "a URL query",
      "GET https://x.convex.site/api/auth/reset?token=abc&x=1 failed",
      "GET https://x.convex.site/api/auth/reset?<query> failed",
    ],
    [
      "a long secret-looking string",
      "secret abcdefghijklmnopqrstuvwxyz012345 leaked",
      "secret <token> leaked",
    ],
  ])("%s", (_, input, out) => expect(redact(input)).toBe(out));
});

describe("fingerprints", () => {
  const stackA =
    "TypeError: x is undefined\n    at decode (http://localhost:5180/src/lib/codec.ts?t=123:42:17)\n    at render (app.tsx:9:3)";
  const stackB =
    "TypeError: x is undefined\n    at decode (http://localhost:5180/src/lib/codec.ts?t=999:43:2)\n    at render (app.tsx:9:3)";
  test("group the same bug across ids, numbers and line shifts", () => {
    const a = fingerprint({
      source: "web",
      kind: "TypeError",
      message: "Reading 7f3a9c01de has 12 steps",
      stack: stackA,
    });
    const b = fingerprint({
      source: "web",
      kind: "TypeError",
      message: "Reading 0b12cc44aa has 9 steps",
      stack: stackB,
    });
    expect(a).toBe(b);
  });
  test("separate different sources, kinds and places", () => {
    const base = {
      source: "web" as const,
      kind: "TypeError",
      message: "boom",
      stack: stackA,
    };
    const fp = fingerprint(base);
    expect(fingerprint({ ...base, source: "android" })).not.toBe(fp);
    expect(fingerprint({ ...base, kind: "RangeError" })).not.toBe(fp);
    expect(fingerprint({ ...base, stack: "Error\n    at other (x.ts:1:1)" })).not.toBe(fp);
  });
  test("top frame and normalized message", () => {
    expect(topFrame(stackA)).toBe("decode (http://localhost:5180/src/lib/codec.ts");
    expect(normalizeMessage("Scan 12 failed after 3.5 s for ab12cd34ef56")).toBe(
      "Scan # failed after # s for #",
    );
    expect(sampleStack("    at frame (file.ts:1:1)\n".repeat(300)).length).toBe(4096);
  });
});
