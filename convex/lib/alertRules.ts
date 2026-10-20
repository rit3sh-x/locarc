// Emitter alert rules, evaluated when a Scan is localized. Pure.
import { formatMHz } from "./channelMath";
import { covers, type Segment } from "./config";
import { distanceM, type LatLng } from "./geo";

export const NEW_AFTER_QUIET_MS = 7 * 86_400_000;
export const LEARNING_MS = 24 * 3_600_000;
export const HEARD_AFTER_QUIET_MS = 30 * 60_000;
export const MOVED_M = 100;
export const SILENT_SCANS = 3;

export type Watch = {
  name: string;
  rules: { heard: boolean; moved: boolean; silent: boolean };
  critical: boolean;
  home: LatLng | null;
};

export type Learning = {
  firstRunAt: number | null;
  planChange: { at: number; previousSegments: Segment[] } | null;
};

/**
 * New is quiet for 24 h after the first Run, and after a Sweep plan change for frequencies the
 * previous plan didn't cover.
 */
export function learning(l: Learning, freqHz: number, at: number): boolean {
  if (l.firstRunAt === null || at < l.firstRunAt + LEARNING_MS) return true;
  const c = l.planChange;
  return c !== null && at < c.at + LEARNING_MS && !covers({ segments: c.previousSegments }, freqHz);
}

/** Away from the usual position: > 100 m, and the usual spot outside its uncertainty radius. */
const outside = (p: Place, usual: LatLng) => {
  const d = distanceM(p, usual);
  return d > MOVED_M && d > p.radiusM;
};

export function median(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  const mid = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
  };
  return {
    lat: mid(points.map((p) => p.lat)),
    lng: mid(points.map((p) => p.lng)),
  };
}

export type EmitterAlert = {
  type: "new" | "heard" | "moved";
  severity: "critical" | "warning";
  title: string;
  detail: string;
};

export type Place = LatLng & { radiusM: number };

/**
 * New, Heard and Moved for one Emitter located this Scan (event alerts). "Appeared" means it
 * wasn't located in the previous 3 Scans; `lastLocatedAt` is when it last was, from activity.
 */
export function emitterAlerts(o: {
  freqHz: number;
  at: number;
  watch: Watch | null;
  appeared: boolean;
  lastLocatedAt: number | null;
  /** Any Emitter inside its span located in the last 7 days. */
  recentInSpan: boolean;
  current: Place;
  /** Its position in the previous Scan, when it was located there. */
  previous: Place | null;
  /** The entry's home, else the median centre of its 10 stored Fixes before these. */
  usual: LatLng | null;
  learning: Learning;
}): EmitterAlert[] {
  const label = o.watch ? `${o.watch.name} (${formatMHz(o.freqHz)})` : formatMHz(o.freqHz);
  if (!o.watch) {
    if (!o.appeared || o.recentInSpan || learning(o.learning, o.freqHz, o.at)) return [];
    return [
      {
        type: "new",
        severity: "warning",
        title: `New emitter on ${formatMHz(o.freqHz)}`,
        detail: "Not on the Watchlist and not located in 7 days",
      },
    ];
  }
  const severity = o.watch.critical ? "critical" : "warning";
  const out: EmitterAlert[] = [];
  const quietFor = o.lastLocatedAt === null ? null : o.at - o.lastLocatedAt;
  if (
    o.watch.rules.heard &&
    o.appeared &&
    (quietFor === null || quietFor >= HEARD_AFTER_QUIET_MS)
  ) {
    out.push({
      type: "heard",
      severity,
      title: `${label} heard ${quietFor === null ? "for the first time" : `after ${Math.round(quietFor / 60_000)} min quiet`}`,
      detail: "Located after 30+ min without being located",
    });
  }
  if (
    o.watch.rules.moved &&
    o.previous &&
    o.usual &&
    outside(o.current, o.usual) &&
    outside(o.previous, o.usual)
  ) {
    out.push({
      type: "moved",
      severity,
      title: `${label} moved ${Math.round(distanceM(o.current, o.usual))} m`,
      detail: "2 Scans in a row away from its usual position",
    });
  }
  return out;
}
