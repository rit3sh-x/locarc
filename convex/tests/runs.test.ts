import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ORG_CONFIG_DEFAULTS } from "../lib/config";
import { makeTest, RECEIVER_ISSUER, setUp, type T, testReading } from "./harness.setup";

const START = Date.parse("2026-10-18T12:00:30Z");
const RUN0 = Date.parse("2026-10-18T12:01:00Z");
const here = { lat: 12.97, lng: 77.59, accuracyM: 5, at: START };

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date(START));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

/** Moves the clock and lets every scheduled function that came due run to completion. */
async function advance(t: T, ms: number) {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 3; i++) {
    await t.finishInProgressScheduledFunctions();
    jest.advanceTimersByTime(0);
  }
}

async function fleet(t: T, names: string[], { positioned = true } = {}) {
  const op = await setUp(t);
  const ids: Id<"receivers">[] = [];
  for (const name of names) {
    const { receiverId, code } = await op.mutation(api.receivers.createPending, { name });
    await t.action(api.receiverAuth.pair, { code });
    ids.push(receiverId);
    await rx(t, receiverId).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat(),
      ...(positioned ? { position: here } : {}),
    });
  }
  return { op, ids };
}

const rx = (t: T, id: Id<"receivers">) => t.withIdentity({ issuer: RECEIVER_ISSUER, subject: id });

function reading(
  runId: Id<"runs">,
  k: number,
  extra: { stopReason?: string; clockUncertaintyMs?: number } = {},
) {
  return testReading(runId, k, { at: here, ...extra });
}

const syncReading = (t: T, id: Id<"receivers">, r: ReturnType<typeof reading>) =>
  rx(t, id).mutation(api.sync.sync, {
    sentAt: Date.now(),
    heartbeat: healthyHeartbeat(),
    readings: [r],
  });

const scans = (t: T) => t.run((ctx) => ctx.db.query("scans").collect());

