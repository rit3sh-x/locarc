import { type Infer, v } from "convex/values";

// The fixed fault enum from the HackRF USB fault handling decision.
export const FAULT_CODES = [
  "PERMISSION_DENIED",
  "DETACHED",
  "OPEN_FAILED",
  "TUNE_FAILED",
  "TRANSFER_TIMEOUT",
  "TRANSFER_ERROR",
  "SHORT_READ",
  "ZERO_BUFFER",
  "DC_ONLY",
  "RESET_FAILED",
  "POWER_FLAPPING",
  "FIRMWARE_UNSUPPORTED",
] as const;
export type FaultCode = (typeof FAULT_CODES)[number];

export const hackrfStateValidator = v.union(
  v.literal("detached"),
  v.literal("needs_permission"),
  v.literal("opening"),
  v.literal("ready"),
  v.literal("streaming"),
  v.literal("recovering"),
  v.literal("needs_attention"),
);

export const thermalValidator = v.union(
  v.literal("none"),
  v.literal("light"),
  v.literal("moderate"),
  v.literal("severe"),
  v.literal("critical"),
  v.literal("emergency"),
  v.literal("shutdown"),
);

/** Phone settings a Receiver needs to run unattended; missing ones never stop it scanning. */
export const SETUP_GAPS = {
  backgroundLocation: 'location "Allow all the time"',
  batteryRestrictions: "battery restrictions on",
  usbAlwaysOpen: '"Always open Locarc" for the HackRF',
  notifications: "notifications off",
  autostart: "Xiaomi Autostart off",
} as const;
export type SetupGap = keyof typeof SETUP_GAPS;
export const setupGapValidator = v.union(
  v.literal("backgroundLocation"),
  v.literal("batteryRestrictions"),
  v.literal("usbAlwaysOpen"),
  v.literal("notifications"),
  v.literal("autostart"),
);

/** What every sync carries about the phone, HackRF and outbox. */
export const heartbeatValidator = v.object({
  appVersion: v.string(),
  appVersionCode: v.number(),
  battery: v.number(),
  charging: v.boolean(),
  thermal: thermalValidator,
  selfPause: v.union(v.null(), v.literal("battery"), v.literal("thermal")),
  hackrf: v.object({
    state: hackrfStateValidator,
    serial: v.union(v.string(), v.null()),
    boardId: v.union(v.number(), v.null()),
    firmware: v.union(v.string(), v.null()),
    /** Highest recovery ladder level reached since the last heartbeat (0 = none). */
    ladder: v.number(),
    /** Counts per FaultCode since the last heartbeat. */
    faults: v.record(v.string(), v.number()),
    detachedSince: v.union(v.number(), v.null()),
  }),
  clippedHz: v.array(v.number()),
  /** Full: boundary to the upload margin. Short: the Fix window only, when warm or on battery. */
  window: v.object({
    mode: v.union(v.literal("full"), v.literal("short")),
    reason: v.union(v.null(), v.literal("battery"), v.literal("warm")),
  }),
  setupGaps: v.array(setupGapValidator),
  outbox: v.object({
    depth: v.number(),
    oldestAgeS: v.number(),
    dropped: v.number(),
  }),
  clock: v.object({ offsetMs: v.number(), uncertaintyMs: v.number() }),
  gpsAccuracyM: v.union(v.number(), v.null()),
  appliedConfigV: v.union(v.number(), v.null()),
  rejectedConfig: v.union(v.null(), v.object({ v: v.number(), reason: v.string() })),
  lastError: v.union(v.string(), v.null()),
});
export type Heartbeat = Infer<typeof heartbeatValidator>;

export const positionFixValidator = v.object({
  lat: v.number(),
  lng: v.number(),
  accuracyM: v.number(),
  at: v.number(),
});
export type PositionFix = Infer<typeof positionFixValidator>;
