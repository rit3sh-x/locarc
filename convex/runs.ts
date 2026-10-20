import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import { measuringParticipants } from "./calibration";
import {
  type Cadence,
  cadenceValidator,
  FIX_WINDOW_MS,
  sameValue,
  sweepPlan,
  UPLOAD_MARGIN_MS,
} from "./lib/config";
import { requireOperator } from "./lib/guards";
import { OFFLINE_AFTER_MS } from "./lib/health";
import {
  boundaryAt,
  burstLengthMs,
  closeDeadline,
  describeCadence,
  nextRunStart,
  periodMs,
  revertCadence,
} from "./lib/schedule";
import { currentConfig, getOrg, writeOrgConfig } from "./orgConfig";

const runStarted = v.object({ number: v.number(), startsAt: v.number() });

const sameCadence = (a: Cadence, b: Cadence) => sameValue(a, b);

export const controlRunSection = (run: Doc<"runs">) => ({
  runId: run._id,
  number: run.number,
  startsAt: run.startedAt,
  periodMs: run.periodMs,
  plan: run.plan,
  fixWindowMs: run.fixWindowMs,
  uploadMarginMs: run.uploadMarginMs,
  burstEndsAt: run.burstEndsAt,
});

/** Every Receiver's control doc mirrors the Run, so phones learn of Start/Stop instantly. */
async function setControlRun(ctx: MutationCtx, run: Doc<"runs"> | null) {
  const section = run && controlRunSection(run);

  for (const control of await ctx.db.query("receiverControl").take(200)) {
    await ctx.db.patch("receiverControl", control._id, { run: section });
  }
}

async function endRun(ctx: MutationCtx, runId: Id<"runs">, reason: string) {
  const run = await ctx.db.get("runs", runId);
  if (!run || run.endedAt !== null) return;
  await ctx.db.patch("runs", runId, { endedAt: Date.now(), endReason: reason });
  for (const scan of await ctx.db
    .query("scans")
    .withIndex("by_run_and_k", (q) => q.eq("run", runId))
    .order("desc")
    .take(5)) {
    if (scan.state === "collecting") {
      await ctx.db.patch("scans", scan._id, { state: "discarded", reason, closedAt: Date.now() });
    }
  }
}

/** Ends the current Run (if any) and opens the next at the next whole minute. */
export async function openRun(ctx: MutationCtx, startedBy: string, endReason: string) {
  const { org, version } = await currentConfig(ctx);
  if (org.run) await endRun(ctx, org.run, endReason);
  const plan = sweepPlan(version.values);
  const cadence = version.values.cadence;
  const startedAt = nextRunStart(Date.now());
  const burst = burstLengthMs(cadence);
  const last = await ctx.db.query("runs").withIndex("by_number").order("desc").first();
  const runId = await ctx.db.insert("runs", {
    number: (last?.number ?? 0) + 1,
    plan,
    cadence,
    periodMs: periodMs(cadence),
    fixWindowMs: FIX_WINDOW_MS,
    uploadMarginMs: UPLOAD_MARGIN_MS,
    burstEndsAt: burst === null ? null : startedAt + burst,
    configV: version.v,
    startedAt,
    startedBy,
    endedAt: null,
    endReason: null,
  });
  const run = (await ctx.db.get("runs", runId)) as Doc<"runs">;
  await ctx.db.patch("organization", org._id, {
    run: runId,
    firstRunAt: org.firstRunAt ?? startedAt,
  });
  await ctx.scheduler.runAt(startedAt, internal.runs.boundary, { runId, k: 0 });
  if (run.burstEndsAt !== null) {
    await ctx.scheduler.runAt(run.burstEndsAt, internal.runs.burstEnd, { runId });
  }
  await setControlRun(ctx, run);
  return run;
}

export async function stopRun(ctx: MutationCtx, reason: string) {
  const org = await getOrg(ctx);
  if (!org.run) return;
  await endRun(ctx, org.run, reason);
  await ctx.db.patch("organization", org._id, { run: null });
  await setControlRun(ctx, null);
}

/** Active, unpaused, positioned Receivers seen within the Offline window. */
async function expectedReceivers(ctx: MutationCtx, at: number) {
  const expected: Id<"receivers">[] = [];
  const calibrating = await measuringParticipants(ctx);
  for (const r of await ctx.db
    .query("receivers")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .take(200)) {
    if (r.pausedByOperator || calibrating.has(r._id)) continue;
    const s = await ctx.db
      .query("receiverStatus")
      .withIndex("by_receiver", (q) => q.eq("receiver", r._id))
      .unique();
    if (!s?.lastSeenAt || at - s.lastSeenAt >= OFFLINE_AFTER_MS || s.snapshot?.selfPause) continue;
    if (r.config.position.mode !== "pinned" && !s.position) continue;
    expected.push(r._id);
  }
  return expected;
}

