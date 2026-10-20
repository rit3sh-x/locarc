import { type Infer, v } from "convex/values";

export const ENVIRONMENT_N = {
  open: 2.2,
  suburban: 3.0,
  urban: 3.5,
  dense: 3.9,
} as const;

export const cadenceValidator = v.union(
  v.object({
    kind: v.literal("steady"),
    minutes: v.union(v.literal(5), v.literal(15)),
  }),
  v.object({
    kind: v.literal("oneMinute"),
    hours: v.union(v.literal(1), v.literal(2), v.literal(4)),
    revertMinutes: v.union(v.literal(5), v.literal(15)),
  }),
  v.object({
    kind: v.literal("continuous"),
    minutes: v.union(v.literal(15), v.literal(30), v.literal(60)),
    revertMinutes: v.union(v.literal(5), v.literal(15)),
  }),
);

export const segmentValidator = v.object({
  startHz: v.number(),
  endHz: v.number(),
});
export type Segment = Infer<typeof segmentValidator>;

export const orgConfigValidator = v.object({
  /** The Sweep plan's frequency segments, ascending and not overlapping. */
  segments: v.array(segmentValidator),
  rasterHz: v.union(v.literal(12_500), v.literal(25_000)),
  cadence: cadenceValidator,
  environment: v.object({
    preset: v.union(
      v.literal("open"),
      v.literal("suburban"),
      v.literal("urban"),
      v.literal("dense"),
      v.literal("custom"),
    ),
    n: v.number(),
  }),
  referenceHz: v.union(v.number(), v.null()),
});

export type Cadence = Infer<typeof cadenceValidator>;
export type OrgConfig = Infer<typeof orgConfigValidator>;

const MHZ = 1e6;
const seg = (startMHz: number, endMHz: number): Segment => ({
  startHz: startMHz * MHZ,
  endHz: endMHz * MHZ,
});

/** Where covert listening devices and telecom bugs transmit (the bands decision), ~1.1 GHz. */
export const SWEEP_PRESETS = {
  bugBands: {
    label: "Bug bands",
    segments: [
      seg(30, 50),
      seg(88, 108),
      seg(130, 180),
      seg(300, 500),
      seg(800, 960),
      seg(1700, 1990),
      seg(2300, 2500),
      seg(5725, 5875),
    ],
  },
  fullSpan: { label: "Full 1 MHz–6 GHz", segments: [seg(1, 6000)] },
} as const;
export type SweepPreset = keyof typeof SWEEP_PRESETS;

export const ORG_CONFIG_DEFAULTS: OrgConfig = {
  segments: [...SWEEP_PRESETS.bugBands.segments],
  rasterHz: 12_500,
  cadence: { kind: "steady", minutes: 15 },
  environment: { preset: "urban", n: ENVIRONMENT_N.urban },
  referenceHz: null,
};

export const positionValidator = v.union(
  v.object({ mode: v.literal("live") }),
  v.object({ mode: v.literal("pinned"), lat: v.number(), lng: v.number() }),
);

export const receiverConfigValidator = v.object({
  name: v.string(),
  notes: v.string(),
  lnaDb: v.number(),
  vgaDb: v.number(),
  /** The HackRF's RF amplifier: +3–4 dB on faint signals for a Receiver in a quiet spot. */
  amp: v.boolean(),
  offsetDb: v.number(),
  offsetSource: v.union(v.literal("default"), v.literal("calibration"), v.literal("manual")),
  ppm: v.number(),
  position: positionValidator,
});

export type ReceiverConfig = Infer<typeof receiverConfigValidator>;

export const receiverConfigDefaults = (name: string): ReceiverConfig => ({
  name,
  notes: "",
  lnaDb: 32,
  vgaDb: 30,
  amp: false,
  offsetDb: 0,
  offsetSource: "default",
  ppm: 0,
  position: { mode: "live" },
});

// ── Sweep plan: firmware sweep mode at 20 MS/s, over and over through each Listening window. ──

