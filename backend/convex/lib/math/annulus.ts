import { differentialEvolution, type Bounds } from "./de";
import type { Bounds2, Vec2 } from "./index";

export interface LocalizationConfig {
    pathLossExponent: number;
    ptMinDbm: number;
    ptMaxDbm: number;
    ptStepDbm: number;
    d0: number;
    deSeed: number;
}

export const DEFAULT_LOC_CONFIG: LocalizationConfig = {
    pathLossExponent: 3.5,
    ptMinDbm: 20.0,
    ptMaxDbm: 43.0,
    ptStepDbm: 0.5,
    d0: 1.0,
    deSeed: 42,
};

export function safeDistances(tx: Vec2, receivers: Vec2[]): number[] {
    const out = new Array<number>(receivers.length);
    for (let i = 0; i < receivers.length; i++) {
        const dx = receivers[i][0] - tx[0];
        const dy = receivers[i][1] - tx[1];
        const d = Math.sqrt(dx * dx + dy * dy);
        out[i] = d === 0 ? 1e-6 : d;
    }
    return out;
}

export function makeObjective(
    receivers: Vec2[],
    powers: number[],
    pathLossExponent: number
): (pos: number[]) => number {
    const n = pathLossExponent;
    return (pos: number[]) => {
        const tx: Vec2 = [pos[0], pos[1]];
        const d = safeDistances(tx, receivers);
        const dRef = d[0];
        const p0 = powers[0];
        let s = 0;
        for (let i = 1; i < receivers.length; i++) {
            const predicted = 10 * n * Math.log10(d[i] / dRef);
            const measured = p0 - powers[i];
            const e = predicted - measured;
            s += e * e;
        }
        return s;
    };
}

export function initialBounds(receivers: Vec2[]): Bounds2 {
    let xMin = Infinity,
        xMax = -Infinity,
        yMin = Infinity,
        yMax = -Infinity;
    for (const [x, y] of receivers) {
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

export function annulusBounds(
    receivers: Vec2[],
    powers: number[],
    cfg: LocalizationConfig
): Bounds2 | null {
    const n = cfg.pathLossExponent;
    let x0 = -Infinity,
        x1 = Infinity,
        y0 = -Infinity,
        y1 = Infinity;

    for (let i = 0; i < receivers.length; i++) {
        const [rx, ry] = receivers[i];
        const dMax = Math.pow(10, (cfg.ptMaxDbm - powers[i]) / (10 * n));
        if (rx - dMax > x0) x0 = rx - dMax;
        if (rx + dMax < x1) x1 = rx + dMax;
        if (ry - dMax > y0) y0 = ry - dMax;
        if (ry + dMax < y1) y1 = ry + dMax;
    }

    if (x0 >= x1 || y0 >= y1) return null;
    return [
        [x0, x1],
        [y0, y1],
    ];
}

export function localizeAnnulus(
    receivers: Vec2[],
    powers: number[],
    cfg: LocalizationConfig
): { est: Vec2; bounds: Bounds2 } {
    const bounds =
        annulusBounds(receivers, powers, cfg) ?? initialBounds(receivers);
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
