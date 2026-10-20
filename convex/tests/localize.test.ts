import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { decodeBoard } from "../lib/boardCodec";
import { SWEEP_PRESETS, sliceOf, slices } from "../lib/config";
import { distanceM, type LatLng } from "../lib/geo";
import { mulberry32, receivedPowerDbm } from "../lib/propagation";
import type { EmitterRecord } from "../lib/readingCodec";
import {
  advance,
  makeTest,
  RECEIVER_ISSUER,
  setUp,
  type T,
  testReading,
  testRecord,
} from "./harness.setup";

const START = Date.parse("2026-10-18T12:00:30Z");
const RUN0 = Date.parse("2026-10-18T12:01:00Z");
const RX: LatLng[] = [
  { lat: 12.9774, lng: 77.5878 },
  { lat: 12.9791, lng: 77.6024 },
  { lat: 12.9653, lng: 77.6037 },
  { lat: 12.9649, lng: 77.586 },
  { lat: 12.972, lng: 77.595 },
  { lat: 12.968, lng: 77.592 },
];
const TX = { lat: 12.9705, lng: 77.596, freqHz: 433.925e6, ptDbm: 30 };
const WIFI = 2437e6;
const OTHER = 418.15e6;
const PLAN = { segments: [...SWEEP_PRESETS.bugBands.segments], rasterHz: 12_500 };
const quietSlices = () =>
  slices(PLAN).map(() => ({
    floorDbm: -100,
    clippedFix: false,
    clippedLater: false,
    anomaly: false,
  }));

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date(START));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

const rx = (t: T, id: Id<"receivers">) => t.withIdentity({ issuer: RECEIVER_ISSUER, subject: id });

const heardAt = (i: number) =>
  receivedPowerDbm({
    ptDbm: TX.ptDbm,
    n: 3.5,
    distanceM: distanceM(RX[i] as LatLng, TX),
    sigmaDb: 1,
    rand: mulberry32(100 + i),
  });

async function scene(
  t: T,
  readingFor: (i: number) => { emitters: EmitterRecord[]; clock?: number; payload?: ArrayBuffer },
) {
  const op = await setUp(t);
  const ids: Id<"receivers">[] = [];
  for (const [i, where] of RX.entries()) {
    const { receiverId, code } = await op.mutation(api.receivers.createPending, { name: `R${i}` });
    await t.action(api.receiverAuth.pair, { code });
    await rx(t, receiverId).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat(),
      position: { ...where, accuracyM: 5, at: START },
    });
    ids.push(receiverId);
  }
  await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });
  await advance(t, RUN0 - Date.now() + 1500);
  const runId = (await op.query(api.live.run, {})).run?._id as Id<"runs">;
  for (const [i, id] of ids.entries()) {
    const r = readingFor(i);
    const at = { ...(RX[i] as LatLng), accuracyM: 5, at: RUN0 };
    const reading = testReading(runId, 0, {
      at,
      emitters: r.emitters,
      slices: quietSlices(),
      clockUncertaintyMs: r.clock,
    });
    await rx(t, id).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat(),
      readings: [r.payload ? { ...reading, payload: r.payload } : reading],
    });
  }
  await advance(t, 0);
  return { op, ids };
}

/** Wi-Fi's 20 MHz as each phone sees it: a strong one sees all of it, a faint one a fragment. */
const wifi = (power: number, full: boolean) => {
  const ch = Math.round(WIFI / 12_500);
  return testRecord(WIFI, power, {
    firstCh: full ? ch - 800 : ch - 300,
    widthCh: full ? 1600 : 500,
    strongestCh: full ? ch + 37 : ch - 120,
  });
};

