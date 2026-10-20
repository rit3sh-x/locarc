import { describe, expect, test } from "bun:test";
import {
  ORG_CONFIG_DEFAULTS as D,
  describeOrgConfig,
  orgConfigDiff,
  receiverConfigDefaults,
  SWEEP_PRESETS,
  startsNewRun,
  validateOrgConfig,
} from "./config";
import { projectMonth } from "./usage";

describe("validation", () => {
  test.each([
    ["defaults", D, null],
    ["segment upside down", { ...D, segments: [{ startHz: 440e6, endHz: 400e6 }] }, "BAND_INVALID"],
    [
      "segment above 6 GHz",
      { ...D, segments: [{ startHz: 5900e6, endHz: 6100e6 }] },
      "BAND_INVALID",
    ],
    [
      "custom n too high",
      { ...D, environment: { preset: "custom" as const, n: 6.5 } },
      "VALUE_OUT_OF_RANGE",
    ],
    [
      "the full span fits a 1-min burst (one pass is under a second)",
      {
        ...D,
        segments: [{ startHz: 1e6, endHz: 6000e6 }],
        cadence: {
          kind: "oneMinute" as const,
          hours: 1 as const,
          revertMinutes: 5 as const,
        },
      },
      null,
    ],
  ])("%s", (_, c, code) => expect<string | null>(validateOrgConfig(c)?.code ?? null).toBe(code));
});

test("defaults: bug bands every 15 min; LNA 32, VGA 30, amp off", () => {
  expect(describeOrgConfig(D).sweepPlan).toBe("Bug bands · 8 segments · 1,090 MHz");
  expect(describeOrgConfig(D).cadence).toBe("every 15 min");
  expect(receiverConfigDefaults("Gate 2")).toMatchObject({
    lnaDb: 32,
    vgaDb: 30,
    amp: false,
  });
});

test("diff lines and what ends a Run", () => {
  const b = {
    ...D,
    segments: [{ startHz: 400e6, endHz: 450e6 }],
    environment: { preset: "open" as const, n: 2.2 },
  };
  expect(orgConfigDiff(D, b)).toEqual([
    "Sweep plan: Bug bands · 8 segments · 1,090 MHz → 400–450 MHz",
    "Propagation environment: Urban (n 3.5) → Open (n 2.2)",
  ]);
  expect(orgConfigDiff(D, { ...D, segments: [{ startHz: 1e6, endHz: 6000e6 }] })).toEqual([
    "Sweep plan: Bug bands · 8 segments · 1,090 MHz → Full 1 MHz–6 GHz",
  ]);
  expect(startsNewRun(D, b)).toBe(true);
  expect(
    startsNewRun(D, {
      ...D,
      environment: b.environment,
      referenceHz: 433.92e6,
    }),
  ).toBe(false);
  expect(describeOrgConfig({ ...D, referenceHz: 433.92e6 }).reference).toBe("433.92 MHz");
});

describe("usage projection: the Convex spec's budget anchors", () => {
  const base = {
    now: 0,
    burstEndsAt: null,
    segments: [...SWEEP_PRESETS.bugBands.segments],
    receivers: 5,
    emitters: 200,
  };
  test("bug bands at the 15-minute default: ~0.3 GB I/O, ~90 MB stored, ~50k calls", () => {
    const u = projectMonth({
      ...base,
      cadence: { kind: "steady", minutes: 15 },
    });
    expect(u.calls / 1000).toBeGreaterThan(40);
    expect(u.calls / 1000).toBeLessThan(60);
    expect(u.ioBytes / 1e9).toBeGreaterThan(0.25);
    expect(u.ioBytes / 1e9).toBeLessThan(0.4);
    expect(u.storageBytes / 1e6).toBeGreaterThan(65);
    expect(u.storageBytes / 1e6).toBeLessThan(115);
    expect(u.warn).toBe(false);
  });
  test("5 minutes: ~0.9 GB, and the meter warns", () => {
    const u = projectMonth({
      ...base,
      cadence: { kind: "steady", minutes: 5 },
    });
    expect(u.ioBytes / 1e9).toBeGreaterThan(0.75);
    expect(u.ioBytes / 1e9).toBeLessThan(1.05);
    expect(u.calls / 1000).toBeGreaterThan(130);
    expect(u.calls / 1000).toBeLessThan(170);
    expect(u.warn).toBe(true);
  });
  test("a 4 h 1-min burst costs little; 1-min all month would blow the I/O limit", () => {
    const steady = projectMonth({
      ...base,
      cadence: { kind: "steady", minutes: 15 },
    });
    const burst = projectMonth({
      ...base,
      cadence: { kind: "oneMinute", hours: 4, revertMinutes: 15 },
      burstEndsAt: 4 * 3_600_000,
    });
    expect(burst.ioBytes - steady.ioBytes).toBeLessThan(30e6);
    expect(burst.calls).toBeGreaterThan(steady.calls);
    const allMonth = projectMonth({
      ...base,
      cadence: { kind: "oneMinute", hours: 4, revertMinutes: 15 },
      burstEndsAt: 30 * 86_400_000,
    });
    expect(allMonth.pct.io).toBeGreaterThan(2);
  });
  test("before any Scan, Emitters are estimated from the plan's width", () => {
    const guess = projectMonth({
      ...base,
      emitters: null,
      cadence: { kind: "steady", minutes: 15 },
    });
    const known = projectMonth({
      ...base,
      cadence: { kind: "steady", minutes: 15 },
    });
    expect(Math.abs(guess.ioBytes / known.ioBytes - 1)).toBeLessThan(0.05);
  });
  test("stopped: idle heartbeats only", () => {
    const u = projectMonth({ ...base, cadence: null });
    expect(u.calls).toBeLessThan(100_000);
    expect(u.warn).toBe(false);
  });
});
