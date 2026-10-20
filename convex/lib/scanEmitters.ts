// One Scan's Readings → its Emitters, their positions, which Fixes to store and the new board.
// Pure: the localization action feeds it decoded data and writes what it returns.
import type { BoardItem, OccupancyClass, Place } from "./boardCodec";
import { centreOf } from "./channelMath";
import { FIX_WINDOW_MS, type SweepPlan, sliceOf } from "./config";
import { centroid, distanceM, type LatLng, localPlane } from "./geo";
import type { PositionFix } from "./heartbeat";
import { estimate, MIN_RECEIVERS } from "./localization";
import type { EmitterRecord, ReadingPayload } from "./readingCodec";

/** A Fix is stored when Pt moves this much from the last stored one… */
export const STORE_POWER_DB = 10;
/** …and a slim "still here" Fix at least this often while it keeps being located. */
export const STILL_HERE_MS = 3_600_000;
/** An Emitter missed for this many Scans in a row leaves the board (and goes Silent). */
export const LEAVES_AFTER_MISSED = 3;

export const occupancyClass = (occupancy: number): OccupancyClass =>
  occupancy < 0.1 ? 0 : occupancy < 0.9 ? 1 : 2;
export const OCCUPANCY_LABEL = ["rare", "intermittent", "steady"] as const;

export type ReadingInput = {
  receiver: string;
  name: string;
  unaligned: boolean;
  payload: ReadingPayload;
  /** Passes in the whole window, and in the Fix window. */
  passes: number;
  fixPasses: number;
  start: PositionFix | null;
  end: PositionFix | null;
  /** A pinned Receiver's surveyed position; it wins over GPS. */
  pin: LatLng | null;
  /** An active "Moved?" alarm: its geometry is suspect. */
  moved: boolean;
};

export type EntryStatus =
  | "used"
  | "clipped"
  | "heard_later"
  | "not_heard"
  | "unaligned"
  | "no_position";

export type ReceiverEntry = {
  receiver: string;
  name: string;
  status: EntryStatus;
  /** Used/clipped: Fix-window dBm (clipped is a lower bound). Heard later: peak. Not heard: floor. */
  powerDbm: number | null;
  lat: number | null;
  lng: number | null;
};

export type Estimate = {
  lat: number;
  lng: number;
  region: LatLng[];
  uncertaintyM: number;
  receiverCount: number;
  chi2: number;
  chi2PerDof: number | null;
  flags: {
    unconfirmed: boolean;
    poorFit: boolean;
    collinear: boolean;
    receiverMoved: boolean;
  };
  pathLossN: number;
  ptDbm: number;
};

export type ScanEmitter = {
  /** The name: a Watchlist frequency, the previous name, or the strongest Channel's centre. */
  freqHz: number;
  ch: number;
  firstCh: number;
  widthCh: number;
  strongestCh: number;
  heard: number;
  loudest: string;
  powerDbm: number | null;
  peakDbm: number;
  occupancy: number;
  clipped: boolean;
  entries: ReceiverEntry[];
  estimate: Estimate | null;
  /** The used entries' positions and powers, for field tests. */
  used: (LatLng & { powerDbm: number })[];
};

/** Position at the Fix window: the pin, else GPS interpolated between the Reading's ends. */
export function positionAt(r: ReadingInput, t: number): LatLng | null {
  if (r.pin) return r.pin;
  const { start, end } = r;
  if (!start || !end) return start ?? end;
  const span = end.at - start.at;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - start.at) / span)) : 0;
  return {
    lat: start.lat + f * (end.lat - start.lat),
    lng: start.lng + f * (end.lng - start.lng),
  };
}

type Rec = EmitterRecord & { reading: number };

const strength = (r: EmitterRecord) =>
  r.fixPowerDbm === null ? [1, -r.peakDbm] : [0, -r.fixPowerDbm];
