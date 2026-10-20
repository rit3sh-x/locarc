import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useQuery } from "convex/react";

import type { FunctionReturnType } from "convex/server";
import { Fragment } from "react";
import { api } from "@/convex/_generated/api";
import { scanNumber } from "../lib/cadence";
import { clock } from "../lib/time";

type Recent = FunctionReturnType<typeof api.scans.recent>;
type ScanState = Recent["scans"][number]["state"];

const FILL: Record<ScanState, string> = {
  collecting: "bg-accent",
  localizing: "bg-accent",
  done: "bg-ok",
  no_fix: "bg-off",
  failed: "bg-crit",
  discarded: "border border-dashed border-muted bg-transparent",
};

export const STATE_LABEL: Record<ScanState, string> = {
  collecting: "collecting",
  localizing: "localizing",
  done: "done",
  no_fix: "no Fix",
  failed: "failed",
  discarded: "discarded",
};

const WINDOW_MS = 2 * 3_600_000;
const STEP_MS = 10 * 60_000;

/** Scans of the last 2 hours, coloured by outcome, with partial markers and Run ends. */
export function ScanStrip({ now }: { now: number }) {
  // Rounded so the subscription's argument only changes every 10 minutes.
  const since = Math.floor((now - WINDOW_MS) / STEP_MS) * STEP_MS;
  const recent = useQuery(api.scans.recent, { since });
  if (!recent) return null;
  const runs = new Map(recent.runs.map((r) => [r._id, r]));

  return (
    <section
      className="rounded-lg border border-line bg-surface p-3"
      aria-label="Last 2 hours of Scans"
    >
      <h2 className="mb-2 text-sm">Last 2 hours</h2>
      {recent.scans.length === 0 ? (
        <p className="text-muted">No Scans in the last 2 hours.</p>
      ) : (
        <ol className="flex flex-wrap items-end gap-1" data-testid="scan-strip">
          {recent.scans.map((s, i) => {
            const run = runs.get(s.run);
            const next = recent.scans[i + 1];
            const runEnded = run?.endedAt != null && next?.run !== s.run;
            const label = `Run ${run?.number} · Scan ${scanNumber(s.k)} at ${clock(s.startsAt)}: ${STATE_LABEL[s.state]}, ${s.reported} of ${s.expected} reported${s.partial ? `, ${s.partial} partial` : ""}`;
            return (
              <Fragment key={s._id}>
                <li title={label}>
                  <Link
                    to="/scans/$run/$k"
                    params={{ run: String(run?.number ?? 0), k: String(scanNumber(s.k)) }}
                    className="grid justify-items-center gap-0.5 rounded-sm"
                  >
                    <span className={cn("block h-6 w-2.5 rounded-sm", FILL[s.state])} />
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        s.partial ? "bg-warn" : "bg-transparent",
                      )}
                    />
                    <span className="sr-only">{label}</span>
                  </Link>
                </li>
                {runEnded && (
                  <li className="self-center px-1 text-xs text-muted">Run {run?.number} ended</li>
                )}
              </Fragment>
            );
          })}
        </ol>
      )}
    </section>
  );
}