describe("Runs", () => {
  test("Start opens a Run at the next whole minute and tells every Receiver", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A", "B"]);
    expect(await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } })).toEqual({
      number: 1,
      startsAt: RUN0,
    });
    const control = await rx(t, ids[0] as Id<"receivers">).query(api.control.mine, {});
    expect(control?.run).toMatchObject({ number: 1, startsAt: RUN0, periodMs: 300_000 });
    expect(control?.run).toMatchObject({
      plan: { segments: ORG_CONFIG_DEFAULTS.segments, rasterHz: 12_500 },
      fixWindowMs: 10_000,
      uploadMarginMs: 3_000,
    });
    expect((await op.query(api.live.run, {})).run?.number).toBe(1);
  });

  test("boundaries create Scans expecting positioned, active, recently seen Receivers", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A", "B"]);
    const { receiverId: unplaced, code } = await op.mutation(api.receivers.createPending, {
      name: "C",
    });
    await t.action(api.receiverAuth.pair, { code });
    await rx(t, unplaced).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat(),
    });
    await op.mutation(api.receivers.createPending, { name: "Never paired" });
    await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });

    await advance(t, RUN0 - Date.now());
    const [scan0] = await scans(t);
    expect(scan0).toMatchObject({
      k: 0,
      startsAt: RUN0,
      state: "collecting",
      // Phones upload just before the next boundary; the close waits 30 s past it.
      deadlineAt: RUN0 + 300_000 + 30_000,
    });
    expect(scan0?.expected.sort()).toEqual([...ids].sort());

    await advance(t, 330_000);
    expect((await scans(t)).map((s) => [s.k, s.state])).toEqual([
      [0, "no_fix"],
      [1, "collecting"],
    ]);
  });

  test("any Sweep plan fits any cadence: the full span runs a 1-min burst; Continuous is 15 s", async () => {
    const t = makeTest();
    const { op } = await fleet(t, ["A"]);
    await t.run(async (ctx) => {
      const org = await ctx.db.query("organization").first();
      if (!org) throw new Error("no org");
      await ctx.db.insert("orgConfigVersions", {
        v: 2,
        author: "test",
        at: Date.now(),
        values: { ...ORG_CONFIG_DEFAULTS, segments: [{ startHz: 1e6, endHz: 6000e6 }] },
        diff: [],
      });
      await ctx.db.patch("organization", org._id, { configV: 2 });
    });
    expect(
      await op.mutation(api.runs.start, {
        cadence: { kind: "oneMinute", hours: 1, revertMinutes: 5 },
      }),
    ).toMatchObject({ number: 1 });
    await op.mutation(api.runs.setCadence, {
      cadence: { kind: "continuous", minutes: 15, revertMinutes: 15 },
    });
    expect((await op.query(api.live.run, {})).run).toMatchObject({ number: 2, periodMs: 15_000 });
  });

  test("a cadence change ends the Run, discards its Scan and opens the next; Stop clears it", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A"]);
    await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });
    await advance(t, RUN0 - Date.now() + 1000);
    expect(
      await op.mutation(api.runs.setCadence, { cadence: { kind: "steady", minutes: 15 } }),
    ).toMatchObject({ number: 2, startsAt: RUN0 + 60_000 });
    const [discarded] = await scans(t);
    expect(discarded).toMatchObject({
      state: "discarded",
      reason: "Cadence changed by First Operator",
    });
    expect((await op.query(api.orgConfig.current, {})).values.cadence).toEqual({
      kind: "steady",
      minutes: 15,
    });

    await op.mutation(api.runs.stop, {});
    expect((await op.query(api.live.run, {})).run).toBeNull();
    expect((await rx(t, ids[0] as Id<"receivers">).query(api.control.mine, {}))?.run).toBeNull();
    await advance(t, 20 * 60_000);
    expect((await scans(t)).length).toBe(1);
  });

  test("a burst reverts to its steady cadence at its end", async () => {
    const t = makeTest();
    const { op } = await fleet(t, ["A"]);
    await op.mutation(api.runs.start, {
      cadence: { kind: "oneMinute", hours: 1, revertMinutes: 15 },
    });
    await advance(t, RUN0 - Date.now());
    for (let i = 0; i < 60; i++) await advance(t, 60_000);
    const live = await op.query(api.live.run, {});
    expect(live.run).toMatchObject({ number: 2, cadence: { kind: "steady", minutes: 15 } });
    expect((await scans(t)).length).toBe(60);
    const versions = await t.run((ctx) => ctx.db.query("orgConfigVersions").collect());
    expect(versions.at(-1)).toMatchObject({
      author: "Locarc",
      values: { cadence: { kind: "steady", minutes: 15 } },
    });
  });
});

