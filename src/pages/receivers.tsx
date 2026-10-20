import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  LNA_STEPS,
  type ReceiverConfig,
  receiverConfigDefaults,
  receiverConfigDiff,
  VGA_STEPS,
} from "@/convex/lib/config";
import { CalibrationPanel } from "../components/calibration-panel";
import { Badge, ConfigStateChip, needsCalibration } from "../components/config-state";

import { ConfirmDialog } from "../components/confirm";
import { EmptyState } from "../components/empty-state";
import { StateChip } from "../components/health";
import { PairDialogContent } from "../components/pair-dialog";
import { Button } from "../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Label } from "../components/ui/input";
import { coords } from "../lib/channels";
import { type FleetRow, rolloutState, useFleet } from "../lib/fleet";

import { dateTime, useNow } from "../lib/time";

type PairTarget = { kind: "new" } | { kind: "repair"; id: Id<"receivers">; name: string };
type Field = "lnaDb" | "vgaDb" | "offsetDb" | "ppm";
type Staged = Map<Id<"receivers">, Partial<ReceiverConfig>>;

const DEFAULTS = receiverConfigDefaults("");
const COLUMNS: { field: Field; label: string; unit: string }[] = [
  { field: "lnaDb", label: "LNA", unit: "dB" },
  { field: "vgaDb", label: "VGA", unit: "dB" },
  { field: "offsetDb", label: "Offset", unit: "dB" },
  { field: "ppm", label: "ppm", unit: "" },
];

