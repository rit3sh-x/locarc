import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useConvex, useQuery } from "convex/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { FixFlags } from "../components/fix-flags";
import { StateChip } from "../components/health";
import { Button } from "../components/ui/button";
import { channelColours, coords, metres, mhz } from "../lib/channels";
import { circle, occupancyText, spanText, useBoard } from "../lib/emitters";
import { useFleet } from "../lib/fleet";
import { coverageHull, latestPerEmitter, receiverMarkers } from "../lib/mapData";
import { dateTime, relative, useNow } from "../lib/time";

const MapCanvas = lazy(() => import("../components/map/map-canvas"));
const route = getRouteApi("/app/map");
const DAY = 86_400_000;
/** Fixes are stored on change plus hourly, so an hour back finds every Emitter present then. */
const LOOKBACK = 3_600_000;

/** One Emitter as the Map draws and lists it, live (the board) or past (stored Fixes). */
type Shown = {
  freqHz: number;
  lowHz: number;
  highHz: number;
  lat: number;
  lng: number;
  radiusM: number;
  region: { lat: number; lng: number }[];
  occupancy: number;
  receiverCount: number;
  flags: { unconfirmed: boolean; poorFit: boolean; collinear: boolean; receiverMoved: boolean };
  missed: number;
  at: number;
};

