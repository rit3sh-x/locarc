// The one estimator (from the localization audit): RSSI path-loss multilateration with the
// transmit power profiled out, solved by a deterministic grid search, plus a 95% likelihood-ratio
// region. Pure; positions arrive in metres on a local plane.
import { convexHull, simplifyHull, type XY } from "./geo";

/** Log-normal shadowing assumed by the cost; the accuracy gate guards any change. */
export const SIGMA_DB = 4;
export const MIN_RECEIVERS = 3;
const GRID = 64;
const ZOOM = 5;
const CHI2_2_95 = 5.991;
const CHI2_99 = [0, 6.63, 9.21, 11.34, 13.28, 15.09, 16.81, 18.48, 20.09];
const MAX_REGION_VERTICES = 32;
/** Centred positions whose minor/major spread is below this ratio count as a line. */
export const COLLINEAR_RATIO = 0.15;

export type Observation = { xy: XY; powerDbm: number };

export type Estimate = {
  xy: XY;
  /** Convex hull of the 95% region, ≤ 32 vertices. */
  region: XY[];
  /** √(area of the 95% region) in metres. */
  uncertaintyM: number;
  chi2: number;
  chi2PerDof: number | null;
  ptDbm: number;
  flags: { unconfirmed: boolean; poorFit: boolean; collinear: boolean };
};

export function isCollinear(points: XY[]): boolean {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, (sxx - syy) ** 2 / 4 + sxy ** 2));
  const major = tr / 2 + disc;
  const minor = Math.max(0, tr / 2 - disc);
  return major === 0 || Math.sqrt(minor / major) < COLLINEAR_RATIO;
}

export function estimate(obs: Observation[], pathLossN: number): Estimate {
  if (obs.length < MIN_RECEIVERS)
    throw new Error(`need ${MIN_RECEIVERS} Receivers, got ${obs.length}`);
  const k = 10 * pathLossN;
  const impliedPt = (p: XY) =>
    obs.map(
      (o) => o.powerDbm + k * Math.log10(Math.max(Math.hypot(o.xy[0] - p[0], o.xy[1] - p[1]), 1)),
    );
  const cost = (p: XY) => {
    const g = impliedPt(p);
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    return g.reduce((s, v) => s + ((v - mean) / SIGMA_DB) ** 2, 0);
  };

  // A square on the Receivers' bounding box, so collinear geometry still gets a 2-D search.
  const xs = obs.map((o) => o.xy[0]);
  const ys = obs.map((o) => o.xy[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const half = Math.max(50, Math.max(w, h) / 2 + 0.1 * Math.hypot(w, h));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const [x0, x1, y0, y1] = [cx - half, cx + half, cy - half, cy + half];
  const sx = (x1 - x0) / GRID;
  const sy = (y1 - y0) / GRID;

  const cells: { p: XY; c: number }[] = [];
  let best: XY = [x0, y0];
  let f = Number.POSITIVE_INFINITY;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const p: XY = [x0 + (i + 0.5) * sx, y0 + (j + 0.5) * sy];
      const c = cost(p);
      cells.push({ p, c });
      if (c < f) {
        f = c;
        best = p;
      }
    }
  }
  for (let s = 1; s <= 2; s++) {
    const hx = sx / ZOOM ** s;
    const hy = sy / ZOOM ** s;
    const centre = best;
    for (let i = -5; i <= 5; i++) {
      for (let j = -5; j <= 5; j++) {
        const p: XY = [
          Math.min(x1, Math.max(x0, centre[0] + i * hx)),
          Math.min(y1, Math.max(y0, centre[1] + j * hy)),
        ];
        const c = cost(p);
        if (c < f) {
          f = c;
          best = p;
        }
      }
    }
  }

  const dof = obs.length - 3;
  // A reduced χ² above 1 means more scatter than σ explains: widen the region accordingly.
  const inflation = dof > 0 ? Math.max(1, f / dof) : 1;
  const inside = cells.filter((cell) => (cell.c - f) / inflation <= CHI2_2_95);
  // Hull of the region's cell centres: convex (over-covers lobes, which the collinear flag
  // explains) but no wider than the likelihood region itself.
  const centres = inside.map((cell) => cell.p);
  const g = impliedPt(best);
  return {
    xy: best,
    region: simplifyHull(convexHull(centres.length > 0 ? centres : [best]), MAX_REGION_VERTICES),

    uncertaintyM: Math.sqrt(Math.max(1, inside.length) * sx * sy),
    chi2: f,
    chi2PerDof: dof > 0 ? f / dof : null,
    ptDbm: g.reduce((a, b) => a + b, 0) / g.length,
    flags: {
      unconfirmed: obs.length === MIN_RECEIVERS,
      poorFit: dof > 0 && f > (CHI2_99[dof] ?? 3 * dof),
      collinear: isCollinear(obs.map((o) => o.xy)),
    },
  };
}
