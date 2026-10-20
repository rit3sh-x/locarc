import { query } from "./_generated/server";
import { requireOperator } from "./lib/guards";

/** Hot, held once by the website shell: the Run and its latest Scans' progress. */
export const run = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const org = await ctx.db.query("organization").first();
    if (!org?.run) return { run: null, scans: [] };
    const run = await ctx.db.get("runs", org.run);
    if (!run) return { run: null, scans: [] };
    // Two, because Continuous Scans overlap: one can still collect while the next starts.
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_run_and_k", (q) => q.eq("run", run._id))
      .order("desc")
      .take(2);
    return {
      run,
      scans: scans.map(({ reportedBy: _, ...s }) => ({ ...s, expected: s.expected.length })),
    };
  },
});

/** Hot, held once by the website shell: the slim per-Receiver status docs. */
export const receiverStatuses = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const statuses = await ctx.db.query("receiverStatus").take(200);
    return statuses.map(({ _id, _creationTime, ...s }) => s);
  },
});
