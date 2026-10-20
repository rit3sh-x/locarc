import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api, internal } from "../_generated/api";
import { recordError } from "../errors";
import { asReceiver, makeTest, setUp } from "./harness.setup";

beforeEach(() => {
  jest.useFakeTimers();
  setSystemTime(new Date("2026-10-18T12:00:30Z"));
});
afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

const report = (n: number) => ({
  kind: "TypeError",
  message: `Reading ${n} is undefined`,
  stack: `TypeError: x\n    at decode (http://localhost:5180/src/a${n % 2}.ts:1:1)`,
  version: "abc123",
  context: "/scans/3/12",
});

test("web reports group by fingerprint; new and returning ones raise one alert", async () => {
  const t = makeTest();
  const op = await setUp(t);
  expect(await op.mutation(api.errors.report, report(1))).toBe("new");
  expect(await op.mutation(api.errors.report, report(3))).toBe("counted");
  const [group] = await op.query(api.errors.list, {});
  expect(group).toMatchObject({
    source: "web",
    count: 2,
    message: "Reading # is undefined",
    latestVersion: "abc123",
  });
  let { open } = await op.query(api.alerts.open, {});
  expect(open.map((a) => a.title)).toEqual(["New web error: TypeError: Reading # is undefined"]);

  await op.mutation(api.errors.resolve, { errorId: group?._id as never });
  expect((await op.query(api.alerts.open, {})).open).toEqual([]);
  await op.mutation(api.errors.report, report(5));
  ({ open } = await op.query(api.alerts.open, {}));
  expect(open.map((a) => a.title)).toEqual([
    "Returning web error: TypeError: Reading # is undefined",
  ]);
});

test("no more than 50 new fingerprints a day; known ones still count", async () => {
  const t = makeTest();
  const op = await setUp(t);
  const outcomes = await t.run(async (ctx) => {
    const out: string[] = [];
    for (let i = 0; i < 52; i++) {
      out.push(
        await recordError(
          ctx,
          { source: "web", kind: `E${i}`, message: "m", stack: null, version: "v", context: "c" },
          Date.now(),
        ),
      );
    }
    out.push(
      await recordError(
        ctx,
        { source: "web", kind: "E0", message: "m", stack: null, version: "v", context: "c" },
        Date.now(),
      ),
    );
    return out;
  });
  expect(outcomes.filter((o) => o === "new")).toHaveLength(50);
  expect(outcomes.slice(50)).toEqual(["capped", "capped", "counted"]);
  expect((await op.query(api.errors.list, {})).length).toBe(50);
});

test("Android crash reports ride sync; failed scheduled functions are harvested once", async () => {
  const t = makeTest();
  const op = await setUp(t);
  const { receiverId, code } = await op.mutation(api.receivers.createPending, { name: "A" });
  await t.action(api.receiverAuth.pair, { code });
  await asReceiver(t, receiverId).mutation(api.sync.sync, {
    sentAt: Date.now(),
    heartbeat: healthyHeartbeat({ appVersion: "1.2.0" }),
    errors: [
      {
        kind: "IllegalStateException",
        message: "USB device closed",
        stack: "at Usb.read(Usb.kt:42)",
        context: "exit reason: CRASH",
      },
    ],
  });
  const groups = await op.query(api.errors.list, {});
  expect(groups[0]).toMatchObject({
    source: "android",
    latestVersion: "1.2.0",
    latestContext: "A: exit reason: CRASH",
  });

  expect(await t.mutation(internal.errors.harvest, {})).toBe(0);
});