test("a closed Scan groups Readings into Emitters, locates them and writes the board", async () => {
  const t = makeTest();
  const { op, ids } = await scene(t, (i) => {
    const emitters: EmitterRecord[] = [];
    // R0, R1, R4 hear the gate radio through the Fix window; R3 only after it; R5 not at all.
    if ([0, 1, 2, 4].includes(i)) emitters.push(testRecord(TX.freqHz, heardAt(i)));
    if (i === 3) emitters.push(testRecord(TX.freqHz, null, { peakDbm: -60 }));
    if ([0, 1, 4].includes(i)) emitters.push(wifi(-50 - i, i === 0));
    if (i === 0) emitters.push(testRecord(OTHER, -20, { clippedFix: true }));
    return { emitters, clock: i === 2 ? 600 : 4 };
  });

  const board = await op.query(api.emitters.board, {});
  if (!board) throw new Error("no board");
  expect(board.at).toBe(RUN0);
  const byName = new Map(decodeBoard(board.items).map((it) => [it.ch * 12_500, it]));
  expect([...byName.keys()].sort()).toEqual([OTHER, TX.freqHz, WIFI + 37 * 12_500].sort());

  const gate = byName.get(TX.freqHz);
  expect(gate).toMatchObject({
    heard: 5,
    used: 3,
    located: true,
    unconfirmed: true,
    fixStored: true,
  });
  expect(distanceM(gate?.position as LatLng, TX)).toBeLessThan(300);
  // Wi-Fi is one Emitter: the faint phones' fragments joined the strong phone's span.
  expect(byName.get(WIFI + 37 * 12_500)).toMatchObject({ heard: 3, widthCh: 1600, located: true });
  // The clipped carrier is heard, listed and never located.
  expect(byName.get(OTHER)).toMatchObject({ heard: 1, used: 0, located: false, clipped: true });

  const fixes = await t.run((ctx) => ctx.db.query("fixes").collect());
  const gateFix = fixes.find((f) => f.freqHz === TX.freqHz);
  expect(gateFix).toMatchObject({ kind: "change", receiverCount: 3, lowHz: TX.freqHz - 6250 });
  expect(Object.fromEntries(gateFix?.receivers.map((e) => [e.name, e.status]) ?? [])).toEqual({
    R0: "used",
    R1: "used",
    R2: "unaligned",
    R3: "heard_later",
    R4: "used",
    R5: "not_heard",
  });
  expect(gateFix?.receivers.find((e) => e.name === "R5")?.powerDbm).toBe(-100);
  const activity = await t.run((ctx) => ctx.db.query("emitterActivity").collect());
  expect(activity.map((a) => [a.freqHz, a.fixCount, a.firstFixAt]).sort()).toEqual(
    [
      [TX.freqHz, 1, RUN0],
      [WIFI + 37 * 12_500, 1, RUN0],
    ].sort(),
  );
  const scan = await t.run((ctx) => ctx.db.query("scans").first());
  expect(scan).toMatchObject({ state: "done", heard: 3, located: 2, fixCount: 2 });

  // Phones get the board and the fleet only when theirs are out of date.
  const sync = (o: { boardSince?: number; fleetSince?: number }) =>
    rx(t, ids[0] as Id<"receivers">).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat(),
      ...o,
    });
  const fresh = await sync({});
  expect(fresh.board?.at).toBe(RUN0);
  expect(decodeBoard(fresh.board?.items ?? new ArrayBuffer(0))).toHaveLength(3);
  expect(fresh.fleet?.items.map((f) => f.name).sort()).toEqual([
    "R0",
    "R1",
    "R2",
    "R3",
    "R4",
    "R5",
  ]);
  const current = await sync({ boardSince: RUN0, fleetSince: fresh.fleet?.at ?? 0 });
  expect(current.board).toBeNull();
  expect(current.fleet).toBeNull();
});

test("the not-heard bound is the floor of the slice holding the strongest Channel", async () => {
  const t = makeTest();
  await scene(t, (i) => ({ emitters: i < 3 ? [testRecord(TX.freqHz, heardAt(i))] : [] }));
  const fix = await t.run((ctx) => ctx.db.query("fixes").first());
  expect(sliceOf(PLAN, TX.freqHz)).toBeGreaterThan(0);
  expect(fix?.receivers.filter((e) => e.status === "not_heard").map((e) => e.powerDbm)).toEqual([
    -100, -100, -100,
  ]);
});

test("a Scan with 400 Emitters still closes", async () => {
  const t = makeTest();
  await scene(t, (i) => ({
    emitters: Array.from({ length: 400 }, (_, e) =>
      testRecord(300e6 + e * 250_000, -60 - ((i + e) % 7)),
    ),
  }));
  const scan = await t.run((ctx) => ctx.db.query("scans").first());
  expect(scan).toMatchObject({ state: "done", heard: 400, located: 400 });
}, 60_000);

test("an unreadable payload fails only its Scan", async () => {
  const t = makeTest();
  await scene(t, (i) => ({
    emitters: [testRecord(TX.freqHz, heardAt(i))],
    payload: i === 1 ? Uint8Array.of(9, 0, 0).buffer : undefined,
  }));
  const scan = await t.run((ctx) => ctx.db.query("scans").first());
  expect(scan).toMatchObject({ state: "failed" });
  expect(scan?.reason).toContain("unsupported Reading codec version 9");
  const errors = await t.run((ctx) => ctx.db.query("errors").collect());
  expect(errors.map((e) => e.source)).toEqual(["server"]);
});
