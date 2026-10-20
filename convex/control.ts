import { query } from "./_generated/server";
import { requireReceiver } from "./lib/guards";

/** The phone's only subscription: Run state, desired config, commands and the latest release. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const receiver = await requireReceiver(ctx);
    const control = await ctx.db
      .query("receiverControl")
      .withIndex("by_receiver", (q) => q.eq("receiver", receiver._id))
      .unique();
    if (!control) return null;
    const { _id, _creationTime, ...doc } = control;
    return doc;
  },
});
