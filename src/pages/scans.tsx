import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Fragment, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { describeCadence } from "@/convex/lib/schedule";
import { EmptyState } from "../components/empty-state";
import { SCAN_STATE_LABEL, ScanStateChip } from "../components/scan-state";
import { Button } from "../components/ui/button";
import { scanNumber } from "../lib/cadence";
import { clock, dateTime } from "../lib/time";

const route = getRouteApi("/app/scans");
const PAGE = 50;
type Page = FunctionReturnType<typeof api.scans.list>;
type Row = Page["page"][number];
const STATES = Object.keys(SCAN_STATE_LABEL) as Doc<"scans">["state"][];

export function ScansPage() {
  const { run, state } = route.useSearch();
  const navigate = useNavigate({ from: "/scans" });
  const filters = { run, state };
  // The first page is live (it changes once per Scan); older pages are one-shot reads.
  const first = useQuery(api.scans.list, {
    ...filters,
    paginationOpts: { numItems: PAGE, cursor: null },
  });
  const runs = useQuery(api.runs.recent);
  const convex = useConvex();
  const [older, setOlder] = useState<{
    key: string;
    rows: Row[];
    cursor: string;
    done: boolean;
  } | null>(null);
  const key = JSON.stringify(filters);
  const extra = older?.key === key ? older : null;

  if (!first || !runs) return null;
  const rows = [...first.page, ...(extra?.rows ?? [])];
  const done = extra ? extra.done : first.isDone;
  const runDocs = new Map(runs.map((r) => [r.number, r]));

  const loadOlder = async () => {
    const cursor = extra?.cursor ?? first.continueCursor;
    const next = await convex.query(api.scans.list, {
      ...filters,
      paginationOpts: { numItems: PAGE, cursor },
    });
    setOlder({
      key,
      rows: [...(extra?.rows ?? []), ...next.page],
      cursor: next.continueCursor,
      done: next.isDone,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg">Scans</h1>
        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1 text-sm">
            Run
            <select
              className="h-9 rounded-md border border-line bg-surface px-2"
              value={run ?? ""}
              onChange={(e) =>
                navigate({
                  search: (s) => ({
                    ...s,
                    run: e.target.value ? Number(e.target.value) : undefined,
                  }),
                })
              }
            >
              <option value="">All Runs</option>
              {runs.map((r) => (
                <option key={r._id} value={r.number}>
                  Run {r.number} · {dateTime(r.startedAt)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Outcome
            <select
              className="h-9 rounded-md border border-line bg-surface px-2"
              value={state ?? ""}
              onChange={(e) =>
                navigate({
                  search: (s) => ({
                    ...s,
                    state: (e.target.value || undefined) as Doc<"scans">["state"] | undefined,
                  }),
                })
              }
            >
              <option value="">Any outcome</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {SCAN_STATE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No Scans">Scans appear here once a Run is going.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left" data-testid="scans-table">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">Scan</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
                <th className="px-3 py-2 font-medium">Reported</th>
                <th className="px-3 py-2 font-medium">Emitters</th>
                <th className="px-3 py-2 font-medium">Took</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const header = i === 0 || rows[i - 1]?.runNumber !== s.runNumber;
                const r = runDocs.get(s.runNumber);
                return (
                  <Fragment key={s._id}>
                    {header && (
                      <tr className="border-b border-line bg-surface-2">
                        <th colSpan={5} className="px-3 py-1.5 text-left text-xs font-medium">
                          Run {s.runNumber}
                          {r && (
                            <span className="font-normal text-muted">
                              {" "}
                              · {describeCadence(r.cadence)} · started {dateTime(r.startedAt)}
                              {r.endedAt
                                ? ` · ended ${dateTime(r.endedAt)} (${r.endReason})`
                                : " · running"}
                            </span>
                          )}
                        </th>
                      </tr>
                    )}
                    <tr className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <Link
                          to="/scans/$run/$k"
                          params={{ run: String(s.runNumber), k: String(scanNumber(s.k)) }}
                          className="font-medium hover:underline"
                        >
                          Scan {scanNumber(s.k)}
                        </Link>{" "}
                        <span className="num text-muted">{clock(s.startsAt)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <ScanStateChip state={s.state} />
                        {s.reason && s.state !== "done" && (
                          <div className="text-xs text-muted">{s.reason}</div>
                        )}
                      </td>
                      <td className="num px-3 py-2">
                        {s.reported} of {s.expected}
                        {s.partial ? ` · ${s.partial} cut short` : ""}
                        {s.late ? ` · ${s.late} late` : ""}
                      </td>
                      <td className="num px-3 py-2">
                        {s.heard} heard · {s.located} located · {s.fixCount} stored
                      </td>
                      <td className="num px-3 py-2 text-muted">
                        {s.closedAt ? `${Math.round((s.closedAt - s.startsAt) / 1000)} s` : "—"}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!done && (
        <Button className="justify-self-start" onClick={loadOlder}>
          Show older
        </Button>
      )}
    </div>
  );
}
