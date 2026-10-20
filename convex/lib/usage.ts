// The usage meter: a monthly projection of Convex Free plan use from what the website already
// knows (cadence, burst, Receivers, the Sweep plan, Emitters on the latest board, open tabs). No
// per-call counters are written; the Convex dashboard stays authoritative and the 24 h soak
// calibrates these constants.
import { type Cadence, planWidthHz, type Segment, slices } from "./config";
import { burstLengthMs, periodMs, revertCadence } from "./schedule";

export const FREE_PLAN = {
  calls: 1_000_000,
  ioBytes: 1_000_000_000,
  storageBytes: 500_000_000,
};
export const WARN_AT = 0.8;
const MONTH_MS = 30 * 86_400_000;
const HOUR_MS = 3_600_000;
const KB = 1000;

/**
 * Per-Scan costs, matched to the Convex spec's budget anchors (5 Receivers, the bug bands, ~200
 * Emitters, one tab: ≈105 KB of I/O and 17 calls a Scan).
 */
export const COST = {
  /** Boundary, close, and the localization action with its query and mutation. */
  schedulerCallsPerScan: 5,
  /** Each sync re-runs the shell's hot queries once per open tab, plus the per-Scan queries. */
  tabCallsPerSync: 1,
  tabCallsPerScan: 2,
  /** Status overwrite, Scan counters and the dead-man timer, per Receiver. */
  ioPerReceiverScan: 4 * KB,
  /** A tab re-reads ~2 KB of hot docs per sync and ~2.7 KB of other per-Scan queries. */
  ioPerTabSync: 2 * KB,
  ioPerTabScan: 2.7 * KB,
  /** Reading v1: 3 B per slice, 15 B per Emitter; a Receiver hears about 3 in 4 Emitters. */
  readingBaseBytes: 7,
  sliceBytes: 3,
  emitterRecordBytes: 15,
  heardShare: 0.75,
  /** One board item per Emitter heard. */
  boardItemBytes: 50,
  /** Full Fixes (on change) and slim hourly ones. */
  fixBytes: 1.5 * KB,
  slimFixBytes: 0.3 * KB,
  changedShare: 0.03,
  locatedShare: 0.75,
  /** Emitters per MHz of plan before any Scan has run (measured: ~200 on the 1,090 MHz bug bands). */
  emittersPerMHz: 0.18,
  /** Idle Receivers heartbeat every 5 minutes. */
  idleSyncMs: 5 * 60_000,
  scanBytes: 0.5 * KB,
  readingDays: 7,
  boardDays: 7,
  fixDays: 30,
  baseStorageBytes: 10_000_000,
};

export type UsageInput = {
  /** null when stopped. */
  cadence: Cadence | null;
  /** When a running burst ends (null for steady cadences). */
  burstEndsAt: number | null;
  now: number;
  segments: Segment[];
  receivers: number;
  /** Emitters on the latest board; estimated from the plan's width when there is none. */
  emitters: number | null;
  tabs?: number;
};

export type Usage = {
  calls: number;
  ioBytes: number;
  storageBytes: number;
  pct: { calls: number; io: number; storage: number };
  worst: number;
  warn: boolean;
};

/** Scans a month split by period, since a burst reverts partway through. */
function scanPeriods(i: UsageInput): { scans: number; period: number }[] {
  if (!i.cadence) return [];
  const burst = burstLengthMs(i.cadence);
  if (burst === null)
    return [{ scans: MONTH_MS / periodMs(i.cadence), period: periodMs(i.cadence) }];
  const left = Math.max(
    0,
    Math.min(i.burstEndsAt === null ? burst : i.burstEndsAt - i.now, MONTH_MS),
  );
  const revert = periodMs(revertCadence(i.cadence));
  return [
    { scans: left / periodMs(i.cadence), period: periodMs(i.cadence) },
    { scans: (MONTH_MS - left) / revert, period: revert },
  ];
}

export function projectMonth(i: UsageInput): Usage {
  const tabs = i.tabs ?? 1;
  const r = i.receivers;
  const emitters = i.emitters ?? Math.max(10, (planWidthHz(i) / 1e6) * COST.emittersPerMHz);
  const located = emitters * COST.locatedShare;
  const readingBytes =
    COST.readingBaseBytes +
    slices(i).length * COST.sliceBytes +
    emitters * COST.heardShare * COST.emitterRecordBytes;
  const boardBytes = emitters * COST.boardItemBytes;
  // Every located Emitter leaves a slim Fix an hour, plus full ones when something changed.
  const fixBytesPerScan = (period: number) =>
    located * Math.min(1, period / HOUR_MS) * COST.slimFixBytes +
    located * COST.changedShare * COST.fixBytes;

  let calls = 0;
  let ioBytes = 0;
  let storageBytes = COST.baseStorageBytes;
  let scanned = 0;
  for (const { scans, period } of scanPeriods(i)) {
    scanned += scans;
    calls +=
      scans *
      (r + COST.schedulerCallsPerScan + tabs * (r * COST.tabCallsPerSync + COST.tabCallsPerScan));
    ioBytes +=
      scans *
      (r * (2 * readingBytes + COST.ioPerReceiverScan) +
        2 * boardBytes +
        fixBytesPerScan(period) +
        tabs * (r * COST.ioPerTabSync + COST.ioPerTabScan + boardBytes));
    // Steady state of what retention keeps, in proportion to the month at this period.
    const perDay = scans / 30;
    storageBytes +=
      perDay * COST.readingDays * r * readingBytes +
      perDay * COST.boardDays * boardBytes +
      perDay * COST.fixDays * (fixBytesPerScan(period) + COST.scanBytes);
  }
  const idleSyncs = scanned === 0 ? (MONTH_MS / COST.idleSyncMs) * r : 0;
  calls += idleSyncs * (1 + tabs);
  ioBytes += idleSyncs * tabs * COST.ioPerTabSync;
  const pct = {
    calls: calls / FREE_PLAN.calls,
    io: ioBytes / FREE_PLAN.ioBytes,
    storage: storageBytes / FREE_PLAN.storageBytes,
  };
  const worst = Math.max(pct.calls, pct.io, pct.storage);
  return { calls, ioBytes, storageBytes, pct, worst, warn: worst >= WARN_AT };
}
