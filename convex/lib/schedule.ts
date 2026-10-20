import { type Cadence, FIX_WINDOW_MS, UPLOAD_MARGIN_MS } from "./config";

/** Lead time a new Run always gets, so every phone sees the control doc before boundary 0. */
export const MIN_RUN_LEAD_MS = 10_000;
export const CLOSE_GRACE_MS = 30_000;
/** Continuous Scans: the 10 s Fix window, the upload margin and a 2 s guard. */
export const CONTINUOUS_PERIOD_MS = 15_000;

/** Runs open at the next whole minute that leaves at least MIN_RUN_LEAD_MS. */
export const nextRunStart = (now: number) => Math.ceil((now + MIN_RUN_LEAD_MS) / 60_000) * 60_000;

export function periodMs(cadence: Cadence): number {
  switch (cadence.kind) {
    case "steady":
      return cadence.minutes * 60_000;
    case "oneMinute":
      return 60_000;
    case "continuous":
      return CONTINUOUS_PERIOD_MS;
  }
}

export function burstLengthMs(cadence: Cadence): number | null {
  switch (cadence.kind) {
    case "steady":
      return null;
    case "oneMinute":
      return cadence.hours * 3_600_000;
    case "continuous":
      return cadence.minutes * 60_000;
  }
}

export const revertCadence = (cadence: Cadence): Cadence =>
  cadence.kind === "steady" ? cadence : { kind: "steady", minutes: cadence.revertMinutes };

export const boundaryAt = (runStart: number, period: number, k: number) => runStart + k * period;

/** The Scan whose slot contains `now` (−1 before the Run starts). */
export const scanIndexAt = (runStart: number, period: number, now: number) =>
  Math.floor((now - runStart) / period);

/** Receivers upload just before the next boundary; stragglers get 30 s more. */
export const closeDeadline = (startsAt: number, period: number) =>
  startsAt + period + CLOSE_GRACE_MS;

/** A full Listening window: from the boundary to the upload margin before the next one. */
export const listeningWindowMs = (period: number) =>
  Math.max(FIX_WINDOW_MS, period - UPLOAD_MARGIN_MS);

export function describeCadence(cadence: Cadence): string {
  switch (cadence.kind) {
    case "steady":
      return `every ${cadence.minutes} min`;
    case "oneMinute":
      return `1-min burst for ${cadence.hours} h, then every ${cadence.revertMinutes} min`;
    case "continuous":
      return `Continuous for ${cadence.minutes} min, then every ${cadence.revertMinutes} min`;
  }
}
