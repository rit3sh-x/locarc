import { v } from "convex/values";
import { env, query } from "./_generated/server";
import { fail } from "./lib/errors";

export const me = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ name: v.string(), email: v.string(), organization: v.string() }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    if (identity.issuer !== env.CONVEX_SITE_URL) fail("WRONG_ISSUER");
    const operator = await ctx.db
      .query("operators")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .unique();
    if (!operator) return null;
    const org = await ctx.db.query("organization").first();
    return { name: operator.name, email: operator.email, organization: org?.name ?? "" };
  },
});
