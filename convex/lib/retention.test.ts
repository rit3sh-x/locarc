import { expect, test } from "bun:test";
import { HOUR, thinFixes } from "./retention";

test("unwatched Fixes go; watched Channels keep their best Fix per hour", () => {
  const t0 = 1_000 * HOUR;
  const fixes = [
    { id: "a1", freqHz: 1, at: t0 + 1, uncertaintyM: 300 },
    { id: "a2", freqHz: 1, at: t0 + 2, uncertaintyM: 120 },
    { id: "a3", freqHz: 1, at: t0 + HOUR + 5, uncertaintyM: 900 },
    { id: "b1", freqHz: 2, at: t0 + 3, uncertaintyM: 50 },
  ];
  expect(thinFixes(fixes, new Set([1])).sort()).toEqual(["a1", "b1"]);
  expect(thinFixes(fixes, new Set()).sort()).toEqual(["a1", "a2", "a3", "b1"]);
});
