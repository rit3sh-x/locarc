import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";
import { type AlertInput, raiseAlert, resolveAlert } from "./alerts";
import { pointFeedAt } from "./emitters";
import { recordError } from "./errors";
import { recordFieldSamples } from "./fieldTests";
import { applyHealth } from "./health";
import { emitterAlerts, median, NEW_AFTER_QUIET_MS, SILENT_SCANS } from "./lib/alertRules";
import { decodeBoard, encodeBoard } from "./lib/boardCodec";
import { formatMHz } from "./lib/channelMath";
import { requireOperator } from "./lib/guards";
import { decodeReading } from "./lib/readingCodec";
import {
  buildEmitters,
  LEAVES_AFTER_MISSED,
  nextBoard,
  occupancyClass,
  type ScanEmitter,
} from "./lib/scanEmitters";
import { currentConfig } from "./orgConfig";
import { scanStateValidator } from "./schema";

/** Collecting → localizing, by the deadline or by the sync that completes the expected set. */
export async function closeScan(ctx: MutationCtx, scanId: Id<"scans">) {
  const scan = await ctx.db.get("scans", scanId);
  if (scan?.state !== "collecting") return;
  const now = Date.now();
  await ctx.db.patch("scans", scanId, { state: "localizing", closedAt: now });
  // Reporters reset their count in sync; only the expected-but-silent are touched here.
  for (const id of scan.expected) {
    if (scan.reportedBy.includes(id)) continue;
    const receiver = await ctx.db.get("receivers", id);
    const status = await ctx.db
      .query("receiverStatus")
      .withIndex("by_receiver", (q) => q.eq("receiver", id))
      .unique();
    if (receiver?.status === "active" && status) {
      await applyHealth(ctx, receiver, status, now, {
        book: { ...status.book, missed: status.book.missed + 1 },
      });
    }
  }
  // An action: hundreds of Emitters at 1–2 ms each would overrun a mutation's 1 s limit.
  await ctx.scheduler.runAfter(0, internal.scans.localize, { scanId });
}

export const close = internalMutation({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: async (ctx, { scanId }) => {
    await closeScan(ctx, scanId);
    return null;
  },
});

/** Everything localization reads, in one transaction. */
export const localizeInputs = internalQuery({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => await readInputs(ctx, scanId),
});

async function readInputs(ctx: QueryCtx, scanId: Id<"scans">) {
  {
    const scan = await ctx.db.get("scans", scanId);
    if (scan?.state !== "localizing") return null;
    const run = await ctx.db.get("runs", scan.run);
    if (!run) return null;
    const { org, version } = await currentConfig(ctx);
    const readings = [];
    for (const r of await ctx.db
      .query("readings")
      .withIndex("by_scan", (q) => q.eq("scan", scanId))
      .take(50)) {
      if (r.late) continue;
      const receiver = await ctx.db.get("receivers", r.receiver);
      if (!receiver) continue;
      const status = await ctx.db
        .query("receiverStatus")
        .withIndex("by_receiver", (q) => q.eq("receiver", r.receiver))
        .unique();
      const pos = receiver.config.position;
      readings.push({
        receiver: r.receiver as string,
        name: receiver.name,
        unaligned: r.unaligned,
        payload: r.payload,
        passes: r.passes,
        fixPasses: r.fixPasses,
        start: r.start,
        end: r.end,
        pin: pos.mode === "pinned" ? { lat: pos.lat, lng: pos.lng } : null,
        moved: status?.book.moved ?? false,
      });
    }
    const previous = await ctx.db
      .query("emitterBoards")
      .withIndex("by_at", (q) => q.lt("at", scan.startsAt))
      .order("desc")
      .first();
    const tests = (
      await ctx.db.query("fieldTests").withIndex("by_startedAt").order("desc").take(20)
    ).filter((t) => t.endedAt === null);
    return {
      scan: { startsAt: scan.startsAt, k: scan.k, run: scan.run },
      run: { plan: run.plan, periodMs: run.periodMs, number: run.number },
      pathLossN: version.values.environment.n,
      learning: { firstRunAt: org.firstRunAt, planChange: org.planChange },
      readings,
      previous: previous && { at: previous.at, items: previous.items },
      watch: (await ctx.db.query("watchlist").take(200)).map((w) => ({
        freqHz: w.freqHz,
        name: w.name,
        rules: w.rules,
        critical: w.critical,
        home: w.home,
      })),
      fieldTests: tests.map((t) => ({ id: t._id, freqHz: t.freqHz })),
    };
  }
}

