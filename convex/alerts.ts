import { paginationOptsValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";

import type { Doc } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { requireOperator } from "./lib/guards";
import type { alertTypeValidator } from "./schema";

export type AlertType = Infer<typeof alertTypeValidator>;
export const COOL_DOWN_MS = 30 * 60_000;

export type AlertInput = {
  subjectKey: string;
  type: AlertType;
  kind: "condition" | "event";
  severity: "critical" | "warning";
  title: string;
  detail: string;
};

const active = (
  ctx: MutationCtx,
  subjectKey: string,
  type: AlertType,
  state: Doc<"alerts">["state"],
) =>
  ctx.db
    .query("alerts")
    .withIndex("by_subjectKey_and_type_and_state", (q) =>
      q.eq("subjectKey", subjectKey).eq("type", type).eq("state", state),
    )
    .order("desc")
    .first();

/**
 * One open alert per subject + type: a repeat bumps count and lastAt without notifying again.
 * An acknowledged event alert can't reopen until its 30-minute cool-down ends.
 */
export async function raiseAlert(ctx: MutationCtx, a: AlertInput, now: number) {
  const existing =
    (await active(ctx, a.subjectKey, a.type, "open")) ??
    (await active(ctx, a.subjectKey, a.type, "acknowledged"));
  if (
    existing &&
    (a.kind === "condition" || existing.state === "open" || (existing.coolDownUntil ?? 0) > now)
  ) {
    await ctx.db.patch("alerts", existing._id, {
      count: existing.count + 1,
      lastAt: now,
      detail: a.detail,
    });
    return { id: existing._id, opened: false };
  }
  const id = await ctx.db.insert("alerts", {
    ...a,
    state: "open",
    count: 1,
    firstAt: now,
    lastAt: now,
    ackBy: null,
    ackAt: null,
    coolDownUntil: null,
    resolvedAt: null,
  });
  // Critical alerts reach opted-in browsers even with no tab open: one push action per alert.
  if (a.severity === "critical")
    await ctx.scheduler.runAfter(0, internal.push.send, { alertId: id });
  return { id, opened: true };
}

/** Condition alerts resolve themselves when their condition clears. */
export async function resolveAlert(
  ctx: MutationCtx,
  subjectKey: string,
  type: AlertType,
  now: number,
) {
  for (const state of ["open", "acknowledged"] as const) {
    const a = await active(ctx, subjectKey, type, state);
    if (a) await ctx.db.patch("alerts", a._id, { state: "resolved", resolvedAt: now });
  }
}

/** Rare subscription: what needs attention now, newest first, plus recent acknowledgements. */
export const open = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const byState = (state: Doc<"alerts">["state"], n: number) =>
      ctx.db
        .query("alerts")
        .withIndex("by_state_and_lastAt", (q) => q.eq("state", state))
        .order("desc")
        .take(n);
    return { open: await byState("open", 100), acknowledged: await byState("acknowledged", 30) };
  },
});

async function acknowledge(ctx: MutationCtx, alert: Doc<"alerts">, by: string, now: number) {
  if (alert.state !== "open" || alert.kind !== "event") return;
  await ctx.db.patch("alerts", alert._id, {
    state: "acknowledged",
    ackBy: by,
    ackAt: now,
    coolDownUntil: now + COOL_DOWN_MS,
  });
}

/** Shared by the team: one acknowledgement records who and when, and starts the cool-down. */
export const ack = mutation({
  args: { alertId: v.id("alerts") },
  returns: v.null(),
  handler: async (ctx, { alertId }) => {
    const operator = await requireOperator(ctx);
    const alert = await ctx.db.get("alerts", alertId);
    if (alert) await acknowledge(ctx, alert, operator.name, Date.now());
    return null;
  },
});

export const ackAll = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const now = Date.now();
    const open = await ctx.db
      .query("alerts")
      .withIndex("by_state_and_lastAt", (q) => q.eq("state", "open"))
      .take(200);
    const events = open.filter((a) => a.kind === "event");
    for (const a of events) await acknowledge(ctx, a, operator.name, now);
    return events.length;
  },
});

/** One-shot pages of the 90-day history, newest first, optionally filtered. */
export const history = query({
  args: {
    paginationOpts: paginationOptsValidator,
    state: v.optional(v.union(v.literal("open"), v.literal("acknowledged"), v.literal("resolved"))),
    severity: v.optional(v.union(v.literal("critical"), v.literal("warning"))),
    type: v.optional(v.string()),
  },
  handler: async (ctx, { paginationOpts, state, severity, type }) => {
    await requireOperator(ctx);
    const base = state
      ? ctx.db
          .query("alerts")
          .withIndex("by_state_and_lastAt", (q) => q.eq("state", state))
          .order("desc")
      : ctx.db.query("alerts").order("desc");
    return await base
      .filter((q) =>
        q.and(
          severity ? q.eq(q.field("severity"), severity) : true,
          type ? q.eq(q.field("type"), type) : true,
        ),
      )
      .paginate(paginationOpts);
  },
});
