// Field tests: a transmitter at a known spot on a known Channel, scored over the Fixes it gets.
import { distanceM, type LatLng } from "./geo";

export const MIN_SCANS_FOR_N = 5;

export type FieldFix = LatLng & { used: (LatLng & { powerDbm: number })[] };

export type FieldResult = {
  scans: number;
  medianErrorM: number;
  /** Best-fit path-loss exponent ± its standard error, once there are ≥ 5 Scans. */
  n: number | null;
  nSpread: number | null;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/**
 * The n fit: within each Fix, demean the powers and the log-distances to the true position
 * (that removes the unknown transmit power), then pool every Fix's points in one least squares.
 */
export function fieldResult(truth: LatLng, fixes: FieldFix[]): FieldResult | null {
  if (fixes.length === 0) return null;
  const medianErrorM = median(fixes.map((f) => distanceM(f, truth)));
  let sxx = 0;
  let sxy = 0;
  const points: [number, number][] = [];
  for (const f of fixes) {
    const xs = f.used.map((u) => -10 * Math.log10(Math.max(distanceM(u, truth), 1)));
    const ys = f.used.map((u) => u.powerDbm);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    xs.forEach((x, i) => {
      const dx = x - mx;
      const dy = (ys[i] as number) - my;
      sxx += dx * dx;
      sxy += dx * dy;
      points.push([dx, dy]);
    });
  }
  if (fixes.length < MIN_SCANS_FOR_N || sxx === 0)
    return { scans: fixes.length, medianErrorM, n: null, nSpread: null };
  const n = sxy / sxx;
  // Each Fix spends one degree of freedom on its own mean, plus one for n.
  const dof = Math.max(1, points.length - fixes.length - 1);
  const sse = points.reduce((s, [x, y]) => s + (y - n * x) ** 2, 0);
  return {
    scans: fixes.length,
    medianErrorM,
    n,
    nSpread: Math.sqrt(sse / dof / sxx),
  };
}
