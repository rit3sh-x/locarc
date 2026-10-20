// Usage: bun run sim [--scenario path] [--pair CODE ...] [--url https://...] [--soak [--hours 24]]
//
// Simulate Receivers from a scenario file against a Convex deployment.
// Defaults to the deployment configured in .env.local.
// Pair Receivers using codes from the website's Pair dialog. Credentials are
// saved per deployment in .sim-state.json so subsequent runs can resume.
// Press Ctrl-C to stop.
//
// --soak runs the pre-production usage test. Start a Run at the intended
// production cadence, record the usage meter's projection, and run the
// simulator for 24 hours. Compare the reported pass criteria with the
// Convex dashboard.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Id } from "@/convex/_generated/dataModel";
import { SimReceiver } from "./sim/receiver";
import { FleetRunner } from "./sim/runner";
import { type Scenario, worldMeasure } from "./sim/world";

const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "scripts/sim/scenarios/demo.json" },
    pair: { type: "string", multiple: true, default: [] },
    url: { type: "string", default: process.env.VITE_CONVEX_URL },
    soak: { type: "boolean", default: false },
    hours: { type: "string", default: "24" },
  },
});
const url = values.url;
if (!url) throw new Error("No deployment URL: pass --url or run `bun run dev` once.");
const scenario = JSON.parse(readFileSync(values.scenario, "utf8")) as Scenario;

const STATE = ".sim-state.json";
type Saved = Record<string, Record<string, { id: Id<"receivers">; secret: string }>>;
const saved: Saved = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
saved[url] = saved[url] ?? {};
const mine = saved[url];

const sims: SimReceiver[] = [];
const codes = [...(values.pair ?? [])];
for (const r of scenario.receivers) {
  const sim = new SimReceiver(url);
  const known = mine[r.name];
  if (known) {
    sim.name = r.name;
    await sim.resume(known.id, known.secret);
  } else if (codes.length > 0) {
    const paired = await sim.pair(codes.shift() as string);
    mine[r.name] = { id: paired.receiverId, secret: paired.secret };
    console.log(`Paired ${paired.name} as scenario Receiver "${r.name}".`);
  } else {
    console.log(`Skipping "${r.name}": not paired. Pass --pair <code> from the website.`);
    continue;
  }
  sims.push(sim);
}
writeFileSync(STATE, JSON.stringify(saved, null, 2));
if (sims.length === 0) process.exit(1);

const positions = scenario.receivers.filter((r) => mine[r.name]);
const live = new FleetRunner(sims, positions, (b) => worldMeasure(scenario, positions, b));

await live.start();
console.log(`Simulating ${sims.length} Receivers against ${url}. Ctrl-C to stop.`);
const startedAt = Date.now();
let shown = 0;
setInterval(() => {
  for (const e of live.log.slice(shown))
    console.log(`${new Date().toISOString()} ${e.name} Scan ${e.k + 1}: ${e.outcome}`);
  shown = live.log.length;
}, 2000);

function finish() {
  live.stop();
  for (const s of sims) s.close();
  if (values.soak) soakReport();
  process.exit(0);
}
process.on("SIGINT", finish);
if (values.soak) setTimeout(finish, Number(values.hours) * 3_600_000);

function soakReport() {
  const hours = (Date.now() - startedAt) / 3_600_000;
  const kind = (outcome: string) => (outcome.startsWith("error") ? "error" : outcome);
  const count = (k: string) => live.log.filter((e) => kind(e.outcome) === k).length;
  const stored = count("stored");
  const ratio = live.log.length === 0 ? 0 : stored / live.log.length;
  console.log(`
Soak: ${sims.length} Receivers for ${hours.toFixed(1)} h, ${live.log.length} Readings sent.
  stored ${stored}, late ${count("late")}, dropped ${count("dropped")}, errors ${count("error")}
  ${ratio >= 0.99 && count("error") === 0 ? "PASS" : "FAIL"}: at least 99% stored and no errors (${(ratio * 100).toFixed(1)}%)

Then check by hand, from the Convex dashboard's usage for these ${hours.toFixed(1)} h (scaled to 30 days):
  - function calls and database I/O each stay under 80% of the Free plan (1M calls, 1 GB I/O);
  - each is within 25% of the website's usage meter projection noted at the start;
  - storage growth matches the meter's storage line;
  - Settings → Diagnostics shows no new error groups and no Receiver went Offline.`);
}
