import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { api } from "../_generated/api";
import { ORG_CONFIG_DEFAULTS as D } from "../lib/config";
import { expectCode, makeTest, setUp } from "./harness.setup";

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-10-18T12:00:30Z"));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

test("saves are versioned, conflict-checked and restorable; the sweep plan opens a new Run", async () => {
  const t = makeTest();
  const op = await setUp(t);
  await op.mutation(api.runs.start, { cadence: D.cadence });

  const wider = { ...D, segments: [{ startHz: 400e6, endHz: 450e6 }] };
  expect(await op.mutation(api.orgConfig.save, { expectedV: 1, values: wider })).toEqual({
    v: 2,
    runNumber: 2,
  });
  await expectCode(op.mutation(api.orgConfig.save, { expectedV: 1, values: D }), "CONFIG_CONFLICT");

  const current = await op.query(api.orgConfig.current, {});
  expect(current).toMatchObject({
    v: 2,
    planChange: { previousSegments: D.segments },
  });

  // n applies from the next Scan: no new Run.
  const open = { ...wider, environment: { preset: "open" as const, n: 2.2 } };
  expect(await op.mutation(api.orgConfig.save, { expectedV: 2, values: open })).toEqual({
    v: 3,
    runNumber: null,
  });

  expect(await op.mutation(api.orgConfig.restore, { v: 1, expectedV: 3 })).toEqual({
    v: 4,
    runNumber: 3,
  });
  const { page } = await op.query(api.orgConfig.versions, {
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect<unknown[]>(page.map((p) => [p.v, p.diff[0] ?? null, p.startedRuns])).toEqual([
    [4, "Restored v1", [3]],
    [3, "Propagation environment: Urban (n 3.5) → Open (n 2.2)", []],
    [2, "Sweep plan: Bug bands · 8 segments · 1,090 MHz → 400–450 MHz", [2]],
    [1, null, [1]],
  ]);
  expect(page[0]?.values).toEqual(D);
});

test("invalid values are refused with their code; an unchanged save writes nothing", async () => {
  const t = makeTest();
  const op = await setUp(t);
  await expectCode(
    op.mutation(api.orgConfig.save, {
      expectedV: 1,
      values: { ...D, segments: [{ startHz: 500e6, endHz: 450e6 }] },
    }),
    "BAND_INVALID",
  );
  expect(await op.mutation(api.orgConfig.save, { expectedV: 1, values: D })).toEqual({
    v: 1,
    runNumber: null,
  });
});

test("a raster change leaves the Watchlist alone (entries re-match by frequency)", async () => {
  const t = makeTest();
  const op = await setUp(t);
  await op.mutation(api.watchlist.upsert, {
    freqHz: 433.925e6,
    name: "Gate radio",
    notes: "",
    rules: { heard: true, moved: true, silent: true },
    critical: false,
    home: null,
  });
  await op.mutation(api.orgConfig.save, { expectedV: 1, values: { ...D, rasterHz: 25_000 } });
  expect((await op.query(api.watchlist.list, {})).map((w) => w.freqHz)).toEqual([433.925e6]);
});
