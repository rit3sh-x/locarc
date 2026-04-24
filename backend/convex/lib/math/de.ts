import { mulberry32 } from "./index";

export type Bounds = [number, number][];

export interface DEOptions {
    seed?: number;
    popSize?: number;
    maxIter?: number;
    tol?: number;
    fMin?: number;
    fMax?: number;
    cr?: number;
}

export interface DEResult {
    x: number[];
    fun: number;
    nfev: number;
    iter: number;
    converged: boolean;
}

export function differentialEvolution(
    objective: (x: number[]) => number,
    bounds: Bounds,
    opts: DEOptions = {}
): DEResult {
    const {
        seed = 42,
        popSize = 15,
        maxIter = 1000,
        tol = 1e-6,
        fMin = 0.5,
        fMax = 1.0,
        cr = 0.7,
    } = opts;

    const rand = mulberry32(seed);
    const d = bounds.length;
    const n = Math.max(popSize, 4) * d;

    const pop: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
        const v = new Array<number>(d);
        for (let j = 0; j < d; j++) {
            const [lo, hi] = bounds[j];
            v[j] = lo + rand() * (hi - lo);
        }
        pop[i] = v;
    }

    const fit = new Array<number>(n);
    let nfev = 0;
    for (let i = 0; i < n; i++) {
        fit[i] = objective(pop[i]);
        nfev++;
    }

    let bestIdx = 0;
    for (let i = 1; i < n; i++) if (fit[i] < fit[bestIdx]) bestIdx = i;

    let converged = false;
    let iter = 0;
    for (; iter < maxIter; iter++) {
        const F = fMin + rand() * (fMax - fMin);

        for (let i = 0; i < n; i++) {
            let r1 = i;
            let r2 = i;
            while (r1 === i || r1 === bestIdx) r1 = Math.floor(rand() * n);
            while (r2 === i || r2 === bestIdx || r2 === r1)
                r2 = Math.floor(rand() * n);

            const trial = new Array<number>(d);
            const jRand = Math.floor(rand() * d);
            for (let j = 0; j < d; j++) {
                const mutate = rand() < cr || j === jRand;
                let val = mutate
                    ? pop[bestIdx][j] + F * (pop[r1][j] - pop[r2][j])
                    : pop[i][j];
                const [lo, hi] = bounds[j];
                if (val < lo) val = lo + rand() * (hi - lo);
                else if (val > hi) val = lo + rand() * (hi - lo);
                trial[j] = val;
            }

            const trialFit = objective(trial);
            nfev++;

            if (trialFit < fit[i]) {
                pop[i] = trial;
                fit[i] = trialFit;
                if (trialFit < fit[bestIdx]) bestIdx = i;
            }
        }

        let meanF = 0;
        for (let i = 0; i < n; i++) meanF += fit[i];
        meanF /= n;
        let varF = 0;
        for (let i = 0; i < n; i++) {
            const d2 = fit[i] - meanF;
            varF += d2 * d2;
        }
        const stdF = Math.sqrt(varF / n);
        const denom = Math.max(Math.abs(meanF), 1e-12);
        if (stdF / denom < tol) {
            converged = true;
            iter++;
            break;
        }
    }

    return {
        x: pop[bestIdx].slice(),
        fun: fit[bestIdx],
        nfev,
        iter,
        converged,
    };
}
