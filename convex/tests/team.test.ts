import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { api, components } from "../_generated/api";
import { createAuth } from "../auth";
import { asOperator, expectCode, makeTest, setUp, type T } from "./harness.setup";

const signUp = (t: T, token: string, email: string, password = "password-123") =>
  t.run((ctx) =>
    createAuth(ctx).api.signUpEmail({
      body: { name: "Second Operator", email, password },
      headers: new Headers({ "x-invite-token": token }),
    }),
  );
const signIn = (t: T, email: string, password: string) =>
  t.run((ctx) => createAuth(ctx).api.signInEmail({ body: { email, password } }));
const tokenOf = (link: string, kind: "invite" | "reset") => link.split(`/${kind}/`)[1] ?? "";

afterEach(() => setSystemTime());

describe("invites", () => {
  test("are bound to an email, stored hashed and good for one sign-up", async () => {
    const t = makeTest();
    const first = await setUp(t);
    const link = await first.mutation(api.team.createInvite, { email: " Second@Example.com " });
    expect(link).toStartWith("http://localhost:5173/invite/");
    const token = tokenOf(link, "invite");
    const rows = await t.run((ctx) => ctx.db.query("invites").collect());
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(await t.query(api.team.invite, { token })).toMatchObject({
      email: "second@example.com",
    });

    await expect(signUp(t, token, "someone-else@example.com")).rejects.toThrow();
    await signUp(t, token, "second@example.com");
    expect(await t.query(api.team.invite, { token })).toBeNull();
    const second = await asOperator(t, "second@example.com");
    expect((await second.query(api.operators.me, {}))?.name).toBe("Second Operator");

    const again = tokenOf(
      await first.mutation(api.team.createInvite, { email: "third@example.com" }),
      "invite",
    );
    await signUp(t, again, "third@example.com");
    await expect(signUp(t, again, "third@example.com", "another-pass-1")).rejects.toThrow();
  });

  test("expire after 7 days and can be revoked", async () => {
    const t = makeTest();
    const first = await setUp(t);
    const token = tokenOf(
      await first.mutation(api.team.createInvite, { email: "late@example.com" }),
      "invite",
    );
    setSystemTime(new Date(Date.now() + 7 * 24 * 3600e3 + 60e3));
    await expect(signUp(t, token, "late@example.com")).rejects.toThrow();
    setSystemTime();

    await first.mutation(api.team.createInvite, { email: "maybe@example.com" });
    const { invites } = await first.query(api.team.list, {});
    const maybe = invites.find((i) => i.email === "maybe@example.com");
    if (!maybe) throw new Error("invite missing");
    await first.mutation(api.team.revokeInvite, { inviteId: maybe.id });
    expect((await first.query(api.team.list, {})).invites.map((i) => i.email)).toEqual([
      "late@example.com",
    ]);
  });

  test("refuse existing Operators and bad emails", async () => {
    const t = makeTest();
    const first = await setUp(t);
    await expectCode(
      first.mutation(api.team.createInvite, { email: "first@example.com" }),
      "NAME_TAKEN",
    );
    await expectCode(
      first.mutation(api.team.createInvite, { email: "nope" }),
      "VALUE_OUT_OF_RANGE",
    );
  });
});

describe("reset links", () => {
  test("set a new password once", async () => {
    const t = makeTest();
    const first = await setUp(t);
    const { operators } = await first.query(api.team.list, {});
    const link = await first.mutation(api.team.createResetLink, {
      operatorId: operators[0]?.id ?? ("" as never),
    });
    expect(link).toStartWith("http://localhost:5173/reset/");
    const token = tokenOf(link, "reset");
    await t.run((ctx) =>
      createAuth(ctx).api.resetPassword({ body: { token, newPassword: "brand-new-pass-1" } }),
    );
    await signIn(t, "first@example.com", "brand-new-pass-1");
    await expect(signIn(t, "first@example.com", "password-123")).rejects.toThrow();
    await expect(
      t.run((ctx) =>
        createAuth(ctx).api.resetPassword({ body: { token, newPassword: "again-pass-123" } }),
      ),
    ).rejects.toThrow();
  });
});

describe("removing Operators", () => {
  test("cuts access at once and never removes the last one", async () => {
    const t = makeTest();
    const first = await setUp(t);
    const token = tokenOf(
      await first.mutation(api.team.createInvite, { email: "second@example.com" }),
      "invite",
    );
    await signUp(t, token, "second@example.com");
    const second = await asOperator(t, "second@example.com");
    const { operators } = await first.query(api.team.list, {});
    const ids = Object.fromEntries(operators.map((o) => [o.email, o.id]));

    await first.mutation(api.team.removeOperator, {
      operatorId: ids["second@example.com"] as never,
    });
    expect(await second.query(api.operators.me, {})).toBeNull();
    await expectCode(second.query(api.team.list, {}), "REVOKED");
    const users = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    );
    expect(users.page.map((u: { email: string }) => u.email)).toEqual(["first@example.com"]);
    await expect(signIn(t, "second@example.com", "password-123")).rejects.toThrow();

    await expectCode(
      first.mutation(api.team.removeOperator, { operatorId: ids["first@example.com"] as never }),
      "LAST_OPERATOR",
    );
  });
});
