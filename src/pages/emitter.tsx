import { getRouteApi, Link } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { channelOf } from "@/convex/lib/channelMath";
import { AlertRow } from "../components/alerts-feed";
import { FixFlags } from "../components/fix-flags";
import { Button } from "../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Input, Label } from "../components/ui/input";
import { toast } from "../components/ui/toast";
import { channelColour, coords, metres, mhz } from "../lib/channels";
import { circle, occupancyText, spanText, useBoard } from "../lib/emitters";
import { useFleet } from "../lib/fleet";
import { receiverMarkers } from "../lib/mapData";
import { dateTime, relative, useNow } from "../lib/time";
import { Section } from "./settings";

const MapCanvas = lazy(() => import("../components/map/map-canvas"));
const route = getRouteApi("/app/emitters/$freqHz");
const DAY = 86_400_000;
const RANGES = [
  { key: "1d", label: "24 hours", ms: DAY },
  { key: "7d", label: "7 days", ms: 7 * DAY },
  { key: "30d", label: "30 days", ms: 30 * DAY },
  { key: "1y", label: "1 year (hourly best)", ms: 365 * DAY },
] as const;

const STATUS: Record<Doc<"fixes">["receivers"][number]["status"], string> = {
  used: "Used",
  clipped: "Clipped (lower bound)",
  heard_later: "Heard after the Fix window",
  not_heard: "Not heard",
  unaligned: "Unaligned",
  no_position: "No position",
};