const byStrength = (a: EmitterRecord, b: EmitterRecord) => {
  const [ga, va] = strength(a) as [number, number];
  const [gb, vb] = strength(b) as [number, number];
  return ga - gb || va - vb;
};

const contains = (r: EmitterRecord, ch: number) => ch >= r.firstCh && ch < r.firstCh + r.widthCh;

/**
 * Strongest first: the strongest unassigned record anchors an Emitter, and each other Receiver
 * joins with its strongest unassigned record covering the anchor's strongest Channel. A member
 * must cover that Channel, not merely overlap another member, so groups can't chain.
 */
export function groupRecords(readings: ReadingInput[]): Rec[][] {
  const all: Rec[] = readings.flatMap((r, reading) =>
    r.payload.emitters.map((e) => ({ ...e, reading })),
  );
  all.sort(byStrength);
  const taken = new Set<Rec>();
  const groups: Rec[][] = [];
  for (const anchor of all) {
    if (taken.has(anchor)) continue;
    taken.add(anchor);
    const group = [anchor];
    for (let reading = 0; reading < readings.length; reading++) {
      if (reading === anchor.reading) continue;
      const member = all.find(
        (r) => r.reading === reading && !taken.has(r) && contains(r, anchor.strongestCh),
      );
      if (member) {
        taken.add(member);
        group.push(member);
      }
    }
    groups.push(group);
  }
  return groups;
}

export type Names = {
  /** Watchlist frequencies. */
  watch: number[];
  /** Names on the previous board, with when each was last located (null: never). */
  previous: { freqHz: number; missed: number | null }[];
};

/**
 * The Emitter's name, in order: a Watchlist frequency inside its span (closest to its strongest
 * Channel), a previous board name inside its span (most recently located), else its strongest
 * Channel. So a wide signal keeps one name from Scan to Scan.
 */
export function nameOf(
  span: { lowHz: number; highHz: number; strongestHz: number },
  names: Names,
  taken: Set<number>,
): number {
  const inside = (f: number) => f >= span.lowHz && f < span.highHz && !taken.has(f);
  const near = (a: number, b: number) =>
    Math.abs(a - span.strongestHz) - Math.abs(b - span.strongestHz);
  const watched = names.watch.filter(inside).sort(near)[0];
  if (watched !== undefined) return watched;
  const previous = names.previous
    .filter((p) => inside(p.freqHz))
    .sort((a, b) => (a.missed ?? 999) - (b.missed ?? 999) || near(a.freqHz, b.freqHz))[0];
  return previous?.freqHz ?? span.strongestHz;
}