export function MapPage() {
  const { at, em, show } = route.useSearch();
  const watchlist = useQuery(api.watchlist.list);
  const navigate = useNavigate({ from: "/map" });
  const now = useNow(5000);
  const fleet = useFleet(now);
  const convex = useConvex();
  // Live: the per-Scan board subscription. Past: one paginated read, never a subscription.
  const board = useBoard();
  const [past, setPast] = useState<{ at: number; fixes: Doc<"fixes">[] } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);

  useEffect(() => {
    if (at === undefined) return;
    let cancelled = false;
    void convex
      .query(api.fixes.window, {
        from: at - LOOKBACK,
        to: at,
        paginationOpts: { numItems: 1000, cursor: null },
      })
      .then((r) => {
        if (!cancelled) setPast({ at, fixes: latestPerEmitter(r.page) });
      });
    return () => {
      cancelled = true;
    };
  }, [at, convex]);

  if (!fleet || board === undefined) return null;
  const all: Shown[] =
    at === undefined
      ? board.rows.flatMap((r) =>
          r.position && r.missed !== null && r.missed < 3
            ? [
                {
                  freqHz: r.freqHz,
                  lowHz: r.lowHz,
                  highHz: r.highHz,
                  lat: r.position.lat,
                  lng: r.position.lng,
                  radiusM: r.position.radiusM,
                  region: circle(r.position, r.position.radiusM),
                  occupancy: r.occupancy,
                  receiverCount: r.used,
                  flags: r,
                  missed: r.missed,
                  at: board.at ?? 0,
                },
              ]
            : [],
        )
      : past?.at === at
        ? past.fixes.map((f) => ({
            ...f,
            radiusM: f.uncertaintyM,
            region: f.region.length >= 3 ? f.region : circle(f, f.uncertaintyM),
            missed: 0,
          }))
        : [];
  const watched = new Map((watchlist ?? []).map((w) => [w.freqHz, w.name]));
  const shown = all.filter(
    (f) =>
      (em === undefined || f.freqHz === em) &&
      (show !== "watched" || watched.has(f.freqHz)) &&
      (show !== "intermittent" || f.occupancy < 0.9),
  );
  const markers = receiverMarkers(fleet);
  const hull = coverageHull(markers);
  const freqs = [...new Set(all.map((f) => f.freqHz))].sort((a, b) => a - b);
  const colour = channelColours(freqs);

  const scrub = draft ?? at ?? now;
  const commit = (value: number) => {
    setDraft(null);
    // The slider moves in whole minutes; within half a step of now means live.
    void navigate({
      search: (s) => ({ ...s, at: value >= Date.now() - 30_000 ? undefined : value }),
    });
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <h1 className="sr-only">Map</h1>
      <div className="grid content-start gap-2">
        <div className="relative h-[60vh] min-h-80 overflow-hidden rounded-lg border border-line bg-surface-2">
          <Suspense fallback={null}>
            <MapCanvas
              receivers={markers.filter((m) => fleet.find((f) => f.receiver._id === m.id))}
              fixes={shown.map((f) => ({ ...f, colour: colour(f.freqHz), dim: f.missed > 0 }))}
              hull={hull}
              onFix={(freqHz) =>
                navigate({ to: "/emitters/$freqHz", params: { freqHz: String(freqHz) } })
              }
              onReceiver={(id) =>
                navigate({ to: "/receivers/$receiverId", params: { receiverId: id } })
              }
            />
          </Suspense>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
          <label className="flex min-w-60 flex-1 items-center gap-2 text-sm">
            <span className="shrink-0">Time</span>
            <input
              type="range"
              aria-label="Time scrubber"
              className="w-full accent-[var(--accent)]"
              min={now - 30 * DAY}
              max={now}
              step={60_000}
              value={scrub}
              onChange={(e) => setDraft(Number(e.target.value))}
              onPointerUp={(e) => commit(Number(e.currentTarget.value))}
              onKeyUp={(e) => commit(Number(e.currentTarget.value))}
            />
          </label>
          <span className="num text-sm" data-testid="map-time">
            {at === undefined ? "Live" : dateTime(at)}
          </span>
          <Button
            size="sm"
            variant={at === undefined ? "primary" : "secondary"}
            onClick={() => commit(now)}
          >
            Live
          </Button>
        </div>
      </div>

      <aside className="grid content-start gap-3" aria-label="Map contents">
        <label className="grid gap-1 text-sm">
          Emitters
          <select
            className="h-9 rounded-md border border-line bg-surface px-2"
            value={em ?? show ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const kind = v === "watched" || v === "intermittent" ? v : undefined;
              void navigate({
                search: (s) => ({
                  ...s,
                  show: kind,
                  em: v && !kind ? Number(v) : undefined,
                }),
              });
            }}
          >
            <option value="">All Emitters</option>
            <option value="watched">Watched only</option>
            <option value="intermittent">Intermittent only (Occupancy under 90%)</option>
            {freqs.map((c) => (
              <option key={c} value={c}>
                {mhz(c)}
                {watched.has(c) ? ` · ${watched.get(c)}` : ""}
              </option>
            ))}
          </select>
        </label>

        <section className="rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-3 py-2 text-sm">
            Emitters {at === undefined ? "(latest Scan)" : `as of ${dateTime(at)}`}
          </h2>
          {shown.length === 0 ? (
            <p className="px-3 py-2 text-muted">
              No located Emitters{at === undefined ? " in the latest Scan" : " in the hour before"}.
            </p>
          ) : (
            <ul className="divide-y divide-line" data-testid="map-emitters">
              {shown.map((f) => (
                <li key={f.freqHz} className="grid gap-0.5 px-3 py-2" data-at={f.at}>
                  <Link
                    to="/emitters/$freqHz"
                    params={{ freqHz: String(f.freqHz) }}
                    className="flex items-center gap-2 font-medium hover:underline"
                  >
                    <span
                      className="size-3 rounded-sm"
                      style={{ background: colour(f.freqHz) }}
                      aria-hidden
                    />
                    <span className="num">{mhz(f.freqHz)}</span>
                    <span className="font-normal text-muted">
                      {watched.get(f.freqHz) ?? "unnamed"}
                    </span>
                  </Link>
                  <span className="num text-xs text-muted" data-testid="fix-position">
                    {coords(f.lat, f.lng)} · ≈ {metres(f.radiusM)} · {f.receiverCount} Receivers ·{" "}
                    {relative(f.at, now)}
                    {f.missed > 0 ? ` · missed ${f.missed} Scan${f.missed > 1 ? "s" : ""}` : ""}
                  </span>
                  <span className="num text-xs">
                    {spanText(f.lowHz, f.highHz)} · {occupancyText(f.occupancy)}
                  </span>
                  <FixFlags fix={{ ...f, receiverCount: f.receiverCount }} quiet />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-3 py-2 text-sm">Receivers</h2>
          <ul className="divide-y divide-line">
            {fleet.map(({ receiver, state }) => {
              const marker = markers.find((m) => m.id === receiver._id);
              return (
                <li key={receiver._id} className="grid gap-0.5 px-3 py-2">
                  <Link
                    to="/receivers/$receiverId"
                    params={{ receiverId: receiver._id }}
                    className="flex flex-wrap items-center gap-2 font-medium hover:underline"
                  >
                    {receiver.name} <StateChip state={state} />
                  </Link>
                  <span className="num text-xs text-muted">
                    {marker
                      ? `${coords(marker.lat, marker.lng)}${marker.pinned ? " · pinned" : ""}`
                      : "no position"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <p className="text-xs text-muted">
          Rings show Receiver health (thick when pinned). Circles show each Emitter's uncertainty;
          faint ones were missed in the latest Scan. The dashed line is the coverage hull: positions
          are only meaningful inside it.
        </p>
      </aside>
    </div>
  );
}