export function ReceiversPage() {
  const now = useNow(5000);
  const fleet = useFleet(now);
  const all = useQuery(api.receivers.list);
  const push = useMutation(api.receivers.pushConfig);
  const [pair, setPair] = useState<PairTarget | null>(null);
  const [staged, setStaged] = useState<Staged>(new Map());
  const [selected, setSelected] = useState<Set<Id<"receivers">>>(new Set());
  const [editing, setEditing] = useState<{ id: Id<"receivers">; field: Field } | null>(null);
  const [review, setReview] = useState(false);
  const [gains, setGains] = useState(false);
  const [calibrate, setCalibrate] = useState(false);
  const config = useQuery(api.orgConfig.current);
  const releases = useQuery(api.releases.list);
  const startCalibration = useMutation(api.calibration.start);

  if (!fleet || !all) return null;
  const removed = all.filter((r) => r.status === "removed");
  const stage = (id: Id<"receivers">, patch: Partial<ReceiverConfig>) => {
    const next = new Map(staged);
    next.set(id, { ...next.get(id), ...patch });
    setStaged(next);
  };
  const stagedRows = fleet.filter((f) => staged.has(f.receiver._id));
  const changes = stagedRows
    .map((f) => ({ row: f, values: { ...f.receiver.config, ...staged.get(f.receiver._id) } }))
    .filter((c) => receiverConfigDiff(c.row.receiver.config, c.values).length > 0);

  return (
    <div className="grid gap-4 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg">Receivers</h1>
        <div className="flex flex-wrap gap-2">
          <Button disabled={selected.size === 0} onClick={() => setGains(true)}>
            Set gains… {selected.size > 0 && `(${selected.size})`}
          </Button>
          <Button disabled={selected.size < 2} onClick={() => setCalibrate(true)}>
            Calibration session{selected.size >= 2 && ` (${selected.size})`}
          </Button>
          <Button variant="primary" onClick={() => setPair({ kind: "new" })}>
            Pair Receiver
          </Button>
        </div>
      </div>

      <CalibrationPanel />
      {fleet.length === 0 ? (
        <EmptyState title="No Receivers yet">
          Pair a phone with its HackRF: give it a name, then scan the code in the Locarc app.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm" data-testid="receiver-matrix">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selected.size === fleet.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(fleet.map((f) => f.receiver._id)) : new Set(),
                      )
                    }
                  />
                </th>
                <th className="px-3 py-2 font-medium">Receiver</th>
                <th className="px-3 py-2 font-medium">Config</th>
                <th className="px-3 py-2 font-medium">Position</th>
                {COLUMNS.map((c) => (
                  <th key={c.field} className="px-3 py-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Amp</th>
                <th className="px-3 py-2 font-medium">Calibration</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line bg-surface-2 text-muted">
                <td />
                <td className="px-3 py-1.5 text-xs font-medium">Fleet default</td>
                <td />
                <td className="px-3 py-1.5 text-xs">live GPS</td>
                {COLUMNS.map((c) => (
                  <td key={c.field} className="num px-3 py-1.5 text-right text-xs">
                    {DEFAULTS[c.field]}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-xs">{DEFAULTS.amp ? "on" : "off"}</td>
                <td />
              </tr>
              {fleet.map((f) => (
                <MatrixRow
                  key={f.receiver._id}
                  row={f}
                  now={now}
                  staged={staged.get(f.receiver._id)}
                  selected={selected.has(f.receiver._id)}
                  onSelect={(on) => {
                    const next = new Set(selected);
                    if (on) next.add(f.receiver._id);
                    else next.delete(f.receiver._id);
                    setSelected(next);
                  }}
                  editing={editing?.id === f.receiver._id ? editing.field : null}
                  onEdit={(field) => setEditing(field ? { id: f.receiver._id, field } : null)}
                  onStage={(patch) => stage(f.receiver._id, patch)}
                  onRepair={() =>
                    setPair({ kind: "repair", id: f.receiver._id, name: f.receiver.name })
                  }
                  release={releases?.promoted[0] ?? null}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {removed.length > 0 && (
        <details className="rounded-lg border border-line bg-surface">
          <summary className="flex cursor-pointer items-center gap-1 px-3 py-2 text-muted">
            <ChevronRight className="size-4" /> Removed ({removed.length})
          </summary>
          <ul className="divide-y divide-line border-t border-line" data-testid="removed-receivers">
            {removed.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="flex-1 font-medium">{r.name}</span>
                <span className="text-muted">
                  removed {r.removedAt ? dateTime(r.removedAt) : ""}
                </span>
                <Button
                  size="sm"
                  onClick={() => setPair({ kind: "repair", id: r._id, name: r.name })}
                >
                  Re-pair
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {changes.length > 0 && (
        <section
          className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-3 border-t border-line bg-surface px-4 py-3 shadow-lg"
          aria-label="Staged changes"
        >
          <span className="text-sm">
            <span className="num">{changes.length}</span> staged change
            {changes.length > 1 ? "s" : ""} on {changes.map((c) => c.row.receiver.name).join(", ")}
          </span>
          <Button className="ml-auto" variant="ghost" onClick={() => setStaged(new Map())}>
            Discard
          </Button>
          <Button variant="primary" onClick={() => setReview(true)}>
            Review &amp; push
          </Button>
        </section>
      )}

      <ConfirmDialog
        open={review}
        onOpenChange={setReview}
        title="Push config?"
        lines={changes.flatMap((c) =>
          receiverConfigDiff(c.row.receiver.config, c.values).map(
            (l) => `${c.row.receiver.name}: ${l}`,
          ),
        )}
        warnings={changes
          .filter((c) => c.row.state === "offline")
          .map((c) => `${c.row.receiver.name} is offline: it gets this when it reconnects.`)}
        confirmLabel={`Push to ${changes.length} Receiver${changes.length > 1 ? "s" : ""}`}
        onConfirm={async () => {
          await push({
            changes: changes.map((c) => ({
              receiverId: c.row.receiver._id,
              expectedV: c.row.receiver.configV,
              values: c.values,
            })),
          });
          setStaged(new Map());
        }}
      />

      <ConfirmDialog
        open={calibrate}
        onOpenChange={setCalibrate}
        title="Start a calibration session?"
        lines={[
          `Co-located: ${fleet
            .filter((f) => selected.has(f.receiver._id))
            .map((f) => f.receiver.name)
            .join(", ")}.`,
          "Their scanning pauses about 30 s while each measures the reference carrier.",
          config?.values.referenceHz
            ? `Reference: ${(config.values.referenceHz / 1e6).toFixed(4)} MHz.`
            : "No reference carrier is set (Settings → Organization).",
        ]}
        confirmLabel="Start measuring"
        onConfirm={async () => {
          await startCalibration({ receivers: [...selected] });
          setSelected(new Set());
        }}
      />

      <SetGainsDialog
        open={gains}
        onOpenChange={setGains}
        onApply={(lnaDb, vgaDb, amp) => {
          const next = new Map(staged);
          for (const id of selected) next.set(id, { ...next.get(id), lnaDb, vgaDb, amp });
          setStaged(next);
          setGains(false);
        }}
      />

      <Dialog open={pair !== null} onOpenChange={(open) => !open && setPair(null)}>
        {pair && (
          <PairDialogContent
            key={pair.kind === "repair" ? pair.id : "new"}
            repair={pair.kind === "repair" ? { id: pair.id, name: pair.name } : undefined}
          />
        )}
      </Dialog>
    </div>
  );
}

function MatrixRow({
  row,
  now,
  staged,
  selected,
  onSelect,
  editing,
  onEdit,
  onStage,
  onRepair,
  release,
}: {
  row: FleetRow;
  now: number;
  staged?: Partial<ReceiverConfig>;
  selected: boolean;
  onSelect: (on: boolean) => void;
  editing: Field | null;
  onEdit: (field: Field | null) => void;
  onStage: (patch: Partial<ReceiverConfig>) => void;
  onRepair: () => void;
  release: { versionCode: number; minSupported: number | null } | null;
}) {
  const { receiver: r, status, state, reasons } = row;
  const update = rolloutState(status?.snapshot?.appVersionCode, release);
  const pos = r.config.position;
  const running = r.running?.values;
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Select ${r.name}`}
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />
      </td>
      <td className="px-3 py-2">
        <Link
          to="/receivers/$receiverId"
          params={{ receiverId: r._id }}
          className="font-medium hover:underline"
        >
          {r.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap gap-1">
          <StateChip state={state} reasons={reasons} />
          {status?.book.moved && <Badge tone="warn">Moved?</Badge>}
          {needsCalibration(r) && <Badge tone="muted">Recalibrate</Badge>}
          {update && update !== "Up to date" && <Badge tone="warn">{update}</Badge>}
          {r.status === "pending" && (
            <Button size="sm" variant="ghost" onClick={onRepair}>
              New code
            </Button>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <ConfigStateChip receiver={r} now={now} />
      </td>
      <td className="num px-3 py-2 text-xs whitespace-nowrap">
        {pos.mode === "pinned"
          ? `pinned ${coords(pos.lat, pos.lng)}`
          : status?.position
            ? `GPS ±${Math.round(status.position.accuracyM)} m`
            : "no position"}
      </td>
      {COLUMNS.map((c) => {
        const desired = r.config[c.field];
        const value = staged?.[c.field] ?? desired;
        const runs = running && running[c.field] !== desired ? running[c.field] : null;
        const isStaged = staged?.[c.field] !== undefined && staged[c.field] !== desired;
        return (
          <td
            key={c.field}
            className={cn(
              "num px-3 py-2 text-right whitespace-nowrap",
              (c.field === "lnaDb" || c.field === "vgaDb") &&
                value !== DEFAULTS[c.field] &&
                "bg-accent-soft/60",
              isStaged && "bg-warn/15",
            )}
          >
            {editing === c.field ? (
              <CellEditor
                field={c.field}
                label={`${c.label} for ${r.name}`}
                value={value}
                onDone={(v) => {
                  if (v !== undefined) onStage({ [c.field]: v });
                  onEdit(null);
                }}
              />
            ) : (
              <button
                type="button"
                aria-label={`${c.label} for ${r.name}: ${value}`}
                className="rounded px-1 hover:bg-surface-2"
                onClick={() => onEdit(c.field)}
                disabled={r.status === "pending"}
              >
                {isStaged && <s className="mr-1 text-muted">{desired}</s>}
                {value}
              </button>
            )}
            {runs !== null && <div className="text-xs text-muted">runs {runs}</div>}
          </td>
        );
      })}
      <AmpCell receiver={r} staged={staged?.amp} running={running?.amp} onStage={onStage} />
      <td className="px-3 py-2 text-xs whitespace-nowrap text-muted">
        {r.calibration ? `${dateTime(r.calibration.at)}` : "never"}
        {r.config.offsetSource === "manual" && <span className="ml-1">· manual</span>}
      </td>
    </tr>
  );
}

/** The RF amp: one click stages the flip; the struck-through value is what's pushed now. */
function AmpCell({
  receiver: r,
  staged,
  running,
  onStage,
}: {
  receiver: { name: string; status: string; config: ReceiverConfig };
  staged: boolean | undefined;
  running: boolean | undefined;
  onStage: (patch: Partial<ReceiverConfig>) => void;
}) {
  const desired = r.config.amp;
  const value = staged ?? desired;
  const isStaged = staged !== undefined && staged !== desired;
  const word = (on: boolean) => (on ? "on" : "off");
  return (
    <td
      className={cn(
        "px-3 py-2 whitespace-nowrap",
        value !== DEFAULTS.amp && "bg-accent-soft/60",
        isStaged && "bg-warn/15",
      )}
    >
      <button
        type="button"
        aria-label={`RF amp for ${r.name}: ${word(value)}`}
        aria-pressed={value}
        className="rounded px-1 hover:bg-surface-2"
        disabled={r.status === "pending"}
        onClick={() => onStage({ amp: !value })}
      >
        {isStaged && <s className="mr-1 text-muted">{word(desired)}</s>}
        {word(value)}
      </button>
      {running !== undefined && running !== desired && (
        <div className="text-xs text-muted">runs {word(running)}</div>
      )}
    </td>
  );
}

function CellEditor({
  field,
  label,
  value,
  onDone,
}: {
  field: Field;
  label: string;
  value: number;
  onDone: (v?: number) => void;
}) {
  if (field === "lnaDb" || field === "vgaDb") {
    const steps = field === "lnaDb" ? LNA_STEPS : VGA_STEPS;
    return (
      <select
        aria-label={label}
        // biome-ignore lint/a11y/noAutofocus: opened by the Operator clicking this cell
        autoFocus
        className="h-7 rounded border border-line bg-surface px-1"
        defaultValue={value}
        onChange={(e) => onDone(Number(e.target.value))}
        onBlur={() => onDone()}
      >
        {steps.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={label}
      // biome-ignore lint/a11y/noAutofocus: opened by the Operator clicking this cell
      autoFocus
      type="number"
      step="0.1"
      className="h-7 w-20 rounded border border-line bg-surface px-1 text-right"
      defaultValue={value}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(Number(e.currentTarget.value));
        if (e.key === "Escape") onDone();
      }}
      onBlur={(e) => onDone(Number(e.currentTarget.value))}
    />
  );
}

function SetGainsDialog({
  open,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onApply: (lna: number, vga: number, amp: boolean) => void;
}) {
  const [lna, setLna] = useState(DEFAULTS.lnaDb);
  const [vga, setVga] = useState(DEFAULTS.vgaDb);
  const [amp, setAmp] = useState(DEFAULTS.amp);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Set gains"
        description="Staged for the selected Receivers; nothing is pushed until Review & push."
      >
        <div className="grid grid-cols-2 gap-3">
          <Label>
            LNA (dB)
            <select
              className="h-9 rounded-md border border-line bg-surface px-2"
              value={lna}
              onChange={(e) => setLna(Number(e.target.value))}
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
              value={vga}
              onChange={(e) => setVga(Number(e.target.value))}
            >
              {VGA_STEPS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={amp} onChange={(e) => setAmp(e.target.checked)} />
          RF amp (+3–4 dB on faint signals; off unless the spot is quiet)
        </label>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary" onClick={() => onApply(lna, vga, amp)}>
            Stage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
