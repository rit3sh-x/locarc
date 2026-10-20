import { useMutation, useQuery } from "convex/react";
import { lazy, Suspense, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { MIN_SCANS_FOR_N } from "@/convex/lib/fieldTest";
import { ConfirmDialog } from "../components/confirm";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { toast } from "../components/ui/toast";
import { channelColour, coords, metres, mhz } from "../lib/channels";
import { orgEffects } from "../lib/configEffects";
import { useBoard } from "../lib/emitters";
import { useFleet } from "../lib/fleet";
import { receiverMarkers } from "../lib/mapData";
import { dateTime, useNow } from "../lib/time";
import { useUsage } from "../lib/usage";
import { Section } from "./settings";

const MapCanvas = lazy(() => import("../components/map/map-canvas"));

export function FieldTestsPage() {
  const tests = useQuery(api.fieldTests.list);
  const board = useBoard();
  const watchlist = useQuery(api.watchlist.list);
  const fleet = useFleet(useNow(30_000));
  const create = useMutation(api.fieldTests.create);
  const [truth, setTruth] = useState<{ lat: number; lng: number } | null>(null);
  const [apply, setApply] = useState<Doc<"fieldTests"> | null>(null);
  if (!tests || !board || !watchlist || !fleet) return null;
  const channels = [
    ...new Set([
      ...watchlist.map((w) => w.freqHz),
      ...board.rows.filter((r) => r.located).map((r) => r.freqHz),
    ]),
  ].sort((a, b) => a - b);
  const names = new Map(watchlist.map((w) => [w.freqHz, w.name]));

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="sr-only">Field tests</h1>
      <Section title="New field test">
        <p className="text-sm text-muted">
          Put a transmitter at a known spot on a known frequency. Each Scan's position is scored
          against it, and after {MIN_SCANS_FOR_N} Scans you get the path-loss exponent that fits
          this environment.
        </p>
        <form
          className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          action={async (form) => {
            const lat = Number(form.get("lat"));
            const lng = Number(form.get("lng"));
            try {
              await create({
                label: String(form.get("label")),
                freqHz: Number(form.get("mhz")) * 1e6,
                truth: { lat, lng },
              });
              setTruth(null);
              toast.success("Field test started");
            } catch (e) {
              toast.error(e);
            }
          }}
        >
          <div className="grid content-start gap-3">
            <Label>
              Name
              <Input
                name="label"
                required
                maxLength={60}
                placeholder="e.g. Gate radio at the main gate"
              />
            </Label>
            <Label>
              Frequency (MHz)
              <Input name="mhz" type="number" step="0.0001" required list="field-test-channels" />
            </Label>
            <datalist id="field-test-channels">
              {channels.map((c) => (
                <option key={c} value={(c / 1e6).toFixed(4)}>
                  {names.get(c) ?? "unnamed"}
                </option>
              ))}
            </datalist>
            <div className="grid grid-cols-2 gap-2">
              <Label>
                True latitude
                <Input
                  name="lat"
                  type="number"
                  step="0.000001"
                  required
                  value={truth?.lat ?? ""}
                  onChange={(e) => setTruth({ lat: Number(e.target.value), lng: truth?.lng ?? 0 })}
                />
              </Label>
              <Label>
                True longitude
                <Input
                  name="lng"
                  type="number"
                  step="0.000001"
                  required
                  value={truth?.lng ?? ""}
                  onChange={(e) => setTruth({ lat: truth?.lat ?? 0, lng: Number(e.target.value) })}
                />
              </Label>
            </div>
            <Button type="submit" variant="primary" className="justify-self-start">
              Start field test
            </Button>
          </div>
          <div className="relative h-64 overflow-hidden rounded-md border border-line bg-surface-2">
            <p className="absolute top-2 left-2 z-10 rounded bg-surface px-2 py-0.5 text-xs shadow">
              Click where the transmitter is
            </p>
            <Suspense fallback={null}>
              <MapCanvas
                receivers={receiverMarkers(fleet)}
                fixes={[]}
                hull={[]}
                dots={truth ? [{ ...truth, colour: "#c2362b" }] : []}
                onMapClick={setTruth}
              />
            </Suspense>
          </div>
        </form>
      </Section>

      <Section title="Field tests">
        {tests.length === 0 ? (
          <p className="text-muted">None yet.</p>
        ) : (
          <ul className="-mx-3 divide-y divide-line" data-testid="field-tests">
            {tests.map((t) => (
              <FieldTestRow
                key={t._id}
                test={t}
                name={names.get(t.freqHz)}
                onApply={() => setApply(t)}
              />
            ))}
          </ul>
        )}
      </Section>
      {apply && <ApplyN test={apply} onDone={() => setApply(null)} />}
    </div>
  );
}

