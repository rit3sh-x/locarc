// Receiver health: one state plus its reasons, from the latest heartbeat and a little
// bookkeeping. Pure; the server evaluates it on every sync, Scan close and dead-man timer, and
// the browser only re-ages Offline.
import { type Infer, v } from "convex/values";
import { formatMHz } from "./channelMath";
import type { Heartbeat } from "./heartbeat";

export const healthStateValidator = v.union(
  v.literal("awaiting_pairing"),
  v.literal("offline"),
  v.literal("needs_attention"),
  v.literal("paused"),
  v.literal("degraded"),
  v.literal("scanning"),
  v.literal("idle"),
);
export type HealthState = Infer<typeof healthStateValidator>;

export const HEALTH_LABEL: Record<HealthState, string> = {
  awaiting_pairing: "Awaiting pairing",
  offline: "Offline",
  needs_attention: "Needs attention",
  paused: "Paused",
  degraded: "Degraded",
  scanning: "Scanning",
  idle: "Idle",
};

/** Named thresholds (the Receiver health states decision); constants, not settings. */
export const THRESHOLDS = {
  offlineAfterMs: 12 * 60_000,
  missedScans: 2,
  clockUncertaintyMs: 500,
  partialOfLast5: 2,
  clippedInLast3: 1,
  ladderLevel: 3,
  ladderWindowMs: 30 * 60_000,
  detachedDuringRunMs: 5 * 60_000,
  backlogAgeS: 600,
  gpsAccuracyM: 50,
  batteryLow: 0.3,
  configPendingMs: 10 * 60_000,
  degradedAlertAfterMs: 15 * 60_000,
  driftM: 100,
  driftForMs: 5 * 60_000,
} as const;

export const OFFLINE_AFTER_MS = THRESHOLDS.offlineAfterMs;

export const reasonCodeValidator = v.union(
  v.literal("offline"),
  v.literal("needs_attention"),
  v.literal("firmware"),
  v.literal("permission_denied"),
  v.literal("detached"),
  v.literal("paused_operator"),
  v.literal("paused_battery"),
  v.literal("paused_thermal"),
  v.literal("missed_scans"),
  v.literal("clock"),
  v.literal("partial"),
  v.literal("usb_ladder"),
  v.literal("power_flapping"),
  v.literal("clipping"),
  v.literal("backlog"),
  v.literal("gps"),
  v.literal("battery"),
  v.literal("thermal"),
  v.literal("config_pending"),
  v.literal("config_rejected"),
  v.literal("moved"),
);
export type ReasonCode = Infer<typeof reasonCodeValidator>;

export const reasonValidator = v.object({
  code: reasonCodeValidator,
  severity: v.union(v.literal("critical"), v.literal("warning"), v.literal("neutral")),
  text: v.string(),
  /** "value vs threshold" for the Receiver detail health panel. */
  detail: v.string(),
});
export type Reason = Infer<typeof reasonValidator>;

/** Hot bookkeeping kept on the Receiver's status doc between syncs. */
export const bookValidator = v.object({
  missed: v.number(),
  recentPartial: v.array(v.boolean()),
  recentClipped: v.array(v.boolean()),
  clippedHz: v.union(v.number(), v.null()),
  ladderAt: v.union(v.number(), v.null()),
  flappingAt: v.union(v.number(), v.null()),
  degradedSince: v.union(v.number(), v.null()),
  driftSince: v.union(v.number(), v.null()),
  moved: v.boolean(),
  /** After "Keep pin", drift stays quiet until GPS comes back near the pin once. */
  driftMuted: v.boolean(),
  deadMan: v.union(v.id("_scheduled_functions"), v.null()),
  /** Health alert types currently open for this Receiver, so steady states cost no lookups. */
  openAlerts: v.array(v.string()),
});
export type Book = Infer<typeof bookValidator>;

export const emptyBook = (): Book => ({
  missed: 0,
  recentPartial: [],
  recentClipped: [],
  clippedHz: null,
  ladderAt: null,
  flappingAt: null,
  degradedSince: null,
  driftSince: null,
  moved: false,
  driftMuted: false,
  deadMan: null,
  openAlerts: [],
});