/** Activity inside each span: sticky names across longer gaps, and New's 7-day memory. */
export const activityInSpans = internalQuery({
  args: { spans: v.array(v.object({ lowHz: v.number(), highHz: v.number() })) },
  handler: async (ctx, { spans }) =>
    await Promise.all(
      spans.map(async ({ lowHz, highHz }) =>
        (
          await ctx.db
            .query("emitterActivity")
            .withIndex("by_freqHz", (q) => q.gte("freqHz", lowHz).lt("freqHz", highHz))
            .take(10)
        ).map((a) => ({ freqHz: a.freqHz, lastLocatedAt: a.lastLocatedAt })),
      ),
    ),
});

const placeValidator = v.object({
  lat: v.number(),
  lng: v.number(),
  radiusM: v.number(),
  ptDbm: v.number(),
});
const alertValidator = v.object({
  subjectKey: v.string(),
  type: v.union(v.literal("new"), v.literal("heard"), v.literal("moved"), v.literal("silent")),
  kind: v.union(v.literal("condition"), v.literal("event")),
  severity: v.union(v.literal("critical"), v.literal("warning")),
  title: v.string(),
  detail: v.string(),
});
const entryValidator = v.object({
  receiver: v.id("receivers"),
  name: v.string(),
  status: v.union(
    v.literal("used"),
    v.literal("clipped"),
    v.literal("heard_later"),
    v.literal("not_heard"),
    v.literal("unaligned"),
    v.literal("no_position"),
  ),
  powerDbm: v.union(v.number(), v.null()),
  lat: v.union(v.number(), v.null()),
  lng: v.union(v.number(), v.null()),
});
const fixValidator = v.object({
  kind: v.union(v.literal("change"), v.literal("hourly")),
  freqHz: v.number(),
  ch: v.number(),
  rasterHz: v.number(),
  lowHz: v.number(),
  highHz: v.number(),
  lat: v.number(),
  lng: v.number(),
  uncertaintyM: v.number(),
  receiverCount: v.number(),
  ptDbm: v.number(),
  occupancy: v.number(),
  peakDbm: v.number(),
  flags: v.object({
    unconfirmed: v.boolean(),
    poorFit: v.boolean(),
    collinear: v.boolean(),
    receiverMoved: v.boolean(),
  }),
  region: v.array(v.object({ lat: v.number(), lng: v.number() })),
  chi2PerDof: v.union(v.number(), v.null()),
  pathLossN: v.number(),
  receivers: v.array(entryValidator),
});
const sampleValidator = v.object({
  lat: v.number(),
  lng: v.number(),
  used: v.array(v.object({ lat: v.number(), lng: v.number(), powerDbm: v.number() })),
});

/**
 * One closed Scan → its Emitters, board, stored Fixes and alerts. Pure work happens here; the
 * reads come from one query (plus a span lookup for Emitters that just appeared) and the writes
 * go through one mutation that first checks the Scan is still `localizing`.
 */
export const localize = internalAction({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: async (ctx, { scanId }) => {
    const input = await ctx.runQuery(internal.scans.localizeInputs, { scanId });
    if (!input) return null;
    let result: Awaited<ReturnType<typeof localizeScan>>;
    try {
      result = await localizeScan(input, (spans) =>
        ctx.runQuery(internal.scans.activityInSpans, { spans }),
      );
    } catch (e) {
      // One bad Scan fails alone (with a server error record); the loop goes on.
      const err = e as Error;
      await ctx.runMutation(internal.scans.localizeFailed, {
        scanId,
        name: err.name || "Error",
        message: err.message,
        stack: err.stack ?? null,
      });
      return null;
    }
    await ctx.runMutation(internal.scans.applyLocalization, { ...result, scanId });
    return null;
  },
});

