import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { type MutationCtx, mutation } from "./_generated/server";
import { recordMeasurement } from "./calibration";
import { feedOf, updateFleet } from "./emitters";
import { recordError } from "./errors";

import { applyHealth, logEvent, rearmDeadMan } from "./health";
import { slices } from "./lib/config";
import { fail } from "./lib/errors";
import { distanceM } from "./lib/geo";
import { requireReceiver } from "./lib/guards";
import { type Book, THRESHOLDS } from "./lib/health";
import { heartbeatValidator, positionFixValidator } from "./lib/heartbeat";
import { decodeReading } from "./lib/readingCodec";
import { scanIndexAt } from "./lib/schedule";
import { ensureScan, inRun } from "./runs";
import { closeScan } from "./scans";

export const MAX_SYNC_BYTES = 256 * 1024;
/** Readings with more clock doubt than this are excluded from Fixes. */
export const UNALIGNED_MS = 500;

/** A corrupt payload is still stored; its Scan's localization reports the failure. */
function safeDecode(payload: ArrayBuffer) {
  try {
    return decodeReading(payload);
  } catch {
    return { slices: [], emitters: [] };
  }
}

/** A pinned Receiver whose GPS stays > 100 m (beyond its accuracy) from the pin for 5 min. */

function trackDrift(
  book: Book,
  receiver: Doc<"receivers">,
  position: Doc<"receiverStatus">["position"],
  now: number,
): Book {
  const pin = receiver.config.position;
  if (pin.mode !== "pinned" || !position) return book;
  const far = distanceM(position, pin) > THRESHOLDS.driftM + position.accuracyM;
  if (!far) return { ...book, driftSince: null, driftMuted: false };
  if (book.driftMuted) return book;
  const driftSince = book.driftSince ?? now;
  return { ...book, driftSince, moved: book.moved || now - driftSince >= THRESHOLDS.driftForMs };
}

const readingValidator = v.object({
  runId: v.id("runs"),
  k: v.number(),
  appVersion: v.string(),
  lnaDb: v.number(),
  vgaDb: v.number(),
  amp: v.boolean(),
  ppm: v.number(),
  /** Listened from the boundary; passes in the whole window and in the Fix window. */
  windowMs: v.number(),
  passes: v.number(),
  fixPasses: v.number(),
  /** Null for a full window; otherwise why it was cut short (a fault code, "paused", …). */
  stopReason: v.union(v.string(), v.null()),
  start: v.union(v.null(), positionFixValidator),
  end: v.union(v.null(), positionFixValidator),
  clockUncertaintyMs: v.number(),
  payload: v.bytes(),
});

const outcomeValidator = v.union(v.literal("stored"), v.literal("late"), v.literal("dropped"));

async function storeReading(
  ctx: MutationCtx,
  receiver: Doc<"receivers">,
  r: typeof readingValidator.type,
  now: number,
): Promise<{ outcome: typeof outcomeValidator.type; run?: Doc<"runs"> }> {
  const run = await ctx.db.get("runs", r.runId);
  if (!run) return { outcome: "dropped" };
  // A sync can beat the scheduler to a boundary; only a slot that has begun can exist.
  const begun = run.endedAt === null && r.k <= scanIndexAt(run.startedAt, run.periodMs, now);
  const scan =
    (await ctx.db
      .query("scans")
      .withIndex("by_run_and_k", (q) => q.eq("run", run._id).eq("k", r.k))
      .unique()) ?? (begun && inRun(run, r.k) ? await ensureScan(ctx, run, r.k) : null);
  if (!scan || scan.state === "discarded") return { outcome: "dropped" };

  const existing = await ctx.db
    .query("readings")
    .withIndex("by_receiver_and_run_and_k", (q) =>
      q.eq("receiver", receiver._id).eq("run", run._id).eq("k", r.k),
    )
    .unique();
  if (existing) return { outcome: existing.late ? "late" : "stored" };

  const late = scan.state !== "collecting";
  const partial = r.stopReason !== null;
  await ctx.db.insert("readings", {
    receiver: receiver._id,
    run: run._id,
    scan: scan._id,
    k: r.k,
    appVersion: r.appVersion,
    lnaDb: r.lnaDb,
    vgaDb: r.vgaDb,
    amp: r.amp,
    ppm: r.ppm,
    windowMs: r.windowMs,
    passes: r.passes,
    fixPasses: r.fixPasses,
    stopReason: r.stopReason,
    start: r.start,
    end: r.end,
    clockUncertaintyMs: r.clockUncertaintyMs,
    late,
    // Clock doubt over 5% of the Fix window: its Fix power may not cover everyone's seconds.
    unaligned: r.clockUncertaintyMs > UNALIGNED_MS,
    partial,
    payload: r.payload,
  });
  if (late) {
    await ctx.db.patch("scans", scan._id, { late: scan.late + 1 });
    return { outcome: "late" };
  }
  const reportedBy = [...scan.reportedBy, receiver._id];
  await ctx.db.patch("scans", scan._id, {
    reportedBy,
    reported: scan.reported + 1,
    partial: scan.partial + (partial ? 1 : 0),
  });
  if (scan.expected.length > 0 && scan.expected.every((id) => reportedBy.includes(id))) {
    await closeScan(ctx, scan._id);
  }
  return { outcome: "stored", run };
}

