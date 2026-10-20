import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ORG_CONFIG_DEFAULTS as D } from "../lib/config";
import { advance, asReceiver, expectCode, makeTest, setUp, type T } from "./harness.setup";

const REF = 433.92e6;

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-10-18T12:00:30Z"));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

async function fleet(t: T, names: string[]) {
  const op = await setUp(t);
  const ids: Id<"receivers">[] = [];
  for (const name of names) {
    const { receiverId, code } = await op.mutation(api.receivers.createPending, { name });
    await t.action(api.receiverAuth.pair, { code });
    ids.push(receiverId);
    await asReceiver(t, receiverId).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat({
        appliedConfigV: 1,
        hackrf: {
          state: "streaming",
          serial: `serial-${name}`,
          boardId: 2,
          firmware: "2023.01.1",
          ladder: 0,
          faults: {},
          detachedSince: null,
        },
      }),
      position: { lat: 12.97, lng: 77.59, accuracyM: 5, at: Date.now() },
    });
  }
  return { op, ids };
}

const report = (
  t: T,
  id: Id<"receivers">,
  session: Id<"calibrationSessions">,
  powerDbm: number,
  ppm: number,
  seq: number,
) =>
  asReceiver(t, id).mutation(api.sync.sync, {
    sentAt: Date.now(),
    heartbeat: healthyHeartbeat({ appliedConfigV: 1 }),
    ackSeq: seq,
    calibration: [{ session, powerDbm, freqOffsetHz: (ppm * REF) / 1e6 }],
  });

test("a session needs the reference carrier and two Receivers", async () => {
  const t = makeTest();
  const { op, ids } = await fleet(t, ["A", "B"]);
  await expectCode(op.mutation(api.calibration.start, { receivers: ids }), "REFERENCE_MISSING");
  await op.mutation(api.orgConfig.save, { expectedV: 1, values: { ...D, referenceHz: REF } });
  await expectCode(
    op.mutation(api.calibration.start, { receivers: [ids[0] as Id<"receivers">] }),
    "TOO_FEW_RECEIVERS",
  );
});

test("measure, review median − own, apply one version each and record the serial", async () => {
  const t = makeTest();
  const { op, ids } = await fleet(t, ["A", "B", "C"]);
  const [a, b, c] = ids as [Id<"receivers">, Id<"receivers">, Id<"receivers">];
  await op.mutation(api.orgConfig.save, { expectedV: 1, values: { ...D, referenceHz: REF } });
  await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });
  const session = await op.mutation(api.calibration.start, { receivers: [a, b, c] });

  const control = await asReceiver(t, a).query(api.control.mine, {});
  expect(control?.commands).toEqual([
    { seq: 1, kind: "calibrate", session, referenceHz: REF, durationS: 30, mode: "full" },
  ]);
  // Measuring Receivers sit out the Scan.
  await advance(t, 30_000);
  expect((await t.run((ctx) => ctx.db.query("scans").first()))?.expected).toEqual([]);

  await report(t, a, session, -45, 1.2, 1);
  await report(t, b, session, -42.5, -0.6, 1);
  expect((await op.query(api.calibration.active, {}))?.state).toBe("measuring");
  await report(t, c, session, -46.5, 0.3, 1);
  const review = await op.query(api.calibration.active, {});
  expect(review?.state).toBe("review");
  expect(review?.proposals?.map((p) => [review.names[p.receiver], p.offsetDb, p.ppm])).toEqual([
    ["A", 0, 1.2],
    ["B", -2.5, -0.6],
    ["C", 1.5, 0.3],
  ]);
  expect((await asReceiver(t, a).query(api.control.mine, {}))?.commands).toEqual([]);

  await op.mutation(api.calibration.apply, { session, receivers: [b, c] });
  const list = await op.query(api.receivers.list, {});
  const byName = Object.fromEntries(list.map((r) => [r.name, r]));
  expect(byName.B?.config).toMatchObject({
    offsetDb: -2.5,
    offsetSource: "calibration",
    ppm: -0.6,
  });
  expect(byName.B?.calibration).toMatchObject({ serial: "serial-B" });
  expect(byName.A?.config.offsetDb).toBe(0);
  expect(byName.A?.calibration).toBeNull();
  expect(await op.query(api.calibration.active, {})).toBeNull();
});

test("after 60 s the session reviews with the missing marked; frequency-only proposes ppm", async () => {
  const t = makeTest();
  const { op, ids } = await fleet(t, ["A", "B"]);
  const [a, b] = ids as [Id<"receivers">, Id<"receivers">];
  await op.mutation(api.orgConfig.save, { expectedV: 1, values: { ...D, referenceHz: REF } });
  const session = await op.mutation(api.calibration.start, { receivers: [a, b] });
  await report(t, a, session, -45, 1, 1);
  await advance(t, 60_000);
  const review = await op.query(api.calibration.active, {});
  expect(review).toMatchObject({ state: "review", missing: [b] });
  await op.mutation(api.calibration.cancel, { session });

  const solo = await op.mutation(api.calibration.frequencyOnly, { receiverId: b });
  await report(t, b, solo, -60, -2, 2);
  expect((await op.query(api.calibration.active, {}))?.proposals).toEqual([
    { receiver: b, measuredDbm: -60, offsetDb: null, ppm: -2 },
  ]);
});
