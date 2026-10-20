import { cn } from "cn";
import { FREE_PLAN } from "@/convex/lib/usage";
import { pct, useUsage } from "../lib/usage";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
const k = (n: number) => `${Math.round(n / 1000)}k`;

/** A client-side projection of this month against the Free plan; warns at 80%. */
export function UsageMeter() {
  const usage = useUsage();
  if (!usage) return null;
  const rows = [
    {
      label: "Function calls",
      value: `${k(usage.calls)} of ${k(FREE_PLAN.calls)}`,
      pct: usage.pct.calls,
    },
    { label: "Database I/O", value: `${mb(usage.ioBytes)} of 1 GB`, pct: usage.pct.io },
    { label: "Storage", value: `${mb(usage.storageBytes)} of 0.5 GB`, pct: usage.pct.storage },
  ];
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Projected usage ${pct(usage.worst)} of the Free plan`}
        data-testid="usage-meter"
        className={cn(
          "hidden h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm hover:bg-surface-2 sm:flex",
          usage.warn ? "border-warn/50 text-warn" : "border-line",
        )}
      >
        Usage <span className="num">{pct(usage.worst)}</span>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="grid gap-3">
          <p className="font-medium">This month, projected</p>
          {rows.map((r) => (
            <div key={r.label} className="grid gap-1">
              <div className="flex justify-between text-sm">
                <span>{r.label}</span>
                <span className="num">{r.value}</span>
              </div>
              <div className="h-1.5 rounded bg-surface-2">
                <div
                  className={cn("h-full rounded", r.pct >= 0.8 ? "bg-warn" : "bg-accent")}
                  style={{ width: `${Math.min(100, r.pct * 100)}%` }}
                />
              </div>
            </div>
          ))}
          <p className="text-xs text-muted">
            An estimate from cadence, Receivers and Fixes. The Convex dashboard has the exact
            figures.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
