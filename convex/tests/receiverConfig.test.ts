import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { Heartbeat } from "../lib/heartbeat";
import { advance, asReceiver, expectCode, makeTest, setUp, type T } from "./harness.setup";

const here = { lat: 12.97, lng: 77.59, accuracyM: 5 };

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-10-18T12:00:30Z"));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

async function fleet(t: T) {
  const op = await setUp(t);
  const ids: Id<"receivers">[] = [];
  for (const name of ["A", "B"]) {
    const { receiverId, code } = await op.mutation(api.receivers.createPending, { name });
    await t.action(api.receiverAuth.pair, { code });
    ids.push(receiverId);
  }
  const beat = (
    id: Id<"receivers">,
    hb: Partial<Heartbeat> = {},
    position = { ...here, at: Date.now() },
  ) =>
    asReceiver(t, id).mutation(api.sync.sync, {
      sentAt: Date.now(),
      heartbeat: healthyHeartbeat(hb),
      position,
    });
  for (const id of ids) await beat(id, { appliedConfigV: 1 });
  return { op, ids: ids as [Id<"receivers">, Id<"receivers">], beat };
}

test("a bulk push writes one version per Receiver; the phones apply or reject it", async () => {
  const t = makeTest();
  const { op, ids, beat } = await fleet(t);
  const list = await op.query(api.receivers.list, {});
  const changes = list.map((r) => ({
    receiverId: r._id,
    expectedV: r.configV,
    values: { ...r.config, lnaDb: 24 },
  }));
  expect(await op.mutation(api.receivers.pushConfig, { changes })).toEqual(
    ids.map((receiverId) => ({ receiverId, v: 2 })),
  );
  expect(await asReceiver(t, ids[0]).query(api.control.mine, {})).toMatchObject({
    config: { v: 2, values: { lnaDb: 24 } },
  });

  await beat(ids[0], { appliedConfigV: 2 });
  await beat(ids[1], {
    appliedConfigV: 1,
    rejectedConfig: { v: 2, reason: "LNA 24 dB saturates this phone" },
  });
  const after = await op.query(api.receivers.list, {});
  expect(after.find((r) => r._id === ids[0])).toMatchObject({ appliedV: 2, running: null });
  expect(after.find((r) => r._id === ids[1])).toMatchObject({
    appliedV: 1,
    rejected: { v: 2, reason: "LNA 24 dB saturates this phone" },
    running: { v: 1, values: { lnaDb: 32 } },
  });
  const { open } = await op.query(api.alerts.open, {});
  expect(open.map((a) => [a.type, a.title])).toEqual([
    ["config_rejected", "B: config v2 rejected: LNA 24 dB saturates this phone"],
  ]);

  await expectCode(
    op.mutation(api.receivers.pushConfig, {
      changes: [{ ...changes[0], expectedV: 1 } as (typeof changes)[number]],
    }),
    "CONFIG_CONFLICT",
  );
  await expectCode(
    op.mutation(api.receivers.pushConfig, {
      changes: [
        {
          receiverId: ids[0],
          expectedV: 2,
          values: { ...(changes[0]?.values as (typeof changes)[number]["values"]), vgaDb: 21 },
        },
      ],
    }),
    "VALUE_OUT_OF_RANGE",
  );

  expect(
    await op.mutation(api.receivers.restoreVersion, { receiverId: ids[1], v: 1, expectedV: 2 }),
  ).toBe(3);
  const { page } = await op.query(api.receivers.versions, {
    receiverId: ids[1],
    paginationOpts: { numItems: 5, cursor: null },
  });
  expect(page.map((p) => p.diff)).toEqual([
    ["Restored v1", "LNA: 24 → 32 dB"],
    ["LNA: 32 → 24 dB"],
    [],
  ]);
});

test("pausing takes a Receiver out of Scans and shows Paused", async () => {
  const t = makeTest();
  const { op, ids } = await fleet(t);
  await op.mutation(api.receivers.setPaused, { receiverId: ids[0], paused: true });
  const statuses = await op.query(api.live.receiverStatuses, {});
  expect(statuses.find((s) => s.receiver === ids[0])).toMatchObject({
    state: "paused",
    reasons: [{ code: "paused_operator" }],
  });
  expect((await asReceiver(t, ids[0]).query(api.control.mine, {}))?.paused).toBe(true);
  await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 5 } });
  await advance(t, 60_000);
  const scan = await t.run((ctx) => ctx.db.query("scans").first());
  expect(scan?.expected).toEqual([ids[1]]);
});

test("Moved?: keep the pin quiets it; move the pin re-pins at GPS", async () => {
  const t = makeTest();
  const { op, ids, beat } = await fleet(t);
  const [a] = ids;
  const r = (await op.query(api.receivers.list, {})).find((x) => x._id === a);
  if (!r) throw new Error("missing");
  await op.mutation(api.receivers.pushConfig, {
    changes: [
      {
        receiverId: a,
        expectedV: r.configV,
        values: { ...r.config, position: { mode: "pinned", lat: 12.98, lng: 77.6 } },
      },
    ],
  });
  await beat(a, { appliedConfigV: 2 });
  await advance(t, 5 * 60_000);
  await beat(a, { appliedConfigV: 2 });
  expect((await op.query(api.receivers.get, { receiverId: a }))?.status?.book.moved).toBe(true);

  await op.mutation(api.receivers.resolveDrift, { receiverId: a, action: "keep" });
  await advance(t, 6 * 60_000);
  await beat(a, { appliedConfigV: 2 });
  expect((await op.query(api.receivers.get, { receiverId: a }))?.status?.book.moved).toBe(false);

  await op.mutation(api.receivers.resolveDrift, { receiverId: a, action: "move" });
  const moved = await op.query(api.receivers.get, { receiverId: a });
  expect(moved?.receiver.config.position).toEqual({ mode: "pinned", lat: here.lat, lng: here.lng });
});