describe("sync", () => {
  test("stores Readings idempotently and closes early once everyone expected has reported", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A", "B"]);
    await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });
    await advance(t, RUN0 - Date.now() + 1500);
    const runId = (await op.query(api.live.run, {})).run?._id as Id<"runs">;
    const [a, b] = ids as [Id<"receivers">, Id<"receivers">];

    const first = await syncReading(t, a, reading(runId, 0, { stopReason: "DETACHED" }));
    expect(first.readings).toEqual([{ runId, k: 0, outcome: "stored" }]);
    expect((await syncReading(t, a, reading(runId, 0))).readings[0]?.outcome).toBe("stored");
    expect((await scans(t))[0]).toMatchObject({ state: "collecting", reported: 1, partial: 1 });

    await syncReading(t, b, reading(runId, 0, { clockUncertaintyMs: 600 }));
    expect((await scans(t))[0]?.state).toBe("localizing");
    await advance(t, 0);
    expect((await scans(t))[0]).toMatchObject({ state: "no_fix", reported: 2 });
    const readings = await t.run((ctx) => ctx.db.query("readings").collect());
    expect(readings.map((r) => [r.partial, r.unaligned, r.late])).toEqual([
      [true, false, false],
      [false, true, false],
    ]);
  });

  test("closes at the deadline, flags late Readings and drops unknown Scans", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A", "B"]);
    await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });
    await advance(t, RUN0 - Date.now() + 1500);
    const runId = (await op.query(api.live.run, {})).run?._id as Id<"runs">;
    const [a, b] = ids as [Id<"receivers">, Id<"receivers">];
    await syncReading(t, a, reading(runId, 0));
    await advance(t, 300_000 + 30_000);
    expect((await scans(t))[0]?.state).toBe("no_fix");
    expect((await syncReading(t, b, reading(runId, 0))).readings[0]?.outcome).toBe("late");
    expect((await scans(t))[0]).toMatchObject({ reported: 1, late: 1 });
    expect((await syncReading(t, b, reading(runId, 7))).readings[0]?.outcome).toBe("dropped");
  });

  test("a sync that beats the scheduler creates the Scan; acks trim commands", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A"]);
    await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });
    const a = ids[0] as Id<"receivers">;
    setSystemTime(new Date(RUN0 + 1200));
    const runId = (await op.query(api.live.run, {})).run?._id as Id<"runs">;
    expect((await syncReading(t, a, reading(runId, 0))).readings[0]?.outcome).toBe("stored");
    await advance(t, 0);
    expect((await scans(t)).map((s) => s.k)).toEqual([0]);

    const command = await t.run(async (ctx) => {
      const session = await ctx.db.insert("calibrationSessions", {
        at: Date.now(),
        by: "test",
        referenceHz: 433.92e6,
        mode: "frequency",
        participants: [],
        state: "cancelled",
        measurements: [],
        missing: [],
        proposals: null,
        applied: [],
      });
      const cmd = {
        kind: "calibrate" as const,
        session,
        referenceHz: 433.92e6,
        durationS: 30,
        mode: "frequency" as const,
      };
      const c = await ctx.db.query("receiverControl").first();
      if (c) {
        await ctx.db.patch("receiverControl", c._id, {
          commands: [
            { seq: 1, ...cmd },
            { seq: 2, ...cmd },
          ],
        });
      }
      return cmd;
    });
    await rx(t, a).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat(),
      ackSeq: 1,
    });
    expect((await rx(t, a).query(api.control.mine, {}))?.commands).toEqual([
      { seq: 2, ...command },
    ]);
  });

  test("a heartbeat updates the hot status, the serial and applied config", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A"]);
    const a = ids[0] as Id<"receivers">;
    const res = await rx(t, a).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat({
        appliedConfigV: 1,
        hackrf: {
          state: "streaming",
          serial: "0000abcd",
          boardId: 2,
          firmware: "2023.01.1",
          ladder: 0,
          faults: {},
          detachedSince: null,
        },
      }),
    });
    expect(res.serverTime).toBe(Date.now());
    expect((await op.query(api.receivers.list, {}))[0]).toMatchObject({
      hackrfSerial: "0000abcd",
      appliedV: 1,
    });
    expect((await op.query(api.live.receiverStatuses, {}))[0]).toMatchObject({
      state: "idle",
      lastSeenAt: Date.now(),
    });
    await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });
    await rx(t, a).mutation(api.sync.sync, { sentAt: Date.now(), heartbeat: healthyHeartbeat() });
    expect((await op.query(api.live.receiverStatuses, {}))[0]?.state).toBe("scanning");
  });
});

test("internal boundaries no-op for ended Runs", async () => {
  const t = makeTest();
  const { op } = await fleet(t, ["A"]);
  await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });
  const runId = (await op.query(api.live.run, {})).run?._id as Id<"runs">;
  await op.mutation(api.runs.stop, {});
  await t.mutation(internal.runs.boundary, { runId, k: 3 });
  expect(await scans(t)).toEqual([]);
});