type Inputs = NonNullable<Awaited<ReturnType<typeof readInputs>>>;
type SpanLookup = (
  spans: { lowHz: number; highHz: number }[],
) => Promise<{ freqHz: number; lastLocatedAt: number }[][]>;

const spanOf = (e: Pick<ScanEmitter, "firstCh" | "widthCh">, raster: number) => ({
  lowHz: e.firstCh * raster - raster / 2,
  highHz: (e.firstCh + e.widthCh) * raster - raster / 2,
});

async function localizeScan(input: Inputs, lookup: SpanLookup) {
  const at = input.scan.startsAt;
  const plan = input.run.plan;
  const raster = plan.rasterHz;
  const previous = input.previous ? decodeBoard(input.previous.items) : [];
  const prevByName = new Map(previous.map((p) => [p.ch * raster, p]));
  const recentOnBoard = (freqHz: number) => {
    const p = prevByName.get(freqHz);
    return p !== undefined && p.missed !== null && p.missed < LEAVES_AFTER_MISSED;
  };
  const watchByName = new Map(input.watch.map((w) => [w.freqHz, w]));
  const { emitters, reason } = buildEmitters({
    startsAt: at,
    plan,
    pathLossN: input.pathLossN,
    readings: input.readings.map((r) => ({ ...r, payload: decodeReading(r.payload) })),
    names: {
      watch: input.watch.map((w) => w.freqHz),
      previous: previous.map((p) => ({ freqHz: p.ch * raster, missed: p.missed })),
    },
  });

  // Emitters that appear (located now, not in the last 3 Scans) look up recent activity in
  // their span: a name from it keeps a wide signal's identity across longer gaps.
  const appearing = emitters.filter((e) => e.estimate && !recentOnBoard(e.freqHz));
  const found = appearing.length > 0 ? await lookup(appearing.map((e) => spanOf(e, raster))) : [];
  const memory = new Map<number, { lastLocatedAt: number | null; recentInSpan: boolean }>();
  const taken = new Set(emitters.map((e) => e.freqHz));
  appearing.forEach((e, i) => {
    const rows = (found[i] ?? []).filter((a) => at - a.lastLocatedAt <= NEW_AFTER_QUIET_MS);
    if (!watchByName.has(e.freqHz)) {
      const sticky = rows
        .filter((a) => !taken.has(a.freqHz))
        .sort((a, b) => b.lastLocatedAt - a.lastLocatedAt)[0];
      if (sticky) {
        taken.delete(e.freqHz);
        taken.add(sticky.freqHz);
        e.freqHz = sticky.freqHz;
        e.ch = Math.round(sticky.freqHz / raster);
      }
    }
    const own = (found[i] ?? []).find((a) => a.freqHz === e.freqHz);
    memory.set(e.freqHz, {
      lastLocatedAt: own?.lastLocatedAt ?? null,
      recentInSpan: rows.length > 0,
    });
  });

  const receivers = input.readings.map((r) => ({ id: r.receiver, name: r.name }));
  const board = nextBoard({
    at,
    periodMs: input.run.periodMs,
    emitters,
    receivers: receivers.map((r) => r.id),
    previous,
    previousAt: input.previous?.at ?? null,
    raster,
  });

  const fixes = [];
  const alerts: (AlertInput & { type: "new" | "heard" | "moved" | "silent" })[] = [];
  const movedCandidates = [];
  const samples = [];
  for (const e of emitters) {
    const est = e.estimate;
    if (!est) continue;
    const kind = board.store.get(e.freqHz);
    const span = spanOf(e, raster);
    const common = {
      freqHz: e.freqHz,
      ch: e.ch,
      rasterHz: raster,
      ...span,
      lat: est.lat,
      lng: est.lng,
      uncertaintyM: est.uncertaintyM,
      receiverCount: est.receiverCount,
      ptDbm: est.ptDbm,
      occupancy: e.occupancy,
      peakDbm: e.peakDbm,
      flags: est.flags,
      pathLossN: est.pathLossN,
    };
    if (kind === "change") {
      fixes.push({
        ...common,
        kind,
        region: est.region,
        chi2PerDof: est.chi2PerDof,
        receivers: e.entries.map((x) => ({ ...x, receiver: x.receiver as Id<"receivers"> })),
      });
    } else if (kind === "hourly") {
      fixes.push({ ...common, kind, region: [], chi2PerDof: null, receivers: [] });
    }

    const watch = watchByName.get(e.freqHz) ?? null;
    const appeared = board.appeared.has(e.freqHz);
    const prev = prevByName.get(e.freqHz);
    const current = { lat: est.lat, lng: est.lng, radiusM: est.uncertaintyM, ptDbm: est.ptDbm };
    const previousPlace = prev?.missed === 0 && prev.position ? prev.position : null;
    const mem = memory.get(e.freqHz);
    const base = {
      freqHz: e.freqHz,
      at,
      watch,
      appeared,
      lastLocatedAt: mem?.lastLocatedAt ?? null,
      recentInSpan: mem?.recentInSpan ?? false,
      current,
      previous: previousPlace,
      learning: input.learning,
    };
    for (const a of emitterAlerts({ ...base, usual: watch?.home ?? null })) {
      alerts.push({ ...a, subjectKey: `ch:${e.freqHz}`, kind: "event" });
    }
    // Without a home, the usual spot is the median of earlier Fixes: read only when it moved.
    if (watch?.rules.moved && !watch.home && previousPlace && kind === "change" && !appeared) {
      movedCandidates.push({ freqHz: e.freqHz, current, previous: previousPlace });
    }
    for (const t of input.fieldTests) {
      if (t.freqHz >= span.lowHz && t.freqHz < span.highHz) {
        samples.push({ testId: t.id, sample: { lat: est.lat, lng: est.lng, used: e.used } });
      }
    }
  }

  // Silent (a condition): a watched entry nothing on the board has located in the last 3 Scans.
  const silent = [];
  const quiet = [];
  for (const w of input.watch) {
    if (!w.rules.silent) continue;
    const covered = board.items.some(
      (i) =>
        i.missed !== null &&
        i.missed < LEAVES_AFTER_MISSED &&
        w.freqHz >= i.firstCh * raster - raster / 2 &&
        w.freqHz < (i.firstCh + i.widthCh) * raster - raster / 2,
    );
    if (covered) quiet.push(w.freqHz);
    else if (input.scan.k + 1 >= SILENT_SCANS) {
      silent.push({
        subjectKey: `ch:${w.freqHz}`,
        type: "silent" as const,
        kind: "condition" as const,
        severity: w.critical ? ("critical" as const) : ("warning" as const),
        title: `${w.name} (${formatMHz(w.freqHz)}) silent`,
        detail: `Not located for ${SILENT_SCANS} Scans`,
      });
    }
  }

  return {
    reason,
    heard: emitters.length,
    located: emitters.filter((e) => e.estimate).length,
    board: { receivers, items: encodeBoard(board.items).buffer, rasterHz: raster },
    fixes,
    left: board.left,
    alerts: [...alerts, ...silent],
    resolveSilent: quiet,
    movedCandidates,
    samples,
  };
}

