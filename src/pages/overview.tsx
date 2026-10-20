import { Link } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense } from "react";
import { AlertsFeed } from "../components/alerts-feed";
import { EmptyState } from "../components/empty-state";
import { FixFlags } from "../components/fix-flags";
import { hackrfLabel, SetupBadge, StateChip, windowLabel } from "../components/health";
import { LearningBanner } from "../components/learning-banner";

import { useLiveRun } from "../components/scan-control";
import { ScanStrip, STATE_LABEL } from "../components/scan-strip";
import { StartButton } from "../components/start-button";
import { buttonVariants } from "../components/ui/button";
import { scanNumber } from "../lib/cadence";
import { channelColours, coords, metres, mhz } from "../lib/channels";
import { circle, occupancyText, spanText, useBoard } from "../lib/emitters";
import { type FleetRow, useFleet } from "../lib/fleet";
import { coverageHull, receiverMarkers } from "../lib/mapData";
import { clock, relative, useNow } from "../lib/time";

const MapCanvas = lazy(() => import("../components/map/map-canvas"));

export function OverviewPage() {
  const now = useNow(5000);
  const fleet = useFleet(now);
  const live = useLiveRun();
  if (!fleet || !live) return null;

  if (fleet.length === 0) {
    return (
      <>
        <h1 className="sr-only">Overview</h1>
        <EmptyState
          title="No Receivers yet"
          action={
            <Link to="/receivers" className={buttonVariants({ variant: "primary" })}>
              Pair Receiver
            </Link>
          }
        >
          Pair a phone with its HackRF to start scanning.
        </EmptyState>
      </>
    );
  }

  const scan = live.scans[0];
  // Phones upload at the end of each window: count the newest Scan that has reports or closed.
  const reporting = live.scans.find((s) => s.reported > 0 || s.state !== "collecting") ?? scan;
  const finished = live.scans.find((s) => s.state === "done" || s.state === "no_fix");
  const healthy = fleet.filter((f) => f.state === "scanning" || f.state === "idle").length;

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="sr-only">Overview</h1>
      <LearningBanner />
      {!live.run && (
        <EmptyState title="Not scanning" action={<StartButton />}>
          Receivers are idle. Start a Run to produce Fixes.
        </EmptyState>
      )}
      <dl
        className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface md:grid-cols-4"
        aria-label="Summary"
      >
        <Kpi label="Current Scan">
          {live.run && scan
            ? `Run ${live.run.number} · Scan ${scanNumber(scan.k)} · ${STATE_LABEL[scan.state]}`
            : live.run
              ? `Run ${live.run.number} · starting`
              : "Not scanning"}
        </Kpi>
        <Kpi label="Reported" mono>
          {reporting
            ? `${reporting.reported} of ${reporting.expected}${reporting.partial ? ` · ${reporting.partial} partial` : ""} (Scan ${scanNumber(reporting.k)})`
            : "—"}
        </Kpi>
        <Kpi label="Emitters (last Scan)" mono>
          {finished ? `${finished.heard} heard · ${finished.located} located` : "—"}
        </Kpi>
        <Kpi label="Healthy Receivers" mono>{`${healthy} of ${fleet.length}`}</Kpi>
      </dl>
      <ScanStrip now={now} />
      <EmittersNow now={now} fleet={fleet} />
      <FleetTable fleet={fleet} now={now} />
      <AlertsFeed limit={8} />
    </div>
  );
}

