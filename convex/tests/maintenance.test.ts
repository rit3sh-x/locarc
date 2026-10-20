import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ORG_CONFIG_DEFAULTS, sweepPlan } from "../lib/config";
import { HOUR, hourOf } from "../lib/retention";
import { makeTest, setUp, type T } from "./harness.setup";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const DAY = 86_400_000;

// convex-test hands out increasing creation times, so each test starts its clock 400 days back
// and writes in time order.
beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date(NOW - 400 * DAY));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

/** Moves the clock forward to `at` and writes there, so `_creationTime` is `at`. */
async function insertAt<R>(t: T, at: number, fn: (ctx: MutationCtx) => Promise<R>): Promise<R> {
  if (at < Date.now()) throw new Error("insertAt only moves forward in time");
  setSystemTime(new Date(at));
  return await t.run(fn);
}

async function purge(t: T) {
  setSystemTime(new Date(NOW));
  await t.mutation(internal.maintenance.purge, {});
  await t.finishAllScheduledFunctions(() => jest.runAllTimers(), 1000);
}

async function world(t: T) {
  const op = await setUp(t);
  const { receiverId } = await op.mutation(api.receivers.createPending, { name: "A" });
  const { run, scan } = await t.run(async (ctx) => {
    const run = await ctx.db.insert("runs", {
      number: 1,
      plan: sweepPlan(ORG_CONFIG_DEFAULTS),
      cadence: { kind: "oneMinute", hours: 1, revertMinutes: 5 },
      periodMs: 60_000,
      fixWindowMs: 10_000,
      uploadMarginMs: 3_000,
      burstEndsAt: null,
      configV: 1,
      startedAt: NOW - 400 * DAY,
      startedBy: "test",
      endedAt: null,
      endReason: null,
    });
    const scan = await ctx.db.insert("scans", {
      run,
      k: 0,
      startsAt: NOW - 400 * DAY,
      deadlineAt: NOW - 400 * DAY,
      state: "done",
      reason: null,
      expected: [],
      reportedBy: [],
      heard: 0,
      located: 0,
      reported: 0,
      partial: 0,
      late: 0,
      fixCount: 0,
      closedAt: null,
    });
    return { run, scan };
  });
  const reading = (at: number) =>
    insertAt(t, at, (ctx) =>
      ctx.db.insert("readings", {
        receiver: receiverId,
        run,
        scan,
        k: 0,
        appVersion: "1",
        lnaDb: 32,
        vgaDb: 30,
        amp: false,
        ppm: 0,
        windowMs: 297_000,
        passes: 1980,
        fixPasses: 66,
        stopReason: null,
        start: null,
        end: null,
        clockUncertaintyMs: 4,
        late: false,
        unaligned: false,
        partial: false,
        payload: new ArrayBuffer(0),
      }),
    );
  const fix = (at: number, freqHz: number, uncertaintyM = 100) =>
    t.run((ctx) =>
      ctx.db.insert("fixes", {
        scan,
        run,
        at,
        kind: "change",
        freqHz,
        ch: 0,
        rasterHz: 12_500,
        lowHz: freqHz - 6250,
        highHz: freqHz + 6250,
        lat: 12.97,
        lng: 77.59,
        region: [],
        uncertaintyM,
        receiverCount: 3,
        occupancy: 1,
        peakDbm: -60,
        chi2PerDof: 1,
        flags: { unconfirmed: false, poorFit: false, collinear: false, receiverMoved: false },
        pathLossN: 3.5,
        ptDbm: 30,
        receivers: [],
      }),
    );
  return { op, receiverId, run, scan, reading, fix };
}

const ids = (t: T, table: "readings" | "fixes" | "scans") =>
  t.run(async (ctx) => (await ctx.db.query(table).collect()).map((d) => d._id as string));