function FieldTestRow({
  test: t,
  name,
  onApply,
}: {
  test: Doc<"fieldTests">;
  name?: string;
  onApply: () => void;
}) {
  const stop = useMutation(api.fieldTests.stop);
  const r = t.result;
  return (
    <li className="grid gap-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="size-3 rounded-sm"
          style={{ background: channelColour(t.freqHz) }}
          aria-hidden
        />
        <span className="font-medium">{t.label}</span>
        <span className="num text-sm text-muted">
          {mhz(t.freqHz)}
          {name ? ` · ${name}` : ""} · truth {coords(t.truth.lat, t.truth.lng)}
        </span>
        <span className="ml-auto text-xs text-muted">
          {t.endedAt ? `ended ${dateTime(t.endedAt)}` : `running since ${dateTime(t.startedAt)}`} ·{" "}
          {t.by}
        </span>
      </div>
      <p className="text-sm">
        {r ? (
          <>
            Median Fix error <span className="num">{metres(r.medianErrorM)}</span> over{" "}
            <span className="num">{r.scans}</span> Scan
            {r.scans === 1 ? "" : "s"}
            {r.n !== null && r.nSpread !== null ? (
              <>
                {" "}
                · best-fit n{" "}
                <span className="num">
                  {r.n.toFixed(2)} ± {r.nSpread.toFixed(2)}
                </span>
              </>
            ) : (
              <span className="text-muted"> · best-fit n after {MIN_SCANS_FOR_N} Scans</span>
            )}
          </>
        ) : (
          <span className="text-muted">Waiting for the first Scan to locate it…</span>
        )}
      </p>
      <div className="flex gap-2">
        {t.endedAt === null && (
          <Button size="sm" onClick={() => stop({ testId: t._id }).catch(toast.error)}>
            Stop
          </Button>
        )}
        {r?.n != null && (
          <Button size="sm" variant="primary" onClick={onApply}>
            Apply n = {Math.min(6, Math.max(1.5, Math.round(r.n * 10) / 10))}…
          </Button>
        )}
      </div>
    </li>
  );
}

function ApplyN({ test, onDone }: { test: Doc<"fieldTests">; onDone: () => void }) {
  const config = useQuery(api.orgConfig.current);
  const live = useQuery(api.live.run);
  const applyN = useMutation(api.fieldTests.applyN);
  const usage = useUsage();
  if (!config || !live || test.result?.n == null) return null;
  const n = Math.min(6, Math.max(1.5, Math.round(test.result.n * 10) / 10));
  const after = { ...config.values, environment: { preset: "custom" as const, n } };
  const e = orgEffects({
    before: config.values,
    after,
    runNumber: live.run?.number ?? null,
    now: Date.now(),
    usageBefore: usage,
    usageAfter: usage,
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onDone()}
      title={`Apply n = ${n}?`}
      lines={[...e.lines, ...e.effects]}
      confirmLabel="Apply"
      onConfirm={() => applyN({ testId: test._id, expectedV: config.v })}
    />
  );
}
