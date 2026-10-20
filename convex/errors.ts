import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { env, internalMutation, type MutationCtx, mutation, query } from "./_generated/server";

import { raiseAlert } from "./alerts";
import {
  type ErrorSource,
  fingerprint,
  normalizeMessage,
  redact,
  sampleStack,
} from "./lib/errorFingerprint";
import { requireOperator } from "./lib/guards";

/** New fingerprints accepted per UTC day; past it, only known ones are counted (no flooding). */
export const NEW_PER_DAY = 50;

export type ErrorReport = {
  source: ErrorSource;
  kind: string;
  message: string;
  stack?: string | null;
  version: string;
  context: string;
};

const dayStart = (t: number) => Math.floor(t / 86_400_000) * 86_400_000;

/**
 * Records one occurrence. A new fingerprint, or a resolved one coming back, raises a warning
 * event alert `err:<fingerprint>`.
 */
export async function recordError(ctx: MutationCtx, e: ErrorReport, now: number) {
  const fp = fingerprint(e);
  const existing = await ctx.db
    .query("errors")
    .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fp))
    .unique();
  const sample = {
    latestVersion: e.version.slice(0, 40),
    latestContext: redact(e.context).slice(0, 200),
    sampleStack: sampleStack(e.stack),
  };
  if (existing) {
    const returning = existing.resolvedAt !== null;
    await ctx.db.patch("errors", existing._id, {
      ...sample,
      count: existing.count + 1,
      lastAt: now,
      resolvedAt: null,
    });
    if (returning) await alertFor(ctx, existing, "returned", now);
    return "counted" as const;
  }
  // A bounded read: at most NEW_PER_DAY rows, never a count over the table.
  const today = await ctx.db
    .query("errors")
    .withIndex("by_firstAt", (q) => q.gte("firstAt", dayStart(now)))
    .take(NEW_PER_DAY);
  if (today.length >= NEW_PER_DAY) return "capped" as const;
  const id = await ctx.db.insert("errors", {
    fingerprint: fp,
    source: e.source,
    kind: e.kind.slice(0, 80),
    message: normalizeMessage(e.message),
    count: 1,
    firstAt: now,
    lastAt: now,
    resolvedAt: null,
    ...sample,
  });
  const doc = await ctx.db.get("errors", id);
  if (doc) await alertFor(ctx, doc, "new", now);
  return "new" as const;
}

const alertFor = (ctx: MutationCtx, e: Doc<"errors">, why: "new" | "returned", now: number) =>
  raiseAlert(
    ctx,
    {
      subjectKey: `err:${e.fingerprint}`,
      type: "error",
      kind: "event",
      severity: "warning",
      title:
        `${why === "new" ? "New" : "Returning"} ${e.source} error: ${e.kind}: ${e.message}`.slice(
          0,
          160,
        ),
      detail: e.latestContext,
    },
    now,
  );

const reportArgs = {
  kind: v.string(),
  message: v.string(),
  stack: v.union(v.string(), v.null()),
  version: v.string(),
  context: v.string(),
};

/** The website's own errors, one capped call each (a failing mutation would roll back with them). */
export const report = mutation({
  args: reportArgs,
  returns: v.union(v.literal("new"), v.literal("counted"), v.literal("capped")),
  handler: async (ctx, e) => {
    await requireOperator(ctx);
    return await recordError(ctx, { ...e, source: "web" }, Date.now());
  },
});

/** Rare subscription: error groups, most recent first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return await ctx.db.query("errors").withIndex("by_lastAt").order("desc").take(100);
  },
});

export const resolve = mutation({
  args: { errorId: v.id("errors") },
  returns: v.null(),
  handler: async (ctx, { errorId }) => {
    await requireOperator(ctx);
    const now = Date.now();
    const e = await ctx.db.get("errors", errorId);
    if (!e) return null;
    await ctx.db.patch("errors", errorId, { resolvedAt: now });
    for (const a of await ctx.db
      .query("alerts")
      .withIndex("by_subjectKey_and_type_and_state", (q) =>
        q.eq("subjectKey", `err:${e.fingerprint}`).eq("type", "error").eq("state", "open"),
      )
      .take(5)) {
      await ctx.db.patch("alerts", a._id, {
        state: "acknowledged",
        ackAt: now,
        coolDownUntil: now,
      });
    }
    return null;
  },
});

/** Hourly: failed scheduled functions since the watermark become server errors. */
export const harvest = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const org = await ctx.db.query("organization").first();
    if (!org) return 0;
    const since = org.errorWatermark ?? 0;
    let latest = since;
    let n = 0;
    for await (const f of ctx.db.system
      .query("_scheduled_functions")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", since))) {
      latest = Math.max(latest, f._creationTime);
      if (f.state.kind !== "failed") continue;
      await recordError(
        ctx,
        {
          source: "server",
          kind: f.name,
          message: f.state.error,
          stack: null,
          version: "server",
          context: f.name,
        },
        Date.now(),
      );
      if (++n >= 100) break;
    }
    await ctx.db.patch("organization", org._id, { errorWatermark: latest });
    return n;
  },
});

/** The hourly cron's entry; test deployments skip it (journeys stay quiet and deterministic). */
export const harvestFromCron = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (env.IS_TEST === "1") return null;
    await ctx.runMutation(internal.errors.harvest, {});
    return null;
  },
});
