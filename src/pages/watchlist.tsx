import { Link } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useActionState, useState } from "react";
import { api } from "@/convex/_generated/api";
import { AlertRow, AlertsFeed } from "../components/alerts-feed";
import { EmptyState } from "../components/empty-state";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { mhz } from "../lib/channels";
import { spanText } from "../lib/emitters";
import { errorMessage } from "../lib/errors";
import { relative, useNow } from "../lib/time";

type History = FunctionReturnType<typeof api.alerts.history>;

export function WatchlistPage() {
  const entries = useQuery(api.watchlist.list);
  const upsert = useMutation(api.watchlist.upsert);
  const now = useNow(30_000);

  const [error, add, adding] = useActionState(async (_: string | null, form: FormData) => {
    const freqHz = Number(form.get("mhz")) * 1e6;
    try {
      await upsert({
        freqHz,
        name: String(form.get("name")),
        notes: "",
        rules: { heard: true, moved: true, silent: true },
        critical: false,
        home: null,
      });
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  }, null);

  if (!entries) return null;
  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 className="text-lg">Watchlist</h1>
      <section className="rounded-lg border border-line bg-surface" aria-label="Known Emitters">
        <h2 className="border-b border-line px-3 py-2 text-sm">Known Emitters</h2>
        {entries.length === 0 ? (
          <div className="p-3">
            <EmptyState title="No Emitters watched yet">
              Name an Emitter from its detail page (every Emitter and New alert links there), or add
              one by frequency below. Known Emitters never raise New.
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left" data-testid="watchlist">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Emitter</th>
                  <th className="px-3 py-2 font-medium">Last span</th>
                  <th className="px-3 py-2 font-medium">Rules</th>
                  <th className="px-3 py-2 font-medium">Last located</th>
                  <th className="px-3 py-2 font-medium">Open alerts</th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .sort((a, b) => a.freqHz - b.freqHz)
                  .map((e) => (
                    <tr key={e._id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <Link
                          to="/emitters/$freqHz"
                          params={{ freqHz: String(e.freqHz) }}
                          className="hover:underline"
                        >
                          <span className="num">{mhz(e.freqHz)}</span> ·{" "}
                          <span className="font-medium">{e.name}</span>
                        </Link>
                        {e.critical && (
                          <span className="ml-2 rounded-full border border-crit/45 px-1.5 text-xs text-crit">
                            critical
                          </span>
                        )}
                      </td>
                      <td className="num px-3 py-2 text-xs">
                        {e.lowHz !== null && e.highHz !== null ? spanText(e.lowHz, e.highHz) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {[
                          e.rules.heard && "Heard",
                          e.rules.moved && "Moved",
                          e.rules.silent && "Silent",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "none"}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {e.lastLocatedAt ? relative(e.lastLocatedAt, now) : "never"}
                      </td>
                      <td className="num px-3 py-2">{e.openAlerts}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <form action={add} className="flex flex-wrap items-end gap-2 border-t border-line p-3">
          <Label>
            Frequency (MHz)
            <Input
              name="mhz"
              type="number"
              step="0.0001"
              min="1"
              max="6000"
              required
              className="w-40"
            />
          </Label>
          <Label className="min-w-48 flex-1">
            Name
            <Input name="name" required maxLength={60} />
          </Label>
          <Button type="submit" disabled={adding}>
            Add to Watchlist
          </Button>
          {error && (
            <p role="alert" className="w-full text-crit">
              {error}
            </p>
          )}
        </form>
      </section>
      <AlertsFeed />
      <AlertHistory now={now} />
    </div>
  );
}

/** 90 days of alerts, one-shot pages with filters (never a subscription). */
function AlertHistory({ now }: { now: number }) {
  const convex = useConvex();
  const [filters, setFilters] = useState<{
    state?: "open" | "acknowledged" | "resolved";
    severity?: "critical" | "warning";
  }>({});
  const [pages, setPages] = useState<{
    rows: History["page"];
    cursor: string | null;
    done: boolean;
  } | null>(null);

  const load = async (more: boolean) => {
    const r = await convex.query(api.alerts.history, {
      ...filters,
      paginationOpts: { numItems: 30, cursor: more ? (pages?.cursor ?? null) : null },
    });
    setPages({
      rows: [...(more ? (pages?.rows ?? []) : []), ...r.page],
      cursor: r.continueCursor,
      done: r.isDone,
    });
  };

  return (
    <section className="rounded-lg border border-line bg-surface" aria-label="Alert history">
      <div className="flex flex-wrap items-end gap-2 border-b border-line px-3 py-2">
        <h2 className="mr-auto text-sm">History (90 days)</h2>
        <select
          aria-label="State"
          className="h-8 rounded-md border border-line bg-surface px-2 text-sm"
          value={filters.state ?? ""}
          onChange={(e) =>
            setFilters({ ...filters, state: (e.target.value || undefined) as typeof filters.state })
          }
        >
          <option value="">Any state</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          aria-label="Severity"
          className="h-8 rounded-md border border-line bg-surface px-2 text-sm"
          value={filters.severity ?? ""}
          onChange={(e) =>
            setFilters({
              ...filters,
              severity: (e.target.value || undefined) as typeof filters.severity,
            })
          }
        >
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
        </select>
        <Button size="sm" onClick={() => load(false)}>
          {pages ? "Reload" : "Load history"}
        </Button>
      </div>
      {pages && (
        <>
          <ul className="divide-y divide-line">
            {pages.rows.map((a) => (
              <AlertRow key={a._id} alert={a} now={now} />
            ))}
          </ul>
          {!pages.done && (
            <Button size="sm" variant="ghost" className="m-2" onClick={() => load(true)}>
              Show older
            </Button>
          )}
        </>
      )}
    </section>
  );
}
