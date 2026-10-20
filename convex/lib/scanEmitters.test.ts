import { describe, expect, test } from "bun:test";
import type { BoardItem } from "./boardCodec";
import { SWEEP_PRESETS } from "./config";
import type { EmitterRecord } from "./readingCodec";
import {
  buildEmitters,
  groupRecords,
  nameOf,
  nextBoard,
  occupancyClass,
  type ReadingInput,
  storeKind,
} from "./scanEmitters";

const R = 12_500;
const T0 = Date.parse("2026-10-19T12:00:00Z");
const plan = { segments: [...SWEEP_PRESETS.bugBands.segments], rasterHz: R };

const rec = (
  firstCh: number,
  widthCh: number,
  power: number | null,
  o: Partial<EmitterRecord> = {},
) => ({
  firstCh,
  widthCh,
  strongestCh: firstCh + Math.floor(widthCh / 2),
  fixPowerDbm: power,
  peakDbm: (power ?? -80) + 3,
  passesOn: 1000,
  clippedFix: false,
  clippedLater: false,
  ...o,
});

const reading = (
  i: number,
  emitters: EmitterRecord[],
  o: Partial<ReadingInput> = {},
): ReadingInput => ({
  receiver: `r${i}`,
  name: `R${i}`,
  unaligned: false,
  payload: { slices: [], emitters },
  passes: 1000,
  fixPasses: 66,
  start: {
    lat: 12.97 + i * 0.005,
    lng: 77.59 + (i % 2) * 0.008,
    accuracyM: 5,
    at: T0,
  },
  end: null,
  pin: null,
  moved: false,
  ...o,
});

describe("grouping, strongest first", () => {
  test("two narrow neighbours stay apart; a fragmented wide signal stays whole", () => {
    const groups = groupRecords([
      reading(0, [rec(100, 1, -60), rec(103, 1, -62), rec(1000, 400, -50)]),
      reading(1, [rec(100, 1, -70), rec(103, 1, -66), rec(1100, 120, -65), rec(1300, 50, -67)]),
    ]);
    const shape = groups.map((g) => g.map((r) => `${r.reading}:${r.firstCh}`));
    expect(shape).toEqual([
      ["0:1000", "1:1100"],
      ["0:100", "1:100"],
      ["0:103", "1:103"],
      ["1:1300"],
    ]);
  });

  test("members must cover the anchor's strongest Channel, so groups don't chain", () => {
    // R1's record overlaps R0's but misses its strongest Channel; R2 overlaps only R1's.
    const groups = groupRecords([
      reading(0, [rec(100, 10, -50)]),
      reading(1, [rec(108, 10, -60)]),
      reading(2, [rec(116, 10, -70)]),
    ]);
    expect(groups.map((g) => g.length)).toEqual([1, 1, 1]);
  });

  test("records heard only after the Fix window anchor last", () => {
    const groups = groupRecords([
      reading(0, [rec(500, 1, null, { peakDbm: -20 }), rec(100, 1, -90)]),
    ]);
    expect(groups.map((g) => g[0]?.firstCh)).toEqual([100, 500]);
  });
});

describe("naming", () => {
  const span = { lowHz: 2427e6, highHz: 2447e6, strongestHz: 2439e6 };
  test("a Watchlist frequency inside the span wins, closest to the strongest Channel", () => {
    expect(
      nameOf(
        span,
        {
          watch: [2430e6, 2437e6, 2500e6],
          previous: [{ freqHz: 2441e6, missed: 0 }],
        },
        new Set(),
      ),
    ).toBe(2437e6);
  });
  test("else the previous name inside the span, most recently located first", () => {
    const previous = [
      { freqHz: 2441e6, missed: 2 },
      { freqHz: 2435e6, missed: 0 },
    ];
    expect(nameOf(span, { watch: [], previous }, new Set())).toBe(2435e6);
    expect(nameOf(span, { watch: [], previous }, new Set([2435e6]))).toBe(2441e6);
  });
  test("else its strongest Channel", () => {
    expect(nameOf(span, { watch: [], previous: [] }, new Set())).toBe(2439e6);
  });
});

