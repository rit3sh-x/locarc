import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { snapToRaster } from "./lib/channelMath";
import { fail } from "./lib/errors";
import { fieldResult } from "./lib/fieldTest";
import { requireOperator } from "./lib/guards";
import { currentConfig, saveValues } from "./orgConfig";

/** Rare subscription: running and finished tests, newest first, with their results. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return await ctx.db.query("fieldTests").withIndex("by_startedAt").order("desc").take(50);
  },
});

export const create = mutation({
  args: {
    label: v.string(),
    freqHz: v.number(),
    truth: v.object({ lat: v.number(), lng: v.number() }),
  },
  returns: v.id("fieldTests"),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const label = args.label.trim();
    if (!label) fail("VALUE_OUT_OF_RANGE", "Name the test.");
    if (Math.abs(args.truth.lat) > 90 || Math.abs(args.truth.lng) > 180)
      fail("VALUE_OUT_OF_RANGE", "That isn't a valid position.");
    const { version } = await currentConfig(ctx);
    return await ctx.db.insert("fieldTests", {
      label,
      freqHz: snapToRaster(args.freqHz, version.values.rasterHz),
      truth: args.truth,
      startedAt: Date.now(),
      endedAt: null,
      by: operator.name,
      samples: [],
      result: null,
    });
  },
});

export const stop = mutation({
  args: { testId: v.id("fieldTests") },
  returns: v.null(),
  handler: async (ctx, { testId }) => {
    await requireOperator(ctx);
    const test = await ctx.db.get("fieldTests", testId);
    if (test && test.endedAt === null)
      await ctx.db.patch("fieldTests", testId, { endedAt: Date.now() });
    return null;
  },
});

/** The best-fit n becomes a Custom environment through the normal (conflict-checked) save. */
export const applyN = mutation({
  args: { testId: v.id("fieldTests"), expectedV: v.number() },
  returns: v.object({ v: v.number(), runNumber: v.union(v.number(), v.null()) }),
  handler: async (ctx, { testId, expectedV }) => {
    const operator = await requireOperator(ctx);
    const test = await ctx.db.get("fieldTests", testId);
    const n = test?.result?.n;
    if (n === undefined || n === null)
      fail("VALUE_OUT_OF_RANGE", "That test has no best-fit n yet.");
    const { version } = await currentConfig(ctx);
    const rounded = Math.min(6, Math.max(1.5, Math.round(n * 10) / 10));
    return await saveValues(
      ctx,
      operator.name,
      expectedV,
      {
        ...version.values,
        environment: { preset: "custom", n: rounded },
      },
      [`Field test "${test?.label}"`],
    );
  },
});

/** At each Scan close: add the Scan's estimate to each running test its Emitter covered. */
export async function recordFieldSamples(
  ctx: MutationCtx,
  samples: { testId: Id<"fieldTests">; sample: Doc<"fieldTests">["samples"][number] }[],
) {
  for (const { testId, sample } of samples) {
    const test = await ctx.db.get("fieldTests", testId);
    if (!test || test.endedAt !== null) continue;
    const kept = [...test.samples, sample].slice(-300);
    await ctx.db.patch("fieldTests", testId, {
      samples: kept,
      result: fieldResult(test.truth, kept),
    });
  }
}