export function buildEmitters(o: {
  startsAt: number;
  plan: SweepPlan;
  pathLossN: number;
  readings: ReadingInput[];
  names: Names;
}): { emitters: ScanEmitter[]; reason: string | null } {
  if (o.readings.length === 0) return { emitters: [], reason: "No Readings" };
  const raster = o.plan.rasterHz;
  const at = o.startsAt + FIX_WINDOW_MS / 2;
  const where = o.readings.map((r) => positionAt(r, at));
  const taken = new Set<number>();
  const emitters: ScanEmitter[] = [];

  for (const group of groupRecords(o.readings)) {
    const anchor = group[0] as Rec;
    const span = {
      lowHz: centreOf(anchor.firstCh, raster) - raster / 2,
      highHz: centreOf(anchor.firstCh + anchor.widthCh, raster) - raster / 2,
      strongestHz: centreOf(anchor.strongestCh, raster),
    };
    const freqHz = nameOf(span, o.names, taken);
    // A second group sharing a name is a fragment of the first: drop it.
    if (taken.has(freqHz)) continue;
    taken.add(freqHz);

    const entries: ReceiverEntry[] = [];
    const used: { at: LatLng; powerDbm: number; moved: boolean }[] = [];
    let peakDbm = Number.NEGATIVE_INFINITY;
    let occupancy = 0;
    let clipped = false;
    o.readings.forEach((r, i) => {
      const base = { receiver: r.receiver, name: r.name };
      const rec = group.find((g) => g.reading === i);
      const pos = where[i] ?? null;
      const place = pos ? { lat: pos.lat, lng: pos.lng } : { lat: null, lng: null };
      if (rec) {
        peakDbm = Math.max(peakDbm, rec.peakDbm);
        if (r.passes > 0) occupancy = Math.max(occupancy, rec.passesOn / r.passes);
        clipped ||= rec.clippedFix;
      }
      if (r.unaligned) {
        entries.push({
          ...base,
          status: "unaligned",
          powerDbm: rec?.fixPowerDbm ?? null,
          ...place,
        });
      } else if (rec && !pos) {
        entries.push({
          ...base,
          status: "no_position",
          powerDbm: rec.fixPowerDbm,
          ...place,
        });
      } else if (rec && rec.fixPowerDbm === null) {
        entries.push({
          ...base,
          status: "heard_later",
          powerDbm: rec.peakDbm,
          ...place,
        });
      } else if (rec && pos && rec.fixPowerDbm !== null) {
        entries.push({
          ...base,
          status: rec.clippedFix ? "clipped" : "used",
          powerDbm: rec.fixPowerDbm,
          ...place,
        });
        if (!rec.clippedFix) used.push({ at: pos, powerDbm: rec.fixPowerDbm, moved: r.moved });
      } else {
        const slice = r.payload.slices[sliceOf(o.plan, span.strongestHz)];
        entries.push({
          ...base,
          status: "not_heard",
          powerDbm: r.fixPasses > 0 ? (slice?.floorDbm ?? null) : null,
          ...place,
        });
      }
    });

    let est: Estimate | null = null;
    if (used.length >= MIN_RECEIVERS) {
      const plane = localPlane(centroid(used.map((u) => u.at)));
      const fit = estimate(
        used.map((u) => ({ xy: plane.toXY(u.at), powerDbm: u.powerDbm })),
        o.pathLossN,
      );
      const centre = plane.toLatLng(fit.xy);
      est = {
        lat: centre.lat,
        lng: centre.lng,
        region: fit.region.map(plane.toLatLng),
        uncertaintyM: fit.uncertaintyM,
        receiverCount: used.length,
        chi2: fit.chi2,
        chi2PerDof: fit.chi2PerDof,
        flags: { ...fit.flags, receiverMoved: used.some((u) => u.moved) },
        pathLossN: o.pathLossN,
        ptDbm: fit.ptDbm,
      };
    }
    emitters.push({
      freqHz,
      ch: Math.round(freqHz / raster),
      firstCh: anchor.firstCh,
      widthCh: anchor.widthCh,
      strongestCh: anchor.strongestCh,
      heard: group.length,
      loudest: o.readings[anchor.reading]?.receiver ?? "",
      powerDbm: anchor.fixPowerDbm,
      peakDbm,
      occupancy,
      clipped,
      entries,
      estimate: est,
      used: used.map((u) => ({ ...u.at, powerDbm: u.powerDbm })),
    });
  }
  const located = emitters.some((e) => e.estimate);
  return {
    emitters,
    reason:
      emitters.length === 0
        ? "No Emitter heard"
        : located
          ? null
          : `No Emitter heard by ${MIN_RECEIVERS} or more Receivers`,
  };
}

export type StoreKind = "change" | "hourly" | null;

/**
 * Change-only storage: a full Fix when the Emitter appeared, moved (the centres further apart
 * than both uncertainty radii), changed Pt by more than 10 dB or changed Occupancy class; a slim
 * one when the last stored Fix is an hour old; otherwise nothing.
 */
