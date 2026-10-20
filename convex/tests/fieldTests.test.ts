import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { distanceM, type LatLng } from "../lib/geo";
import { mulberry32, receivedPowerDbm } from "../lib/propagation";
import { advance, asReceiver, makeTest, setUp, testReading, testRecord } from "./harness.setup";

const RX: LatLng[] = [
  { lat: 12.9774, lng: 77.5878 },
  { lat: 12.9791, lng: 77.6024 },
  { lat: 12.9653, lng: 77.6037 },
  { lat: 12.9649, lng: 77.586 },
];
// Near one Receiver, so distances (and the n fit) have leverage.
const TX = { lat: 12.9755, lng: 77.5905, freqHz: 433.925e6 };

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-10-18T12:00:30Z"));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

test("a field test scores Fixes on its Channel; n after 5 Scans; Apply n saves a Custom environment", async () => {
  const t = makeTest();
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
  const testId = await op.mutation(api.fieldTests.create, {
    label: "Gate radio walk",
    freqHz: TX.freqHz,
    truth: { lat: TX.lat, lng: TX.lng },
  });
  await op.mutation(api.runs.start, { cadence: { kind: "oneMinute", hours: 1, revertMinutes: 5 } });
  await advance(t, 30_000);
  const runId = (await op.query(api.live.run, {})).run?._id as Id<"runs">;
  const rand = mulberry32(3);
  for (let k = 0; k < 5; k++) {
    await advance(t, 1500);
    const pt = 25 + rand() * 10;
    for (const [i, id] of ids.entries()) {
      const at = { ...(RX[i] as LatLng), accuracyM: 5, at: Date.now() };
      const powerDbm = receivedPowerDbm({
        ptDbm: pt,
        n: 3.0,
        distanceM: distanceM(RX[i] as LatLng, TX),
        sigmaDb: 1,
        rand,
      });
      await asReceiver(t, id).mutation(api.sync.sync, {
        sentAt: Date.now(),
        heartbeat: healthyHeartbeat({ appliedConfigV: 1 }),
        readings: [testReading(runId, k, { at, emitters: [testRecord(TX.freqHz, powerDbm)] })],
      });
    }
    await advance(t, 60_000 - 1500);
    const [result] = await op.query(api.fieldTests.list, {});
    expect(result?.result?.scans).toBe(k + 1);
    expect(result?.result?.n === null).toBe(k < 4);
  }
  const [done] = await op.query(api.fieldTests.list, {});
  expect(done?.result?.medianErrorM).toBeLessThan(300);
  expect(Math.abs((done?.result?.n ?? 0) - 3.0)).toBeLessThan(0.6);

  const { v } = await op.query(api.orgConfig.current, {});
  await op.mutation(api.fieldTests.applyN, { testId, expectedV: v });
  const after = await op.query(api.orgConfig.current, {});
  expect(after.values.environment).toEqual({
    preset: "custom",
    n: Math.round((done?.result?.n ?? 0) * 10) / 10,
  });
  await op.mutation(api.fieldTests.stop, { testId });
  expect((await op.query(api.fieldTests.list, {}))[0]?.endedAt).not.toBeNull();
});
