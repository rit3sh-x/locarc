import type { Doc } from "@/convex/_generated/dataModel";
import { decodeReading } from "@/convex/lib/readingCodec";
import type { BoardRow } from "./emitters";

type Reading = Doc<"readings"> & { name: string };

/** The whole Scan as JSON: header, decoded Readings, its board and stored Fixes. */
export function scanJson(o: {
  run: Doc<"runs">;
  scan: { runNumber: number; k: number; startsAt: number; state: string; reason: string | null };
  readings: Reading[];
  board: BoardRow[];
  fixes: Doc<"fixes">[];
}) {
  return {
    run: { number: o.run.number, cadence: o.run.cadence, plan: o.run.plan },
    scan: { ...o.scan, number: o.scan.k + 1, startsAtIso: new Date(o.scan.startsAt).toISOString() },
    readings: o.readings.map(({ payload, _id, _creationTime, scan, run, ...header }) => ({
      ...header,
      ...decodeReading(payload),
    })),
    board: o.board,
    fixes: o.fixes.map(({ _id, _creationTime, scan, run, ...f }) => f),
  };
}

const CSV_HEADER = [
  "freq_mhz",
  "span_khz",
  "heard",
  "used",
  "located",
  "lat",
  "lng",
  "radius_m",
  "pt_dbm",
  "power_dbm",
  "peak_dbm",
  "occupancy",
  "unconfirmed",
  "poor_fit",
  "collinear",
  "receiver_moved",
  "clipped",
  "fix_stored",
];

/** The Scan's board as CSV: one row per Emitter heard. */
export function boardCsv(rows: BoardRow[]): string {
  const lines = rows.map((r) =>
    [
      (r.freqHz / 1e6).toFixed(4),
      ((r.highHz - r.lowHz) / 1e3).toFixed(1),
      r.heard,
      r.used,
      r.located,
      r.position?.lat.toFixed(6) ?? "",
      r.position?.lng.toFixed(6) ?? "",
      r.position?.radiusM ?? "",
      r.position?.ptDbm.toFixed(1) ?? "",
      r.powerDbm?.toFixed(1) ?? "",
      r.peakDbm.toFixed(1),
      r.occupancy.toFixed(4),
      r.unconfirmed,
      r.poorFit,
      r.collinear,
      r.receiverMoved,
      r.clipped,
      r.fixStored,
    ].join(","),
  );
  return `${[CSV_HEADER.join(","), ...lines].join("\n")}\n`;
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