/** Writes one Scan's localization, unless the Scan was discarded or done meanwhile. */
export const applyLocalization = internalMutation({
  args: {
    scanId: v.id("scans"),
    reason: v.union(v.string(), v.null()),
    heard: v.number(),
    located: v.number(),
    board: v.object({
      receivers: v.array(v.object({ id: v.string(), name: v.string() })),
      items: v.bytes(),
      rasterHz: v.number(),
    }),
    fixes: v.array(fixValidator),
    left: v.array(v.object({ freqHz: v.number(), lastLocatedAt: v.number() })),
    alerts: v.array(alertValidator),
    resolveSilent: v.array(v.number()),
    movedCandidates: v.array(
      v.object({ freqHz: v.number(), current: placeValidator, previous: placeValidator }),
    ),
    samples: v.array(v.object({ testId: v.id("fieldTests"), sample: sampleValidator })),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const scan = await ctx.db.get("scans", a.scanId);
    if (scan?.state !== "localizing") return null;
    const at = scan.startsAt;
    const now = Date.now();

    // Moved needs the usual spot before this Scan's Fix is written.
    const moved: AlertInput[] = [];
    for (const c of a.movedCandidates) {
      const watch = await ctx.db
        .query("watchlist")
        .withIndex("by_freqHz", (q) => q.eq("freqHz", c.freqHz))
        .unique();
      const earlier = await ctx.db
        .query("fixes")
        .withIndex("by_freqHz_and_at", (q) => q.eq("freqHz", c.freqHz).lt("at", at))
        .order("desc")
        .take(10);
      for (const m of emitterAlerts({
        freqHz: c.freqHz,
        at,
        watch,
        appeared: false,
        lastLocatedAt: null,
        recentInSpan: true,
        current: c.current,
        previous: c.previous,
        usual: median(earlier),
        learning: { firstRunAt: null, planChange: null },
      })) {
        moved.push({ ...m, subjectKey: `ch:${c.freqHz}`, kind: "event" });
      }
    }

    for (const f of a.fixes) {
      const id = await ctx.db.insert("fixes", { ...f, scan: a.scanId, run: scan.run, at });
      const lastFix = {
        id,
        lat: f.lat,
        lng: f.lng,
        radiusM: f.uncertaintyM,
        ptDbm: f.ptDbm,
        occupancyClass: occupancyClass(f.occupancy),
        at,
      };
      const activity = await ctx.db
        .query("emitterActivity")
        .withIndex("by_freqHz", (q) => q.eq("freqHz", f.freqHz))
        .unique();
      if (activity) {
        await ctx.db.patch("emitterActivity", activity._id, {
          lowHz: f.lowHz,
          highHz: f.highHz,
          lastLocatedAt: at,
          fixCount: activity.fixCount + 1,
          lastFix,
        });
      } else {
        await ctx.db.insert("emitterActivity", {
          freqHz: f.freqHz,
          lowHz: f.lowHz,
          highHz: f.highHz,
          firstFixAt: at,
          lastLocatedAt: at,
          fixCount: 1,
          lastFix,
        });
      }
    }
    for (const l of a.left) {
      const activity = await ctx.db
        .query("emitterActivity")
        .withIndex("by_freqHz", (q) => q.eq("freqHz", l.freqHz))
        .unique();
      if (activity && activity.lastLocatedAt < l.lastLocatedAt)
        await ctx.db.patch("emitterActivity", activity._id, { lastLocatedAt: l.lastLocatedAt });
    }

    const boardId = await ctx.db.insert("emitterBoards", {
      scan: a.scanId,
      run: scan.run,
      at,
      rasterHz: a.board.rasterHz,
      receivers: a.board.receivers.map((r) => ({ id: r.id as Id<"receivers">, name: r.name })),
      items: a.board.items,
    });
    // Scans can close out of order by a few seconds; the phones' pointer only moves forward.
    const feed = await ctx.db.query("fieldFeed").first();
    if (!feed?.board || feed.board.at < at) await pointFeedAt(ctx, { id: boardId, at });

    for (const alert of [...a.alerts, ...moved]) await raiseAlert(ctx, alert, now);
    for (const freqHz of a.resolveSilent) await resolveAlert(ctx, `ch:${freqHz}`, "silent", now);
    // Located again: Silent clears.
    for (const f of a.fixes) await resolveAlert(ctx, `ch:${f.freqHz}`, "silent", now);
    await recordFieldSamples(ctx, a.samples);

    await ctx.db.patch("scans", a.scanId, {
      state: a.located > 0 ? "done" : "no_fix",
      reason: a.reason,
      heard: a.heard,
      located: a.located,
      fixCount: a.fixes.length,
    });
    return null;
  },
});

