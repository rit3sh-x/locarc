// Drives SimReceivers like phones: follow the control doc's Run, sweep each slot and sync a
// Reading when the sweep ends; heartbeat while idle; sync at once when the control doc changes.
import type { Id } from "@/convex/_generated/dataModel";
import { FIX_WINDOW_MS, passMs, type SweepPlan, slices } from "@/convex/lib/config";
import type { Heartbeat, PositionFix } from "@/convex/lib/heartbeat";
import { encodeReading, type ReadingPayload } from "@/convex/lib/readingCodec";
import { boundaryAt, listeningWindowMs } from "@/convex/lib/schedule";
import { healthyHeartbeat } from "./heartbeat";
import type { Control, SimReceiver } from "./receiver";

type RunSection = NonNullable<NonNullable<Control>["run"]>;
type Command = NonNullable<Control>["commands"][number];

export type SimPosition = { lat: number; lng: number };

/** What a Receiver hears through one Listening window; the propagation model plugs in here. */
export type Measure = (args: {
  index: number;
  sim: SimReceiver;
  plan: SweepPlan;
  run: RunSection;
  k: number;
  windowMs: number;
}) => {
  payload: ReadingPayload;
  windowMs: number;
  passes: number;
  fixPasses: number;
  stopReason: string | null;
};

/** Per-Receiver overrides a scenario or a journey can flip at any time. */
export type Behaviour = {
  offline?: boolean;
  heartbeat?: Partial<Heartbeat>;
  clockUncertaintyMs?: number;
  /** Cut windows short after this long (a detach mid-window). */
  partialWindowMs?: number;
  /** Listen only to the Fix window, as a warm or on-battery phone does. */
  shortWindow?: "battery" | "warm";
  /** Clip the slices holding these frequencies (gain too high). */
  clipHz?: number[];
  /** Refuse config pushes with this reason (the phone keeps running what it had). */
  rejectConfig?: string;
  /** How this phone + HackRF misreads a reference carrier: gain bias and oscillator error. */
  calibration?: { biasDb: number; ppmError: number };
};

/** Every co-located phone sees the reference carrier at this true power. */
const REFERENCE_DBM = -45;

const quiet: Measure = ({ plan, windowMs }) => ({
  payload: {
    slices: slices(plan).map(() => ({
      floorDbm: -100,
      clippedFix: false,
      clippedLater: false,
      anomaly: false,
    })),
    emitters: [],
  },
  windowMs,
  passes: Math.max(1, Math.floor(windowMs / passMs(plan))),
  fixPasses: Math.floor(Math.min(windowMs, FIX_WINDOW_MS) / passMs(plan)),
  stopReason: null,
});

