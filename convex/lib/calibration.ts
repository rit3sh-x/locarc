// Calibration proposals from a co-located session (or one Receiver's frequency-only run).
// Phones measure the reference carrier with their offset and ppm correction turned off.

export type Measurement = {
  receiver: string;
  powerDbm: number;
  freqOffsetHz: number;
};
export type Proposal = {
  receiver: string;
  measuredDbm: number;
  offsetDb: number | null;
  ppm: number;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** To `decimals` places, dividing last so stored values stay clean (−1.2, not −1.2000000000000002). */
const round = (x: number, decimals: number) => Math.round(x * 10 ** decimals) / 10 ** decimals;

/**
 * offset = group median − own power, so every Receiver reads the same carrier alike;
 * ppm = carrier offset ÷ reference × 10⁶ (the oscillator's error, which the app then corrects).
 * Frequency-only runs (or a lone Receiver) propose ppm alone.
 */
export function proposals(
  ms: Measurement[],
  referenceHz: number,
  mode: "full" | "frequency",
): Proposal[] {
  const groupMedian = ms.length >= 2 ? median(ms.map((m) => m.powerDbm)) : null;
  return ms.map((m) => ({
    receiver: m.receiver,
    measuredDbm: m.powerDbm,
    offsetDb: mode === "full" && groupMedian !== null ? round(groupMedian - m.powerDbm, 1) : null,
    ppm: round((m.freqOffsetHz / referenceHz) * 1e6, 2),
  }));
}
