import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { createAuth } from "./auth";
import { ORG_CONFIG_DEFAULTS } from "./lib/config";
import { fail } from "./lib/errors";
import { insertInvite } from "./team";

// Idempotent until the first Operator exists, so a failed sign-up (say, a short password)
// can simply be retried.
export const prepare = internalMutation({
  args: { orgName: v.string(), email: v.string() },
  returns: v.string(),
  handler: async (ctx, { orgName, email }) => {
    const org = await ctx.db.query("organization").first();
    if (org) {
      if (await ctx.db.query("operators").first()) fail("ALREADY_SET_UP");
      await ctx.db.patch("organization", org._id, { name: orgName });
    } else {
      await ctx.db.insert("orgConfigVersions", {
        v: 1,
        author: "setup",
        at: Date.now(),
        values: ORG_CONFIG_DEFAULTS,
        diff: [],
      });
      await ctx.db.insert("organization", {
        name: orgName,
        configV: 1,
        run: null,
        firstRunAt: null,
        planChange: null,
      });
    }
    return await insertInvite(ctx, email, "setup");
  },
});

export const init = internalAction({
  args: { orgName: v.string(), name: v.string(), email: v.string(), password: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const token: string = await ctx.runMutation(internal.setup.prepare, {
      orgName: args.orgName,
      email,
    });
    await createAuth(ctx).api.signUpEmail({
      body: { name: args.name, email, password: args.password },
      headers: new Headers({ "x-invite-token": token }),
    });
    return null;
  },
});

export const resetPassword = internalAction({
  args: { email: v.string(), password: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    let token: string | undefined;
    const auth = createAuth(ctx, {
      onResetToken: (t) => {
        token = t;
      },
    });
    await auth.api.requestPasswordReset({ body: { email: args.email.trim().toLowerCase() } });
    if (token === undefined) fail("NOT_FOUND", "No Operator with that email.");
    await auth.api.resetPassword({ body: { token, newPassword: args.password } });
    return null;
  },
});
