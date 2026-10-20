import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  describeOrgConfig,
  ENVIRONMENT_N,
  FIX_WINDOW_MS,
  ORG_CONFIG_DEFAULTS,
  type OrgConfig,
  passesInFixWindow,
  passMs,
  planWidthHz,
  presetOf,
  SWEEP_PRESETS,
  type SweepPreset,
  sameValue,
  sortSegments,
  TUNE_MS,
  tuneCount,
  validateOrgConfig,
} from "@/convex/lib/config";
import { errorCode } from "@/convex/lib/errors";
import { burstLengthMs, listeningWindowMs, periodMs } from "@/convex/lib/schedule";
import { LearningBanner } from "../components/learning-banner";
import { Button } from "../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Input, Label } from "../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { toast } from "../components/ui/toast";
import {
  CADENCE_OPTIONS,
  type CadenceKey,
  cadenceKey,
  formatSeconds,
  parseCadence,
  revertOf,
} from "../lib/cadence";
import { orgEffects } from "../lib/configEffects";
import { dateTime } from "../lib/time";
import { pct, useUsage } from "../lib/usage";
import { Section } from "./settings";

type Editor = "sweep" | "environment" | "reference";
type Pending = { values: OrgConfig; baseV: number; title: string; restoreV?: number };
type Versions = FunctionReturnType<typeof api.orgConfig.versions>;

const same = sameValue;
const mhzIn = (hz: number) => String(Number((hz / 1e6).toFixed(4)));

export function OrganizationPage() {
  const config = useQuery(api.orgConfig.current);
  const live = useQuery(api.live.run);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const usage = useUsage();
  if (!config || !live) return null;
  const c = config.values;
  const d = describeOrgConfig(c);
  const channels = Math.round(planWidthHz(c) / c.rasterHz);
  const isDefault = (keys: (keyof OrgConfig)[]) =>
    keys.every((k) => same(c[k], ORG_CONFIG_DEFAULTS[k]));

  const tile = (
    editor: Editor,
    label: string,
    value: string,
    sub: string,
    keys: (keyof OrgConfig)[],
    sweep = false,
  ) => (
    <Popover
      open={open === label && pending === null}
      onOpenChange={(o) => setOpen(o ? label : null)}
    >
      <PopoverTrigger
        aria-label={`${label}: ${value}`}
        className="grid gap-1 rounded-lg border border-line bg-surface p-3 text-left hover:border-accent/50"
      >
        <span className="flex items-center gap-2 text-xs tracking-wide text-muted uppercase">
          {label}
          {sweep && <span className="rounded bg-surface-2 px-1 normal-case">Sweep plan</span>}
          {isDefault(keys) && (
            <span className="rounded bg-surface-2 px-1 normal-case">default</span>
          )}
        </span>
        <span className="num text-base font-medium">{value}</span>
        <span className="text-xs text-muted">{sub}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,26rem)]">
        <ConfigEditor
          editor={editor}
          current={c}
          baseV={config.v}
          onSave={(values, title) => {
            setPending({ values, baseV: config.v, title });
            setOpen(null);
          }}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="sr-only">Organization</h1>
      <LearningBanner />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {tile("sweep", "Sweep plan", d.sweepPlan, `${formatSeconds(passMs(c))} per pass`, [
          "segments",
        ])}
        {tile(
          "sweep",
          "Channel raster",
          d.raster,
          `${channels.toLocaleString()} Channels in the plan`,
          ["rasterHz"],
          true,
        )}
        {tile(
          "sweep",
          "Cadence",
          d.cadence,
          usage ? `≈${Math.round(usage.calls / 1000)}k calls a month` : "",
          ["cadence"],
          true,
        )}
        {tile("environment", "Propagation environment", d.environment, "Used from the next Scan", [
          "environment",
        ])}
        {tile(
          "reference",
          "Calibration reference",
          d.reference,
          "Required for calibration sessions",
          ["referenceHz"],
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Section title="Current load">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Pass</dt>
            <dd className="num">
              {tuneCount(c)} tunes × {TUNE_MS} ms = {formatSeconds(passMs(c))}
            </dd>
            <dt className="text-muted">Fix window</dt>
            <dd className="num">
              {passesInFixWindow(c)} passes in {formatSeconds(FIX_WINDOW_MS)}
            </dd>
            <dt className="text-muted">Listening</dt>
            <dd className="num">
              {formatSeconds(listeningWindowMs(periodMs(c.cadence)))} of each Scan
            </dd>
            <dt className="text-muted">Channels</dt>
            <dd className="num">{channels.toLocaleString()}</dd>
            <dt className="text-muted">Path loss</dt>
            <dd className="num">n = {c.environment.n}</dd>
            <dt className="text-muted">Projected</dt>
            <dd>
              {usage ? (
                <span className={usage.warn ? "text-warn" : ""}>
                  {pct(usage.pct.calls)} of calls · {pct(usage.pct.io)} of I/O ·{" "}
                  {pct(usage.pct.storage)} of storage
                </span>
              ) : (
                "—"
              )}
            </dd>
          </dl>
        </Section>
        <Timeline
          currentV={config.v}
          onRestore={(v, values) =>
            setPending({ values, baseV: config.v, title: `Restore v${v}?`, restoreV: v })
          }
        />
      </div>
      {pending && (
        <SaveConfirm
          pending={pending}
          current={c}
          currentV={config.v}
          runNumber={live.run?.number ?? null}
          onRebase={(baseV) => setPending({ ...pending, baseV })}
          onDone={() => setPending(null)}
        />
      )}
    </div>
  );
}

