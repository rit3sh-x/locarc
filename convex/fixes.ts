import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOperator } from "./lib/guards";

/**
 * One-shot history read (the Map scrubber, Emitter history); paginated, newest first. Fixes are
 * stored on change plus hourly, so the scrubber asks from an hour before the moment it shows.
 */
export const window = query({
  args: {
    from: v.number(),
    to: v.number(),
    freqHz: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { from, to, freqHz, paginationOpts }) => {
    await requireOperator(ctx);
    const q =
      freqHz === undefined
        ? ctx.db.query("fixes").withIndex("by_at", (q) => q.gte("at", from).lte("at", to))
        : ctx.db
            .query("fixes")
            .withIndex("by_freqHz_and_at", (q) =>
              q.eq("freqHz", freqHz).gte("at", from).lte("at", to),
            );
    return await q.order("desc").paginate(paginationOpts);
  },
});

export const byScan = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    await requireOperator(ctx);
    return await ctx.db
      .query("fixes")
      .withIndex("by_scan", (q) => q.eq("scan", scanId))
      .take(200);
  },
});
