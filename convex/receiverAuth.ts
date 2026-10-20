// Called by phones over the HTTP API. Neither needs a session: the pairing code or the
// Receiver secret is the credential.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env, internalMutation, internalQuery } from "./_generated/server";
import { applyHealth, logEvent, rearmDeadMan } from "./health";
import { randomToken, sha256Hex } from "./lib/crypto";
import { fail } from "./lib/errors";

import { normalizePairingCode } from "./lib/pairing";
import { mintReceiverToken } from "./lib/receiverJwt";

const tokenResult = v.object({ token: v.string(), expiresAt: v.number() });
type TokenResult = { token: string; expiresAt: number };

export const pair = action({
  args: { code: v.string() },
  returns: v.object({
    receiverId: v.id("receivers"),
    name: v.string(),
    secret: v.string(),
    token: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (
    ctx,
    { code },
  ): Promise<TokenResult & { receiverId: Id<"receivers">; name: string; secret: string }> => {
    const secret = randomToken(32);
    const { receiverId, name }: { receiverId: Id<"receivers">; name: string } =
      await ctx.runMutation(internal.receiverAuth.redeem, {
        codeHash: await sha256Hex(normalizePairingCode(code)),
        secretHash: await sha256Hex(secret),
      });
    return {
      receiverId,
      name,
      secret,
      ...(await mintReceiverToken(receiverId, env.RECEIVER_JWT_PRIVATE_KEY)),
    };
  },
});

export const token = action({
  args: { secret: v.string() },
  returns: tokenResult,
  handler: async (ctx, { secret }): Promise<TokenResult> => {
    const receiverId: Id<"receivers"> | null = await ctx.runQuery(
      internal.receiverAuth.activeBySecret,
      {
        secretHash: await sha256Hex(secret),
      },
    );
    if (!receiverId) fail("REVOKED", "This Receiver was removed or re-paired. Pair it again.");
    return await mintReceiverToken(receiverId, env.RECEIVER_JWT_PRIVATE_KEY);
  },
});

/** Expired and used codes fail identically. Redeeming rotates the secret (re-pair cuts the old phone off). */
export const redeem = internalMutation({
  args: { codeHash: v.string(), secretHash: v.string() },
  returns: v.object({ receiverId: v.id("receivers"), name: v.string() }),
  handler: async (ctx, { codeHash, secretHash }) => {
    const now = Date.now();
    const code = await ctx.db
      .query("pairingCodes")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
      .unique();
    if (!code || code.usedAt !== null || code.expiresAt <= now) fail("CODE_INVALID");
    const receiver = await ctx.db.get("receivers", code.receiver);
    if (!receiver) fail("CODE_INVALID");
    await ctx.db.patch("pairingCodes", code._id, { usedAt: now });
    await ctx.db.patch("receivers", receiver._id, {
      status: "active",
      secretHash,
      pairedAt: now,
      removedAt: null,
    });
    const status = await ctx.db
      .query("receiverStatus")
      .withIndex("by_receiver", (q) => q.eq("receiver", receiver._id))
      .unique();
    if (status) {
      const book = await rearmDeadMan(ctx, receiver._id, status.book);
      await logEvent(
        ctx,
        receiver._id,
        now,
        "pairing",
        receiver.pairedAt ? "Re-paired with a new phone" : "Paired",
      );
      await applyHealth(ctx, { ...receiver, status: "active" }, status, now, {
        lastSeenAt: now,
        book,
      });
    }
    return { receiverId: receiver._id, name: receiver.name };
  },
});

export const activeBySecret = internalQuery({
  args: { secretHash: v.string() },
  returns: v.union(v.null(), v.id("receivers")),
  handler: async (ctx, { secretHash }) => {
    const receiver = await ctx.db
      .query("receivers")
      .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
      .unique();
    return receiver?.status === "active" ? receiver._id : null;
  },
});