/** Health first: find the sick Receiver in seconds. */
function FleetTable({ fleet, now }: { fleet: FleetRow[]; now: number }) {
  const rank = {
    needs_attention: 0,
    offline: 1,
    degraded: 2,
    paused: 3,
    awaiting_pairing: 4,
    scanning: 5,
    idle: 6,
  };
  const rows = [...fleet].sort(
    (a, b) => rank[a.state] - rank[b.state] || a.receiver.name.localeCompare(b.receiver.name),
  );
  return (
    <section className="rounded-lg border border-line bg-surface" aria-label="Fleet">
      <h2 className="border-b border-line px-3 py-2 text-sm">Fleet</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="fleet-table">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-medium">Receiver</th>
              <th className="px-3 py-2 font-medium">HackRF</th>
              <th className="px-3 py-2 font-medium">Battery</th>
              <th className="px-3 py-2 font-medium">Window</th>
              <th className="px-3 py-2 font-medium">Clock</th>
              <th className="px-3 py-2 font-medium">Outbox</th>
              <th className="px-3 py-2 font-medium">GPS</th>
              <th className="px-3 py-2 font-medium">App</th>
              <th className="px-3 py-2 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ receiver, status, state, reasons }) => {
              const s = status?.snapshot ?? null;
              const pinned = receiver.config.position.mode === "pinned";
              return (
                <tr key={receiver._id} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-2">
                    <Link
                      to="/receivers/$receiverId"
                      params={{ receiverId: receiver._id }}
                      className="font-medium hover:underline"
                    >
                      {receiver.name}
                    </Link>
                    <div className="flex flex-wrap gap-1">
                      <StateChip state={state} reasons={reasons} />
                      <SetupBadge gaps={s?.setupGaps ?? []} />
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{hackrfLabel(s)}</td>
                  <td className="num px-3 py-2 whitespace-nowrap">
                    {s ? `${Math.round(s.battery * 100)}%${s.charging ? " ⚡" : ""}` : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{s ? windowLabel(s.window) : "—"}</td>
                  <td className="num px-3 py-2 whitespace-nowrap">
                    {s
                      ? `${s.clock.offsetMs >= 0 ? "+" : ""}${Math.round(s.clock.offsetMs)} ms ±${Math.round(s.clock.uncertaintyMs)}`
                      : "—"}
                  </td>
                  <td className="num px-3 py-2 whitespace-nowrap">
                    {s
                      ? s.outbox.depth > 0
                        ? `${s.outbox.depth} · ${Math.round(s.outbox.oldestAgeS / 60)} min`
                        : "0"
                      : "—"}
                  </td>
                  <td className="num px-3 py-2 whitespace-nowrap">
                    {pinned
                      ? "pinned"
                      : s?.gpsAccuracyM != null
                        ? `±${Math.round(s.gpsAccuracyM)} m`
                        : "—"}
                  </td>
                  <td className="num px-3 py-2">{status?.appVersion ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">
                    {status?.lastSeenAt ? relative(status.lastSeenAt, now) : "never"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Every Emitter on the latest board: located ones first, then those heard by fewer than 3. */
function EmittersNow({ now, fleet }: { now: number; fleet: FleetRow[] }) {
  const board = useBoard();
  if (!board) return null;
  const markers = receiverMarkers(fleet);
  const colour = channelColours(board.rows.filter((r) => r.position).map((r) => r.freqHz));
  const shown = board.rows.slice(0, 50);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="rounded-lg border border-line bg-surface" aria-label="Emitters now">
        <h2 className="border-b border-line px-3 py-2 text-sm">
          Emitters now
          {board.at !== null && <span className="text-muted"> · Scan at {clock(board.at)}</span>}
        </h2>
        {board.rows.length === 0 ? (
          <p className="px-3 py-2 text-muted">No Emitters in the latest Scan.</p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left" data-testid="emitters-now">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Emitter</th>
                  <th className="px-3 py-2 font-medium">Occupancy</th>
                  <th className="px-3 py-2 font-medium">Where</th>
                  <th className="px-3 py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.ch} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        to="/emitters/$freqHz"
                        params={{ freqHz: String(r.freqHz) }}
                        className="num flex items-center gap-2 hover:underline"
                      >
                        <span
                          className="size-3 shrink-0 rounded-sm"
                          style={{ background: r.position ? colour(r.freqHz) : "transparent" }}
                          aria-hidden
                        />
                        {mhz(r.freqHz)}
                      </Link>
                      <span className="num text-xs text-muted">{spanText(r.lowHz, r.highHz)}</span>
                    </td>
                    <td className="num px-3 py-2 text-xs">{occupancyText(r.occupancy)}</td>
                    <td className="num px-3 py-2 text-xs">
                      {r.position && r.missed !== null && r.missed < 3 ? (
                        <>
                          {coords(r.position.lat, r.position.lng)} · ≈{metres(r.position.radiusM)}
                          {r.missed > 0 && (
                            <span className="text-muted">
                              {" "}
                              · missed {r.missed} Scan{r.missed > 1 ? "s" : ""}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">
                          heard by {r.heard}
                          {r.loudestName ? ` · loudest at ${r.loudestName}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <FixFlags fix={{ receiverCount: r.used, flags: r }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {board.rows.length > shown.length && (
              <p className="px-3 py-1 text-xs text-muted">
                {board.rows.length - shown.length} more on the Map.
              </p>
            )}
          </div>
        )}
        <p className="px-3 py-1 text-xs text-muted">
          {board.at !== null ? `Updated ${relative(board.at, now)}` : ""}
        </p>
      </section>
      <div className="h-72 overflow-hidden rounded-lg border border-line bg-surface-2 lg:h-auto lg:min-h-72">
        <Suspense fallback={null}>
          <MapCanvas
            receivers={markers}
            fixes={board.rows.flatMap((r) =>
              r.position && r.missed !== null && r.missed < 3
                ? [
                    {
                      freqHz: r.freqHz,
                      lat: r.position.lat,
                      lng: r.position.lng,
                      colour: colour(r.freqHz),
                      region: circle(r.position, r.position.radiusM),
                      dim: r.missed > 0,
                    },
                  ]
                : [],
            )}
            hull={coverageHull(markers)}
          />
        </Suspense>
      </div>
    </div>
  );
}

function Kpi({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 border-line p-3 not-last:border-r max-md:even:border-r-0 max-md:[&:nth-child(-n+2)]:border-b">
      <dt className="text-xs tracking-wide text-muted uppercase">{label}</dt>
      <dd className={`text-base font-medium ${mono ? "num" : ""}`}>{children}</dd>
    </div>
  );
}
