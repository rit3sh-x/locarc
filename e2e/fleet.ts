import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SimReceiver } from "@/scripts/sim/receiver";
import { FleetRunner } from "@/scripts/sim/runner";
import { type Scenario, worldMeasure } from "@/scripts/sim/world";

import { ensureSetUp, OPERATOR } from "./helpers";
import { WEB_PORT } from "./ports";

/** The demo scenario: four Receivers ~1.6 km apart and three emitters. */
export const DEMO = JSON.parse(
  readFileSync(join(import.meta.dirname, "../scripts/sim/scenarios/demo.json"), "utf8"),
) as Scenario;
export const FLEET = DEMO.receivers.map((r) => r.name);
export const FLEET_POSITIONS = DEMO.receivers.map(({ lat, lng }) => ({ lat, lng }));

const convexUrl = () => process.env.E2E_CONVEX_URL ?? "";
// Keyed to this run's backend, so a previous run's secrets are never reused.
const runKey = () =>
  createHash("sha256")
    .update(process.env.E2E_ADMIN_KEY ?? "")
    .digest("hex");
const stateFile = join(tmpdir(), "locarc-e2e-fleet.json");

type Saved = { run: string; receivers: { id: Id<"receivers">; name: string; secret: string }[] };

export function saveFleet(sims: SimReceiver[]) {
  const saved: Saved = {
    run: runKey(),
    receivers: sims.map((s) => ({
      id: s.id as Id<"receivers">,
      name: s.name,
      secret: s.secret ?? "",
    })),
  };
  writeFileSync(stateFile, JSON.stringify(saved));
}

/** An Operator's Convex token, minted through the same /api/auth proxy the website uses. */
export async function operatorClient(email = OPERATOR.email, password = OPERATOR.password) {
  const base = `http://localhost:${WEB_PORT}`;
  const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password }),
  });
  if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status}`);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { token } = (await (
    await fetch(`${base}/api/auth/convex/token`, { headers: { cookie } })
  ).json()) as {
    token: string;
  };
  const client = new ConvexHttpClient(convexUrl());
  client.setAuth(token);
  return client;
}

/** The four paired Receivers, resumed from the pairing journey or paired here when run alone. */
export async function ensureFleet(): Promise<SimReceiver[]> {
  if (existsSync(stateFile)) {
    const saved = JSON.parse(readFileSync(stateFile, "utf8")) as Saved;
    if (saved.run === runKey()) {
      return await Promise.all(
        saved.receivers.map(async (r) => {
          const sim = new SimReceiver(convexUrl());
          sim.name = r.name;
          await sim.resume(r.id, r.secret);
          return sim;
        }),
      );
    }
  }
  ensureSetUp();
  const op = await operatorClient();
  const sims: SimReceiver[] = [];
  for (const name of FLEET) {
    const { code } = await op.mutation(api.receivers.createPending, { name });
    const sim = new SimReceiver(convexUrl());
    await sim.pair(code);
    sims.push(sim);
  }
  saveFleet(sims);
  return sims;
}

/**
 * A Run with a Scan every minute (or faster), whatever earlier journeys left: Restore in
 * the org-config journey brings back v1's 5-minute cadence, and a burst can end.
 */
export async function ensureMinuteRun(op: ConvexHttpClient) {
  const { run } = await op.query(api.live.run, {});
  const cadence = { kind: "oneMinute", hours: 4, revertMinutes: 5 } as const;
  if (!run) await op.mutation(api.runs.start, { cadence });
  else if (run.periodMs > 60_000) await op.mutation(api.runs.setCadence, { cadence });
}

/**
 * The paired fleet sweeping the demo world, with a Run scanning every minute. Call `stop()` at
 * the end of the journey.
 */
export async function scanningWorld() {
  const sims = await ensureFleet();
  const runner = new FleetRunner(sims, FLEET_POSITIONS, (b) =>
    worldMeasure(DEMO, FLEET_POSITIONS, b),
  );
  DEMO.receivers.forEach((r, i) => {
    runner.behaviour[i] = { calibration: { biasDb: r.biasDb ?? 0, ppmError: r.ppmError ?? 0 } };
  });
  await runner.start();

  const op = await operatorClient();
  await ensureMinuteRun(op);
  return {
    sims,
    runner,
    op,
    stop: () => {
      runner.stop();
      for (const s of sims) s.close();
    },
  };
}
