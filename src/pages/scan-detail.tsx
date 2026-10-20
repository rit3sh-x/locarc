import { getRouteApi, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { slices } from "@/convex/lib/config";
import { decodeReading } from "@/convex/lib/readingCodec";
import { describeCadence } from "@/convex/lib/schedule";
import { FixFlags } from "../components/fix-flags";
import { ScanStateChip } from "../components/scan-state";
import { Button } from "../components/ui/button";
import { formatSeconds } from "../lib/cadence";
import { channelColours, coords, metres, mhz } from "../lib/channels";
import { boardRows, occupancyText, spanText } from "../lib/emitters";
import { boardCsv, download, scanJson } from "../lib/exports";
import { dateTime } from "../lib/time";

const route = getRouteApi("/app/scans/$run/$k");

export function ScanDetailPage() {
  const params = route.useParams();
  const runNumber = Number(params.run);
  const k = Number(params.k) - 1;
  const found = useQuery(api.scans.byNumber, { run: runNumber, k });
  const readings = useQuery(api.scans.readings, found ? { scanId: found.scan._id } : "skip");
  const fixes = useQuery(api.fixes.byScan, found ? { scanId: found.scan._id } : "skip");
  const board = useQuery(api.emitters.boardOf, found ? { scanId: found.scan._id } : "skip");

  if (found === null)
    return (
      <div className="grid gap-2">
        <h1 className="text-lg">Scan not found</h1>
        <p className="text-muted">
          No Scan {params.k} in Run {params.run}.
        </p>
      </div>
    );

  if (!found || !readings || !fixes || board === undefined) return null;
  const { scan, run } = found;
  const name = `locarc-run${run.number}-scan${k + 1}`;
  const rows = boardRows(board).sort(
    (a, b) => Number(b.located) - Number(a.located) || a.freqHz - b.freqHz,
  );
  const colour = channelColours(rows.filter((r) => r.located).map((r) => r.freqHz));
  const stored = new Set(fixes.map((f) => f.freqHz));

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg">
          Run {run.number} · Scan {k + 1}
        </h1>
        <ScanStateChip state={scan.state} />
        <span className="num text-muted">{dateTime(scan.startsAt)}</span>
        <div className="ml-auto flex gap-2">
          <Button
            onClick={() =>
              download(
                `${name}.json`,
                JSON.stringify(scanJson({ run, scan, readings, board: rows, fixes }), null, 2),
                "application/json",
              )
            }
          >
            Export JSON
          </Button>
          <Button onClick={() => download(`${name}-emitters.csv`, boardCsv(rows), "text/csv")}>
            Export Emitters CSV
          </Button>
        </div>
      </div>
      <p className="text-muted">
        {describeCadence(run.cadence)} · {scan.reported} of {scan.expected} Receivers reported
        {scan.partial ? `, ${scan.partial} cut short` : ""}
        {scan.late ? `, ${scan.late} late` : ""} · {scan.heard} Emitters heard, {scan.located}{" "}
        located, {scan.fixCount} Fix{scan.fixCount === 1 ? "" : "es"} stored
      </p>
      {scan.reason && scan.state !== "done" && (
        <p
          role="note"
          className={cn(
            "rounded-md border p-3",
            scan.state === "failed" ? "border-crit/45 text-crit" : "border-line",
          )}
        >
          {scan.reason}
        </p>
      )}

      <section className="rounded-lg border border-line bg-surface" aria-label="Emitters">
        <h2 className="border-b border-line px-3 py-2 text-sm">Emitters ({rows.length})</h2>
        {rows.length > 0 && (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-left" data-testid="scan-emitters">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Emitter</th>
                  <th className="px-3 py-2 font-medium">Position</th>
                  <th className="px-3 py-2 font-medium">Receivers</th>
                  <th className="px-3 py-2 font-medium">Occupancy</th>
                  <th className="px-3 py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ch} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        to="/emitters/$freqHz"
                        params={{ freqHz: String(r.freqHz) }}
                        className="num flex items-center gap-2 hover:underline"
                      >
                        <span
                          className="size-3 shrink-0 rounded-sm"
                          style={{ background: r.located ? colour(r.freqHz) : "transparent" }}
                          aria-hidden
                        />
                        {mhz(r.freqHz)}
                      </Link>
                      <span className="num text-xs text-muted">{spanText(r.lowHz, r.highHz)}</span>
                    </td>
                    <td className="num px-3 py-2 text-xs">
                      {r.located && r.position ? (
                        <>
                          {coords(r.position.lat, r.position.lng)} · ≈{metres(r.position.radiusM)}
                          {stored.has(r.freqHz) && <span className="text-muted"> · stored</span>}
                        </>
                      ) : r.heard === 0 ? (
                        <span className="text-muted">missed (carried)</span>
                      ) : (
                        <span className="text-muted">
                          not located{r.loudestName ? ` · loudest at ${r.loudestName}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="num px-3 py-2">
                      {r.used} of {r.heard}
                    </td>
                    <td className="num px-3 py-2 text-xs">{occupancyText(r.occupancy)}</td>
                    <td className="px-3 py-2">
                      <FixFlags fix={{ flags: r }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface" aria-label="Readings">
        <h2 className="border-b border-line px-3 py-2 text-sm">Readings ({readings.length})</h2>
        <ul className="divide-y divide-line" data-testid="scan-readings">
          {readings.map((r) => (
            <ReadingRow key={r._id} reading={r} plan={run.plan} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ReadingRow({
  reading: r,
  plan,
}: {
  reading: Doc<"readings"> & { name: string };
  plan: Doc<"runs">["plan"];
}) {
  const { slices: floors, emitters } = decodeReading(r.payload);
  const sliceList = slices(plan);
  const clipped = floors.filter((s) => s.clippedFix).length;
  const flags = [
    r.partial &&
      `cut short at ${formatSeconds(r.windowMs)}${r.stopReason ? ` · ${r.stopReason}` : ""}`,
    r.late && "late",
    r.unaligned && `unaligned (clock ±${Math.round(r.clockUncertaintyMs)} ms)`,
    clipped > 0 && `clipped ${clipped} slice${clipped > 1 ? "s" : ""}`,
  ].filter(Boolean) as string[];
  return (
    <li>
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
          <span className="font-medium">{r.name}</span>
          <span className="num text-muted">
            {formatSeconds(r.windowMs)} · {r.passes} passes ({r.fixPasses} in the Fix window) ·{" "}
            {emitters.length} Emitters
          </span>
          {flags.map((f) => (
            <span key={f} className="rounded-full border border-warn/45 px-1.5 text-xs text-warn">
              {f}
            </span>
          ))}
          <span className="num ml-auto text-xs text-muted">
            LNA {r.lnaDb} · VGA {r.vgaDb}
            {r.amp ? " · amp" : ""} · {r.appVersion}
          </span>
        </summary>
        <div className="max-h-96 overflow-auto px-3 pb-3">
          <table className="num w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Emitter</th>
                <th className="py-1 pr-3 font-medium">Span</th>
                <th className="py-1 pr-3 font-medium">Fix-window power</th>
                <th className="py-1 pr-3 font-medium">Peak</th>
                <th className="py-1 font-medium">Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {emitters.map((e) => {
                const raster = plan.rasterHz;
                const low = e.firstCh * raster - raster / 2;
                return (
                  <tr key={e.firstCh} className={cn(e.clippedFix && "text-warn")}>
                    <td className="py-0.5 pr-3">
                      {mhz(e.strongestCh * raster)}
                      {e.clippedFix ? " (clipped)" : ""}
                    </td>
                    <td className="py-0.5 pr-3">{spanText(low, low + e.widthCh * raster)}</td>
                    <td className="py-0.5 pr-3">
                      {e.fixPowerDbm === null
                        ? "after the Fix window"
                        : `${e.fixPowerDbm.toFixed(1)} dBm`}
                    </td>
                    <td className="py-0.5 pr-3">{e.peakDbm.toFixed(1)} dBm</td>
                    <td className="py-0.5">
                      {occupancyText(r.passes > 0 ? e.passesOn / r.passes : 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {clipped > 0 && (
            <p className="mt-1 text-xs text-warn">
              Clipped in the Fix window:{" "}
              {floors
                .flatMap((f, i) =>
                  f.clippedFix && sliceList[i] ? [mhz(sliceList[i].startHz)] : [],
                )
                .join(", ")}
            </p>
          )}
        </div>
      </details>
    </li>
  );
}