export class FleetRunner {
  readonly behaviour: Behaviour[];
  readonly log: { name: string; k: number; outcome: string }[] = [];
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private heartbeats: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];
  private runs = new Map<number, string | null>();
  private halted = false;
  private applied = new Map<number, number>();
  private handled = new Map<number, number>();
  private measuringUntil = new Map<number, number>();

  readonly measure: Measure;

  /** `world` builds the measurement from the runner's live behaviour (e.g. worldMeasure). */
  constructor(
    readonly sims: SimReceiver[],
    readonly positions: SimPosition[],
    world?: (behaviour: Behaviour[]) => Measure,
    readonly heartbeatMs = 5 * 60_000,
  ) {
    this.behaviour = sims.map(() => ({}));
    this.measure = world ? world(this.behaviour) : quiet;
  }

  private position(i: number): PositionFix {
    const p = this.positions[i] ?? { lat: 0, lng: 0 };
    return { lat: p.lat, lng: p.lng, accuracyM: 6, at: Date.now() };
  }

  /** Like the app: apply each pushed version, or reject it and keep running the last one. */
  heartbeat(i: number): Heartbeat {
    const desired = this.sims[i]?.control?.config.v ?? null;
    const reject = this.behaviour[i]?.rejectConfig;
    if (desired !== null && !reject) this.applied.set(i, desired);
    const appliedConfigV = this.applied.get(i) ?? null;
    const rejectedConfig =
      reject && desired !== null && desired !== appliedConfigV
        ? { v: desired, reason: reject }
        : null;
    const name = this.sims[i]?.name ?? `rx${i}`;
    const short = this.behaviour[i]?.shortWindow;
    return healthyHeartbeat({
      appliedConfigV,
      rejectedConfig,
      hackrf: {
        state: "streaming",
        serial: `sim-${name.toLowerCase().replaceAll(" ", "-")}`,
        boardId: 2,
        firmware: "2023.01.1",
        ladder: 0,
        faults: {},
        detachedSince: null,
      },
      window: short ? { mode: "short", reason: short } : { mode: "full", reason: null },
      ...this.behaviour[i]?.heartbeat,
    });
  }

  /** One heartbeat-only sync (with position), as a phone sends while idle or on a change. */
  async ping(i: number) {
    const sim = this.sims[i];
    if (!sim || sim.stopped || this.halted || this.behaviour[i]?.offline) return;

    await sim.sync({
      sentAt: Date.now(),
      heartbeat: this.heartbeat(i),
      position: this.position(i),
    });
  }

  async start() {
    await Promise.all(this.sims.map((_, i) => this.ping(i)));
    this.sims.forEach((sim, i) => {
      this.unsubscribers.push(
        // Like the app: any control change (Run, config, pause, commands) syncs at once;
        // only a Run change reschedules the sweeps.
        sim.onControl((control) => {
          void this.ping(i).catch(() => {});
          for (const c of control?.commands ?? []) this.runCommand(i, c);

          const run = control?.run ?? null;
          const key = run ? `${run.runId}` : null;
          if (this.runs.get(i) === key) return;
          this.runs.set(i, key);
          this.schedule(i, run);
        }),
      );
      if (sim.control !== null) {
        this.runs.set(i, sim.control.run ? `${sim.control.run.runId}` : null);
        this.schedule(i, sim.control.run);
      }
    });
    this.heartbeats = setInterval(() => {
      this.sims.forEach((_, i) => void this.ping(i).catch(() => {}));
    }, this.heartbeatMs);
  }

  private schedule(i: number, run: RunSection | null, k?: number) {
    clearTimeout(this.timers.get(i));
    this.timers.delete(i);
    // A Reading still in flight when stop() ran must not schedule the next sweep.
    if (!run || this.halted) return;
    const now = Date.now();
    const next =
      k ?? (now < run.startsAt ? 0 : Math.floor((now - run.startsAt) / run.periodMs) + 1);
    const startsAt = boundaryAt(run.startsAt, run.periodMs, next);
    if (run.burstEndsAt !== null && startsAt >= run.burstEndsAt) return;
    // Like a phone: listen until the upload margin before the next boundary, then upload.
    const reportAt = startsAt + this.windowOf(i, run) + 150 + 100 * i;
    this.timers.set(
      i,
      setTimeout(
        () => {
          void this.report(i, run, next).finally(() => {
            if (this.runs.get(i) === `${run.runId}`) this.schedule(i, run, next + 1);
          });
        },
        Math.max(0, reportAt - now),
      ),
    );
  }

  /** Like the app: pause sweeps, measure the reference carrier for the command's duration, report, ack. */
  private runCommand(i: number, c: Command) {
    const seen = this.handled.get(i) ?? 0;
    if (c.seq <= seen) return;
    this.handled.set(i, c.seq);
    this.measuringUntil.set(i, Date.now() + c.durationS * 1000);
    setTimeout(() => {
      const sim = this.sims[i];
      if (!sim || sim.stopped || this.halted || this.behaviour[i]?.offline) return;
      const cal = this.behaviour[i]?.calibration ?? { biasDb: 0, ppmError: 0 };
      void sim
        .sync({
          sentAt: Date.now(),
          heartbeat: this.heartbeat(i),
          ackSeq: c.seq,
          calibration: [
            {
              session: c.session,
              powerDbm: REFERENCE_DBM + cal.biasDb,
              freqOffsetHz: (cal.ppmError * c.referenceHz) / 1e6,
            },
          ],
        })
        .catch(() => {});
    }, c.durationS * 1000);
  }

  /** A full window, or only the Fix window when the phone is warm or on battery. */
  private windowOf(i: number, run: RunSection) {
    return this.behaviour[i]?.shortWindow ? FIX_WINDOW_MS : listeningWindowMs(run.periodMs);
  }

  private async report(i: number, run: RunSection, k: number) {
    const sim = this.sims[i];
    if (!sim || sim.stopped || this.halted || this.behaviour[i]?.offline) return;
    if (Date.now() < (this.measuringUntil.get(i) ?? 0)) return;
    const m = this.measure({
      index: i,
      sim,
      plan: run.plan,
      run,
      k,
      windowMs: this.windowOf(i, run),
    });
    const where = this.position(i);
    const gains = sim.control?.config.values;
    try {
      const res = await sim.sync({
        sentAt: Date.now(),
        heartbeat: this.heartbeat(i),
        position: where,
        readings: [
          {
            runId: run.runId as Id<"runs">,
            k,
            appVersion: this.heartbeat(i).appVersion,
            lnaDb: gains?.lnaDb ?? 32,
            vgaDb: gains?.vgaDb ?? 30,
            amp: gains?.amp ?? false,
            ppm: gains?.ppm ?? 0,
            windowMs: m.windowMs,
            passes: m.passes,
            fixPasses: m.fixPasses,
            stopReason: m.stopReason,
            start: where,
            end: where,
            clockUncertaintyMs: this.behaviour[i]?.clockUncertaintyMs ?? 4,
            payload: encodeReading(m.payload).buffer,
          },
        ],
      });
      this.log.push({ name: sim.name, k, outcome: res.readings[0]?.outcome ?? "?" });
    } catch (e) {
      this.log.push({ name: sim.name, k, outcome: `error: ${(e as Error).message}` });
    }
  }

  stop() {
    this.halted = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.heartbeats) clearInterval(this.heartbeats);
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }
}
