import { describe, expect, test } from "bun:test";
import { emitterAlerts, learning, type Place, type Watch } from "./alertRules";

const H = 3_600_000;
const T = 100 * 24 * H;
const settled = { firstRunAt: T - 48 * H, planChange: null };
const place = (lat: number, lng: number, radiusM = 100): Place => ({
  lat,
  lng,
  radiusM,
});
const here = place(12.97, 77.59);
const watch = (o: Partial<Watch> = {}): Watch => ({
  name: "Gate radio",
  rules: { heard: true, moved: true, silent: true },
  critical: false,
  home: null,
  ...o,
});
const run = (o: Partial<Parameters<typeof emitterAlerts>[0]>) =>
  emitterAlerts({
    freqHz: 433.925e6,
    at: T,
    watch: null,
    appeared: true,
    lastLocatedAt: null,
    recentInSpan: false,
    current: here,
    previous: null,
    usual: null,
    learning: settled,
    ...o,
  }).map((a) => [a.type, a.severity]);

describe("New", () => {
  test("fires when an unlisted Emitter appears with nothing in its span located in 7 days", () => {
    expect(run({})).toEqual([["new", "warning"]]);
    expect(run({ recentInSpan: true })).toEqual([]);
    expect(run({ appeared: false })).toEqual([]);
  });
  test("never for a listed Emitter", () =>
    expect(
      run({
        watch: watch({ rules: { heard: false, moved: false, silent: false } }),
      }),
    ).toEqual([]));
  test("quiet while learning: 24 h after the first Run, and for newly covered frequencies", () => {
    expect(run({ learning: { firstRunAt: T - 23 * H, planChange: null } })).toEqual([]);
    const planChange = {
      at: T - H,
      previousSegments: [{ startHz: 400e6, endHz: 430e6 }],
    };
    expect(learning({ firstRunAt: T - 48 * H, planChange }, 433.925e6, T)).toBe(true);
    expect(learning({ firstRunAt: T - 48 * H, planChange }, 410e6, T)).toBe(false);
    expect(run({ learning: { firstRunAt: T - 48 * H, planChange } })).toEqual([]);
  });
});

describe("watched", () => {
  test("Heard when it appears after 30+ min unlocated, critical when the entry is", () => {
    expect(run({ watch: watch(), lastLocatedAt: T - 31 * 60_000 })).toEqual([["heard", "warning"]]);
    expect(run({ watch: watch({ critical: true }), lastLocatedAt: null })).toEqual([
      ["heard", "critical"],
    ]);
    expect(run({ watch: watch(), lastLocatedAt: T - 29 * 60_000 })).toEqual([]);
    expect(run({ watch: watch(), appeared: false, lastLocatedAt: T - 31 * 60_000 })).toEqual([]);
    expect(
      run({
        watch: watch({ rules: { heard: false, moved: true, silent: true } }),
        lastLocatedAt: T - 31 * 60_000,
      }),
    ).toEqual([]);
  });
  test("Moved needs two Scans in a row away from the usual spot", () => {
    const away = place(12.975, 77.59, 50);
    const usual = { lat: 12.97, lng: 77.59 };
    const steady = { appeared: false };
    expect(run({ ...steady, watch: watch(), current: away, previous: away, usual })).toEqual([
      ["moved", "warning"],
    ]);
    expect(run({ ...steady, watch: watch(), current: away, previous: here, usual })).toEqual([]);
    expect(
      run({
        ...steady,
        watch: watch(),
        current: place(12.9705, 77.59, 10),
        previous: away,
        usual,
      }),
    ).toEqual([]);
    // An uncertainty wide enough to include the usual spot isn't evidence of a move.
    expect(
      run({
        ...steady,
        watch: watch(),
        current: place(12.975, 77.59, 900),
        previous: away,
        usual,
      }),
    ).toEqual([]);
  });
});
