import type { Doc } from "../_generated/dataModel";
import { env, type MutationCtx, type QueryCtx } from "../_generated/server";
import { fail } from "./errors";
import { receiverIssuer } from "./receiverJwt";

export async function requireOperator(ctx: QueryCtx | MutationCtx): Promise<Doc<"operators">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("UNAUTHENTICATED");
  if (identity.issuer !== env.CONVEX_SITE_URL) fail("WRONG_ISSUER");
  const operator = await ctx.db
    .query("operators")
    .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
    .unique();
  if (!operator) fail("REVOKED");
  return operator;
}

export async function requireReceiver(ctx: QueryCtx | MutationCtx): Promise<Doc<"receivers">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("UNAUTHENTICATED");
  if (identity.issuer !== receiverIssuer()) fail("WRONG_ISSUER");
  const id = ctx.db.normalizeId("receivers", identity.subject);
  const receiver = id ? await ctx.db.get("receivers", id) : null;
  if (receiver?.status !== "active") fail("REVOKED");
  return receiver;
}