export function storeKind(
  now: Place & { occupancy: number },
  last: BoardItem["lastStored"],
  at: number,
  appeared: boolean,
): StoreKind {
  if (appeared || !last) return "change";
  const moved = distanceM(now, last) > now.radiusM + last.radiusM;
  const power = Math.abs(now.ptDbm - last.ptDbm) > STORE_POWER_DB;
  const occupancy = occupancyClass(now.occupancy) !== last.occupancyClass;
  if (moved || power || occupancy) return "change";
  return at - last.at >= STILL_HERE_MS ? "hourly" : null;
}

export type BoardOutcome = {
  items: BoardItem[];
  /** Emitters located now that weren't located in the last 3 Scans (or ever). */
  appeared: Set<number>;
  /** Names that left the board's located set this Scan, with when they were last located. */
  left: { freqHz: number; lastLocatedAt: number }[];
  store: Map<number, Exclude<StoreKind, null>>;
};

/** This Scan's board from its Emitters and the previous board; also what to store. */
export function nextBoard(o: {
  at: number;
  periodMs: number;
  emitters: ScanEmitter[];
  receivers: string[];
  previous: BoardItem[];
  previousAt: number | null;
  raster: number;
}): BoardOutcome {
  const prev = new Map(o.previous.map((p) => [p.ch * o.raster, p]));
  const appeared = new Set<number>();
  const store = new Map<number, Exclude<StoreKind, null>>();
  const items: BoardItem[] = [];
  const seen = new Set<number>();
  for (const e of o.emitters) {
    seen.add(e.freqHz);
    const p = prev.get(e.freqHz);
    const recent = p !== undefined && p.missed !== null && p.missed < LEAVES_AFTER_MISSED;
    const est = e.estimate;
    let position = p?.position ?? null;
    let lastStored = p?.lastStored ?? null;
    let missed = p?.missed === null || p === undefined ? null : p.missed + 1;
    let fixStored = false;
    if (est) {
      position = {
        lat: est.lat,
        lng: est.lng,
        radiusM: est.uncertaintyM,
        ptDbm: est.ptDbm,
      };
      missed = 0;
      if (!recent) appeared.add(e.freqHz);
      const kind = storeKind({ ...position, occupancy: e.occupancy }, lastStored, o.at, !recent);
      if (kind) {
        store.set(e.freqHz, kind);
        fixStored = true;
        lastStored = {
          ...position,
          occupancyClass: occupancyClass(e.occupancy),
          at: o.at,
        };
      }
    }
    items.push({
      ch: e.ch,
      firstCh: e.firstCh,
      widthCh: e.widthCh,
      heard: e.heard,
      used: est?.receiverCount ?? 0,
      loudest: Math.max(0, o.receivers.indexOf(e.loudest)),
      located: est !== null,
      unconfirmed: est?.flags.unconfirmed ?? false,
      poorFit: est?.flags.poorFit ?? false,
      collinear: est?.flags.collinear ?? false,
      receiverMoved: est?.flags.receiverMoved ?? false,
      clipped: e.clipped,
      fixStored,
      missed,
      powerDbm: e.powerDbm,
      peakDbm: e.peakDbm,
      occupancy: e.occupancy,
      position,
      lastStored,
    });
  }
  const left: BoardOutcome["left"] = [];
  for (const p of o.previous) {
    const freqHz = p.ch * o.raster;
    const locatedNow = items.some((i) => i.ch === p.ch && i.located);
    if (p.missed === LEAVES_AFTER_MISSED - 1 && !locatedNow) {
      left.push({
        freqHz,
        lastLocatedAt: (o.previousAt ?? o.at) - (LEAVES_AFTER_MISSED - 1) * o.periodMs,
      });
    }
    if (seen.has(freqHz) || p.missed === null || p.missed + 1 >= LEAVES_AFTER_MISSED) continue;
    // Located recently but not heard now: carried, dimmed, with its last position.
    items.push({
      ...p,
      heard: 0,
      used: 0,
      located: false,
      fixStored: false,
      missed: p.missed + 1,
    });
  }
  return { items, appeared, left, store };
}