export const MIN_BAND_HZ = 1e6;
export const MAX_BAND_HZ = 6000e6;
export const MAX_SEGMENTS = 16;
/** The HackRF's sweep-mode tune step, and the measured time per tune (0.15 s for the bug bands). */
export const TUNE_HZ = 20e6;
export const TUNE_MS = 2.7;
/** Readings report a noise floor per 5 MHz slice of the plan. */
export const SLICE_HZ = 5e6;
/** Fix power covers the first 10 s after the boundary, which every Receiver always listens to. */
export const FIX_WINDOW_MS = 10_000;
/** Receivers stop listening this long before the next boundary, to upload. */
export const UPLOAD_MARGIN_MS = 3_000;

export const sweepPlanValidator = v.object({
  segments: v.array(segmentValidator),
  rasterHz: v.number(),
});
export type SweepPlan = Infer<typeof sweepPlanValidator>;

export const sweepPlan = (c: Pick<OrgConfig, "segments" | "rasterHz">): SweepPlan => ({
  segments: c.segments,
  rasterHz: c.rasterHz,
});

export const planWidthHz = (plan: Pick<SweepPlan, "segments">) =>
  plan.segments.reduce((n, s) => n + (s.endHz - s.startHz), 0);

export const tuneCount = (plan: Pick<SweepPlan, "segments">) =>
  plan.segments.reduce((n, s) => n + Math.max(1, Math.ceil((s.endHz - s.startHz) / TUNE_HZ)), 0);

/** One pass over every segment. */
export const passMs = (plan: Pick<SweepPlan, "segments">) => tuneCount(plan) * TUNE_MS;

export const passesInFixWindow = (plan: Pick<SweepPlan, "segments">) =>
  Math.floor(FIX_WINDOW_MS / passMs(plan));

/** The plan's 5 MHz slices, in order: each segment from its start, its last slice shorter. */
export function slices(plan: Pick<SweepPlan, "segments">): Segment[] {
  const out: Segment[] = [];
  for (const s of plan.segments) {
    for (let lo = s.startHz; lo < s.endHz; lo += SLICE_HZ) {
      out.push({ startHz: lo, endHz: Math.min(s.endHz, lo + SLICE_HZ) });
    }
  }
  return out;
}

/** Index of the slice holding a frequency, or −1 outside the plan. */
export function sliceOf(plan: Pick<SweepPlan, "segments">, freqHz: number): number {
  let i = 0;
  for (const s of plan.segments) {
    const n = Math.ceil((s.endHz - s.startHz) / SLICE_HZ);
    if (freqHz >= s.startHz && freqHz < s.endHz)
      return i + Math.floor((freqHz - s.startHz) / SLICE_HZ);
    i += n;
  }
  return -1;
}

export const covers = (plan: Pick<SweepPlan, "segments">, freqHz: number) =>
  plan.segments.some((s) => freqHz >= s.startHz && freqHz < s.endHz);

/** Which preset a segment list is, if any. */
export function presetOf(segments: Segment[]): SweepPreset | null {
  for (const [key, p] of Object.entries(SWEEP_PRESETS)) {
    if (sameSegments(p.segments, segments)) return key as SweepPreset;
  }
  return null;
}

/** Ascending by start; the editor sorts before saving. */
export const sortSegments = (segments: Segment[]) =>
  [...segments].sort((a, b) => a.startHz - b.startHz);

// ── Validation, diff and effects: one module for the website's live checks and the backend. ──

export type ConfigProblem = {
  code: "BAND_INVALID" | "VALUE_OUT_OF_RANGE";
  message: string;
};