/**
 * Scan k of a Run, created on first need: by its scheduled boundary, or by a sync that beats
 * the scheduler to it. Creating it schedules its close.
 */
export async function ensureScan(ctx: MutationCtx, run: Doc<"runs">, k: number) {
  const existing = await ctx.db
    .query("scans")
    .withIndex("by_run_and_k", (q) => q.eq("run", run._id).eq("k", k))
    .unique();
  if (existing) return existing;
  const startsAt = boundaryAt(run.startedAt, run.periodMs, k);
  const deadlineAt = closeDeadline(startsAt, run.periodMs);
  const scanId = await ctx.db.insert("scans", {
    run: run._id,
    k,
    startsAt,
    deadlineAt,
    state: "collecting",
    reason: null,
    expected: await expectedReceivers(ctx, startsAt),
    reportedBy: [],
    reported: 0,
    partial: 0,
    late: 0,
    heard: 0,
    located: 0,
    fixCount: 0,
    closedAt: null,
  });
  await ctx.scheduler.runAt(deadlineAt, internal.scans.close, { scanId });
  return (await ctx.db.get("scans", scanId)) as Doc<"scans">;
}

/** Whether boundary k belongs to the Run (bursts stop scheduling at their end). */
export const inRun = (run: Doc<"runs">, k: number) =>
  k >= 0 &&
  (run.burstEndsAt === null || boundaryAt(run.startedAt, run.periodMs, k) < run.burstEndsAt);

export const boundary = internalMutation({
  args: { runId: v.id("runs"), k: v.number() },
  returns: v.null(),
  handler: async (ctx, { runId, k }) => {
    const run = await ctx.db.get("runs", runId);
    if (!run || run.endedAt !== null) return null;
    await ensureScan(ctx, run, k);
    if (inRun(run, k + 1)) {
      await ctx.scheduler.runAt(
        boundaryAt(run.startedAt, run.periodMs, k + 1),
        internal.runs.boundary,
        {
          runId,
          k: k + 1,
        },
      );
    }
    return null;
  },
});

export const burstEnd = internalMutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const { org, version } = await currentConfig(ctx);
    if (org.run !== runId) return null;
    const cadence = revertCadence(version.values.cadence);
    await writeOrgConfig(ctx, org, { ...version.values, cadence }, "Locarc", [
      `Cadence: burst ended, back to ${describeCadence(cadence)}`,
    ]);
    await openRun(ctx, "Locarc", "Burst ended");
    return null;
  },
});

async function applyCadence(ctx: MutationCtx, cadence: Cadence, author: string) {
  const { org, version } = await currentConfig(ctx);
  if (sameCadence(version.values.cadence, cadence)) return org;
  return await writeOrgConfig(ctx, org, { ...version.values, cadence }, author, [
    `Cadence: ${describeCadence(version.values.cadence)} → ${describeCadence(cadence)}`,
  ]);
}

export const start = mutation({
  args: { cadence: cadenceValidator },
  returns: runStarted,
  handler: async (ctx, { cadence }) => {
    const operator = await requireOperator(ctx);
    await applyCadence(ctx, cadence, operator.name);
    const run = await openRun(ctx, operator.name, `Restarted by ${operator.name}`);
    return { number: run.number, startsAt: run.startedAt };
  },
});

/** Saves the cadence; while scanning it ends the Run and opens the next one. */
export const setCadence = mutation({
  args: { cadence: cadenceValidator },
  returns: v.union(v.null(), runStarted),
  handler: async (ctx, { cadence }) => {
    const operator = await requireOperator(ctx);
    const org = await applyCadence(ctx, cadence, operator.name);
    if (!org.run) return null;
    const run = await openRun(ctx, operator.name, `Cadence changed by ${operator.name}`);
    return { number: run.number, startsAt: run.startedAt };
  },
});

export const stop = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    await stopRun(ctx, `Stopped by ${operator.name}`);
    return null;
  },
});

/** For the Scans list's Run filter: the latest Runs, newest first. */
export const recent = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return await ctx.db.query("runs").withIndex("by_number").order("desc").take(30);
  },
});
