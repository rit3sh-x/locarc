// The simulated radio world: emitters measured through the shared propagation model over a
// Listening window, with seeded shadowing so every run of a scenario produces the same Readings.
import { channelOf } from "@/convex/lib/channelMath";
import { FIX_WINDOW_MS, passMs, sliceOf, slices } from "@/convex/lib/config";
import { distanceM } from "@/convex/lib/geo";
import { mulberry32, receivedPowerDbm } from "@/convex/lib/propagation";
import type { EmitterRecord, Slice } from "@/convex/lib/readingCodec";
import type { Behaviour, Measure, SimPosition } from "./runner";

export type Emitter = {
  name: string;
  freqHz: number;
  ptDbm: number;
  lat: number;
  lng: number;
  /** Occupied bandwidth (default one 12.5 kHz Channel); Wi-Fi is 20 MHz. */
  bandwidthHz?: number;
  /** Share of passes it's on (default 1, a broadcaster). */
  duty?: number;
  /** False for a burst that only comes after the Fix window: peak and Occupancy, no Fix power. */
  inFixWindow?: boolean;
  /** Transmits only on Scans whose index is a multiple of this. */
  every?: number;
  /** Off until switched on (a journey's "new emitter"). Default on. */
  active?: boolean;
};

export type Scenario = {
  seed: number;
  /** True path-loss exponent and shadowing of the simulated world. */
  n: number;
  sigmaDb: number;
  receivers: (SimPosition & { name: string; biasDb?: number; ppmError?: number })[];
  emitters: Emitter[];
};

const NOISE_DBM = -100;
const DETECT_SNR_DB = 10;
/** Above this, at the default 32 + 30 dB of gain, the ADC clips; more gain clips sooner. */
const clipDbm = (lnaDb: number, vgaDb: number, amp: boolean) =>
  -50 - (lnaDb + vgaDb - 62) - (amp ? 11 : 0);

const seedOf = (...xs: number[]) =>
  xs.reduce((h, x) => Math.imul(h ^ x, 0x9e3779b1) >>> 0, 2166136261);

export function worldMeasure(
  scenario: Scenario,
  positions: SimPosition[],
  behaviour: Behaviour[],
): Measure {
  return ({ index, plan, run, k, sim, windowMs }) => {
    const b = behaviour[index] ?? {};
    const rand = mulberry32(seedOf(scenario.seed, index, run.number, k));
    const where = positions[index] ?? { lat: 0, lng: 0 };
    const gains = sim.control?.config.values ?? { lnaDb: 32, vgaDb: 30, amp: false };
    const listened = Math.min(windowMs, b.partialWindowMs ?? windowMs);
    const pass = passMs(plan);
    const passes = Math.max(1, Math.floor(listened / pass));
    const fixPasses = Math.floor(Math.min(listened, FIX_WINDOW_MS) / pass);
    const raster = plan.rasterHz;

    const sliceList: Slice[] = slices(plan).map(() => ({
      floorDbm: NOISE_DBM + (rand() - 0.5),
      clippedFix: false,
      clippedLater: false,
      anomaly: false,
    }));
    const emitters: EmitterRecord[] = [];
    for (const e of scenario.emitters) {
      const slice = sliceOf(plan, e.freqHz);
      if (e.active === false || slice < 0 || (e.every && k % e.every !== 0)) continue;
      const powerDbm = receivedPowerDbm({
        ptDbm: e.ptDbm,
        n: scenario.n,
        distanceM: distanceM(where, e),
        sigmaDb: scenario.sigmaDb,
        rand,
      });
      const floor = sliceList[slice]?.floorDbm ?? NOISE_DBM;
      if (powerDbm < floor + DETECT_SNR_DB) continue;
      const clipped =
        powerDbm > clipDbm(gains.lnaDb, gains.vgaDb, gains.amp) || !!b.clipHz?.includes(e.freqHz);
      const s = sliceList[slice];
      if (clipped && s) s.clippedFix = true;
      // A faint receiver sees only the middle of a wide signal.
      const fullWidth = Math.max(1, Math.round((e.bandwidthHz ?? raster) / raster));
      const widthCh = powerDbm - floor < 20 ? Math.max(1, Math.round(fullWidth / 2)) : fullWidth;
      const strongestCh = channelOf(e.freqHz, raster);
      const duty = e.duty ?? 1;
      const inFix = e.inFixWindow !== false && fixPasses > 0;
      emitters.push({
        firstCh: strongestCh - Math.floor(widthCh / 2),
        widthCh,
        strongestCh,
        // Fix-window power over a duty cycle: the same offset on every Receiver, so Pt absorbs it.
        fixPowerDbm: inFix ? powerDbm + 10 * Math.log10(duty) : null,
        peakDbm: powerDbm + 3,
        passesOn: Math.max(1, Math.round(duty * passes)),
        clippedFix: clipped,
        clippedLater: false,
      });
    }
    return {
      payload: { slices: sliceList, emitters },
      windowMs: listened,
      passes,
      fixPasses,
      stopReason: listened < windowMs ? "DETACHED" : null,
    };
  };
}
