import { describe, expect, test } from "bun:test";
import { proposals } from "./calibration";
import { fieldResult } from "./fieldTest";
import { distanceM } from "./geo";
import { mulberry32, receivedPowerDbm } from "./propagation";

describe("calibration proposals", () => {
  const ref = 433.92e6;
  test("offset = group median − own; ppm from the carrier offset", () => {
    const ms = [
      { receiver: "A", powerDbm: -50, freqOffsetHz: 868 },
      { receiver: "B", powerDbm: -53, freqOffsetHz: -434 },
      { receiver: "C", powerDbm: -51, freqOffsetHz: 0 },
    ];
    expect(proposals(ms, ref, "full")).toEqual([
      { receiver: "A", measuredDbm: -50, offsetDb: -1, ppm: 2 },
      { receiver: "B", measuredDbm: -53, offsetDb: 2, ppm: -1 },
      { receiver: "C", measuredDbm: -51, offsetDb: 0, ppm: 0 },
    ]);
  });
  test("values are stored clean", () => {
    const [, b] = proposals(
      [
        { receiver: "A", powerDbm: -45, freqOffsetHz: 0 },
        { receiver: "B", powerDbm: -42.5, freqOffsetHz: 0 },
      ],
      ref,
      "full",
    );
    expect(b?.offsetDb).toBe(-1.2);
  });
  test("frequency-only, or a lone Receiver, proposes ppm only", () => {
    expect(
      proposals([{ receiver: "A", powerDbm: -50, freqOffsetHz: 434 }], ref, "frequency"),
    ).toEqual([{ receiver: "A", measuredDbm: -50, offsetDb: null, ppm: 1 }]);
  });
});

describe("field test fit", () => {
  const truth = { lat: 12.9705, lng: 77.596 };
  const rx = [
    { lat: 12.9774, lng: 77.5878 },
    { lat: 12.9791, lng: 77.6024 },
    { lat: 12.9653, lng: 77.6037 },
    { lat: 12.9649, lng: 77.586 },
  ];
  const fixes = (n: number, count: number, sigma: number) => {
    const rand = mulberry32(5);
    return Array.from({ length: count }, () => {
      const ptDbm = 20 + rand() * 20;
      return {
        lat: truth.lat + 0.001,
        lng: truth.lng,
        used: rx.map((r) => ({
          ...r,
          powerDbm: receivedPowerDbm({
            ptDbm,
            n,
            distanceM: distanceM(r, truth),
            sigmaDb: sigma,
            rand,
          }),
        })),
      };
    });
  };

  test("recovers n from noise-free Fixes once there are 5 Scans", () => {
    const r = fieldResult(truth, fixes(3.2, 5, 0));
    expect(r?.n).toBeCloseTo(3.2, 6);
    expect(r?.medianErrorM).toBeCloseTo(111, 0);
    expect(fieldResult(truth, fixes(3.2, 4, 0))?.n).toBeNull();
  });

  test("with 4 dB shadowing over 30 Scans, n lands within its reported spread (×3)", () => {
    const r = fieldResult(truth, fixes(2.8, 30, 4));
    expect(r?.n).not.toBeNull();
    expect(Math.abs((r?.n ?? 0) - 2.8)).toBeLessThan(3 * (r?.nSpread ?? 0));
  });
});