/** The phone's one write: Readings, position, heartbeat and acks, idempotent on resend. */
export const sync = mutation({
  args: {
    sentAt: v.number(),
    heartbeat: heartbeatValidator,
    position: v.optional(positionFixValidator),
    readings: v.optional(v.array(readingValidator)),
    ackSeq: v.optional(v.number()),
    /** The time of the newest Emitter board the phone holds. */
    boardSince: v.optional(v.number()),
    /** The time of the fleet positions the phone holds. */
    fleetSince: v.optional(v.number()),
    /** Crash stacks and Android exit reasons since the last sync. */
    errors: v.optional(
      v.array(
        v.object({
          kind: v.string(),
          message: v.string(),
          stack: v.union(v.string(), v.null()),
          context: v.string(),
        }),
      ),
    ),
    /** Reference-carrier measurements for calibration sessions (offset and ppm turned off). */
    calibration: v.optional(
      v.array(
        v.object({
          session: v.id("calibrationSessions"),
          powerDbm: v.number(),
          freqOffsetHz: v.number(),
        }),
      ),
    ),
  },
  returns: v.object({
    serverTime: v.number(),
    readings: v.array(v.object({ runId: v.id("runs"), k: v.number(), outcome: outcomeValidator })),
    /** The newest Emitter board, only when newer than the phone's (boardCodec). */
    board: v.union(
      v.null(),
      v.object({
        at: v.number(),
        rasterHz: v.number(),
        receivers: v.array(v.object({ id: v.id("receivers"), name: v.string() })),
        items: v.bytes(),
      }),
    ),
    /** The fleet's positions, only when one changed since the phone's copy. */
    fleet: v.union(
      v.null(),
      v.object({
        at: v.number(),
        items: v.array(
          v.object({
            receiver: v.id("receivers"),
            name: v.string(),
            lat: v.number(),
            lng: v.number(),
            accuracyM: v.number(),
            pinned: v.boolean(),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const receiver = await requireReceiver(ctx);
    const now = Date.now();
    const readings = args.readings ?? [];
    if (readings.reduce((n, r) => n + r.payload.byteLength, 0) > MAX_SYNC_BYTES) {
      fail("VALUE_OUT_OF_RANGE", "Send at most 256 KB of Readings per sync.");
    }

    const outcomes = [];
    const stored: { partial: boolean; clippedHz: number | null }[] = [];
    for (const r of readings) {
      const { outcome, run } = await storeReading(ctx, receiver, r, now);
      outcomes.push({ runId: r.runId, k: r.k, outcome });
      // Only new on-time Readings feed health; resends and late ones were counted already.
      if (!run) continue;
      // Health tracks clipping per Reading: "gain too high at <the clipped frequency>".
      const payload = safeDecode(r.payload);
      const clippedEmitter = payload.emitters.find((e) => e.clippedFix);
      const clippedSlice = payload.slices.findIndex((s) => s.clippedFix);
      const slice = clippedSlice >= 0 ? slices(run.plan)[clippedSlice] : undefined;
      const clippedHz = clippedEmitter
        ? clippedEmitter.strongestCh * run.plan.rasterHz
        : slice
          ? (slice.startHz + slice.endHz) / 2
          : null;
      stored.push({ partial: r.stopReason !== null, clippedHz });
    }

    const hb = args.heartbeat;

    // Cold doc: written only when something actually changed.
    const cold: Partial<Doc<"receivers">> = {};
    if (hb.hackrf.serial !== null && hb.hackrf.serial !== receiver.hackrfSerial) {
      cold.hackrfSerial = hb.hackrf.serial;
    }
    if (hb.appliedConfigV !== null && hb.appliedConfigV !== receiver.appliedV) {
      cold.appliedV = hb.appliedConfigV;
    }
    if (JSON.stringify(hb.rejectedConfig) !== JSON.stringify(receiver.rejected)) {
      cold.rejected = hb.rejectedConfig;
    }
    if (Object.keys(cold).length > 0) await ctx.db.patch("receivers", receiver._id, cold);

    const status = await ctx.db
      .query("receiverStatus")
      .withIndex("by_receiver", (q) => q.eq("receiver", receiver._id))
      .unique();
    if (status) {
      const position =
        args.position && (!status.position || args.position.at >= status.position.at)
          ? args.position
          : status.position;
      if (position && receiver.config.position.mode === "live") {
        await updateFleet(ctx, receiver, { ...position, pinned: false }, now);
      }
      let book: Book = { ...status.book };
      for (const r of stored) {
        book.recentPartial = [...book.recentPartial, r.partial].slice(-5);
        book.recentClipped = [...book.recentClipped, r.clippedHz !== null].slice(-3);
        if (r.clippedHz !== null) book.clippedHz = r.clippedHz;
        book.missed = 0;
      }
      if (hb.hackrf.ladder >= THRESHOLDS.ladderLevel) book.ladderAt = now;
      if ((hb.hackrf.faults.POWER_FLAPPING ?? 0) > 0) book.flappingAt = now;
      book = trackDrift(book, receiver, position, now);
      book = await rearmDeadMan(ctx, receiver._id, book);
      const faults = Object.entries(hb.hackrf.faults).filter(([, n]) => n > 0);
      if (faults.length > 0) {
        const text = faults.map(([code, n]) => `${code} ×${n}`).join(", ");
        await logEvent(
          ctx,
          receiver._id,
          now,
          "fault",
          `${text} (ladder L${hb.hackrf.ladder})`,
          Object.fromEntries(faults),
        );
      }
      await applyHealth(ctx, { ...receiver, ...cold }, status, now, {
        lastSeenAt: now,
        appVersion: hb.appVersion,
        position,
        snapshot: hb,
        book,
      });
    }

    for (const m of args.calibration ?? []) await recordMeasurement(ctx, receiver._id, m);
    for (const e of (args.errors ?? []).slice(0, 10)) {
      await recordError(
        ctx,
        {
          ...e,
          source: "android",
          version: hb.appVersion,
          context: `${receiver.name}: ${e.context}`,
        },
        now,
      );
    }

    if (args.ackSeq !== undefined) {
      const control = await ctx.db
        .query("receiverControl")
        .withIndex("by_receiver", (q) => q.eq("receiver", receiver._id))
        .unique();
      const ackSeq = args.ackSeq;
      if (control?.commands.some((c) => c.seq <= ackSeq)) {
        await ctx.db.patch("receiverControl", control._id, {
          commands: control.commands.filter((c) => c.seq > ackSeq),
        });
      }
    }

    // The field map's board and fleet ride back only when the phone's are out of date.
    const feed = await feedOf(ctx);
    const boardRef = feed?.board ?? null;
    const board =
      boardRef && boardRef.at > (args.boardSince ?? Number.NEGATIVE_INFINITY)
        ? await ctx.db.get("emitterBoards", boardRef.id)
        : null;
    const fleetNewer = feed !== null && feed.fleetChangedAt > (args.fleetSince ?? -1);
    return {
      serverTime: now,
      readings: outcomes,
      board: board && {
        at: board.at,
        rasterHz: board.rasterHz,
        receivers: board.receivers,
        items: board.items,
      },
      fleet: fleetNewer ? { at: feed.fleetChangedAt, items: feed.fleet } : null,
    };
  },
});
