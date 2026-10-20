import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { decodeBoard } from "../lib/boardCodec";
import { distanceM, type LatLng } from "../lib/geo";
import { receivedPowerDbm } from "../lib/propagation";
import type { EmitterRecord } from "../lib/readingCodec";
import {
  advance,
  asReceiver,
  expectCode,
  makeTest,
  setUp,
  type T,
  testReading,
  testRecord,
} from "./harness.setup";

const START = Date.parse("2026-10-18T12:00:30Z");
const RX: LatLng[] = [
  { lat: 12.9774, lng: 77.5878 },
  { lat: 12.9791, lng: 77.6024 },
  { lat: 12.9653, lng: 77.6037 },
  { lat: 12.9649, lng: 77.586 },
];
const TX = { lat: 12.9705, lng: 77.596, freqHz: 433.925e6 };
const WIFI = 2437e6;

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date(START));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

const power = (i: number) =>
  receivedPowerDbm({
    ptDbm: 30,
    n: 3.5,
    distanceM: distanceM(RX[i] as LatLng, TX),
    sigmaDb: 0,
    rand: Math.random,
  });

/** The gate radio, as Receiver i hears it. */
const gate = (i: number) => [testRecord(TX.freqHz, power(i))];

/** Wi-Fi whose strongest Channel wanders inside its 20 MHz from Scan to Scan. */
const wifi = (i: number, k: number) => {
  const ch = Math.round(WIFI / 12_500);
  return [
    testRecord(WIFI, power(i) + 10, {
      firstCh: ch - 800,
      widthCh: 1600,
      strongestCh: ch - 600 + ((k * 397) % 1200),
    }),
  ];
};

async function world(t: T) {
  const op = await setUp(t);
  const ids: Id<"receivers">[] = [];
  for (const [i, at] of RX.entries()) {
    const { receiverId, code } = await op.mutation(api.receivers.createPending, { name: `R${i}` });
    await t.action(api.receiverAuth.pair, { code });
    await asReceiver(t, receiverId).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat({ appliedConfigV: 1 }),
      position: { ...at, accuracyM: 5, at: Date.now() },
    });
    ids.push(receiverId);
  }
  await op.mutation(api.runs.start, { cadence: { kind: "oneMinute", hours: 4, revertMinutes: 5 } });
  await advance(t, 30_000);
  const runId = (await op.query(api.live.run, {})).run?._id as Id<"runs">;
  /** One Scan: every Receiver reports what it heard (all report, so it closes at once). */
  const scan = async (k: number, heard: (i: number) => EmitterRecord[]) => {
    await advance(t, 1500);
    for (const [i, id] of ids.entries()) {
      const at = { ...(RX[i] as LatLng), accuracyM: 5, at: Date.now() };
      await asReceiver(t, id).mutation(api.sync.sync, {
        sentAt: Date.now(),
        heartbeat: healthyHeartbeat({ appliedConfigV: 1 }),
        readings: [testReading(runId, k, { at, emitters: heard(i) })],
      });
    }
    await advance(t, 60_000 - 1500);
  };
  return { op, scan };
}

const nothing = () => [];

const open = async (op: Awaited<ReturnType<typeof world>>["op"]) =>
  (await op.query(api.alerts.open, {})).open.map((a) => [a.type, a.subjectKey, a.count]);

const fixKinds = (t: T, freqHz: number) =>
  t.run(async (ctx) =>
    (await ctx.db.query("fixes").collect()).filter((f) => f.freqHz === freqHz).map((f) => f.kind),
  );

test("an Emitter heard while learning is known, not New", async () => {
  const t = makeTest();
  const { op, scan } = await world(t);
  await scan(0, gate);
  expect(await open(op)).toEqual([]);
  await t.mutation(internal.tests.seed.backdateLearning, {});
  await scan(1, gate);
  expect(await open(op)).toEqual([]);
});

test("after learning, a new Emitter raises New once; naming it acknowledges", async () => {
  const t = makeTest();
  const { op, scan } = await world(t);
  await t.mutation(internal.tests.seed.backdateLearning, {});
  await scan(0, nothing);
  await scan(1, gate);
  await scan(2, gate);
  expect(await open(op)).toEqual([["new", "ch:433925000", 1]]);

  await op.mutation(api.watchlist.upsert, {
    freqHz: 433.925e6,
    name: "Gate radio",
    notes: "",
    rules: { heard: true, moved: true, silent: true },
    critical: false,
    home: null,
  });
  expect(await open(op)).toEqual([]);
  expect((await op.query(api.alerts.open, {})).acknowledged[0]).toMatchObject({
    type: "new",
    ackBy: "First Operator",
  });
  await scan(3, gate);
  expect(await open(op)).toEqual([]);
});

test("a wide Emitter keeps its name while its strongest Channel wanders: one New, one name", async () => {
  const t = makeTest();
  const { op, scan } = await world(t);
  await t.mutation(internal.tests.seed.backdateLearning, {});
  for (let k = 0; k < 4; k++) await scan(k, (i) => wifi(i, k));
  const alerts = await open(op);
  expect(alerts).toHaveLength(1);
  const name = Number(String(alerts[0]?.[1]).slice(3));
  const board = await op.query(api.emitters.board, {});
  expect(decodeBoard(board?.items ?? new ArrayBuffer(0)).map((i) => i.ch * 12_500)).toEqual([name]);
});

test("change-only storage: a steady Emitter stores its first Fix, then one slim Fix an hour", async () => {
  const t = makeTest();
  const { scan } = await world(t);
  for (let k = 0; k < 5; k++) await scan(k, gate);
  expect(await fixKinds(t, TX.freqHz)).toEqual(["change"]);
  // 55 more Scans: past the hour since the stored Fix.
  for (let k = 5; k < 61; k++) await scan(k, gate);
  expect(await fixKinds(t, TX.freqHz)).toEqual(["change", "hourly"]);
}, 60_000);

test("a watched Emitter: Heard when it appears; Silent after 3 Scans, resolved when located", async () => {
  const t = makeTest();
  const { op, scan } = await world(t);
  await t.mutation(internal.tests.seed.backdateLearning, {});
  await op.mutation(api.watchlist.upsert, {
    freqHz: 433.925e6,
    name: "Gate radio",
    notes: "",
    rules: { heard: true, moved: false, silent: true },
    critical: true,
    home: null,
  });
  await scan(0, gate);
  expect(await open(op)).toEqual([["heard", "ch:433925000", 1]]);
  await op.mutation(api.alerts.ackAll, {});
  for (let k = 1; k <= 2; k++) await scan(k, nothing);
  expect((await op.query(api.alerts.open, {})).open.some((a) => a.type === "silent")).toBe(false);
  await scan(3, nothing);
  const silent = (await op.query(api.alerts.open, {})).open.find((a) => a.type === "silent");
  expect(silent).toMatchObject({
    severity: "critical",
    kind: "condition",
    title: "Gate radio (433.9250 MHz) silent",
  });
  await scan(4, gate);
  const now = (await op.query(api.alerts.open, {})).open;
  expect(now.some((a) => a.type === "silent")).toBe(false);
  // Back after 3 Scans (4 minutes) is under the 30-minute Heard threshold.
  expect(now.some((a) => a.type === "heard")).toBe(false);
});

test("the learning seed refuses outside test mode", async () => {
  const t = makeTest();
  await setUp(t);
  process.env.IS_TEST = "";
  try {
    await expectCode(t.mutation(internal.tests.seed.backdateLearning, {}), "NOT_TEST_MODE");
  } finally {
    process.env.IS_TEST = "1";
  }
});