const THERMAL_ORDER = ["none", "light", "moderate", "severe", "critical", "emergency", "shutdown"];

export type HealthInput = {
  status: "pending" | "active" | "removed";
  now: number;
  lastSeenAt: number | null;
  runActive: boolean;
  pausedByOperator: boolean;
  pinned: boolean;
  snapshot: Heartbeat | null;
  book: Book;
  /** Desired config the Receiver hasn't applied yet, and since when. */
  configPendingSince: number | null;
  configRejected: { v: number; reason: string } | null;
};

const SEVERITY_ORDER = { critical: 0, warning: 1, neutral: 2 } as const;

export function evaluate(h: HealthInput): {
  state: HealthState;
  reasons: Reason[];
} {
  if (h.status === "pending") return { state: "awaiting_pairing", reasons: [] };
  const silentFor = h.lastSeenAt === null ? Number.POSITIVE_INFINITY : h.now - h.lastSeenAt;
  if (silentFor >= THRESHOLDS.offlineAfterMs) {
    const mins = Number.isFinite(silentFor) ? `${Math.round(silentFor / 60_000)} min` : "never";
    return {
      state: "offline",
      reasons: [
        {
          code: "offline",
          severity: "critical",
          text: `no contact for ${mins}`,
          detail: `silent ${mins} vs 12 min`,
        },
      ],
    };
  }

  const reasons: Reason[] = [];
  const add = (code: ReasonCode, severity: Reason["severity"], text: string, detail: string) =>
    reasons.push({ code, severity, text, detail });
  const s = h.snapshot;
  const b = h.book;

  if (s) {
    const usb = s.hackrf;
    if ((usb.faults.FIRMWARE_UNSUPPORTED ?? 0) > 0) {
      add(
        "firmware",
        "critical",
        "update the HackRF firmware",
        `firmware ${usb.firmware ?? "unknown"} has no sweep mode`,
      );
    } else if (usb.state === "needs_attention") {
      add("needs_attention", "critical", "replug the HackRF", "USB recovery exhausted (L4)");
    }
    if (usb.state === "needs_permission" || (usb.faults.PERMISSION_DENIED ?? 0) > 0) {
      add(
        "permission_denied",
        "critical",
        "USB permission denied",
        "grant HackRF access on the phone",
      );
    }
    if (
      h.runActive &&
      usb.detachedSince !== null &&
      h.now - usb.detachedSince > THRESHOLDS.detachedDuringRunMs
    ) {
      const mins = Math.round((h.now - usb.detachedSince) / 60_000);
      add(
        "detached",
        "critical",
        `HackRF detached ${mins} min`,
        `detached ${mins} min vs 5 min during a Run`,
      );
    }
    if (s.selfPause === "battery")
      add(
        "paused_battery",
        "warning",
        "self-paused: battery low",
        `battery ${Math.round(s.battery * 100)}%`,
      );
    if (s.selfPause === "thermal")
      add("paused_thermal", "warning", "self-paused: phone too hot", `thermal ${s.thermal}`);
    if (s.clock.uncertaintyMs > THRESHOLDS.clockUncertaintyMs) {
      add(
        "clock",
        "warning",
        `clock ±${Math.round(s.clock.uncertaintyMs)} ms`,
        `±${Math.round(s.clock.uncertaintyMs)} ms vs 500 ms`,
      );
    }
    if (s.outbox.oldestAgeS > THRESHOLDS.backlogAgeS) {
      const mins = Math.round(s.outbox.oldestAgeS / 60);
      add(
        "backlog",
        "warning",
        `upload backlog ${mins} min`,
        `oldest ${mins} min vs 10 min (${s.outbox.depth} queued)`,
      );
    } else if (s.outbox.dropped > 0) {
      add("backlog", "warning", `${s.outbox.dropped} Readings dropped`, "outbox hit its 24 h cap");
    }
    if (!h.pinned && s.gpsAccuracyM !== null && s.gpsAccuracyM > THRESHOLDS.gpsAccuracyM) {
      add(
        "gps",
        "warning",
        `GPS ±${Math.round(s.gpsAccuracyM)} m`,
        `±${Math.round(s.gpsAccuracyM)} m vs 50 m`,
      );
    }
    if (s.battery < THRESHOLDS.batteryLow && !s.charging && !s.selfPause) {
      add(
        "battery",
        "warning",
        `battery ${Math.round(s.battery * 100)}%`,
        `${Math.round(s.battery * 100)}% not charging vs 30%`,
      );
    }
    if (THERMAL_ORDER.indexOf(s.thermal) >= THERMAL_ORDER.indexOf("moderate") && !s.selfPause) {
      add("thermal", "warning", `phone hot (${s.thermal})`, `thermal ${s.thermal} vs moderate`);
    }
  }
  if (b.flappingAt !== null && h.now - b.flappingAt < THRESHOLDS.ladderWindowMs) {
    add(
      "power_flapping",
      "warning",
      "USB power unstable: use a powered OTG Y-cable",
      "3+ replugs in 2 min",
    );
  }
  if (b.ladderAt !== null && h.now - b.ladderAt < THRESHOLDS.ladderWindowMs) {
    add("usb_ladder", "warning", "USB recovery L3+", "reached L3+ in the last 30 min");
  }
  if (h.runActive && b.missed >= THRESHOLDS.missedScans) {
    add("missed_scans", "warning", "not reporting", `missed ${b.missed} Scans vs 2`);
  }
  const partial = b.recentPartial.slice(-5).filter(Boolean).length;
  if (partial >= THRESHOLDS.partialOfLast5) {
    add("partial", "warning", `${partial} of last 5 windows cut short`, `${partial} of 5 vs 2`);
  }
  if (b.recentClipped.slice(-3).some(Boolean)) {
    const at = b.clippedHz === null ? "" : ` at ${formatMHz(b.clippedHz)}`;
    add("clipping", "warning", `gain too high${at}`, "clipped slices in the last 3 Readings");
  }
  if (h.configRejected) {
    add(
      "config_rejected",
      "warning",
      `config v${h.configRejected.v} rejected`,
      h.configRejected.reason,
    );
  } else if (
    h.configPendingSince !== null &&
    h.now - h.configPendingSince > THRESHOLDS.configPendingMs
  ) {
    const mins = Math.round((h.now - h.configPendingSince) / 60_000);
    add("config_pending", "warning", `config pending ${mins} min`, `${mins} min vs 10 min`);
  }
  if (h.pinned && b.moved) add("moved", "warning", "Moved?", "GPS > 100 m from the pin for 5 min");
  if (h.pausedByOperator)
    add("paused_operator", "neutral", "paused by an Operator", "excluded from Scans");

  reasons.sort((a, b2) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b2.severity]);
  const has = (...codes: ReasonCode[]) => reasons.some((r) => codes.includes(r.code));
  const state: HealthState = reasons.some((r) => r.severity === "critical")
    ? "needs_attention"
    : has("paused_operator", "paused_battery", "paused_thermal")
      ? "paused"
      : reasons.some((r) => r.severity === "warning")
        ? "degraded"
        : h.runActive
          ? "scanning"
          : "idle";
  // Paused leads with its own reason; other warnings follow as "+N more".
  if (state === "paused") {
    const i = reasons.findIndex((r) => r.code.startsWith("paused_"));
    reasons.unshift(...reasons.splice(i, 1));
  }
  return { state, reasons };
}

/** The website's view: the server's state, re-aged so silence reads Offline without a call. */
export function displayedState(
  r: {
    status: "pending" | "active" | "removed";
    serverState: HealthState;
    lastSeenAt: number | null;
  },
  now: number,
): HealthState {
  if (r.status === "pending") return "awaiting_pairing";
  if (r.lastSeenAt === null || now - r.lastSeenAt >= OFFLINE_AFTER_MS) return "offline";
  return r.serverState;
}

/** Self-pause is a warning; an Operator's pause is neutral. */
export const pausedTone = (reasons: Reason[]) =>
  reasons[0]?.code === "paused_operator" ? "neutral" : "warning";