export function EmitterPage() {
  const freqHz = Number(route.useParams().freqHz);
  const detail = useQuery(api.emitters.detail, { freqHz });
  const board = useBoard();
  const config = useQuery(api.orgConfig.current);
  const now = useNow(30_000);
  const fleet = useFleet(now);
  const [naming, setNaming] = useState(false);
  const [pickHome, setPickHome] = useState(false);
  const upsert = useMutation(api.watchlist.upsert);

  if (!detail || !config || !fleet || board === undefined) return null;
  const { watch, activity, recent, full, alerts } = detail;
  const latest = recent[0];
  const now$ = board.rows.find((r) => r.freqHz === freqHz);
  const raster = config.values.rasterHz;
  const colour = channelColour(freqHz);
  const span = now$ ?? (activity && { lowHz: activity.lowHz, highHz: activity.highHz });
  // Where it is now: the board's latest position, else the latest stored Fix.
  const here =
    now$?.position && now$.missed !== null && now$.missed < 3
      ? { ...now$.position, region: circle(now$.position, now$.position.radiusM) }
      : full
        ? { lat: full.lat, lng: full.lng, region: full.region }
        : null;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="num text-xl font-medium">{mhz(freqHz)}</h1>
        {span && (
          <span className="num" data-testid="emitter-span">
            {spanText(span.lowHz, span.highHz)} wide
          </span>
        )}
        <span className="num text-muted">
          ch {channelOf(freqHz, raster)} · {raster / 1000} kHz raster
        </span>
        {now$ && (
          <span className="num text-sm" data-testid="emitter-occupancy">
            {occupancyText(now$.occupancy)} · peak {now$.peakDbm.toFixed(1)} dBm
          </span>
        )}
        <span className="text-base">
          {watch ? watch.name : <span className="text-muted">unnamed</span>}
        </span>
        {!watch && (
          <Button variant="primary" className="ml-auto" onClick={() => setNaming(true)}>
            Name &amp; watch
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="relative h-80 overflow-hidden rounded-lg border border-line bg-surface-2 lg:h-auto lg:min-h-96">
          {pickHome && (
            <p className="absolute top-2 left-2 z-10 rounded-md bg-surface px-2 py-1 text-sm shadow">
              Click the map to set the usual position.
            </p>
          )}
          <Suspense fallback={null}>
            <MapCanvas
              receivers={receiverMarkers(fleet)}
              fixes={here ? [{ ...here, freqHz, colour }] : []}
              hull={[]}
              trail={[...recent].reverse()}
              onMapClick={
                pickHome && watch
                  ? (p) => {
                      setPickHome(false);
                      void upsert({ ...strip(watch), home: p }).then(
                        () => toast.success("Usual position set"),
                        toast.error,
                      );
                    }
                  : undefined
              }
            />
          </Suspense>
        </div>
        <div className="grid content-start gap-4">
          <Section title="Activity">
            {activity ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted">First Fix</dt>
                <dd>{dateTime(activity.firstFixAt)}</dd>
                <dt className="text-muted">Last located</dt>
                <dd>{relative(activity.lastLocatedAt, now)}</dd>
                <dt className="text-muted">Fixes stored</dt>
                <dd className="num">{activity.fixCount}</dd>
              </dl>
            ) : now$ ? (
              <p className="text-muted">
                Heard by {now$.heard} Receiver{now$.heard === 1 ? "" : "s"}
                {now$.loudestName ? `, loudest at ${now$.loudestName}` : ""}; not located yet.
              </p>
            ) : (
              <p className="text-muted">Not located in the last 30 days.</p>
            )}
          </Section>
          {full && (
            <Section title={`Latest full Fix · ${relative(full.at, now)}`}>
              <p className="num text-xs">
                {coords(full.lat, full.lng)} · 95% region ≈ {metres(full.uncertaintyM)} across
              </p>
              <FixFlags fix={full} />
              <table className="w-full text-left text-sm" data-testid="power-by-receiver">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 font-medium">Receiver</th>
                    <th className="py-1 font-medium">Status</th>
                    <th className="py-1 text-right font-medium">Power</th>
                  </tr>
                </thead>
                <tbody>
                  {full.receivers.map((e) => (
                    <tr key={e.receiver}>
                      <td className="py-0.5">{e.name}</td>
                      <td className="py-0.5">{STATUS[e.status]}</td>
                      <td className="num py-0.5 text-right">
                        {e.powerDbm === null
                          ? "—"
                          : `${e.status === "not_heard" ? "< " : ""}${e.powerDbm.toFixed(1)} dBm`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </div>
      </div>

      {watch && (
        <WatchSettings watch={watch} latest={latest} onPickHome={() => setPickHome(true)} />
      )}
      {alerts.length > 0 && (
        <Section title="Alerts">
          <ul className="-mx-3 divide-y divide-line">
            {alerts.map((a) => (
              <AlertRow key={a._id} alert={a} now={now} />
            ))}
          </ul>
        </Section>
      )}
      <EmitterHistory freqHz={freqHz} watched={watch !== null} />

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent
          title={`Name ${mhz(freqHz)}`}
          description="It joins the Watchlist with Heard, Moved and Silent alerts on; it never raises New again."
        >
          <form
            className="grid grid-cols-1 gap-4"
            action={async (form) => {
              try {
                await upsert({
                  freqHz,
                  name: String(form.get("name")),
                  notes: String(form.get("notes") ?? ""),
                  rules: { heard: true, moved: true, silent: true },
                  critical: false,
                  home: null,
                });
                setNaming(false);
                toast.success("Added to the Watchlist");
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            <Label>
              Name
              <Input name="name" required maxLength={60} />
            </Label>
            <Label>
              Notes
              <Input name="notes" maxLength={200} />
            </Label>
            <DialogFooter>
              <DialogClose render={<Button />}>Cancel</DialogClose>
              <Button type="submit" variant="primary">
                Name &amp; watch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const strip = (w: Doc<"watchlist">) => ({
  freqHz: w.freqHz,
  name: w.name,
  notes: w.notes,
  rules: w.rules,
  critical: w.critical,
  home: w.home,
});

function WatchSettings({
  watch,
  latest,
  onPickHome,
}: {
  watch: Doc<"watchlist">;
  latest?: Doc<"fixes">;
  onPickHome: () => void;
}) {
  const upsert = useMutation(api.watchlist.upsert);
  const remove = useMutation(api.watchlist.remove);
  const save = async (patch: Partial<ReturnType<typeof strip>>) => {
    try {
      await upsert({ ...strip(watch), ...patch });
      toast.success("Saved");
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Section title="Watch settings">
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        action={(form) =>
          save({
            name: String(form.get("name")),
            notes: String(form.get("notes")),
            rules: {
              heard: form.get("heard") === "on",
              moved: form.get("moved") === "on",
              silent: form.get("silent") === "on",
            },
            critical: form.get("critical") === "on",
          })
        }
      >
        <Label>
          Name
          <Input name="name" defaultValue={watch.name} required maxLength={60} />
        </Label>
        <Label>
          Notes
          <Input name="notes" defaultValue={watch.notes} maxLength={200} />
        </Label>
        <fieldset className="flex flex-wrap gap-4 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Alert when</legend>
          {(
            [
              ["heard", "Heard after 30 min quiet"],
              ["moved", "Moved from its usual position"],
              ["silent", "Silent for 3 Scans"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" name={key} defaultChecked={watch.rules[key]} /> {label}
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input type="checkbox" name="critical" defaultChecked={watch.critical} /> Critical (push
            to phones)
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <span className="text-sm">
            Usual position:{" "}
            <span className="num">
              {watch.home ? coords(watch.home.lat, watch.home.lng) : "median of recent Fixes"}
            </span>
          </span>
          <Button size="sm" onClick={onPickHome}>
            Pick on map
          </Button>
          {latest && (
            <Button size="sm" onClick={() => save({ home: { lat: latest.lat, lng: latest.lng } })}>
              Use latest Fix
            </Button>
          )}
          {watch.home && (
            <Button size="sm" variant="ghost" onClick={() => save({ home: null })}>
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" variant="primary">
            Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => remove({ freqHz: watch.freqHz }).catch(toast.error)}
          >
            Remove from Watchlist
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** One-shot reads over a chosen range; beyond 30 days only watched Emitters keep hourly-best Fixes. */
function EmitterHistory({ freqHz, watched }: { freqHz: number; watched: boolean }) {
  const convex = useConvex();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("1d");
  const [rows, setRows] = useState<Doc<"fixes">[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ms = RANGES.find((r) => r.key === range)?.ms ?? DAY;
    const to = Date.now();
    void convex
      .query(api.emitters.history, {
        freqHz,
        from: to - ms,
        to,
        paginationOpts: { numItems: 200, cursor: null },
      })
      .then((r) => {
        if (!cancelled) setRows(r.page);
      });
    return () => {
      cancelled = true;
    };
  }, [convex, freqHz, range]);
  return (
    <Section
      title="History"
      action={
        <select
          aria-label="History range"
          className="h-8 rounded-md border border-line bg-surface px-2 text-sm"
          value={range}
          onChange={(e) => setRange(e.target.value as typeof range)}
        >
          {RANGES.filter((r) => watched || r.key !== "1y").map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      }
    >
      {!rows ? null : rows.length === 0 ? (
        <p className="text-muted">No Fixes in this range.</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="num w-full text-left text-xs">
            <tbody>
              {rows.map((f) => (
                <tr key={f._id} className="border-b border-line last:border-0">
                  <td className="py-1 pr-3 whitespace-nowrap">{dateTime(f.at)}</td>
                  <td className="py-1 pr-3">{coords(f.lat, f.lng)}</td>
                  <td className="py-1 pr-3">≈{metres(f.uncertaintyM)}</td>
                  <td className="py-1">{f.receiverCount} Rx</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!watched && (
        <p className="text-xs text-muted">
          Fixes older than 30 days are kept only for watched Emitters.
        </p>
      )}
    </Section>
  );
}

export const EmitterLink = ({ freqHz }: { freqHz: number }) => (
  <Link to="/emitters/$freqHz" params={{ freqHz: String(freqHz) }} className="num hover:underline">
    {mhz(freqHz)}
  </Link>
);
