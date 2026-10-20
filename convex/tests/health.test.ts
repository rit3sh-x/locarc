import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { raiseAlert } from "../alerts";
import type { Heartbeat } from "../lib/heartbeat";
import { makeTest, RECEIVER_ISSUER, setUp, type T, testReading } from "./harness.setup";

const START = Date.parse("2026-10-18T12:00:30Z");
const here = { lat: 12.97, lng: 77.59, accuracyM: 5, at: START };

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date(START));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

async function advance(t: T, ms: number) {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 3; i++) {
    await t.finishInProgressScheduledFunctions();
    jest.advanceTimersByTime(0);
  }
}

const rx = (t: T, id: Id<"receivers">) => t.withIdentity({ issuer: RECEIVER_ISSUER, subject: id });

async function fleet(t: T, names: string[]) {
  const op = await setUp(t);
  const ids: Id<"receivers">[] = [];
  for (const name of names) {
    const { receiverId, code } = await op.mutation(api.receivers.createPending, { name });
    await t.action(api.receiverAuth.pair, { code });
    ids.push(receiverId);
    await beat(t, receiverId);
  }
  return { op, ids };
}

const beat = (
  t: T,
  id: Id<"receivers">,
  hb: Partial<Heartbeat> = {},
  position = { ...here, at: Date.now() },
) =>
  rx(t, id).mutation(api.sync.sync, {
    sentAt: Date.now(),
    heartbeat: healthyHeartbeat({ appliedConfigV: 1, ...hb }),
    position,
  });

const status = async (_t: T, op: Awaited<ReturnType<typeof fleet>>["op"], name: string) => {
  const receivers = await op.query(api.receivers.list, {});
  const id = receivers.find((r) => r.name === name)?._id;
  return (await op.query(api.live.receiverStatuses, {})).find((s) => s.receiver === id);
};

const alerts = async (op: Awaited<ReturnType<typeof fleet>>["op"]) => {
  const { open, acknowledged } = await op.query(api.alerts.open, {});
  return [...open, ...acknowledged].map((a) => [a.type, a.state, a.severity]);
};