describe("Emitters and Fixes", () => {
  const five = [0, 1, 2, 3, 4];
  test("≥ 3 used Receivers locate it; clipped, heard later, unaligned and not heard are listed", () => {
    const ch = Math.round(433.925e6 / R);
    const { emitters, reason } = buildEmitters({
      startsAt: T0,
      plan,
      pathLossN: 3.5,
      names: { watch: [], previous: [] },
      readings: five.map((i) =>
        reading(
          i,
          i === 4
            ? []
            : [
                rec(ch, 1, i === 3 ? null : -60 - 5 * i, {
                  clippedFix: i === 2,
                }),
              ],
          { unaligned: i === 1 },
        ),
      ),
    });
    expect(reason).toBe("No Emitter heard by 3 or more Receivers");
    expect(emitters[0]?.entries.map((e) => e.status)).toEqual([
      "used",
      "unaligned",
      "clipped",
      "heard_later",
      "not_heard",
    ]);
    const located = buildEmitters({
      startsAt: T0,
      plan,
      pathLossN: 3.5,
      names: { watch: [], previous: [] },
      readings: five.map((i) => reading(i, [rec(ch, 1, -60 - 4 * i)])),
    });
    expect(located.reason).toBeNull();
    expect(located.emitters[0]).toMatchObject({ freqHz: 433.925e6, heard: 5 });
    expect(located.emitters[0]?.estimate?.receiverCount).toBe(5);
  });
});

describe("change-only storage", () => {
  const here = {
    lat: 12.97,
    lng: 77.59,
    radiusM: 100,
    ptDbm: 30,
    occupancy: 1,
  };
  const last = { ...here, occupancyClass: 2 as const, at: T0 };
  test.each([
    ["appeared", here, last, T0 + 60_000, true, "change"],
    ["never stored", here, null, T0 + 60_000, false, "change"],
    ["steady", here, last, T0 + 15 * 60_000, false, null],
    ["an hour on", here, last, T0 + 3_600_000, false, "hourly"],
    ["moved past both radii", { ...here, lat: 12.9725 }, last, T0 + 60_000, false, "change"],
    ["moved within its radii", { ...here, lat: 12.971 }, last, T0 + 60_000, false, null],
    ["Pt up 11 dB", { ...here, ptDbm: 41 }, last, T0 + 60_000, false, "change"],
    ["now intermittent", { ...here, occupancy: 0.4 }, last, T0 + 60_000, false, "change"],
  ] as const)("%s", (_, now, prev, at, appeared, kind) => {
    expect(storeKind(now, prev, at, appeared)).toBe(kind);
  });
  test("Occupancy classes", () => {
    expect([0.05, 0.1, 0.89, 0.9].map(occupancyClass)).toEqual([0, 1, 1, 2]);
  });
});

describe("the board", () => {
  const item = (ch: number, missed: number | null): BoardItem => ({
    ch,
    firstCh: ch,
    widthCh: 1,
    heard: 3,
    used: 3,
    loudest: 0,
    located: missed === 0,
    unconfirmed: false,
    poorFit: false,
    collinear: false,
    receiverMoved: false,
    clipped: false,
    fixStored: false,
    missed,
    powerDbm: -70,
    peakDbm: -67,
    occupancy: 1,
    position: missed === null ? null : { lat: 12.97, lng: 77.59, radiusM: 100, ptDbm: 30 },
    lastStored:
      missed === null
        ? null
        : {
            lat: 12.97,
            lng: 77.59,
            radiusM: 100,
            ptDbm: 30,
            occupancyClass: 2,
            at: T0,
          },
  });
  test("missed Emitters are carried for 2 Scans, then leave (and go Silent)", () => {
    const out = nextBoard({
      at: T0 + 900_000,
      periodMs: 900_000,
      emitters: [],
      receivers: [],
      previous: [item(100, 0), item(200, 1), item(300, 2), item(400, null)],
      previousAt: T0,
      raster: R,
    });
    expect(out.items.map((i) => [i.ch, i.missed, i.located])).toEqual([
      [100, 1, false],
      [200, 2, false],
    ]);
    expect(out.left).toEqual([{ freqHz: 300 * R, lastLocatedAt: T0 - 2 * 900_000 }]);
    expect(out.store.size).toBe(0);
  });
});
