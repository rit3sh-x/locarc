import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  LNA_STEPS,
  type ReceiverConfig,
  receiverConfigDefaults,
  receiverConfigDiff,
  VGA_STEPS,
  validateReceiverConfig,
} from "@/convex/lib/config";
import { distanceM } from "@/convex/lib/geo";
import { SETUP_GAPS } from "@/convex/lib/heartbeat";
import { CalibrationPanel } from "../components/calibration-panel";
import { ConfigStateChip, needsCalibration } from "../components/config-state";
import { ConfirmDialog } from "../components/confirm";
import { hackrfLabel, SetupBadge, StateChip, windowLabel } from "../components/health";
import { PairDialogContent } from "../components/pair-dialog";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import { Input, Label } from "../components/ui/input";
import { toast } from "../components/ui/toast";
import { coords, metres } from "../lib/channels";
import { useFleet } from "../lib/fleet";
import { dateTime, relative, useNow } from "../lib/time";
import { Section } from "./settings";

const MapCanvas = lazy(() => import("../components/map/map-canvas"));
const route = getRouteApi("/app/receivers/$receiverId");
type Detail = NonNullable<FunctionReturnType<typeof api.receivers.get>>;
type Events = FunctionReturnType<typeof api.receivers.events>;

export function ReceiverPage() {
  const receiverId = route.useParams().receiverId as Id<"receivers">;
  const data = useQuery(api.receivers.get, { receiverId });
  const now = useNow(10_000);
  const fleet = useFleet(now);
  const [repair, setRepair] = useState(false);
  const frequencyOnly = useMutation(api.calibration.frequencyOnly);
  if (data === null) return <p>That Receiver doesn't exist.</p>;
  if (!data || !fleet) return null;
  const { receiver: r, status, running } = data;
  const row = fleet.find((f) => f.receiver._id === r._id);
  const pending = r.appliedV !== r.configV && r.status === "active";

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-lg">{r.name}</h1>
        {row && <StateChip state={row.state} reasons={row.reasons} />}
        <ConfigStateChip receiver={r} now={now} />
        <span className="num text-sm text-muted">
          app {status?.appVersion ?? "—"} · HackRF {r.hackrfSerial ?? "unknown"}
          {status?.snapshot?.hackrf.firmware
            ? ` (firmware ${status.snapshot.hackrf.firmware})`
            : ""}{" "}
          · {hackrfLabel(status?.snapshot ?? null)}
        </span>
        <SetupBadge gaps={status?.snapshot?.setupGaps ?? []} />
        <Actions receiver={r} onRepair={() => setRepair(true)} />
      </div>
      {r.status === "removed" && (
        <p className="rounded-md border border-line p-3">
          Removed {r.removedAt ? dateTime(r.removedAt) : ""}. Re-pair to bring it back with its
          history.
        </p>
      )}
      {pending && running && (
        <p role="status" className="rounded-md border border-warn/45 bg-warn/10 p-3 text-sm">
          {r.rejected?.v === r.configV
            ? `v${r.configV} was rejected (${r.rejected.reason}); the phone still runs v${running.v}.`
            : `v${r.configV} is pending (${relative(r.configAt, now)}); the phone still runs v${running.v}.`}
        </p>
      )}
      <CalibrationPanel />
      {status?.book.moved && r.config.position.mode === "pinned" && (
        <DriftAlarm receiver={r} status={status} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <HealthPanel detail={data} reasons={row?.reasons ?? []} now={now} />
        <div className="grid content-start gap-4">
          <ConfigSection
            title="Identity"
            detail={data}
            fields={["name", "notes"]}
            view={
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Name</dt>
                <dd>{r.config.name}</dd>
                <dt className="text-muted">Notes</dt>
                <dd>{r.config.notes || "—"}</dd>
              </dl>
            }
            editor={(d, set) => (
              <>
                <Label>
                  Name
                  <Input
                    value={d.name}
                    maxLength={40}
                    onChange={(e) => set({ name: e.target.value })}
                  />
                </Label>
                <Label>
                  Notes
                  <Input
                    value={d.notes}
                    maxLength={200}
                    onChange={(e) => set({ notes: e.target.value })}
                  />
                </Label>
              </>
            )}
          />
          <ConfigSection
            title="Gains"
            detail={data}
            fields={["lnaDb", "vgaDb", "amp"]}
            view={
              <p className="num text-sm">
                LNA {r.config.lnaDb} dB · VGA {r.config.vgaDb} dB · RF amp{" "}
                {r.config.amp ? "on" : "off"}
              </p>
            }
            editor={(d, set) => (
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={d.amp}
                    onChange={(e) => set({ amp: e.target.checked })}
                  />
                  RF amp: +3–4 dB on faint signals for a Receiver in a quiet spot
                </label>
                <Label>
                  LNA (dB)
                  <select
                    className="h-9 rounded-md border border-line bg-surface px-2"
                    value={d.lnaDb}
                    onChange={(e) => set({ lnaDb: Number(e.target.value) })}
                  >
                    {LNA_STEPS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Label>
                <Label>
                  VGA (dB)
                  <select
                    className="h-9 rounded-md border border-line bg-surface px-2"
                    value={d.vgaDb}
                    onChange={(e) => set({ vgaDb: Number(e.target.value) })}
                  >
                    {VGA_STEPS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Label>
              </div>
            )}
          />
          <ConfigSection
            title="Calibration"
            detail={data}
            fields={["offsetDb", "offsetSource", "ppm"]}
            view={
              <div className="grid gap-1 text-sm">
                <p className="num">
                  Offset {r.config.offsetDb > 0 ? "+" : ""}
                  {r.config.offsetDb} dB ({r.config.offsetSource}) · {r.config.ppm > 0 ? "+" : ""}
                  {r.config.ppm} ppm
                </p>
                <p className="text-muted">
                  {r.calibration
                    ? `Calibrated ${dateTime(r.calibration.at)} with HackRF ${r.calibration.serial}`
                    : "Never calibrated"}
                  {needsCalibration(r) && " · Recalibrate"}
                </p>
                {r.status === "active" && (
                  <Button
                    size="sm"
                    className="justify-self-start"
                    onClick={() => frequencyOnly({ receiverId: r._id }).catch(toast.error)}
                  >
                    Frequency only
                  </Button>
                )}
              </div>
            }
            editor={(d, set) => (
              <div className="grid grid-cols-2 gap-2">
                <Label>
                  Offset (dB, ±30)
                  <Input
                    type="number"
                    step="0.1"
                    value={d.offsetDb}
                    onChange={(e) =>
                      set({ offsetDb: Number(e.target.value), offsetSource: "manual" })
                    }
                  />
                </Label>
                <Label>
                  Frequency correction (ppm, ±50)
                  <Input
                    type="number"
                    step="0.01"
                    value={d.ppm}
                    onChange={(e) => set({ ppm: Number(e.target.value) })}
                  />
                </Label>
              </div>
            )}
          />
          <PositionSection detail={data} />
        </div>
      </div>
      <VersionHistory detail={data} />
      <Dialog open={repair} onOpenChange={setRepair}>
        {repair && <PairDialogContent repair={{ id: r._id, name: r.name }} />}
      </Dialog>
    </div>
  );
}

function Actions({
  receiver: r,
  onRepair,
}: {
  receiver: Detail["receiver"];
  onRepair: () => void;
}) {
  const setPaused = useMutation(api.receivers.setPaused);
  const remove = useMutation(api.receivers.remove);
  const navigate = useNavigate();
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <div className="ml-auto flex flex-wrap gap-2">
      {r.status === "active" && (
        <Button
          onClick={() =>
            setPaused({ receiverId: r._id, paused: !r.pausedByOperator }).catch(toast.error)
          }
        >
          {r.pausedByOperator ? "Resume" : "Pause"}
        </Button>
      )}
      <Button onClick={onRepair}>Re-pair</Button>
      {r.status !== "removed" && (
        <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
          Remove
        </Button>
      )}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${r.name}?`}
        lines={[
          "The phone is cut off at once.",
          "Its history stays; re-pair it later from Removed.",
        ]}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          await remove({ receiverId: r._id });
          await navigate({ to: "/receivers" });
        }}
      />
    </div>
  );
}

function DriftAlarm({
  receiver: r,
  status,
}: {
  receiver: Detail["receiver"];
  status: Doc<"receiverStatus">;
}) {
  const resolve = useMutation(api.receivers.resolveDrift);
  const pin = r.config.position;
  const away = pin.mode === "pinned" && status.position ? distanceM(status.position, pin) : null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-md border border-warn/45 bg-warn/10 p-3"
    >
      <span className="text-sm">
        <strong>Moved?</strong> GPS has been {away === null ? "far" : metres(away)} from the pin for
        over 5 minutes; this Receiver's Fixes are flagged.
      </span>
      <Button
        size="sm"
        className="ml-auto"
        onClick={() => resolve({ receiverId: r._id, action: "move" }).catch(toast.error)}
      >
        Move pin to GPS
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => resolve({ receiverId: r._id, action: "keep" }).catch(toast.error)}
      >
        Keep pin
      </Button>
    </div>
  );
}

function HealthPanel({
  detail,
  reasons,
  now,
}: {
  detail: Detail;
  reasons: Doc<"receiverStatus">["reasons"];
  now: number;
}) {
  const since = Math.floor((now - 86_400_000) / 3_600_000) * 3_600_000;
  const faults = useQuery(api.receivers.faultCounts, { receiverId: detail.receiver._id, since });
  const convex = useConvex();
  const [events, setEvents] = useState<{
    rows: Events["page"];
    cursor: string;
    done: boolean;
  } | null>(null);
  const load = async (more: boolean) => {
    const r = await convex.query(api.receivers.events, {
      receiverId: detail.receiver._id,
      paginationOpts: { numItems: 25, cursor: more ? (events?.cursor ?? null) : null },
    });
    setEvents({
      rows: [...(more ? (events?.rows ?? []) : []), ...r.page],
      cursor: r.continueCursor,
      done: r.isDone,
    });
  };
  const s = detail.status;
  const snap = s?.snapshot;
  return (
    <Section title="Health">
      {snap && (
        <p className="text-sm">
          <span className="text-muted">Window: </span>
          {windowLabel(snap.window)}
          {snap.window.mode === "short" && (
            <span className="text-muted">
              {" "}
              (Fixes are unaffected; peak and Occupancy cover only the first 10 s)
            </span>
          )}
        </p>
      )}
      {snap && snap.setupGaps.length > 0 && (
        <p className="text-sm text-warn" data-testid="setup-gaps">
          Setup incomplete: {snap.setupGaps.map((g) => SETUP_GAPS[g]).join(", ")}. The phone keeps
          scanning; fix these on the phone's Status screen.
        </p>
      )}
      {reasons.length === 0 ? (
        <p className="text-muted">
          No active reasons{s?.lastSeenAt ? ` · last seen ${relative(s.lastSeenAt, now)}` : ""}.
        </p>
      ) : (
        <ul className="grid gap-1 text-sm" data-testid="health-reasons">
          {reasons.map((r) => (
            <li key={r.code}>
              <span
                className={
                  r.severity === "critical"
                    ? "text-crit"
                    : r.severity === "warning"
                      ? "text-warn"
                      : "text-muted"
                }
              >
                {r.text}
              </span>
              <span className="text-muted"> · {r.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        <span className="text-muted">Faults in the last 24 h: </span>
        {faults && Object.keys(faults).length > 0 ? (
          <span className="num">
            {Object.entries(faults)
              .map(([code, n]) => `${code} ×${n}`)
              .join(", ")}
          </span>
        ) : (
          "none"
        )}
      </p>
      {s?.snapshot && (
        <p className="num text-xs text-muted">
          battery {Math.round(s.snapshot.battery * 100)}%{s.snapshot.charging ? " ⚡" : ""} ·
          thermal {s.snapshot.thermal} · clock ±{Math.round(s.snapshot.clock.uncertaintyMs)} ms ·
          outbox {s.snapshot.outbox.depth}
        </p>
      )}
      <div>
        <Button size="sm" onClick={() => load(false)}>
          {events ? "Reload events" : "Show event timeline"}
        </Button>
        {events && (
          <ol className="mt-2 grid gap-1 text-xs" data-testid="receiver-events">
            {events.rows.map((e) => (
              <li key={e._id}>
                <span className="num text-muted">{dateTime(e.at)}</span> · {e.text}
              </li>
            ))}
            {!events.done && (
              <li>
                <Button size="sm" variant="ghost" onClick={() => load(true)}>
                  Older
                </Button>
              </li>
            )}
          </ol>
        )}
      </div>
    </Section>
  );
}

/** Read first; Edit opens the fields, Save… shows the diff, and the push writes one version. */
function ConfigSection({
  title,
  detail,
  fields,
  view,
  editor,
  map,
}: {
  title: string;
  detail: Detail;
  fields: (keyof ReceiverConfig)[];
  view: ReactNode;
  editor: (draft: ReceiverConfig, set: (patch: Partial<ReceiverConfig>) => void) => ReactNode;
  map?: (draft: ReceiverConfig | null, set: (patch: Partial<ReceiverConfig>) => void) => ReactNode;
}) {
  const r = detail.receiver;
  const push = useMutation(api.receivers.pushConfig);
  const [draft, setDraft] = useState<ReceiverConfig | null>(null);
  const [confirm, setConfirm] = useState(false);
  const set = (patch: Partial<ReceiverConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const problem = draft && validateReceiverConfig(draft);
  const defaults = receiverConfigDefaults(r.name);
  return (
    <Section
      title={title}
      action={
        !draft &&
        r.status !== "removed" && (
          <Button size="sm" onClick={() => setDraft(r.config)}>
            Edit
          </Button>
        )
      }
    >
      {map?.(draft, set)}
      {draft ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setConfirm(true);
          }}
        >
          {editor(draft, set)}
          {problem && (
            <p role="alert" className="text-crit">
              {problem.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                set(
                  Object.fromEntries(
                    fields.filter((f) => f !== "name").map((f) => [f, defaults[f]]),
                  ),
                )
              }
            >
              Reset to default
            </Button>
            <Button className="ml-auto" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!!problem || receiverConfigDiff(r.config, draft).length === 0}
            >
              Save…
            </Button>
          </div>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={`Push ${title.toLowerCase()} to ${r.name}?`}
            lines={receiverConfigDiff(r.config, draft)}
            warnings={
              detail.status && detail.status.state === "offline"
                ? [`${r.name} is offline: it gets this when it reconnects.`]
                : []
            }
            confirmLabel="Push"
            onConfirm={async () => {
              await push({ changes: [{ receiverId: r._id, expectedV: r.configV, values: draft }] });
              setDraft(null);
            }}
          />
        </form>
      ) : (
        view
      )}
    </Section>
  );
}

function PositionSection({ detail }: { detail: Detail }) {
  const r = detail.receiver;
  const gps = detail.status?.position ?? null;
  const pos = r.config.position;
  return (
    <ConfigSection
      title="Position"
      detail={detail}
      fields={["position"]}
      view={
        <p className="num text-sm">
          {pos.mode === "pinned" ? `Pinned at ${coords(pos.lat, pos.lng)}` : "Live GPS"}
          {gps && ` · GPS ${coords(gps.lat, gps.lng)} ±${Math.round(gps.accuracyM)} m`}
        </p>
      }
      map={(draft, set) => {
        const p = (draft ?? r.config).position;
        return (
          <div className="relative h-56 overflow-hidden rounded-md border border-line bg-surface-2">
            {draft && (
              <p className="absolute top-2 left-2 z-10 rounded bg-surface px-2 py-0.5 text-xs shadow">
                Click to pin here
              </p>
            )}
            <Suspense fallback={null}>
              <MapCanvas
                receivers={
                  p.mode === "pinned"
                    ? [
                        {
                          id: r._id,
                          name: r.name,
                          state: "idle",
                          pinned: true,
                          lat: p.lat,
                          lng: p.lng,
                        },
                      ]
                    : []
                }
                fixes={[]}
                hull={[]}
                dots={gps ? [{ ...gps, colour: "#8a94a1" }] : []}
                onMapClick={
                  draft
                    ? (at) => set({ position: { mode: "pinned", lat: at.lat, lng: at.lng } })
                    : undefined
                }
              />
            </Suspense>
          </div>
        );
      }}
      editor={(d, set) => (
        <>
          <fieldset className="flex gap-4 text-sm">
            <legend className="sr-only">Position mode</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={d.position.mode === "live"}
                onChange={() => set({ position: { mode: "live" } })}
              />{" "}
              Live GPS
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={d.position.mode === "pinned"}
                onChange={() =>
                  set({ position: { mode: "pinned", lat: gps?.lat ?? 0, lng: gps?.lng ?? 0 } })
                }
              />{" "}
              Pinned
            </label>
          </fieldset>
          {d.position.mode === "pinned" && (
            <div className="grid grid-cols-2 gap-2">
              <Label>
                Latitude
                <Input
                  type="number"
                  step="0.00001"
                  value={d.position.lat}
                  onChange={(e) =>
                    set({
                      position: {
                        ...(d.position as { mode: "pinned"; lat: number; lng: number }),
                        lat: Number(e.target.value),
                      },
                    })
                  }
                />
              </Label>
              <Label>
                Longitude
                <Input
                  type="number"
                  step="0.00001"
                  value={d.position.lng}
                  onChange={(e) =>
                    set({
                      position: {
                        ...(d.position as { mode: "pinned"; lat: number; lng: number }),
                        lng: Number(e.target.value),
                      },
                    })
                  }
                />
              </Label>
              {gps && (
                <Button
                  size="sm"
                  className="col-span-2 justify-self-start"
                  onClick={() => set({ position: { mode: "pinned", lat: gps.lat, lng: gps.lng } })}
                >
                  Use current GPS
                </Button>
              )}
            </div>
          )}
        </>
      )}
    />
  );
}

function VersionHistory({ detail }: { detail: Detail }) {
  const r = detail.receiver;
  const page = useQuery(api.receivers.versions, {
    receiverId: r._id,
    paginationOpts: { numItems: 20, cursor: null },
  });
  const restore = useMutation(api.receivers.restoreVersion);
  const [target, setTarget] = useState<number | null>(null);
  if (!page) return null;
  const chosen = page.page.find((p) => p.v === target);
  return (
    <Section title="Config history">
      <ol className="-mx-3 divide-y divide-line" data-testid="receiver-versions">
        {page.page.map((v) => (
          <li key={v._id} className="grid gap-0.5 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="num font-medium">v{v.v}</span>
              <span>{v.author}</span>
              <span className="text-muted">{dateTime(v.at)}</span>
              {v.v === r.appliedV && <span className="text-xs text-ok">running</span>}
              {v.v === r.configV ? (
                <span className="ml-auto text-xs text-muted">desired</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setTarget(v.v)}
                >
                  Restore…
                </Button>
              )}
            </div>
            <span className="num text-xs text-muted">
              {v.diff.length > 0 ? v.diff.join("; ") : "Initial config"}
            </span>
          </li>
        ))}
      </ol>
      {chosen && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          title={`Restore v${chosen.v}?`}
          lines={receiverConfigDiff(r.config, chosen.values)}
          confirmLabel="Restore"
          onConfirm={() => restore({ receiverId: r._id, v: chosen.v, expectedV: r.configV })}
        />
      )}
    </Section>
  );
}