describe("health on sync", () => {
  test("a replug fault opens a critical alert that resolves when cleared", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A"]);
    const [a] = ids as [Id<"receivers">];
    await beat(t, a, {
      hackrf: {
        state: "needs_attention",
        serial: null,
        boardId: 2,
        firmware: "2023.01.1",
        ladder: 4,
        faults: { RESET_FAILED: 1 },
        detachedSince: null,
      },
    });
    const failing = await status(t, op, "A");
    expect(failing?.state).toBe("needs_attention");
    expect(failing?.reasons[0]?.text).toBe("replug the HackRF");
    expect(await alerts(op)).toEqual([["needs_attention", "open", "critical"]]);
    await beat(t, a);
    // The replug clears the critical alert; an L4 recovery keeps it Degraded for 30 minutes.
    const recovered = await status(t, op, "A");
    expect(recovered?.state).toBe("degraded");
    expect(recovered?.reasons[0]?.text).toBe("USB recovery L3+");
    expect(await alerts(op)).toEqual([]);
    const events = await t.run((ctx) => ctx.db.query("receiverEvents").collect());
    expect(events.map((e) => e.kind)).toEqual([
      "pairing",
      "state",
      "fault",
      "alert",
      "state",
      "alert",
      "state",
    ]);
  });

  test("the dead-man timer marks a silent Receiver Offline with a critical alert", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A"]);
    await advance(t, 11 * 60_000);
    expect((await status(t, op, "A"))?.state).toBe("idle");
    await advance(t, 60_000);
    expect(await status(t, op, "A")).toMatchObject({
      state: "offline",
      reasons: [{ code: "offline" }],
    });
    expect(await alerts(op)).toEqual([["offline", "open", "critical"]]);
    await beat(t, ids[0] as Id<"receivers">);
    expect(await alerts(op)).toEqual([]);
  });

  test("steady syncs write no events and keep one timer", async () => {
    const t = makeTest();
    const { ids } = await fleet(t, ["A"]);
    for (let i = 0; i < 5; i++) {
      await advance(t, 60_000);
      await beat(t, ids[0] as Id<"receivers">);
    }
    const events = await t.run((ctx) => ctx.db.query("receiverEvents").collect());
    expect(events.map((e) => e.kind)).toEqual(["pairing", "state"]);

    const pending = await t.run((ctx) =>
      ctx.db.system
        .query("_scheduled_functions")
        .filter((q) => q.eq(q.field("state.kind"), "pending"))
        .collect(),
    );
    expect(pending.filter((f) => f.name.includes("deadMan"))).toHaveLength(1);
  });

  test("missing 2 Scans in a Run shows Degraded · not reporting", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A", "B"]);
    const [a] = ids as [Id<"receivers">];
    await op.mutation(api.runs.start, {
      cadence: { kind: "oneMinute", hours: 1, revertMinutes: 5 },
    });
    await advance(t, 30_000);
    const runId = (await op.query(api.live.run, {})).run?._id as Id<"runs">;
    for (let k = 0; k < 2; k++) {
      await advance(t, 1500);
      await rx(t, a).mutation(api.sync.sync, {
        sentAt: Date.now(),
        heartbeat: healthyHeartbeat({ appliedConfigV: 1 }),
        readings: [testReading(runId, k, { at: here })],
      });
      await beat(t, ids[1] as Id<"receivers">);
      await advance(t, 60_000 - 1500);
    }
    // Each Scan closes 30 s after the next boundary.
    await advance(t, 30_000);
    expect(await status(t, op, "B")).toMatchObject({
      state: "degraded",
      reasons: [{ text: "not reporting" }],
    });
    expect((await status(t, op, "A"))?.state).toBe("scanning");
  });

  test("a pinned Receiver's GPS far from the pin for 5 minutes raises Moved?", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A"]);
    const [a] = ids as [Id<"receivers">];
    await t.run(async (ctx) => {
      const r = await ctx.db.get("receivers", a);
      if (r)
        await ctx.db.patch("receivers", a, {
          config: { ...r.config, position: { mode: "pinned", lat: 12.98, lng: 77.6 } },
        });
    });
    await beat(t, a);
    await advance(t, 4 * 60_000);
    await beat(t, a);
    expect((await status(t, op, "A"))?.state).toBe("idle");
    await advance(t, 60_000);
    await beat(t, a);
    expect(await status(t, op, "A")).toMatchObject({
      state: "degraded",
      reasons: [{ text: "Moved?" }],
    });
    expect(await alerts(op)).toEqual([["pin_drift", "open", "warning"]]);
  });

  test("Degraded for over 15 minutes raises a warning on the next sync", async () => {
    const t = makeTest();
    const { op, ids } = await fleet(t, ["A"]);
    const slowClock = { clock: { offsetMs: 0, uncertaintyMs: 900 } };
    await beat(t, ids[0] as Id<"receivers">, slowClock);
    await advance(t, 10 * 60_000);
    await beat(t, ids[0] as Id<"receivers">, slowClock);
    expect(await alerts(op)).toEqual([]);
    await advance(t, 6 * 60_000);
    await beat(t, ids[0] as Id<"receivers">, slowClock);
    expect(await alerts(op)).toEqual([["degraded", "open", "warning"]]);
  });
});

describe("alert lifecycle", () => {
  const event = {
    subjectKey: "ch:433925000",
    type: "new" as const,
    kind: "event" as const,
    severity: "warning" as const,
    title: "New emitter",
    detail: "",
  };

  test("one open per subject and type; acknowledgement is shared and cools down 30 minutes", async () => {
    const t = makeTest();
    const op = await setUp(t);
    await t.run((ctx) => raiseAlert(ctx, event, Date.now()));
    await t.run((ctx) => raiseAlert(ctx, event, Date.now()));
    const { open } = await op.query(api.alerts.open, {});
    expect(open).toHaveLength(1);
    expect(open[0]?.count).toBe(2);

    await op.mutation(api.alerts.ack, { alertId: open[0]?._id as Id<"alerts"> });
    expect((await op.query(api.alerts.open, {})).acknowledged[0]).toMatchObject({
      ackBy: "First Operator",
      count: 2,
    });
    await advance(t, 29 * 60_000);
    expect((await t.run((ctx) => raiseAlert(ctx, event, Date.now()))).opened).toBe(false);
    await advance(t, 2 * 60_000);
    expect((await t.run((ctx) => raiseAlert(ctx, event, Date.now()))).opened).toBe(true);
    expect(await op.mutation(api.alerts.ackAll, {})).toBe(1);
    expect((await op.query(api.alerts.open, {})).open).toEqual([]);
  });
});