test("each rule deletes past its age and keeps the rest", async () => {
  const t = makeTest();
  const w = await world(t);
  const WATCHED = 433_925_000;
  const UNWATCHED = 418_150_000;
  await t.run((ctx) =>
    ctx.db.insert("watchlist", {
      freqHz: WATCHED,
      name: "Gate radio",
      notes: "",
      rules: { heard: false, moved: false, silent: false },
      critical: false,
      home: null,
      createdBy: "test",
    }),
  );
  const keptScan = await t.run(async (ctx) => {
    const s = await ctx.db.get("scans", w.scan);
    if (!s) throw new Error("no scan");
    const { _id, _creationTime, ...doc } = s;
    return await ctx.db.insert("scans", { ...doc, k: 1, startsAt: NOW - 29 * DAY });
  });

  // One hour just past 30 days: the watched Channel keeps its best Fix, the unwatched loses all.
  const hour = hourOf(NOW - 31 * DAY);
  await w.fix(hour + 60_000, WATCHED, 100);
  const best = await w.fix(hour + 120_000, WATCHED, 50);
  await w.fix(hour + 180_000, WATCHED, 80);
  await w.fix(hour + 240_000, UNWATCHED, 10);
  const nextHour = await w.fix(hour + HOUR + 1, WATCHED, 90);
  const recent = await w.fix(NOW - 29 * DAY, UNWATCHED);
  await w.fix(NOW - 366 * DAY, WATCHED);

  const alert = (state: "open" | "resolved", lastAt: number) =>
    t.run((ctx) =>
      ctx.db.insert("alerts", {
        subjectKey: `ch:${lastAt}`,
        type: "heard",
        kind: "event",
        severity: "warning",
        state,
        title: "",
        detail: "",
        count: 1,
        firstAt: lastAt,
        lastAt,
        ackBy: null,
        ackAt: null,
        coolDownUntil: null,
        resolvedAt: state === "resolved" ? lastAt : null,
      }),
    );
  await alert("resolved", NOW - 91 * DAY);
  const openOld = await alert("open", NOW - 91 * DAY);
  const resolvedRecent = await alert("resolved", NOW - 89 * DAY);

  const error = (lastAt: number) =>
    t.run((ctx) =>
      ctx.db.insert("errors", {
        fingerprint: String(lastAt),
        source: "web",
        kind: "Error",
        message: "",
        sampleStack: "",
        count: 1,
        firstAt: lastAt,
        lastAt,
        latestVersion: "dev",
        latestContext: "",
        resolvedAt: null,
      }),
    );
  await error(NOW - 31 * DAY);
  const recentError = await error(NOW - 29 * DAY);

  const activity = (freqHz: number, lastLocatedAt: number) =>
    t.run(async (ctx) =>
      ctx.db.insert("emitterActivity", {
        freqHz,
        lowHz: freqHz - 6250,
        highHz: freqHz + 6250,
        firstFixAt: lastLocatedAt,
        lastLocatedAt,
        fixCount: 1,
        lastFix: {
          id: (await ctx.db.query("fixes").first())?._id as Id<"fixes">,
          lat: 0,
          lng: 0,
          radiusM: 100,
          ptDbm: 30,
          occupancyClass: 2,
          at: lastLocatedAt,
        },
      }),
    );
  const board = (at: number) =>
    t.run((ctx) =>
      ctx.db.insert("emitterBoards", {
        scan: w.scan,
        run: w.run,
        at,
        rasterHz: 12_500,
        receivers: [],
        items: new ArrayBuffer(3),
      }),
    );
  await board(NOW - 8 * DAY);
  const recentBoard = await board(NOW - 6 * DAY);
  await activity(UNWATCHED, NOW - 31 * DAY);
  const recentActivity = await activity(WATCHED, NOW - DAY);

  // Rows aged by creation time, written in time order.
  const event = (at: number, text: string) =>
    insertAt(t, at, (ctx) =>
      ctx.db.insert("receiverEvents", { receiver: w.receiverId, at, kind: "state", text }),
    );
  const invite = (at: number, usedAt: number | null) =>
    insertAt(t, at, (ctx) =>
      ctx.db.insert("invites", {
        email: `${at}@x.test`,
        tokenHash: String(at),
        expiresAt: at + 7 * DAY,
        usedAt,
        createdBy: "test",
      }),
    );
  const code = (at: number, codeHash: string) =>
    insertAt(t, at, (ctx) =>
      ctx.db.insert("pairingCodes", {
        codeHash,
        receiver: w.receiverId,
        expiresAt: at,
        usedAt: null,
      }),
    );
  await event(NOW - 31 * DAY, "old");
  await invite(NOW - 9 * DAY, NOW - 8.5 * DAY);
  await w.reading(NOW - 8 * DAY);
  const newReading = await w.reading(NOW - 6 * DAY);
  await code(NOW - 2 * DAY, "old");
  const pendingInvite = await invite(NOW - DAY, null);
  await code(NOW - HOUR, "fresh");
  await event(NOW - 1, "new");

  await purge(t);

  expect(await ids(t, "readings")).toEqual([newReading]);
  expect(await ids(t, "scans")).toEqual([keptScan]);
  expect((await ids(t, "fixes")).sort()).toEqual([best, nextHour, recent].sort());
  const left = await t.run(async (ctx) => ({
    events: (await ctx.db.query("receiverEvents").collect()).map((e) => e.text),
    alerts: (await ctx.db.query("alerts").collect()).map((a) => a._id),
    errors: (await ctx.db.query("errors").collect()).map((e) => e._id),
    activity: (await ctx.db.query("emitterActivity").collect()).map((a) => a._id),
    boards: (await ctx.db.query("emitterBoards").collect()).map((b) => b._id),
    invites: (await ctx.db.query("invites").collect()).map((i) => i._id),
    codes: (await ctx.db.query("pairingCodes").collect()).map((c) => c.codeHash),
  }));
  expect(left.events).toEqual(["new"]);
  expect(left.alerts.sort()).toEqual([openOld, resolvedRecent].sort());
  expect(left.errors).toEqual([recentError]);
  expect(left.activity).toEqual([recentActivity]);
  expect(left.boards).toEqual([recentBoard]);
  expect(left.invites).toEqual([pendingInvite]);
  expect(left.codes).toEqual(["fresh"]);
});

test("big backlogs continue across transactions, busy hours included", async () => {
  const t = makeTest();
  const w = await world(t);
  const hour = hourOf(NOW - 31 * DAY);
  const first = await w.fix(hour, 1);
  await t.run(async (ctx) => {
    const fix = await ctx.db.get("fixes", first);
    if (!fix) return;
    const { _id, _creationTime, ...doc } = fix;
    for (let i = 1; i < 1200; i++)
      await ctx.db.insert("fixes", { ...doc, at: hour + i, freqHz: 1 + (i % 7) });
  });
  for (let i = 0; i < 450; i++) await w.reading(NOW - 8 * DAY);
  await purge(t);
  expect(await ids(t, "readings")).toEqual([]);
  expect(await ids(t, "fixes")).toEqual([]);
  // The watermark reached the 30-day edge, so later purges read only new hours.
  const org = await t.run((ctx) => ctx.db.query("organization").first());
  expect(org?.fixesThinnedTo).toBe(hourOf(NOW - 30 * DAY));
}, 60_000);
