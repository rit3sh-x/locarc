import { v } from "convex/values";
import {
  env,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { createAuth } from "./auth";
import { randomToken, sha256Hex } from "./lib/crypto";
import { fail } from "./lib/errors";
import { requireOperator } from "./lib/guards";

export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function insertInvite(ctx: MutationCtx, email: string, createdBy: string) {
  const token = randomToken();
  await ctx.db.insert("invites", {
    email,
    tokenHash: await sha256Hex(token),
    expiresAt: Date.now() + INVITE_TTL_MS,
    usedAt: null,
    createdBy,
  });
  return token;
}

const inviteByHash = (ctx: QueryCtx, tokenHash: string) =>
  ctx.db
    .query("invites")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();

export const inviteIsValid = internalQuery({
  args: { tokenHash: v.string(), email: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { tokenHash, email, now }) => {
    const invite = await inviteByHash(ctx, tokenHash);
    return (
      invite !== null && invite.email === email && invite.usedAt === null && invite.expiresAt > now
    );
  },
});

/** For the invite page: who the link is for. Expiry is checked by the page and at sign-up. */
export const invite = query({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ email: v.string(), expiresAt: v.number() })),
  handler: async (ctx, { token }) => {
    const invite = await inviteByHash(ctx, await sha256Hex(token));
    if (!invite || invite.usedAt !== null) return null;
    return { email: invite.email, expiresAt: invite.expiresAt };
  },
});

export const list = query({
  args: {},
  returns: v.object({
    operators: v.array(
      v.object({ id: v.id("operators"), name: v.string(), email: v.string(), isMe: v.boolean() }),
    ),
    invites: v.array(
      v.object({
        id: v.id("invites"),
        email: v.string(),
        expiresAt: v.number(),
        createdBy: v.string(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const me = await requireOperator(ctx);
    const operators = await ctx.db.query("operators").take(100);
    const invites = await ctx.db.query("invites").order("desc").take(100);
    return {
      operators: operators.map((o) => ({
        id: o._id,
        name: o.name,
        email: o.email,
        isMe: o._id === me._id,
      })),
      invites: invites
        .filter((i) => i.usedAt === null)
        .map((i) => ({
          id: i._id,
          email: i.email,
          expiresAt: i.expiresAt,
          createdBy: i.createdBy,
        })),
    };
  },
});

export const createInvite = mutation({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const me = await requireOperator(ctx);
    const email = normalizeEmail(args.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      fail("VALUE_OUT_OF_RANGE", "Enter a valid email.");
    const existing = await ctx.db
      .query("operators")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) fail("NAME_TAKEN", "That person is already an Operator.");
    return `${env.SITE_URL}/invite/${await insertInvite(ctx, email, me.name)}`;
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    await requireOperator(ctx);
    const invite = await ctx.db.get("invites", inviteId);
    if (invite && invite.usedAt === null) await ctx.db.delete("invites", inviteId);
    return null;
  },
});

export const createResetLink = mutation({
  args: { operatorId: v.id("operators") },
  returns: v.string(),
  handler: async (ctx, { operatorId }) => {
    await requireOperator(ctx);
    const target = await ctx.db.get("operators", operatorId);
    if (!target) fail("NOT_FOUND");
    let token: string | undefined;
    const auth = createAuth(ctx, {
      onResetToken: (t) => {
        token = t;
      },
    });
    await auth.api.requestPasswordReset({ body: { email: target.email } });
    if (token === undefined) fail("NOT_FOUND");
    return `${env.SITE_URL}/reset/${token}`;
  },
});

export const removeOperator = mutation({
  args: { operatorId: v.id("operators") },
  returns: v.null(),
  handler: async (ctx, { operatorId }) => {
    await requireOperator(ctx);
    const target = await ctx.db.get("operators", operatorId);
    if (!target) return null;
    if ((await ctx.db.query("operators").take(2)).length < 2) fail("LAST_OPERATOR");
    await ctx.db.delete("operators", operatorId);
    // Their user, sessions and accounts go too, so the next token refresh fails as well.
    const { internalAdapter } = await createAuth(ctx).$context;
    await internalAdapter.deleteUser(target.userId);
    return null;
  },
});