export function validateSegments(segments: Segment[]): ConfigProblem | null {
  if (segments.length < 1 || segments.length > MAX_SEGMENTS) {
    return {
      code: "BAND_INVALID",
      message: `The Sweep plan needs 1–${MAX_SEGMENTS} segments.`,
    };
  }
  for (const [i, s] of segments.entries()) {
    if (!(s.startHz >= MIN_BAND_HZ && s.endHz <= MAX_BAND_HZ && s.startHz < s.endHz)) {
      return {
        code: "BAND_INVALID",
        message: "Each segment must sit within 1–6000 MHz, start below end.",
      };
    }
    const prev = segments[i - 1];
    if (prev && s.startHz < prev.endHz) {
      return {
        code: "BAND_INVALID",
        message: "Segments must be in order and must not overlap.",
      };
    }
  }
  return null;
}

export function validateOrgConfig(c: OrgConfig): ConfigProblem | null {
  const plan = validateSegments(c.segments);
  if (plan) return plan;
  if (c.environment.n < 1.5 || c.environment.n > 6) {
    return {
      code: "VALUE_OUT_OF_RANGE",
      message: "The path-loss exponent must be within 1.5–6.",
    };
  }
  if (c.referenceHz !== null && (c.referenceHz < MIN_BAND_HZ || c.referenceHz > MAX_BAND_HZ)) {
    return {
      code: "VALUE_OUT_OF_RANGE",
      message: "The reference must be within 1–6000 MHz.",
    };
  }
  return null;
}

const mhz = (hz: number) => `${Number((hz / 1e6).toFixed(4))}`;
const ENV_LABEL = {
  open: "Open",
  suburban: "Suburban",
  urban: "Urban",
  dense: "Dense/indoor",
  custom: "Custom",
} as const;
const cadenceText = (c: Cadence) =>
  c.kind === "steady"
    ? `every ${c.minutes} min`
    : c.kind === "oneMinute"
      ? `1-min burst for ${c.hours} h, then every ${c.revertMinutes} min`
      : `Continuous for ${c.minutes} min, then every ${c.revertMinutes} min`;

/** "Bug bands · 8 segments · 1,090 MHz", or the segments themselves when there are few. */
export function describeSweepPlan(segments: Segment[]): string {
  const preset = presetOf(segments);
  if (preset === "fullSpan") return SWEEP_PRESETS.fullSpan.label;
  const width = `${Math.round(planWidthHz({ segments }) / 1e6).toLocaleString("en")} MHz`;
  const n = `${segments.length} segment${segments.length === 1 ? "" : "s"}`;
  if (preset) return `${SWEEP_PRESETS[preset].label} · ${n} · ${width}`;
  if (segments.length <= 3)
    return segments.map((s) => `${mhz(s.startHz)}–${mhz(s.endHz)} MHz`).join(", ");
  return `${n} · ${width}`;
}

export function describeOrgConfig(c: OrgConfig) {
  return {
    sweepPlan: describeSweepPlan(c.segments),
    raster: `${c.rasterHz / 1000} kHz`,
    cadence: cadenceText(c.cadence),
    environment: `${ENV_LABEL[c.environment.preset]} (n ${c.environment.n})`,
    reference: c.referenceHz === null ? "none" : `${mhz(c.referenceHz)} MHz`,
  };
}

/** Human lines for the diff confirm and the version timeline. */
export function orgConfigDiff(a: OrgConfig, b: OrgConfig): string[] {
  const da = describeOrgConfig(a);
  const db = describeOrgConfig(b);
  const label = {
    sweepPlan: "Sweep plan",
    raster: "Channel raster",
    cadence: "Cadence",
    environment: "Propagation environment",
    reference: "Calibration reference",
  } as const;
  const lines = (Object.keys(label) as (keyof typeof label)[])
    .filter((k) => da[k] !== db[k])
    .map((k) => `${label[k]}: ${da[k]} → ${db[k]}`);
  // Two plans can read alike ("9 segments · 1,100 MHz"); still say the segments changed.
  if (da.sweepPlan === db.sweepPlan && !sameSegments(a.segments, b.segments)) {
    lines.unshift(`Sweep plan: segments edited (${db.sweepPlan})`);
  }
  return lines;
}

