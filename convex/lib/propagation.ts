// The synthetic world shared by the localization accuracy gate and the simulator:
// log-distance path loss with log-normal shadowing, and a seeded RNG for repeatable scenes.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const gaussian = (rand: () => number) =>
  Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

/** Received power in dBm: Pt − 10·n·log10(d) + σ·N(0,1), with d floored at 1 m. */
export function receivedPowerDbm(o: {
  ptDbm: number;
  n: number;
  distanceM: number;
  sigmaDb: number;
  rand: () => number;
}): number {
  return o.ptDbm - 10 * o.n * Math.log10(Math.max(o.distanceM, 1)) + o.sigmaDb * gaussian(o.rand);
}
