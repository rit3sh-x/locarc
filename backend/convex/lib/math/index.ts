export type Vec2 = [number, number];
export type Bounds2 = [[number, number], [number, number]];

export const EARTH_RADIUS_METERS = 6_371_000;

export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

export function gpsToXy(
    lat: number,
    lon: number,
    refLat: number,
    refLon: number
): Vec2 {
    const x =
        EARTH_RADIUS_METERS *
        deg2rad(lon - refLon) *
        Math.cos(deg2rad(refLat));
    const y = EARTH_RADIUS_METERS * deg2rad(lat - refLat);
    return [x, y];
}

export function xyToGps(
    x: number,
    y: number,
    refLat: number,
    refLon: number
): { latitude: number; longitude: number } {
    const latitude = refLat + rad2deg(y / EARTH_RADIUS_METERS);
    const longitude =
        refLon +
        rad2deg(x / (EARTH_RADIUS_METERS * Math.cos(deg2rad(refLat))));
    return { latitude, longitude };
}

export function boundsToCorners(
    bounds: Bounds2,
    refLat: number,
    refLon: number
): { latitude: number; longitude: number }[] {
    const [[x0, x1], [y0, y1]] = bounds;
    const corners: Vec2[] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
    ];
    return corners.map(([x, y]) => xyToGps(x, y, refLat, refLon));
}

export function norm2(a: Vec2, b: Vec2): number {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
}

export function mean(xs: number[]): number {
    if (xs.length === 0) return 0;
    let s = 0;
    for (const v of xs) s += v;
    return s / xs.length;
}

export function argsortAsc(xs: number[]): number[] {
    return xs
        .map((v, i) => [v, i] as [number, number])
        .sort((a, b) => a[0] - b[0])
        .map(([, i]) => i);
}

export function arange(start: number, stop: number, step: number): number[] {
    const out: number[] = [];
    if (step <= 0) return out;
    for (let v = start; v < stop; v += step) out.push(v);
    return out;
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
