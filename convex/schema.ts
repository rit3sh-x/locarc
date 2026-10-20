import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  cadenceValidator,
  orgConfigValidator,
  receiverConfigValidator,
  segmentValidator,
  sweepPlanValidator,
} from "./lib/config";
import { bookValidator, healthStateValidator, reasonValidator } from "./lib/health";
import { heartbeatValidator, positionFixValidator as position } from "./lib/heartbeat";

/** What a Receiver's control doc says about the current Run (null when stopped). */
export const controlRunValidator = v.object({
  runId: v.id("runs"),
  number: v.number(),
  startsAt: v.number(),
  periodMs: v.number(),
  plan: sweepPlanValidator,
  /** Fix power covers this much after each boundary; every phone listens at least this long. */
  fixWindowMs: v.number(),
  /** Phones stop listening this long before the next boundary, to upload. */
  uploadMarginMs: v.number(),
  burstEndsAt: v.union(v.number(), v.null()),
});

/** A command in a Receiver's control doc; the phone acks the highest seq it has run via sync. */
export const commandValidator = v.object({
  seq: v.number(),
  kind: v.literal("calibrate"),
  session: v.id("calibrationSessions"),
  referenceHz: v.number(),
  durationS: v.number(),
  mode: v.union(v.literal("full"), v.literal("frequency")),
});

export const alertTypeValidator = v.union(
  // Receiver condition alerts
  v.literal("offline"),
  v.literal("needs_attention"),
  v.literal("self_pause"),
  v.literal("power_flapping"),
  v.literal("pin_drift"),
  v.literal("config_rejected"),
  v.literal("degraded"),
  // Channel alerts
  v.literal("new"),
  v.literal("heard"),
  v.literal("moved"),
  v.literal("silent"),
  // Diagnostics
  v.literal("error"),
);

export const scanStateValidator = v.union(
  v.literal("collecting"),
  v.literal("localizing"),
  v.literal("done"),
  v.literal("no_fix"),
  v.literal("failed"),
  v.literal("discarded"),
);