export const localizeFailed = internalMutation({
  args: {
    scanId: v.id("scans"),
    name: v.string(),
    message: v.string(),
    stack: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, e) => {
    const scan = await ctx.db.get("scans", e.scanId);
    if (scan?.state !== "localizing") return null;
    const run = await ctx.db.get("runs", scan.run);
    await ctx.db.patch("scans", e.scanId, {
      state: "failed",
      reason: `Localization failed: ${e.message}`,
    });
    await recordError(
      ctx,
      {
        source: "server",
        kind: e.name,
        message: e.message,
        stack: e.stack,
        version: "server",
        context: `localize Run ${run?.number ?? "?"} Scan ${scan.k + 1}`,
      },
      Date.now(),
    );
    return null;
  },
});

/**
 * Per-Scan subscription for the Overview strip: Scans since `since` (the website rounds it to
 * 10 minutes so the argument, and so the subscription, stays stable), plus the Runs they cover.
 */
export const recent = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    await requireOperator(ctx);
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_startsAt", (q) => q.gte("startsAt", since))
      .take(400);
    const runIds = [...new Set(scans.map((s) => s.run))];
    const runs = (await Promise.all(runIds.map((id) => ctx.db.get("runs", id)))).filter(
      (r) => r !== null,
    );
    return {
      scans: scans.map((s) => ({
        _id: s._id,
        run: s.run,
        k: s.k,
        startsAt: s.startsAt,
        state: s.state,
        reason: s.reason,
        expected: s.expected.length,
        reported: s.reported,
        partial: s.partial,
        late: s.late,
        heard: s.heard,
        located: s.located,
        fixCount: s.fixCount,
      })),
      runs: runs.map((r) => ({
        _id: r._id,
        number: r.number,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        endReason: r.endReason,
      })),
    };
  },
});

