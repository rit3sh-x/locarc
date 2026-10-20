export type LatLng = { lat: number; lng: number };
export type XY = [number, number];

const R = 6_371_008.8;
const RAD = Math.PI / 180;

/** A local equirectangular plane in metres around `origin`; plenty for a few-km fleet. */
export function localPlane(origin: LatLng) {
  const kx = R * RAD * Math.cos(origin.lat * RAD);
  const ky = R * RAD;
  return {
    toXY: (p: LatLng): XY => [(p.lng - origin.lng) * kx, (p.lat - origin.lat) * ky],
    toLatLng: ([x, y]: XY): LatLng => ({
      lat: origin.lat + y / ky,
      lng: origin.lng + x / kx,
    }),
  };
}

export function centroid(points: LatLng[]): LatLng {
  const n = Math.max(1, points.length);
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  };
}

export function distanceM(a: LatLng, b: LatLng): number {
  const [x, y] = localPlane(a).toXY(b);
  return Math.hypot(x, y);
}

/** Andrew's monotone chain; returns the hull counter-clockwise without repeating the start. */
export function convexHull(points: XY[]): XY[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const cross = (o: XY, a: XY, b: XY) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] as XY, lower[lower.length - 1] as XY, p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (const p of pts.reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] as XY, upper[upper.length - 1] as XY, p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function pointInPolygon([x, y]: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as XY;
    const [xj, yj] = poly[j] as XY;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Drops the vertex whose removal loses the least area until at most `max` remain. */
export function simplifyHull(hull: XY[], max: number): XY[] {
  const out = [...hull];
  const area = (a: XY, b: XY, c: XY) =>
    Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
  while (out.length > max) {
    let best = 0;
    let bestArea = Number.POSITIVE_INFINITY;
    for (let i = 0; i < out.length; i++) {
      const a = area(
        out[(i - 1 + out.length) % out.length] as XY,
        out[i] as XY,
        out[(i + 1) % out.length] as XY,
      );
      if (a < bestArea) {
        bestArea = a;
        best = i;
      }
    }
    out.splice(best, 1);
  }
  return out;
}
