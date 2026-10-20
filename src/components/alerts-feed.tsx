import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useMutation, useQuery } from "convex/react";
import { Bell } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { relative, useNow } from "../lib/time";
import { Button } from "./ui/button";
import { toast } from "./ui/toast";

/** Where an alert's subject lives: a Receiver, an Emitter or Diagnostics. */
export function AlertLink({
  alert,
  children,
}: {
  alert: Doc<"alerts">;
  children: React.ReactNode;
}) {
  const [kind, id = ""] = alert.subjectKey.split(":");
  if (kind === "rx")
    return (
      <Link to="/receivers/$receiverId" params={{ receiverId: id }} className="hover:underline">
        {children}
      </Link>
    );
  if (kind === "ch")
    return (
      <Link to="/emitters/$freqHz" params={{ freqHz: id }} className="hover:underline">
        {children}
      </Link>
    );
  return (
    <Link to="/settings/diagnostics" className="hover:underline">
      {children}
    </Link>
  );
}

export function AlertRow({ alert, now }: { alert: Doc<"alerts">; now: number }) {
  const ack = useMutation(api.alerts.ack);
  const critical = alert.severity === "critical";
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 px-3 py-2">
      <span
        className={cn("mt-1.5 size-2.5 rounded-full", critical ? "bg-crit" : "bg-warn")}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="font-medium">
          <span className={cn("mr-1.5 text-xs uppercase", critical ? "text-crit" : "text-warn")}>
            {critical ? "Critical" : "Warning"}
          </span>
          <AlertLink alert={alert}>{alert.title}</AlertLink>
        </div>
        <div className="text-xs text-muted">
          {alert.count > 1 && <span className="num">×{alert.count} · </span>}
          first {relative(alert.firstAt, now)}
          {alert.count > 1 && <> · last {relative(alert.lastAt, now)}</>}
          {alert.state === "acknowledged" && alert.ackAt && (
            <>
              {" "}
              · acknowledged by {alert.ackBy} {relative(alert.ackAt, now)}
            </>
          )}
          {alert.kind === "condition" && alert.state === "open" && <> · clears by itself</>}
        </div>
      </div>
      {alert.kind === "event" && alert.state === "open" && (
        <Button size="sm" onClick={() => ack({ alertId: alert._id }).catch(toast.error)}>
          Acknowledge
        </Button>
      )}
    </li>
  );
}

/** Open alerts (critical first) with acknowledge, and the recently acknowledged below. */
export function AlertsFeed({ limit }: { limit?: number }) {
  const alerts = useQuery(api.alerts.open);
  const ackAll = useMutation(api.alerts.ackAll);
  const now = useNow(30_000);
  if (!alerts) return null;
  const open = [...alerts.open].sort(
    (a, b) =>
      Number(b.severity === "critical") - Number(a.severity === "critical") || b.lastAt - a.lastAt,
  );
  const shown = limit ? open.slice(0, limit) : open;
  const events = open.filter((a) => a.kind === "event").length;
  return (
    <section className="rounded-lg border border-line bg-surface" aria-label="Alerts">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm">
          Alerts <span className="num text-muted">({open.length} open)</span>
        </h2>
        {events > 0 && (
          <Button size="sm" variant="ghost" onClick={() => ackAll({}).catch(toast.error)}>
            Acknowledge all
          </Button>
        )}
      </div>
      {open.length === 0 ? (
        <p className="px-3 py-2 text-muted">Nothing needs attention.</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="alerts-open">
          {shown.map((a) => (
            <AlertRow key={a._id} alert={a} now={now} />
          ))}
        </ul>
      )}
      {limit && open.length > limit && (
        <Link to="/watchlist" className="block px-3 py-2 text-sm text-accent hover:underline">
          All {open.length} alerts
        </Link>
      )}
      {!limit && alerts.acknowledged.length > 0 && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm text-muted">
            Acknowledged recently ({alerts.acknowledged.length})
          </summary>
          <ul className="divide-y divide-line" data-testid="alerts-acknowledged">
            {alerts.acknowledged.map((a) => (
              <AlertRow key={a._id} alert={a} now={now} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The top-bar bell: open, unacknowledged alerts. */
export function AlertBell() {
  const alerts = useQuery(api.alerts.open);
  const count = alerts?.open.length ?? 0;
  const critical = alerts?.open.some((a) => a.severity === "critical");
  return (
    <Link
      to="/watchlist"
      aria-label={`Alerts: ${count} open`}
      className="relative inline-flex size-8 items-center justify-center rounded-md hover:bg-surface-2"
    >
      <Bell className="size-4" aria-hidden />
      {count > 0 && (
        <span
          className={cn(
            "num absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 text-white",
            critical ? "bg-crit" : "bg-warn",
          )}
          data-testid="bell-count"
        >
          {count}
        </span>
      )}
    </Link>
  );
}
