import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { healthyHeartbeat } from "@/scripts/sim/heartbeat";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { formatPairingCode } from "../lib/pairing";
import { expectCode, makeTest, RECEIVER_ISSUER, setUp, type T } from "./harness.setup";

const asReceiver = (t: T, id: Id<"receivers">) =>
  t.withIdentity({ issuer: RECEIVER_ISSUER, subject: id });

afterEach(() => setSystemTime());

describe("pairing", () => {
  test("a code redeems once into a secret and a token; Awaiting pairing becomes Idle", async () => {
    const t = makeTest();
    const op = await setUp(t);
    const { receiverId, code } = await op.mutation(api.receivers.createPending, { name: "Roof" });
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect((await op.query(api.live.receiverStatuses, {}))[0]?.state).toBe("awaiting_pairing");

    // Typed the way a person would: lower case, with the dash.
    const paired = await t.action(api.receiverAuth.pair, {
      code: formatPairingCode(code).toLowerCase(),
    });
    expect(paired).toMatchObject({ receiverId, name: "Roof" });
    expect(paired.token.split(".")).toHaveLength(3);
    expect((await op.query(api.live.receiverStatuses, {}))[0]?.state).toBe("idle");
    expect((await op.query(api.receivers.list, {}))[0]).toMatchObject({
      status: "active",
      pairedAt: expect.any(Number),
    });

    await expectCode(t.action(api.receiverAuth.pair, { code }), "CODE_INVALID");
    const minted = await t.action(api.receiverAuth.token, { secret: paired.secret });
    expect(minted.expiresAt).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect(await asReceiver(t, receiverId).query(api.control.mine, {})).toMatchObject({
      receiver: receiverId,
      config: { v: 1 },
    });
  });

  test("codes expire after 10 minutes and names are unique", async () => {
    const t = makeTest();
    const op = await setUp(t);
    const { code } = await op.mutation(api.receivers.createPending, { name: "Gate" });
    await expectCode(op.mutation(api.receivers.createPending, { name: " Gate " }), "NAME_TAKEN");
    setSystemTime(new Date(Date.now() + 10 * 60_000 + 1000));
    await expectCode(t.action(api.receiverAuth.pair, { code }), "CODE_INVALID");
  });

  test("re-pair rotates the secret; remove refuses the next mint and every call", async () => {
    const t = makeTest();
    const op = await setUp(t);
    const { receiverId, code } = await op.mutation(api.receivers.createPending, { name: "Lab" });
    const first = await t.action(api.receiverAuth.pair, { code });

    const again = await op.mutation(api.receivers.repair, { receiverId });
    const second = await t.action(api.receiverAuth.pair, { code: again.code });
    expect(second.receiverId).toBe(receiverId);
    await expectCode(t.action(api.receiverAuth.token, { secret: first.secret }), "REVOKED");
    await t.action(api.receiverAuth.token, { secret: second.secret });

    await op.mutation(api.receivers.remove, { receiverId });
    await expectCode(t.action(api.receiverAuth.token, { secret: second.secret }), "REVOKED");
    await expectCode(asReceiver(t, receiverId).query(api.control.mine, {}), "REVOKED");
    expect((await op.query(api.receivers.list, {}))[0]).toMatchObject({ status: "removed" });

    const back = await op.mutation(api.receivers.repair, { receiverId });
    await t.action(api.receiverAuth.pair, { code: back.code });
    expect((await op.query(api.receivers.list, {}))[0]).toMatchObject({
      status: "active",
      name: "Lab",
    });
  });

  test("each side's functions reject the other side's tokens", async () => {
    const t = makeTest();
    const op = await setUp(t);
    const { receiverId, code } = await op.mutation(api.receivers.createPending, { name: "Mast" });
    await t.action(api.receiverAuth.pair, { code });
    await expectCode(asReceiver(t, receiverId).query(api.receivers.list, {}), "WRONG_ISSUER");
    await expectCode(op.query(api.control.mine, {}), "WRONG_ISSUER");
    await expectCode(
      op.mutation(api.sync.sync, { sentAt: Date.now(), heartbeat: healthyHeartbeat() }),
      "WRONG_ISSUER",
    );
  });

  test("testing seeds refuse outside test mode", async () => {
    const t = makeTest();
    process.env.IS_TEST = "";
    try {
      const { internal } = await import("../_generated/api");
      await expectCode(t.mutation(internal.tests.seed.expirePairingCodes, {}), "NOT_TEST_MODE");
    } finally {
      process.env.IS_TEST = "1";
    }
  });
});
