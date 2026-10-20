import { describe, expect, test } from "bun:test";
import { pointInPolygon, type XY } from "./geo";
import { estimate, type Observation } from "./localization";
import { mulberry32, receivedPowerDbm } from "./propagation";

const N = 3.5;
const SIGMA = 4;
const SQUARE: XY[] = [
  [0, 0],
  [1000, 0],
  [1000, 1000],
  [0, 1000],
];

function scene(rand: () => number, rx: XY[], tx: XY, sigma = SIGMA): Observation[] {
  const pt = 20 + rand() * 20;
  return rx.map((xy) => ({
    xy,
    powerDbm: receivedPowerDbm({
      ptDbm: pt,
      n: N,
      distanceM: Math.hypot(xy[0] - tx[0], xy[1] - tx[1]),
      sigmaDb: sigma,
      rand,
    }),
  }));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
};

describe("accuracy gate", () => {
  test("4 Receivers ~1 km apart: median error ≤ 160 m, 95% region covers truth 90–98%", () => {
    // The localization audit's seed and scene; 1000 trials keep the median's error near ±4 m.
    const rand = mulberry32(2026);
    const jit = (p: XY): XY => [p[0] + (rand() - 0.5) * 100, p[1] + (rand() - 0.5) * 100];
    const errors: number[] = [];
    let covered = 0;
    const trials = 1000;
    for (let t = 0; t < trials; t++) {
      const tx: XY = [100 + rand() * 800, 100 + rand() * 800];
      const fix = estimate(scene(rand, SQUARE.map(jit), tx), N);
      errors.push(Math.hypot(fix.xy[0] - tx[0], fix.xy[1] - tx[1]));
      if (pointInPolygon(tx, fix.region)) covered++;
    }
    const coverage = covered / trials;
    console.log(
      `median error ${median(errors).toFixed(0)} m, coverage ${(coverage * 100).toFixed(1)}%`,
    );
    expect(median(errors)).toBeLessThanOrEqual(160);
    expect(coverage).toBeGreaterThanOrEqual(0.9);
    expect(coverage).toBeLessThanOrEqual(0.98);
  });
});

describe("flags", () => {
  const rand = mulberry32(7);

  test("3-Receiver Fixes are unconfirmed", () => {
    const tri: XY[] = [
      [0, 0],
      [1000, 0],
      [500, 866],
    ];
    const fix = estimate(scene(rand, tri, [500, 300]), N);
    expect(fix.flags.unconfirmed).toBe(true);
    expect(fix.chi2PerDof).toBeNull();
  });

  test("Receivers along a road are collinear", () => {
    const road: XY[] = [
      [0, 0],
      [500, 5],
      [1000, -5],
      [1500, 3],
    ];
    const fix = estimate(scene(rand, road, [700, 300]), N);
    expect(fix.flags.collinear).toBe(true);
    expect(fix.flags.unconfirmed).toBe(false);
  });

  test("a far Receiver reading 15 dB low (an obstructed path) fails the fit", () => {
    const obs = scene(rand, [...SQUARE, [500, 500]], [300, 300], 0);
    (obs[2] as Observation).powerDbm -= 15;
    expect(estimate(obs, N).flags.poorFit).toBe(true);
  });

  test("the same Readings always give the same Fix", () => {
    const obs = scene(mulberry32(11), SQUARE, [400, 600]);
    expect(estimate(obs, N)).toEqual(estimate(obs, N));
    expect(estimate(obs, N).region.length).toBeLessThanOrEqual(32);
  });

  test("noise-free Readings land on the transmitter", () => {
    const fix = estimate(scene(rand, SQUARE, [420, 610], 0), N);
    expect(Math.hypot(fix.xy[0] - 420, fix.xy[1] - 610)).toBeLessThan(5);
  });
});
