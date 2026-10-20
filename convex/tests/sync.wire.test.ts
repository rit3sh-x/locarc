// The phone's wire contract: the committed sample request goes through the real sync, and the
// reply keeps the committed sample's shape. The Kotlin tests read the same two files.
import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { convexToJson, jsonToConvex, type Value } from "convex/values";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { fromHex } from "../lib/readingCodec";
import board from "../lib/wire/board.golden.json";
import request from "../lib/wire/sync-request.json";
import { advance, asReceiver, makeTest, setUp } from "./harness.setup";

const REPLY = join(import.meta.dir, "../lib/wire/sync-reply.json");

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-10-18T12:00:30Z"));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

/** Keys and value types, recursively: what a client parser depends on. */
const shape = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.length > 0
      ? [shape(x[0])]
      : []
    : x !== null && typeof x === "object"
      ? Object.fromEntries(
          Object.entries(x)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, shape(v)]),
        )
      : x === null
        ? "null"
        : typeof x;

test("the sample sync request is accepted and the reply keeps the sample's shape", async () => {
  const t = makeTest();
  const op = await setUp(t);
  const { receiverId, code } = await op.mutation(api.receivers.createPending, { name: "Gate 2" });
  await t.action(api.receiverAuth.pair, { code });
  const rx = asReceiver(t, receiverId);
  await rx.mutation(api.sync.sync, { sentAt: Date.now(), heartbeat: healthyHeartbeat() });
  await op.mutation(api.runs.start, { cadence: { kind: "steady", minutes: 15 } });
  await advance(t, 31_000);
  const runId = (await op.query(api.live.run, {})).run?._id as Id<"runs">;
  // A board for the reply to carry.
  await t.run(async (ctx) => {
    const scan = await ctx.db.query("scans").first();
    if (!scan) throw new Error("no Scan");
    const id = await ctx.db.insert("emitterBoards", {
      scan: scan._id,
      run: runId,
      at: scan.startsAt - 900_000,
      rasterHz: 12_500,
      receivers: [{ id: receiverId, name: "Gate 2" }],
      items: fromHex(board.hex).buffer,
    });
    await ctx.db.insert("fieldFeed", {
      board: { id, at: scan.startsAt - 900_000 },
      fleetChangedAt: 0,
      fleet: [],
    });
  });

  const json = JSON.parse(JSON.stringify(request.body.args).replaceAll("$RUN_ID", runId));
  const args = jsonToConvex(json) as Parameters<typeof rx.mutation<typeof api.sync.sync>>[1];
  const reply = await rx.mutation(api.sync.sync, args);
  expect(reply.readings).toEqual([{ runId, k: 0, outcome: "stored" }]);
  expect(reply.board).not.toBeNull();
  expect(reply.fleet?.items).toHaveLength(1);

  const wire = JSON.parse(
    JSON.stringify(convexToJson(reply as unknown as Value))
      .replaceAll(runId, "$RUN_ID")
      .replaceAll(receiverId, "$RECEIVER_ID"),
  );
  if (process.env.WRITE_WIRE) {
    writeFileSync(
      REPLY,
      `${JSON.stringify(
        {
          comment:
            "A sample sync reply as the HTTP API returns it (Convex JSON). The Kotlin client must parse it; `board.items` decodes with wire/board.golden.json's layout. Regenerate with WRITE_WIRE=1 bun test convex/sync.wire.test.ts.",
          value: wire,
        },
        null,
        2,
      )}\n`,
    );
  }
  const sample = (await import("../lib/wire/sync-reply.json")).default;
  expect(shape(wire)).toEqual(shape(sample.value));
});
