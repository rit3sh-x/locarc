import { cn } from "cn";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { FIX_WINDOW_MS } from "@/convex/lib/config";
import {
  burstLengthMs,
  describeCadence,
  listeningWindowMs,
  nextRunStart,
  periodMs,
  scanIndexAt,
} from "@/convex/lib/schedule";
import {
  CADENCE_OPTIONS,
  type CadenceKey,
  cadenceKey,
  countdown,
  formatSeconds,
  parseCadence,
  revertOf,
  sameCadence,
  scanNumber,
} from "../lib/cadence";
import { clock, useNow } from "../lib/time";
import { ConfirmDialog } from "./confirm";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

type Pending = { kind: "start" | "change" | "stop" } | null;

export function useLiveRun() {
  return useQuery(api.live.run);
}

/** Top-bar Scan control: state at a glance, Start/Stop and cadence behind one popover. */
export function ScanControl() {
  const live = useLiveRun();
  const config = useQuery(api.orgConfig.current);
  const now = useNow(1000);
  const start = useMutation(api.runs.start);
  const setCadence = useMutation(api.runs.setCadence);
  const stop = useMutation(api.runs.stop);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [choice, setChoice] = useState<{ key: CadenceKey; revert: 5 | 15 } | null>(null);

  if (!live || !config) return <div className="h-8" />;
  const run = live.run;
  const current = config.values.cadence;
  const key = choice?.key ?? cadenceKey(current);
  const revert = choice?.revert ?? revertOf(current);
  const cadence = parseCadence(key, revert);
  const window = listeningWindowMs(periodMs(cadence));
  // Phones upload at the end of each window, so the newest Scan with reports (or closed) is
  // the one to count; the current one is still listening.
  const scan = live.scans.find((s) => s.reported > 0 || s.state !== "collecting") ?? live.scans[0];
  const running = run !== null && now >= run.startedAt;
  const nextBoundary =
    run && run.startedAt + (scanIndexAt(run.startedAt, run.periodMs, now) + 1) * run.periodMs;
  const nextStart = nextRunStart(now);

  const summary = !run
    ? "Not scanning"
    : !running
      ? `Run ${run.number} starts ${clock(run.startedAt)}`
      : scan
        ? `${scan.reported} of ${scan.expected} reported${scan.partial ? ` · ${scan.partial} partial` : ""}`
        : `Run ${run.number}`;

  const confirm = {
    start: {
      title: "Start scanning?",
      lines: [
        `Run ${(run?.number ?? 0) + 1} starts at ${clock(nextStart)}.`,
        `Cadence: ${describeCadence(cadence)}.`,
      ],
      label: "Start",
      action: () => start({ cadence }),
    },
    change: {
      title: "Change cadence?",
      lines: [
        `Ends Run ${run?.number} now; the Scan in progress is discarded.`,
        `Run ${(run?.number ?? 0) + 1} starts at ${clock(nextStart)}, ${describeCadence(cadence)}.`,
      ],
      label: "Change cadence",
      action: () => setCadence({ cadence }),
    },
    stop: {
      title: `Stop Run ${run?.number}?`,
      lines: [
        `Ends Run ${run?.number} now.`,
        scan?.state === "collecting"
          ? `Scan ${scanNumber(scan.k)} is still collecting and is discarded.`
          : "No Scan is in progress.",
      ],
      label: "Stop scanning",
      action: () => stop({}),
    },
  };
  const dialog = pending && confirm[pending.kind];

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label="Scan control"
          className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 hover:bg-surface-2"
        >
          <span className={cn("size-2 rounded-full", run ? "bg-ok" : "bg-off")} aria-hidden />
          <span className="text-sm" data-testid="scan-summary">
            {summary}
          </span>
          {running && nextBoundary && (
            <span className="num hidden text-xs text-muted sm:inline">
              next {countdown(nextBoundary - now)}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="start">
          <div className="grid gap-3">
            {run ? (
              <div className="grid gap-1">
                <div className="font-medium">
                  Run {run.number} · {describeCadence(run.cadence)}
                </div>
                {run.burstEndsAt !== null && (
                  <div className="text-muted">
                    Burst ends in <span className="num">{countdown(run.burstEndsAt - now)}</span>,
                    then every {revertOf(run.cadence)} min
                  </div>
                )}
                {scan && (
                  <div className="text-muted">
                    Scan {scanNumber(scan.k)} · {scan.state}: {scan.reported} of {scan.expected}{" "}
                    reported
                    {scan.partial ? ` · ${scan.partial} partial` : ""}
                  </div>
                )}
                {nextBoundary && running && (
                  <div className="text-muted">
                    Next Scan in <span className="num">{countdown(nextBoundary - now)}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="font-medium">Not scanning</div>
            )}

            <label className="grid gap-1 text-sm">
              Cadence
              <select
                className="h-9 rounded-md border border-line bg-surface px-2"
                value={key}
                onChange={(e) => setChoice({ key: e.target.value as CadenceKey, revert })}
              >
                {CADENCE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {burstLengthMs(cadence) !== null && (
              <label className="grid gap-1 text-sm">
                Then
                <select
                  className="h-9 rounded-md border border-line bg-surface px-2"
                  value={revert}
                  onChange={(e) => setChoice({ key, revert: Number(e.target.value) as 5 | 15 })}
                >
                  <option value={5}>Every 5 min</option>
                  <option value={15}>Every 15 min</option>
                </select>
              </label>
            )}
            <p className="text-xs text-muted" data-testid="scan-windows">
              Receivers listen <span className="num">{formatSeconds(window)}</span> of each Scan;
              Fixes use the first <span className="num">{formatSeconds(FIX_WINDOW_MS)}</span>.
            </p>

            <div className="flex flex-wrap justify-end gap-2">
              {run ? (
                <>
                  <Button
                    disabled={sameCadence(cadence, run.cadence)}
                    onClick={() => setPending({ kind: "change" })}
                  >
                    Change cadence…
                  </Button>
                  <Button variant="danger" onClick={() => setPending({ kind: "stop" })}>
                    Stop…
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => setPending({ kind: "start" })}>
                  Start…
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {dialog && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={dialog.title}
          lines={dialog.lines}
          confirmLabel={dialog.label}
          danger={pending?.kind === "stop"}
          onConfirm={async () => {
            await dialog.action();
            setChoice(null);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