function ConfigEditor({
  editor,
  current,
  onSave,
}: {
  editor: Editor;
  current: OrgConfig;
  baseV: number;
  onSave: (values: OrgConfig, title: string) => void;
}) {
  const [draft, setDraft] = useState<OrgConfig>(current);
  const problem = validateOrgConfig({ ...draft, segments: sortSegments(draft.segments) });
  const usage = useUsage(draft);
  const set = (patch: Partial<OrgConfig>) => setDraft({ ...draft, ...patch });
  const reset = (keys: (keyof OrgConfig)[]) =>
    setDraft({ ...draft, ...Object.fromEntries(keys.map((k) => [k, ORG_CONFIG_DEFAULTS[k]])) });
  const keys: Record<Editor, (keyof OrgConfig)[]> = {
    sweep: ["segments", "rasterHz", "cadence"],
    environment: ["environment"],
    reference: ["referenceHz"],
  };
  const title = {
    sweep: "Sweep plan",
    environment: "Propagation environment",
    reference: "Calibration reference",
  }[editor];

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(
          { ...draft, segments: sortSegments(draft.segments) },
          `Save ${title.toLowerCase()}?`,
        );
      }}
    >
      <p className="font-medium">{title}</p>
      {editor === "sweep" && (
        <>
          <SegmentsEditor segments={draft.segments} onChange={(segments) => set({ segments })} />
          <Label>
            Channel raster
            <select
              className="h-9 rounded-md border border-line bg-surface px-2"
              value={draft.rasterHz}
              onChange={(e) => set({ rasterHz: Number(e.target.value) as 12_500 | 25_000 })}
            >
              <option value={12_500}>12.5 kHz</option>
              <option value={25_000}>25 kHz</option>
            </select>
          </Label>
          <Label>
            Cadence
            <select
              className="h-9 rounded-md border border-line bg-surface px-2"
              value={cadenceKey(draft.cadence)}
              onChange={(e) =>
                set({
                  cadence: parseCadence(e.target.value as CadenceKey, revertOf(draft.cadence)),
                })
              }
            >
              {CADENCE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </Label>
          {burstLengthMs(draft.cadence) !== null && (
            <Label>
              Then
              <select
                className="h-9 rounded-md border border-line bg-surface px-2"
                value={revertOf(draft.cadence)}
                onChange={(e) =>
                  set({
                    cadence: parseCadence(
                      cadenceKey(draft.cadence),
                      Number(e.target.value) as 5 | 15,
                    ),
                  })
                }
              >
                <option value={5}>Every 5 min</option>
                <option value={15}>Every 15 min</option>
              </select>
            </Label>
          )}
          <p className="text-sm" data-testid="sweep-effects">
            <span className="num">{Math.round(planWidthHz(draft) / 1e6).toLocaleString()}</span> MHz
            · <span className="num">{formatSeconds(passMs(draft))}</span> per pass ·{" "}
            <span className="num">{passesInFixWindow(draft)}</span> passes in the Fix window ·{" "}
            <span className="num">
              {Math.round(planWidthHz(draft) / draft.rasterHz).toLocaleString()}
            </span>{" "}
            Channels
          </p>
        </>
      )}
      {editor === "environment" && (
        <>
          <Label>
            Environment
            <select
              className="h-9 rounded-md border border-line bg-surface px-2"
              value={draft.environment.preset}
              onChange={(e) => {
                const preset = e.target.value as OrgConfig["environment"]["preset"];
                set({
                  environment: {
                    preset,
                    n: preset === "custom" ? draft.environment.n : ENVIRONMENT_N[preset],
                  },
                });
              }}
            >
              <option value="open">Open (n 2.2)</option>
              <option value="suburban">Suburban (n 3.0)</option>
              <option value="urban">Urban (n 3.5)</option>
              <option value="dense">Dense/indoor (n 3.9)</option>
              <option value="custom">Custom</option>
            </select>
          </Label>
          {draft.environment.preset === "custom" && (
            <Label>
              Path-loss exponent n (1.5–6)
              <Input
                type="number"
                step="0.1"
                min="1.5"
                max="6"
                value={draft.environment.n}
                onChange={(e) =>
                  set({ environment: { preset: "custom", n: Number(e.target.value) } })
                }
              />
            </Label>
          )}
          <p className="text-sm text-muted">
            Fixes from the next Scan use n = {draft.environment.n}; the Run continues.
          </p>
        </>
      )}
      {editor === "reference" && (
        <>
          <Label>
            Reference carrier (MHz), blank for none
            <Input
              type="number"
              step="0.0001"
              value={draft.referenceHz === null ? "" : mhzIn(draft.referenceHz)}
              onChange={(e) =>
                set({ referenceHz: e.target.value === "" ? null : Number(e.target.value) * 1e6 })
              }
            />
          </Label>
          <p className="text-sm text-muted">
            A steady carrier near the co-located Receivers, for calibration sessions.
          </p>
        </>
      )}
      {usage && (
        <p className={`text-sm ${usage.warn ? "text-warn" : "text-muted"}`}>
          Projected usage {pct(usage.worst)} of the Free plan.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-crit">
          {problem.message}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={() => reset(keys[editor])}>
          Reset to default
        </Button>
        <Button type="submit" variant="primary" disabled={problem !== null || same(draft, current)}>
          Save…
        </Button>
      </div>
    </form>
  );
}

/** Presets in one tap; otherwise one row per segment, sorted on save. */
function SegmentsEditor({
  segments,
  onChange,
}: {
  segments: OrgConfig["segments"];
  onChange: (segments: OrgConfig["segments"]) => void;
}) {
  const preset = presetOf(segments);
  const setAt = (i: number, patch: Partial<OrgConfig["segments"][number]>) =>
    onChange(segments.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm">Segments</legend>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(SWEEP_PRESETS) as SweepPreset[]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={preset === key ? "primary" : "secondary"}
            aria-pressed={preset === key}
            onClick={() => onChange([...SWEEP_PRESETS[key].segments])}
          >
            {SWEEP_PRESETS[key].label}
          </Button>
        ))}
      </div>
      <ol className="grid max-h-56 gap-1 overflow-y-auto" aria-label="Segments">
        {segments.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: controlled rows; a row is its position
          <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Label>
              <span className="sr-only">Segment {i + 1} </span>Start (MHz)
              <Input
                type="number"
                step="0.0001"
                value={mhzIn(s.startHz)}
                onChange={(e) => setAt(i, { startHz: Number(e.target.value) * 1e6 })}
              />
            </Label>
            <Label>
              <span className="sr-only">Segment {i + 1} </span>End (MHz)
              <Input
                type="number"
                step="0.0001"
                value={mhzIn(s.endHz)}
                onChange={(e) => setAt(i, { endHz: Number(e.target.value) * 1e6 })}
              />
            </Label>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove segment ${i + 1}`}
              disabled={segments.length === 1}
              onClick={() => onChange(segments.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ol>
      <Button
        size="sm"
        className="justify-self-start"
        onClick={() => {
          const last = segments.at(-1);
          const start = Math.min(5990e6, last ? last.endHz : 400e6);
          onChange([...segments, { startHz: start, endHz: Math.min(6000e6, start + 10e6) }]);
        }}
      >
        Add segment
      </Button>
    </fieldset>
  );
}

function SaveConfirm({
  pending,
  current,
  currentV,
  runNumber,
  onRebase,
  onDone,
}: {
  pending: Pending;
  current: OrgConfig;
  currentV: number;
  runNumber: number | null;
  onRebase: (baseV: number) => void;
  onDone: () => void;
}) {
  const save = useMutation(api.orgConfig.save);
  const restore = useMutation(api.orgConfig.restore);
  const usageBefore = useUsage();
  const usageAfter = useUsage(pending.values, { running: runNumber !== null });
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const e = orgEffects({
    before: current,
    after: pending.values,
    runNumber,
    now: Date.now(),
    usageBefore,
    usageAfter,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent title={pending.title}>
        {conflict && (
          <p role="alert" className="rounded-md border border-warn/45 p-2 text-warn">
            A teammate saved v{currentV} while you were editing. The changes below are against their
            version; confirm again if they still look right.
          </p>
        )}
        {e.lines.length === 0 ? (
          <p className="text-muted">Nothing would change.</p>
        ) : (
          <ul className="grid list-disc gap-1 pl-5" aria-label="Changes">
            {e.lines.map((l) => (
              <li key={l} className="num text-sm">
                {l}
              </li>
            ))}
          </ul>
        )}
        {e.effects.length > 0 && (
          <ul className="grid gap-1 rounded-md bg-surface-2 p-3 text-sm" aria-label="Effects">
            {e.effects.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {e.warnings.map((w) => (
          <p key={w} className="text-warn">
            {w}
          </p>
        ))}
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || e.lines.length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                const r = pending.restoreV
                  ? await restore({ v: pending.restoreV, expectedV: pending.baseV })
                  : await save({ expectedV: pending.baseV, values: pending.values });
                toast.success(
                  r.runNumber ? `Saved v${r.v}; Run ${r.runNumber} started` : `Saved v${r.v}`,
                );
                onDone();
              } catch (err) {
                if (errorCode(err) === "CONFIG_CONFLICT") {
                  setConflict(true);
                  onRebase(currentV);
                } else toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {pending.restoreV ? "Restore" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Permanent history: the latest 20 live, older pages one-shot, Restore on each. */
function Timeline({
  currentV,
  onRestore,
}: {
  currentV: number;
  onRestore: (v: number, values: OrgConfig) => void;
}) {
  const first = useQuery(api.orgConfig.versions, {
    paginationOpts: { numItems: 20, cursor: null },
  });
  const convex = useConvex();
  const [older, setOlder] = useState<{
    rows: Versions["page"];
    cursor: string;
    done: boolean;
  } | null>(null);
  if (!first) return null;
  const rows = [...first.page, ...(older?.rows ?? [])];
  const done = older ? older.done : first.isDone;
  return (
    <Section title="Version history">
      <ol className="-mx-3 divide-y divide-line" data-testid="config-timeline">
        {rows.map((v) => (
          <li key={v._id} className="grid gap-1 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="num font-medium">v{v.v}</span>
              <span>{v.author}</span>
              <span className="text-muted">{dateTime(v.at)}</span>
              {v.startedRuns.length > 0 && (
                <span className="text-muted">· started Run {v.startedRuns.join(", ")}</span>
              )}
              {v.v === currentV ? (
                <span className="ml-auto text-xs text-muted">current</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => onRestore(v.v, v.values)}
                >
                  Restore…
                </Button>
              )}
            </div>
            {v.diff.length > 0 ? (
              <ul className="num text-xs text-muted">
                {v.diff.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Initial configuration</p>
            )}
          </li>
        ))}
      </ol>
      {!done && (
        <Button
          size="sm"
          className="justify-self-start"
          onClick={async () => {
            const r = await convex.query(api.orgConfig.versions, {
              paginationOpts: { numItems: 20, cursor: older?.cursor ?? first.continueCursor },
            });
            setOlder({
              rows: [...(older?.rows ?? []), ...r.page],
              cursor: r.continueCursor,
              done: r.isDone,
            });
          }}
        >
          Show older
        </Button>
      )}
    </Section>
  );
}