const scanView = (s: Doc<"scans">, runNumber: number) => ({
  _id: s._id,
  runNumber,
  k: s.k,
  startsAt: s.startsAt,
  closedAt: s.closedAt,
  state: s.state,
  reason: s.reason,
  expected: s.expected.length,
  reported: s.reported,
  partial: s.partial,
  late: s.late,
  heard: s.heard,
  located: s.located,
  fixCount: s.fixCount,
});

/** Newest first. The website subscribes to the first page only and reads older pages one-shot. */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    run: v.optional(v.number()),
    state: v.optional(scanStateValidator),
  },
  handler: async (ctx, { paginationOpts, run, state }) => {
    await requireOperator(ctx);
    let runDoc: Doc<"runs"> | null = null;
    if (run !== undefined) {
      runDoc = await ctx.db
        .query("runs")
        .withIndex("by_number", (q) => q.eq("number", run))
        .unique();
      if (!runDoc) return { page: [], isDone: true, continueCursor: "" };
    }
    const base = runDoc
      ? ctx.db
          .query("scans")
          .withIndex("by_run_and_k", (q) => q.eq("run", (runDoc as Doc<"runs">)._id))
          .order("desc")
      : ctx.db.query("scans").withIndex("by_startsAt").order("desc");
    const result = await (state
      ? base.filter((q) => q.eq(q.field("state"), state))
      : base
    ).paginate(paginationOpts);
    const runs = new Map<Id<"runs">, number>();
    for (const s of result.page) {
      if (!runs.has(s.run)) runs.set(s.run, (await ctx.db.get("runs", s.run))?.number ?? 0);
    }
    return { ...result, page: result.page.map((s) => scanView(s, runs.get(s.run) ?? 0)) };
  },
});

/** Scan detail by the numbers people see: Run number and Scan number (k + 1). */
export const byNumber = query({
  args: { run: v.number(), k: v.number() },
  handler: async (ctx, { run, k }) => {
    await requireOperator(ctx);
    const runDoc = await ctx.db
      .query("runs")
      .withIndex("by_number", (q) => q.eq("number", run))
      .unique();
    if (!runDoc) return null;
    const scan = await ctx.db
      .query("scans")
      .withIndex("by_run_and_k", (q) => q.eq("run", runDoc._id).eq("k", k))
      .unique();
    if (!scan) return null;
    return { scan: scanView(scan, runDoc.number), run: runDoc, expected: scan.expected };
  },
});

/** Headers plus packed payloads; the website decodes them with the shared codec. */
export const readings = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    await requireOperator(ctx);
    const readings = await ctx.db
      .query("readings")
      .withIndex("by_scan", (q) => q.eq("scan", scanId))
      .take(50);
    return await Promise.all(
      readings.map(async (r) => ({
        ...r,
        name: (await ctx.db.get("receivers", r.receiver))?.name ?? "removed",
      })),
    );
  },
});