/** Deep equality that ignores key order: documents read back from Convex sort their keys. */
export const sameValue = (a: unknown, b: unknown) => stable(a) === stable(b);
const stable = (x: unknown): string =>
  Array.isArray(x)
    ? `[${x.map(stable).join(",")}]`
    : x !== null && typeof x === "object"
      ? `{${Object.keys(x)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(x);

export const sameSegments = (a: readonly Segment[], b: readonly Segment[]) => sameValue(a, b);

/** Sweep plan, raster or cadence changes end the Run; n and the reference don't. */
export const startsNewRun = (a: OrgConfig, b: OrgConfig) =>
  !sameSegments(a.segments, b.segments) ||
  a.rasterHz !== b.rasterHz ||
  !sameValue(a.cadence, b.cadence);

export type OrgEffect =
  | { kind: "newRun"; endsRun: number | null; startsAt: number }
  | { kind: "pathLoss"; n: number }
  | { kind: "usage"; before: number; after: number; warn: boolean };

// ── Receiver config ──

export const LNA_STEPS = [0, 8, 16, 24, 32, 40] as const;
export const VGA_STEPS = Array.from({ length: 32 }, (_, i) => i * 2);

export function validateReceiverConfig(c: ReceiverConfig): ConfigProblem | null {
  const name = c.name.trim();
  if (name.length < 1 || name.length > 40)
    return {
      code: "VALUE_OUT_OF_RANGE",
      message: "Names are 1–40 characters.",
    };
  if (!(LNA_STEPS as readonly number[]).includes(c.lnaDb))
    return {
      code: "VALUE_OUT_OF_RANGE",
      message: "LNA gain is 0–40 dB in 8 dB steps.",
    };
  if (!VGA_STEPS.includes(c.vgaDb))
    return {
      code: "VALUE_OUT_OF_RANGE",
      message: "VGA gain is 0–62 dB in 2 dB steps.",
    };
  if (Math.abs(c.offsetDb) > 30)
    return {
      code: "VALUE_OUT_OF_RANGE",
      message: "The calibration offset is within ±30 dB.",
    };
  if (Math.abs(c.ppm) > 50)
    return {
      code: "VALUE_OUT_OF_RANGE",
      message: "Frequency correction is within ±50 ppm.",
    };
  if (
    c.position.mode === "pinned" &&
    (Math.abs(c.position.lat) > 90 || Math.abs(c.position.lng) > 180)
  ) {
    return {
      code: "VALUE_OUT_OF_RANGE",
      message: "That pin isn't a valid position.",
    };
  }
  return null;
}

const signed = (x: number, unit: string) => `${x > 0 ? "+" : ""}${x} ${unit}`;
const where = (p: ReceiverConfig["position"]) =>
  p.mode === "live" ? "live GPS" : `pinned ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

export function receiverConfigDiff(a: ReceiverConfig, b: ReceiverConfig): string[] {
  const out: string[] = [];
  if (a.name !== b.name) out.push(`Name: ${a.name} → ${b.name}`);
  if (a.notes !== b.notes) out.push("Notes changed");
  if (a.lnaDb !== b.lnaDb) out.push(`LNA: ${a.lnaDb} → ${b.lnaDb} dB`);
  if (a.vgaDb !== b.vgaDb) out.push(`VGA: ${a.vgaDb} → ${b.vgaDb} dB`);
  if (a.amp !== b.amp) out.push(`RF amp: ${a.amp ? "on" : "off"} → ${b.amp ? "on" : "off"}`);
  if (a.offsetDb !== b.offsetDb || a.offsetSource !== b.offsetSource) {
    out.push(
      `Offset: ${signed(a.offsetDb, "dB")} → ${signed(b.offsetDb, "dB")} (${b.offsetSource})`,
    );
  }
  if (a.ppm !== b.ppm)
    out.push(`Frequency correction: ${signed(a.ppm, "ppm")} → ${signed(b.ppm, "ppm")}`);
  if (!sameValue(a.position, b.position))
    out.push(`Position: ${where(a.position)} → ${where(b.position)}`);
  return out;
}
