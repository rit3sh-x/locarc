import { differentialEvolution, type Bounds } from "./de";
import { argsortAsc, arange, type Bounds2, type Vec2 } from "./index";
import {
    initialBounds,
    makeObjective,
    type LocalizationConfig,
} from "./annulus";

export function circleIntersections(
    c1: Vec2,
    r1: number,
    c2: Vec2,
    r2: number
): Vec2[] {
    const dx = c1[0] - c2[0];
    const dy = c1[1] - c2[1];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return [];

    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const hSq = Math.max(0, r1 * r1 - a * a);
    const h = Math.sqrt(hSq);
    const mid: Vec2 = [
        c1[0] + (a * (c2[0] - c1[0])) / d,
        c1[1] + (a * (c2[1] - c1[1])) / d,
    ];
    const perp: Vec2 = [(c2[1] - c1[1]) / d, (c1[0] - c2[0]) / d];
    const p1: Vec2 = [mid[0] + h * perp[0], mid[1] + h * perp[1]];
    if (h === 0) return [p1];
    const p2: Vec2 = [mid[0] - h * perp[0], mid[1] - h * perp[1]];
    return [p1, p2];
}

export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
    const [x, y] = point;
    const n = polygon.length;
    if (n === 0) return false;
    let inside = false;
    let p1x = polygon[0][0];
    let p1y = polygon[0][1];
    for (let i = 1; i <= n; i++) {
        const [p2x, p2y] = polygon[i % n];
        if (Math.min(p1y, p2y) < y && y <= Math.max(p1y, p2y) && x <= Math.max(p1x, p2x)) {
            let xi = Number.POSITIVE_INFINITY;
            if (p1y !== p2y) {
                xi = ((y - p1y) * (p2x - p1x)) / (p2y - p1y) + p1x;
            }
            if (p1x === p2x || x <= xi) inside = !inside;
        }
        p1x = p2x;
        p1y = p2y;
    }
    return inside;
}

export function circleBounds(
    receivers: Vec2[],
    powers: number[],
    cfg: LocalizationConfig
): Bounds2 | null {
    const n = cfg.pathLossExponent;
    const order = argsortAsc(powers);
    const top2 = order.slice(-2);

    let ptEst: number | null = null;
    for (const pt of arange(cfg.ptMinDbm, cfg.ptMaxDbm, cfg.ptStepDbm)) {
        const d1 = Math.pow(10, (pt - powers[top2[1]]) / (10 * n));
        const d2 = Math.pow(10, (pt - powers[top2[0]]) / (10 * n));
        const dx = receivers[top2[1]][0] - receivers[top2[0]][0];
        const dy = receivers[top2[1]][1] - receivers[top2[0]][1];
        const sep = Math.sqrt(dx * dx + dy * dy);
        if (sep <= d1 + d2) {
            ptEst = pt;
            break;
        }
    }
    if (ptEst === null) return null;

    const radii = powers.map((p) =>
        Math.pow(10, ((ptEst as number) - p) / (10 * n))
    );

    const pts: Vec2[] = [];
    for (let i = 0; i < receivers.length; i++) {
        for (let j = i + 1; j < receivers.length; j++) {
            const inter = circleIntersections(
                receivers[i],
                radii[i],
                receivers[j],
                radii[j]
            );
            for (const p of inter) pts.push(p);
        }
    }
    if (pts.length === 0) return null;

    const N = receivers.length;
    const quadIdx =
        N >= 4 ? [1, 0, 2, 3] : Array.from({ length: N }, (_, k) => k);
    const quad = quadIdx.slice(0, N).map((k) => receivers[k]);

    const valid = pts.filter((p) => pointInPolygon(p, quad));
    if (valid.length === 0) return null;

    let xMin = Infinity,
        xMax = -Infinity,
        yMin = Infinity,
        yMax = -Infinity;
    for (const [x, y] of valid) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
    }
    return [
        [xMin, xMax],
        [yMin, yMax],
    ];
}

export function localizeCircle(
    receivers: Vec2[],
    powers: number[],
    cfg: LocalizationConfig
): { est: Vec2; bounds: Bounds2 } {
    const bounds =
        circleBounds(receivers, powers, cfg) ?? initialBounds(receivers);
    const deBounds: Bounds = [
        [bounds[0][0], bounds[0][1]],
        [bounds[1][0], bounds[1][1]],
    ];
    const obj = makeObjective(receivers, powers, cfg.pathLossExponent);
    const result = differentialEvolution(obj, deBounds, {
        seed: cfg.deSeed,
        popSize: 15,
        maxIter: 1000,
        tol: 1e-6,
    });
    return { est: [result.x[0], result.x[1]], bounds };
}
