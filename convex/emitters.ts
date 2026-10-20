import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, query } from "./_generated/server";
import { distanceM } from "./lib/geo";
import { requireOperator } from "./lib/guards";

/** The phones' feed singleton (newest board pointer + fleet positions), read on every sync. */
export async function feedOf(ctx: QueryCtx) {
  return await ctx.db.query("fieldFeed").first();
}

async function feedDoc(ctx: MutationCtx) {
  const feed = await feedOf(ctx);
  if (feed) return feed;
  const id = await ctx.db.insert("fieldFeed", { board: null, fleetChangedAt: 0, fleet: [] });
  return (await ctx.db.get("fieldFeed", id)) as Doc<"fieldFeed">;
}

export async function pointFeedAt(ctx: MutationCtx, board: Doc<"fieldFeed">["board"]) {
  const feed = await feedDoc(ctx);
  await ctx.db.patch("fieldFeed", feed._id, { board });
}

/**
 * A Receiver's place in the phones' fleet map. Rewritten (with a new changedAt) only when it
 * moved more than max(10 m, its accuracy), switched between pinned and live, or was renamed, so
 * phones re-download the fleet rarely. `null` takes it off the map.
 */
export async function updateFleet(
  ctx: MutationCtx,
  receiver: Pick<Doc<"receivers">, "_id" | "name">,
  place: { lat: number; lng: number; accuracyM: number; pinned: boolean } | null,
  now: number,
) {
  const feed = await feedDoc(ctx);
  const others = feed.fleet.filter((f) => f.receiver !== receiver._id);
  const mine = feed.fleet.find((f) => f.receiver === receiver._id);
  if (place === null) {
    if (mine) await ctx.db.patch("fieldFeed", feed._id, { fleet: others, fleetChangedAt: now });
    return;
  }
  const same =
    mine &&
    mine.name === receiver.name &&
    mine.pinned === place.pinned &&
    distanceM(mine, place) <= Math.max(10, place.accuracyM);
  if (same) return;
  const { lat, lng, accuracyM, pinned } = place;
  await ctx.db.patch("fieldFeed", feed._id, {
    fleet: [
      ...others,
      { receiver: receiver._id, name: receiver.name, lat, lng, accuracyM, pinned },
    ],
    fleetChangedAt: now,
  });
}

const boardView = (b: Doc<"emitterBoards">) => ({
  scan: b.scan,
  at: b.at,
  rasterHz: b.rasterHz,
  receivers: b.receivers,
  items: b.items,
});

/** Per-Scan subscription: the newest Emitter board (packed; the website decodes it). */
export const board = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const latest = await ctx.db.query("emitterBoards").withIndex("by_at").order("desc").first();
    return latest && boardView(latest);
  },
});

/** One Scan's board, read one-shot by Scan detail. */
export const boardOf = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    await requireOperator(ctx);
    const b = await ctx.db
      .query("emitterBoards")
      .withIndex("by_scan", (q) => q.eq("scan", scanId))
      .first();
    return b && boardView(b);
  },
});

/** Everything about one Emitter, keyed by its name. Re-runs when it gets a stored Fix. */
export const detail = query({
  args: { freqHz: v.number() },
  handler: async (ctx, { freqHz }) => {
    await requireOperator(ctx);
    const watch = await ctx.db
      .query("watchlist")
      .withIndex("by_freqHz", (q) => q.eq("freqHz", freqHz))
      .unique();
    const activity = await ctx.db
      .query("emitterActivity")
      .withIndex("by_freqHz", (q) => q.eq("freqHz", freqHz))
      .unique();
    const recent = await ctx.db
      .query("fixes")
      .withIndex("by_freqHz_and_at", (q) => q.eq("freqHz", freqHz))
      .order("desc")
      .take(20);
    // The latest full Fix carries the region and the per-Receiver powers.
    const full =
      recent.find((f) => f.kind === "change") ??
      (await ctx.db
        .query("fixes")
        .withIndex("by_freqHz_and_at", (q) => q.eq("freqHz", freqHz))
        .order("desc")
        .filter((q) => q.eq(q.field("kind"), "change"))
        .first());
    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_subjectKey_and_type_and_state")
      .filter((q) => q.eq(q.field("subjectKey"), `ch:${freqHz}`))
      .order("desc")
      .take(10);
    return { watch, activity, recent, full, alerts };
  },
});

/** One-shot history: 30 days of stored Fixes, then hourly-best for watched Emitters up to a year. */
export const history = query({
  args: {
    freqHz: v.number(),
    from: v.number(),
    to: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { freqHz, from, to, paginationOpts }) => {
    await requireOperator(ctx);
    return await ctx.db
      .query("fixes")
      .withIndex("by_freqHz_and_at", (q) => q.eq("freqHz", freqHz).gte("at", from).lte("at", to))
      .order("desc")
      .paginate(paginationOpts);
  },
});
