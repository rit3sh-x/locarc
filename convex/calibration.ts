import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import { logEvent } from "./health";
import { proposals } from "./lib/calibration";
import { fail } from "./lib/errors";
import { requireOperator } from "./lib/guards";
import { currentConfig } from "./orgConfig";
import { pushReceiverConfig } from "./receivers";

const MEASURE_S = 30;
/** After this, the session moves to review with whoever hasn't reported marked missing. */
const TIMEOUT_MS = 60_000;

/** The session participants are taken out of Scans while it measures. */
export async function measuringParticipants(ctx: MutationCtx): Promise<Set<Id<"receivers">>> {
  const latest = await ctx.db.query("calibrationSessions").withIndex("by_at").order("desc").first();
  return new Set(latest?.state === "measuring" ? latest.participants : []);
}

async function begin(
  ctx: MutationCtx,
  by: string,
  receivers: Id<"receivers">[],
  mode: "full" | "frequency",
) {
  const { version } = await currentConfig(ctx);
  const referenceHz = version.values.referenceHz;
  if (referenceHz === null) fail("REFERENCE_MISSING");
  const latest = await ctx.db.query("calibrationSessions").withIndex("by_at").order("desc").first();
  if (latest?.state === "measuring")
    fail("VALUE_OUT_OF_RANGE", "A calibration session is already measuring.");
  for (const id of receivers) {
    if ((await ctx.db.get("receivers", id))?.status !== "active")
      fail("NOT_FOUND", "Pick paired Receivers.");
  }
  const now = Date.now();
  const session = await ctx.db.insert("calibrationSessions", {
    at: now,
    by,
    referenceHz,
    mode,
    participants: receivers,
    state: "measuring",
    measurements: [],
    missing: [],
    proposals: null,
    applied: [],
  });
  for (const id of receivers) {
    const control = await ctx.db
      .query("receiverControl")
      .withIndex("by_receiver", (q) => q.eq("receiver", id))
      .unique();
    if (!control) continue;
    const seq = control.lastSeq + 1;
    await ctx.db.patch("receiverControl", control._id, {
      lastSeq: seq,
      commands: [
        ...control.commands,
        { seq, kind: "calibrate", session, referenceHz, durationS: MEASURE_S, mode },
      ],
    });
    await logEvent(
      ctx,
      id,
      now,
      "config",
      `Calibration (${mode === "full" ? "power + frequency" : "frequency only"}) started by ${by}`,
    );
  }
  await ctx.scheduler.runAfter(TIMEOUT_MS, internal.calibration.timeout, { session });
  return session;
}

/** Start a co-located session: at least two Receivers near the reference carrier. */
export const start = mutation({
  args: { receivers: v.array(v.id("receivers")) },
  returns: v.id("calibrationSessions"),
  handler: async (ctx, { receivers }) => {
    const operator = await requireOperator(ctx);
    if (new Set(receivers).size < 2) fail("TOO_FEW_RECEIVERS");
    return await begin(ctx, operator.name, [...new Set(receivers)], "full");
  },
});

/** ppm only, for one Receiver anywhere the reference carrier is heard. */
export const frequencyOnly = mutation({
  args: { receiverId: v.id("receivers") },
  returns: v.id("calibrationSessions"),
  handler: async (ctx, { receiverId }) => {
    const operator = await requireOperator(ctx);
    return await begin(ctx, operator.name, [receiverId], "frequency");
  },
});

async function toReview(ctx: MutationCtx, s: Doc<"calibrationSessions">) {
  const measured = new Set(s.measurements.map((m) => m.receiver));
  await ctx.db.patch("calibrationSessions", s._id, {
    state: "review",
    missing: s.participants.filter((p) => !measured.has(p)),
    proposals: proposals(s.measurements, s.referenceHz, s.mode).map((p) => ({
      ...p,
      receiver: p.receiver as Id<"receivers">,
    })),
  });
}

/** A phone's measurement, delivered through sync. The last one in moves the session to review. */
export async function recordMeasurement(
  ctx: MutationCtx,
  receiver: Id<"receivers">,
  m: { session: Id<"calibrationSessions">; powerDbm: number; freqOffsetHz: number },
) {
  const s = await ctx.db.get("calibrationSessions", m.session);
  if (s?.state !== "measuring" || !s.participants.includes(receiver)) return;
  if (s.measurements.some((x) => x.receiver === receiver)) return;
  const measurements = [
    ...s.measurements,
    { receiver, powerDbm: m.powerDbm, freqOffsetHz: m.freqOffsetHz, at: Date.now() },
  ];
  await ctx.db.patch("calibrationSessions", s._id, { measurements });
  if (measurements.length === s.participants.length) await toReview(ctx, { ...s, measurements });
}

export const timeout = internalMutation({
  args: { session: v.id("calibrationSessions") },
  returns: v.null(),
  handler: async (ctx, { session }) => {
    const s = await ctx.db.get("calibrationSessions", session);
    if (s?.state === "measuring") await toReview(ctx, s);
    return null;
  },
});

/** Writes one config version per ticked Receiver and records the HackRF it was calibrated with. */
export const apply = mutation({
  args: { session: v.id("calibrationSessions"), receivers: v.array(v.id("receivers")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const s = await ctx.db.get("calibrationSessions", args.session);
    if (s?.state !== "review") fail("NOT_FOUND", "That session isn't waiting for review.");
    const now = Date.now();
    for (const p of s.proposals ?? []) {
      if (!args.receivers.includes(p.receiver)) continue;
      const r = await ctx.db.get("receivers", p.receiver);
      if (!r || r.status === "removed") continue;
      const values = {
        ...r.config,
        ppm: p.ppm,
        ...(p.offsetDb === null
          ? {}
          : { offsetDb: p.offsetDb, offsetSource: "calibration" as const }),
      };
      await pushReceiverConfig(
        ctx,
        operator.name,
        { receiverId: r._id, expectedV: r.configV, values },
        ["Calibration session"],
      );
      if (s.mode === "full")
        await ctx.db.patch("receivers", r._id, {
          calibration: { at: now, serial: r.hackrfSerial ?? "unknown" },
        });
    }
    await ctx.db.patch("calibrationSessions", s._id, { state: "applied", applied: args.receivers });
    return null;
  },
});

export const cancel = mutation({
  args: { session: v.id("calibrationSessions") },
  returns: v.null(),
  handler: async (ctx, { session }) => {
    await requireOperator(ctx);
    const s = await ctx.db.get("calibrationSessions", session);
    if (!s || s.state === "applied" || s.state === "cancelled") return null;
    await ctx.db.patch("calibrationSessions", session, { state: "cancelled" });
    for (const id of s.participants) {
      const control = await ctx.db
        .query("receiverControl")
        .withIndex("by_receiver", (q) => q.eq("receiver", id))
        .unique();
      if (control)
        await ctx.db.patch("receiverControl", control._id, {
          commands: control.commands.filter((c) => c.session !== session),
        });
    }
    return null;
  },
});

/** Rare subscription: the session being measured or reviewed, with Receiver names. */
export const active = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const s = await ctx.db.query("calibrationSessions").withIndex("by_at").order("desc").first();
    if (!s || s.state === "applied" || s.state === "cancelled") return null;
    const names: Record<string, string> = {};
    for (const id of s.participants)
      names[id] = (await ctx.db.get("receivers", id))?.name ?? "removed";
    return { ...s, names };
  },
});
