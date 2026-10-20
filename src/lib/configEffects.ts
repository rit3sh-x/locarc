import {
  describeOrgConfig,
  type OrgConfig,
  orgConfigDiff,
  sameSegments,
  startsNewRun,
} from "@/convex/lib/config";
import { nextRunStart } from "@/convex/lib/schedule";
import type { Usage } from "@/convex/lib/usage";
import { clock } from "./time";
import { pct } from "./usage";

/** What the diff confirm says about an Organization config change. */
export function orgEffects(o: {
  before: OrgConfig;
  after: OrgConfig;
  runNumber: number | null;
  now: number;
  usageBefore: Usage | null;
  usageAfter: Usage | null;
}) {
  const lines = orgConfigDiff(o.before, o.after);
  const effects: string[] = [];
  const warnings: string[] = [];
  if (startsNewRun(o.before, o.after) && o.runNumber !== null) {
    effects.push(
      `Ends Run ${o.runNumber} now; the Scan in progress is discarded. Run ${o.runNumber + 1} starts at ${clock(nextRunStart(o.now))}.`,
    );
  }
  if (o.before.environment.n !== o.after.environment.n) {
    effects.push(`Fixes from the next Scan use n = ${o.after.environment.n}.`);
  }
  if (!sameSegments(o.before.segments, o.after.segments)) {
    effects.push("New alerts stay quiet for 24 h on newly covered frequencies.");
  }
  if (
    o.usageBefore &&
    o.usageAfter &&
    Math.round(o.usageBefore.worst * 100) !== Math.round(o.usageAfter.worst * 100)
  ) {
    effects.push(
      `Projected usage: ${pct(o.usageBefore.worst)} → ${pct(o.usageAfter.worst)} of the Free plan.`,
    );
  }
  if (o.usageAfter?.warn)
    warnings.push(`Projected usage reaches ${pct(o.usageAfter.worst)} of the Free plan.`);
  return { lines, effects, warnings, summary: describeOrgConfig(o.after) };
}
