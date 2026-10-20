import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { snapToRaster } from "./lib/channelMath";
import { fail } from "./lib/errors";
import { requireOperator } from "./lib/guards";
import { currentConfig } from "./orgConfig";

const entryArgs = {
  freqHz: v.number(),
  name: v.string(),
  notes: v.string(),
  rules: v.object({ heard: v.boolean(), moved: v.boolean(), silent: v.boolean() }),
  critical: v.boolean(),
  home: v.union(v.null(), v.object({ lat: v.number(), lng: v.number() })),
};

/** Rare subscription: the known Emitters, each with its last span, when last located, open alerts. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const entries = await ctx.db.query("watchlist").take(200);
    return await Promise.all(
      entries.map(async (e) => {
        const activity = await ctx.db
          .query("emitterActivity")
          .withIndex("by_freqHz", (q) => q.eq("freqHz", e.freqHz))
          .unique();
        const open = await ctx.db
          .query("alerts")
          .withIndex("by_subjectKey_and_type_and_state")
          .filter((q) =>
            q.and(q.eq(q.field("subjectKey"), `ch:${e.freqHz}`), q.eq(q.field("state"), "open")),
          )
          .take(10);
        return {
          ...e,
          lastLocatedAt: activity?.lastLocatedAt ?? null,
          lowHz: activity?.lowHz ?? null,
          highHz: activity?.highHz ?? null,
          openAlerts: open.length,
        };
      }),
    );
  },
});

/**
 * Adds or edits the entry for a Channel, keyed by its centre frequency (snapped to the raster).
 * Naming a Channel is how a New alert is triaged, so it acknowledges that alert too.
 */
export const upsert = mutation({
  args: entryArgs,
  returns: v.number(),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const name = args.name.trim();
    if (!name) fail("VALUE_OUT_OF_RANGE", "Give the Channel a name.");
    if (args.freqHz < 1e6 || args.freqHz > 6000e6)
      fail("VALUE_OUT_OF_RANGE", "Use a frequency within 1–6000 MHz.");
    const { version } = await currentConfig(ctx);
    const freqHz = snapToRaster(args.freqHz, version.values.rasterHz);
    const entry = { ...args, freqHz, name, notes: args.notes.trim() };
    const existing = await ctx.db
      .query("watchlist")
      .withIndex("by_freqHz", (q) => q.eq("freqHz", freqHz))
      .unique();
    if (existing) await ctx.db.patch("watchlist", existing._id, entry);
    else await ctx.db.insert("watchlist", { ...entry, createdBy: operator.name });

    const now = Date.now();
    const pending = await ctx.db
      .query("alerts")
      .withIndex("by_subjectKey_and_type_and_state", (q) =>
        q.eq("subjectKey", `ch:${freqHz}`).eq("type", "new").eq("state", "open"),
      )
      .take(5);
    for (const a of pending) {
      await ctx.db.patch("alerts", a._id, {
        state: "acknowledged",
        ackBy: operator.name,
        ackAt: now,
        coolDownUntil: now + 30 * 60_000,
      });
    }
    return freqHz;
  },
});

export const remove = mutation({
  args: { freqHz: v.number() },
  returns: v.null(),
  handler: async (ctx, { freqHz }) => {
    await requireOperator(ctx);
    const existing = await ctx.db
      .query("watchlist")
      .withIndex("by_freqHz", (q) => q.eq("freqHz", freqHz))
      .unique();
    if (existing) await ctx.db.delete("watchlist", existing._id);
    return null;
  },
});
