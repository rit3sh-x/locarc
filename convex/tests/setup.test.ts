import { describe, expect, test } from "bun:test";
import { api, internal } from "../_generated/api";
import { expectCode, makeTest, RECEIVER_ISSUER, setUp } from "./harness.setup";

describe("setup", () => {
  test("creates the Organization, config v1 and the first Operator once", async () => {
    const t = makeTest();
    const op = await setUp(t);
    expect(await op.query(api.operators.me, {})).toEqual({
      name: "First Operator",
      email: "first@example.com",
      organization: "Test Org",
    });
    const versions = await t.run((ctx) => ctx.db.query("orgConfigVersions").collect());
    expect(versions.map((v) => v.v)).toEqual([1]);
    await expectCode(
      t.action(internal.setup.init, {
        orgName: "Again",
        name: "X",
        email: "x@example.com",
        password: "password-123",
      }),
      "ALREADY_SET_UP",
    );
  });

  test("can be retried after a failed sign-up", async () => {
    const t = makeTest();
    const args = { orgName: "Org", name: "A", email: "a@example.com", password: "short" };
    await expect(t.action(internal.setup.init, args)).rejects.toThrow();
    await t.action(internal.setup.init, { ...args, password: "long-enough-1" });
    expect(await t.run((ctx) => ctx.db.query("operators").collect())).toHaveLength(1);
  });

  test("resets a known Operator's password and refuses an unknown email", async () => {
    const t = makeTest();
    await setUp(t);
    await t.action(internal.setup.resetPassword, {
      email: "first@example.com",
      password: "new-password-456",
    });
    await expectCode(
      t.action(internal.setup.resetPassword, {
        email: "nobody@example.com",
        password: "whatever-1",
      }),
      "NOT_FOUND",
    );
  });
});

describe("operators.me", () => {
  test("is null when signed out or when the Operator row is gone", async () => {
    const t = makeTest();
    const op = await setUp(t);
    expect(await t.query(api.operators.me, {})).toBeNull();
    await t.run(async (ctx) => {
      for (const o of await ctx.db.query("operators").collect()) await ctx.db.delete(o._id);
    });
    expect(await op.query(api.operators.me, {})).toBeNull();
  });

  test("rejects a Receiver token", async () => {
    const t = makeTest();
    await setUp(t);
    await expectCode(
      t.withIdentity({ issuer: RECEIVER_ISSUER, subject: "r1" }).query(api.operators.me, {}),
      "WRONG_ISSUER",
    );
  });
});
