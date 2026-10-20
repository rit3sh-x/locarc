import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type BoardItem, decodeBoard } from "@/convex/lib/boardCodec";
import { OCCUPANCY_LABEL, occupancyClass } from "@/convex/lib/scanEmitters";
import type { LatLng } from "../components/map/map-canvas";

export type BoardRow = BoardItem & {
  freqHz: number;
  lowHz: number;
  highHz: number;
  loudestName: string | null;
};

/** Decodes a packed board (the latest, or one Scan's) into rows the pages render. */
export function boardRows(
  board: { rasterHz: number; receivers: { id: string; name: string }[]; items: ArrayBuffer } | null,
): BoardRow[] {
  if (!board) return [];
  const r = board.rasterHz;
  return decodeBoard(board.items).map((it) => ({
    ...it,
    freqHz: it.ch * r,
    lowHz: it.firstCh * r - r / 2,
    highHz: (it.firstCh + it.widthCh) * r - r / 2,
    loudestName: it.heard > 0 ? (board.receivers[it.loudest]?.name ?? null) : null,
  }));
}

/** The latest board, decoded: located Emitters first (strongest first), then the rest. */
export function useBoard() {
  const board = useQuery(api.emitters.board);
  if (board === undefined) return undefined;
  const rows = boardRows(board).sort(
    (a, b) =>
      Number(b.located) - Number(a.located) ||
      Number(b.missed === 0) - Number(a.missed === 0) ||
      (b.powerDbm ?? b.peakDbm) - (a.powerDbm ?? a.peakDbm),
  );
  return { at: board?.at ?? null, scan: board?.scan ?? null, rows };
}

/** "25 kHz", "1.6 MHz": an Emitter's span. */
export const spanText = (lowHz: number, highHz: number) => {
  const w = highHz - lowHz;
  return w >= 1e6 ? `${Number((w / 1e6).toFixed(2))} MHz` : `${Number((w / 1e3).toFixed(1))} kHz`;
};

/** "steady · 100%", "intermittent · 34%", "rare · <1%". */
export function occupancyText(occupancy: number): string {
  const pct = occupancy * 100;
  const shown = pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
  return `${OCCUPANCY_LABEL[occupancyClass(occupancy)]} · ${shown}`;
}

/** An uncertainty circle as a polygon the map can draw. */
export function circle(c: LatLng, radiusM: number, points = 40): LatLng[] {
  const dLat = radiusM / 111_320;
  const dLng = dLat / Math.max(0.01, Math.cos((c.lat * Math.PI) / 180));
  return Array.from({ length: points }, (_, i) => {
    const a = (2 * Math.PI * i) / points;
    return { lat: c.lat + dLat * Math.sin(a), lng: c.lng + dLng * Math.cos(a) };
  });
}