export default defineSchema({
  // Singleton: the deployment's one Organization.
  organization: defineTable({
    name: v.string(),
    configV: v.number(),
    run: v.union(v.id("runs"), v.null()),
    firstRunAt: v.union(v.number(), v.null()),
    /** Fixes older than 30 days are thinned up to here (each hour once). */
    fixesThinnedTo: v.optional(v.number()),
    /** Failed scheduled functions are harvested from here on. */

    errorWatermark: v.optional(v.number()),
    /** The last Sweep plan change, for New's learning window over newly covered frequencies. */
    planChange: v.union(
      v.null(),
      v.object({ at: v.number(), previousSegments: v.array(segmentValidator) }),
    ),
  }),
  orgConfigVersions: defineTable({
    v: v.number(),
    author: v.string(),
    at: v.number(),
    values: orgConfigValidator,
    diff: v.array(v.string()),
  }).index("by_v", ["v"]),
  operators: defineTable({
    userId: v.string(),
    name: v.string(),
    email: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"]),
  invites: defineTable({
    email: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
    usedAt: v.union(v.number(), v.null()),
    createdBy: v.string(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_email", ["email"]),

  // Cold: changes only on Operator action or pairing.
  receivers: defineTable({
    name: v.string(),
    status: v.union(v.literal("pending"), v.literal("active"), v.literal("removed")),
    secretHash: v.union(v.string(), v.null()),
    pairedAt: v.union(v.number(), v.null()),
    removedAt: v.union(v.number(), v.null()),
    hackrfSerial: v.union(v.string(), v.null()),
    configV: v.number(),
    /** When the desired config version was written (pending-too-long is measured from it). */
    configAt: v.number(),
    config: receiverConfigValidator,
    appliedV: v.union(v.number(), v.null()),
    rejected: v.union(v.null(), v.object({ v: v.number(), reason: v.string() })),
    pausedByOperator: v.boolean(),
    calibration: v.union(v.null(), v.object({ at: v.number(), serial: v.string() })),
  })
    .index("by_status", ["status"])
    .index("by_name", ["name"])
    .index("by_secretHash", ["secretHash"]),
  receiverConfigVersions: defineTable({
    receiver: v.id("receivers"),
    v: v.number(),
    author: v.string(),
    at: v.number(),
    values: receiverConfigValidator,
    diff: v.array(v.string()),
  }).index("by_receiver_and_v", ["receiver", "v"]),
  pairingCodes: defineTable({
    codeHash: v.string(),
    receiver: v.id("receivers"),
    expiresAt: v.number(),
    usedAt: v.union(v.number(), v.null()),
  })
    .index("by_codeHash", ["codeHash"])
    .index("by_receiver", ["receiver"]),
  // Hot: overwritten on every sync, read by the website shell's live subscription.
  receiverStatus: defineTable({
    receiver: v.id("receivers"),
    state: healthStateValidator,
    lastSeenAt: v.union(v.number(), v.null()),
    appVersion: v.union(v.string(), v.null()),
    position: v.union(v.null(), position),
    snapshot: v.union(v.null(), heartbeatValidator),
    reasons: v.array(reasonValidator),
    book: bookValidator,
  }).index("by_receiver", ["receiver"]),
  // The phone's only subscription; changes only on Operator action.
  receiverControl: defineTable({
    receiver: v.id("receivers"),
    run: v.union(v.null(), controlRunValidator),
    paused: v.boolean(),
    config: v.object({ v: v.number(), values: receiverConfigValidator }),
    commands: v.array(commandValidator),
    /** Commands are numbered per Receiver and never reuse a number the phone may have acked. */
    lastSeq: v.number(),
    /** The promoted release phones should run, and the oldest they may stay on. */
    release: v.union(
      v.null(),
      v.object({
        versionCode: v.number(),
        versionName: v.string(),
        sha256: v.string(),
        size: v.number(),
        minSupported: v.union(v.number(), v.null()),
      }),
    ),
  }).index("by_receiver", ["receiver"]),

  runs: defineTable({
    number: v.number(),
    plan: sweepPlanValidator,
    cadence: cadenceValidator,
    periodMs: v.number(),
    fixWindowMs: v.number(),
    uploadMarginMs: v.number(),
    burstEndsAt: v.union(v.number(), v.null()),
    configV: v.number(),
    startedAt: v.number(),
    startedBy: v.string(),
    endedAt: v.union(v.number(), v.null()),
    endReason: v.union(v.string(), v.null()),
  })
    .index("by_number", ["number"])
    .index("by_startedAt", ["startedAt"])
    .index("by_configV", ["configV"]),

  scans: defineTable({
    run: v.id("runs"),
    k: v.number(),
    startsAt: v.number(),
    deadlineAt: v.number(),
    state: scanStateValidator,
    reason: v.union(v.string(), v.null()),
    expected: v.array(v.id("receivers")),
    /** Receivers with an on-time Reading, so early close never has to read payloads. */
    reportedBy: v.array(v.id("receivers")),

    /** On-time Readings, partial ones included; `partial` counts those that were cut short. */
    reported: v.number(),
    partial: v.number(),
    late: v.number(),
    /** Emitters heard and located at close, and the Fixes stored (change-only). */
    heard: v.number(),
    located: v.number(),
    fixCount: v.number(),
    closedAt: v.union(v.number(), v.null()),
  })
    .index("by_run_and_k", ["run", "k"])
    .index("by_startsAt", ["startsAt"]),
  readings: defineTable({
    receiver: v.id("receivers"),
    run: v.id("runs"),
    scan: v.id("scans"),
    k: v.number(),
    appVersion: v.string(),
    lnaDb: v.number(),
    vgaDb: v.number(),
    amp: v.boolean(),
    ppm: v.number(),
    /** Listened from the boundary, and passes in the window and in its Fix window. */
    windowMs: v.number(),
    passes: v.number(),
    fixPasses: v.number(),
    stopReason: v.union(v.string(), v.null()),
    start: v.union(v.null(), position),
    end: v.union(v.null(), position),
    clockUncertaintyMs: v.number(),
    late: v.boolean(),
    unaligned: v.boolean(),
    partial: v.boolean(),
    payload: v.bytes(),
  })
    .index("by_receiver_and_run_and_k", ["receiver", "run", "k"])
    .index("by_scan", ["scan"]),
  /** Stored on change only: a full Fix when an Emitter appears, moves or changes; slim hourly. */
  fixes: defineTable({
    scan: v.id("scans"),
    run: v.id("runs"),
    at: v.number(),
    kind: v.union(v.literal("change"), v.literal("hourly")),
    /** The Emitter's name, and its span. */
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
    /** Empty on hourly Fixes. */
    region: v.array(v.object({ lat: v.number(), lng: v.number() })),
    chi2PerDof: v.union(v.number(), v.null()),
    pathLossN: v.number(),
    receivers: v.array(
      v.object({
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
      }),
    ),
  })
    .index("by_scan", ["scan"])
    .index("by_freqHz_and_at", ["freqHz", "at"])
    .index("by_at", ["at"]),
  /** Every Emitter heard in one Scan, packed (boardCodec). */
  emitterBoards: defineTable({
    scan: v.id("scans"),
    run: v.id("runs"),
    at: v.number(),
    rasterHz: v.number(),
    /** The Receivers its items' loudest index refers to. */
    receivers: v.array(v.object({ id: v.id("receivers"), name: v.string() })),
    items: v.bytes(),
  })
    .index("by_scan", ["scan"])
    .index("by_at", ["at"]),
  /** What the phones' sync replies need, in one small read: the newest board and the fleet. */
  fieldFeed: defineTable({
    board: v.union(v.null(), v.object({ id: v.id("emitterBoards"), at: v.number() })),
    fleetChangedAt: v.number(),
    fleet: v.array(
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
  alerts: defineTable({
    /** `rx:<receiverId>`, `ch:<freqHz>` or `err:<fingerprint>`. */
    subjectKey: v.string(),
    type: alertTypeValidator,
    kind: v.union(v.literal("condition"), v.literal("event")),
    severity: v.union(v.literal("critical"), v.literal("warning")),
    state: v.union(v.literal("open"), v.literal("acknowledged"), v.literal("resolved")),
    title: v.string(),
    detail: v.string(),
    count: v.number(),
    firstAt: v.number(),
    lastAt: v.number(),
    ackBy: v.union(v.string(), v.null()),
    ackAt: v.union(v.number(), v.null()),
    coolDownUntil: v.union(v.number(), v.null()),
    resolvedAt: v.union(v.number(), v.null()),
  })
    .index("by_subjectKey_and_type_and_state", ["subjectKey", "type", "state"])
    .index("by_state_and_lastAt", ["state", "lastAt"]),
  receiverEvents: defineTable({
    receiver: v.id("receivers"),
    at: v.number(),
    kind: v.union(
      v.literal("state"),
      v.literal("alert"),
      v.literal("fault"),
      v.literal("pause"),
      v.literal("pairing"),
      v.literal("config"),
    ),
    text: v.string(),
    faults: v.optional(v.record(v.string(), v.number())),
  }).index("by_receiver_and_at", ["receiver", "at"]),
  releases: defineTable({
    status: v.union(v.literal("candidate"), v.literal("promoted"), v.literal("retired")),
    versionCode: v.number(),
    versionName: v.string(),
    commit: v.string(),
    sha256: v.string(),
    size: v.number(),
    notes: v.string(),
    minSupported: v.union(v.number(), v.null()),
    storageId: v.id("_storage"),
    builtAt: v.number(),
    promotedBy: v.union(v.string(), v.null()),
    promotedAt: v.union(v.number(), v.null()),
    checklist: v.union(v.null(), v.array(v.string())),
  }).index("by_status_and_versionCode", ["status", "versionCode"]),
  pushSubscriptions: defineTable({
    operator: v.id("operators"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_operator", ["operator"])
    .index("by_endpoint", ["endpoint"]),
  errors: defineTable({
    fingerprint: v.string(),
    source: v.union(v.literal("web"), v.literal("server"), v.literal("android")),
    kind: v.string(),
    message: v.string(),
    /** Redacted, ≤ 4 KB. */
    sampleStack: v.string(),
    count: v.number(),
    firstAt: v.number(),
    lastAt: v.number(),
    latestVersion: v.string(),
    latestContext: v.string(),
    resolvedAt: v.union(v.number(), v.null()),
  })
    .index("by_fingerprint", ["fingerprint"])
    .index("by_lastAt", ["lastAt"])
    .index("by_firstAt", ["firstAt"]),
  fieldTests: defineTable({
    label: v.string(),
    freqHz: v.number(),
    truth: v.object({ lat: v.number(), lng: v.number() }),
    startedAt: v.number(),
    endedAt: v.union(v.number(), v.null()),
    by: v.string(),
    /** Per Scan that located it: the estimate and the used Receivers, for the n fit. */
    samples: v.array(
      v.object({
        lat: v.number(),
        lng: v.number(),
        used: v.array(v.object({ lat: v.number(), lng: v.number(), powerDbm: v.number() })),
      }),
    ),
    result: v.union(
      v.null(),
      v.object({
        scans: v.number(),
        medianErrorM: v.number(),
        n: v.union(v.number(), v.null()),
        nSpread: v.union(v.number(), v.null()),
      }),
    ),
  }).index("by_startedAt", ["startedAt"]),
  calibrationSessions: defineTable({
    at: v.number(),
    by: v.string(),
    referenceHz: v.number(),
    mode: v.union(v.literal("full"), v.literal("frequency")),
    participants: v.array(v.id("receivers")),
    state: v.union(
      v.literal("measuring"),
      v.literal("review"),
      v.literal("applied"),
      v.literal("cancelled"),
    ),
    measurements: v.array(
      v.object({
        receiver: v.id("receivers"),
        powerDbm: v.number(),
        freqOffsetHz: v.number(),
        at: v.number(),
      }),
    ),
    missing: v.array(v.id("receivers")),
    proposals: v.union(
      v.null(),
      v.array(
        v.object({
          receiver: v.id("receivers"),
          measuredDbm: v.number(),
          offsetDb: v.union(v.number(), v.null()),
          ppm: v.number(),
        }),
      ),
    ),
    applied: v.array(v.id("receivers")),
  }).index("by_at", ["at"]),
  watchlist: defineTable({
    /** Centre frequency: band changes never touch it, raster changes re-match by it. */
    freqHz: v.number(),
    name: v.string(),
    notes: v.string(),
    rules: v.object({ heard: v.boolean(), moved: v.boolean(), silent: v.boolean() }),
    critical: v.boolean(),
    home: v.union(v.null(), v.object({ lat: v.number(), lng: v.number() })),
    createdBy: v.string(),
  }).index("by_freqHz", ["freqHz"]),
  /** One row per Emitter name; written only when a Fix is stored and when it leaves the board. */
  emitterActivity: defineTable({
    freqHz: v.number(),
    lowHz: v.number(),
    highHz: v.number(),
    firstFixAt: v.number(),
    lastLocatedAt: v.number(),
    fixCount: v.number(),
    lastFix: v.object({
      id: v.id("fixes"),
      lat: v.number(),
      lng: v.number(),
      radiusM: v.number(),
      ptDbm: v.number(),
      occupancyClass: v.union(v.literal(0), v.literal(1), v.literal(2)),
      at: v.number(),
    }),
  })
    .index("by_freqHz", ["freqHz"])
    .index("by_lastLocatedAt", ["lastLocatedAt"]),
});
