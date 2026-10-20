import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";
import { env, internalMutation, type MutationCtx } from "./_generated/server";
import { HOUR, hourOf, RETENTION, thinFixes } from "./lib/retention";

/** Rows deleted per transaction; a rule with more left reschedules itself at once. */
const BATCH = 200;
/** Fixes read per thinning transaction (one hour of them, or part of a busy hour). */
const THIN_BATCH = 1000;

const RULES = [
  "readings",
  "boards",
  "scans",
  "fixes",
  "watchedFixes",
  "events",
  "alerts",
  "errors",
  "activity",
  "invites",
  "pairingCodes",
] as const;
type Rule = (typeof RULES)[number];

async function remove(ctx: MutationCtx, table: TableNames, ids: string[]) {
  for (const id of ids) await ctx.db.delete(table, id as never);
  return ids.length;
}

/** One batch of one rule; returns whether that rule has more to do. */
async function runRule(ctx: MutationCtx, rule: Rule, now: number): Promise<boolean> {
  const before = (ms: number) => now - ms;
  switch (rule) {
    case "readings": {
      const old = await ctx.db
        .query("readings")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", before(RETENTION.readingsMs)))
        .take(BATCH);
      return (
        (await remove(
          ctx,
          "readings",
          old.map((d) => d._id),
        )) === BATCH
      );
    }
    case "boards": {
      const old = await ctx.db
        .query("emitterBoards")
        .withIndex("by_at", (q) => q.lt("at", before(RETENTION.boardsMs)))
        .take(BATCH);
      return (
        (await remove(
          ctx,
          "emitterBoards",
          old.map((d) => d._id),
        )) === BATCH
      );
    }
    case "scans": {
      const old = await ctx.db
        .query("scans")
        .withIndex("by_startsAt", (q) => q.lt("startsAt", before(RETENTION.scansMs)))
        .take(BATCH);
      return (
        (await remove(
          ctx,
          "scans",
          old.map((d) => d._id),
        )) === BATCH
      );
    }
    case "fixes": {
      // Thin each hour once, as it crosses the 30-day mark (a watermark, so kept Fixes aren't re-read).
      const org = await ctx.db.query("organization").first();
      if (!org) return false;
      const edge = hourOf(before(RETENTION.fixesMs));
      const from = org.fixesThinnedTo ?? hourOf(edge - 2 * 86_400_000);
      if (from >= edge) return false;
      const to = from + HOUR;
      const hour = await ctx.db
        .query("fixes")
        .withIndex("by_at", (q) => q.gte("at", from).lt("at", to))
        .take(THIN_BATCH);
      const watched = new Set((await ctx.db.query("watchlist").take(500)).map((w) => w.freqHz));
      await remove(
        ctx,
        "fixes",
        thinFixes(
          hour.map((f) => ({
            id: f._id,
            freqHz: f.freqHz,
            at: f.at,
            uncertaintyM: f.uncertaintyM,
          })),
          watched,
        ),
      );
      // A busy hour is thinned in parts: what's kept competes again with the next part.
      if (hour.length === THIN_BATCH) return true;
      await ctx.db.patch("organization", org._id, { fixesThinnedTo: to });
      return to < edge;
    }
    case "watchedFixes": {
      const old = await ctx.db
        .query("fixes")
        .withIndex("by_at", (q) => q.lt("at", before(RETENTION.watchedFixesMs)))
        .take(BATCH);
      return (
        (await remove(
          ctx,
          "fixes",
          old.map((d) => d._id),
        )) === BATCH
      );
    }
    case "events": {
      const old = await ctx.db
        .query("receiverEvents")
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", before(RETENTION.eventsMs)))
        .take(BATCH);
      return (
        (await remove(
          ctx,
          "receiverEvents",
          old.map((d) => d._id),
        )) === BATCH
      );
    }
    case "alerts": {
      let more = false;
      for (const state of ["acknowledged", "resolved"] as const) {
        const old = await ctx.db
          .query("alerts")
          .withIndex("by_state_and_lastAt", (q) =>
            q.eq("state", state).lt("lastAt", before(RETENTION.closedAlertsMs)),
          )
          .take(BATCH);
        if (
          (await remove(
            ctx,
            "alerts",
            old.map((d) => d._id),
          )) === BATCH
        )
          more = true;
      }
      return more;
    }
    case "errors": {
      const old = await ctx.db
        .query("errors")
        .withIndex("by_lastAt", (q) => q.lt("lastAt", before(RETENTION.errorsMs)))
        .take(BATCH);
      return (
        (await remove(
          ctx,
          "errors",
          old.map((d) => d._id),
        )) === BATCH
      );
    }
    case "activity": {
      const old = await ctx.db
        .query("emitterActivity")
        .withIndex("by_lastLocatedAt", (q) => q.lt("lastLocatedAt", before(RETENTION.activityMs)))
        .take(BATCH);
      return (
        (await remove(
          ctx,
          "emitterActivity",
          old.map((d) => d._id),
        )) === BATCH
      );
    }
    case "invites": {
      const old = await ctx.db
        .query("invites")
        .withIndex("by_creation_time", (q) =>
          q.lt("_creationTime", before(RETENTION.invitesGraceMs)),
        )
        .take(BATCH);
      const done = old.filter(
        (i) => i.usedAt !== null || i.expiresAt < before(RETENTION.invitesGraceMs),
      );
      await remove(
        ctx,
        "invites",
        done.map((d) => d._id),
      );
      return false;
    }
    case "pairingCodes": {
      const old = await ctx.db
        .query("pairingCodes")
        .withIndex("by_creation_time", (q) =>
          q.lt("_creationTime", before(RETENTION.pairingCodesMs)),
        )
        .take(BATCH);
      return (
        (await remove(
          ctx,
          "pairingCodes",
          old.map((d) => d._id),
        )) === BATCH
      );
    }
  }
}

/**
 * The daily purge: one rule per transaction, rescheduling itself with runAfter(0) while a rule
 * has more or rules remain. Crons don't run it in test deployments; tests call it directly.
 */
export const purge = internalMutation({
  args: { rule: v.optional(v.number()), fromCron: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { rule = 0, fromCron = false }) => {
    if (fromCron && env.IS_TEST === "1") return null;
    const name = RULES[rule];
    if (!name) return null;
    const more = await runRule(ctx, name, Date.now());
    const next = more ? rule : rule + 1;
    if (next < RULES.length)
      await ctx.scheduler.runAfter(0, internal.maintenance.purge, { rule: next });
    return null;
  },
});
