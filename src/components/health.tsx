import { cn } from "cn";
import type { Doc } from "@/convex/_generated/dataModel";
import { HEALTH_LABEL, type HealthState, type Reason } from "@/convex/lib/health";
import { SETUP_GAPS, type SetupGap } from "@/convex/lib/heartbeat";

const TONE: Record<HealthState, string> = {
  scanning: "text-ok border-ok/40",
  idle: "text-muted border-line",
  awaiting_pairing: "text-accent border-accent/40",
  offline: "text-crit border-crit/45",
  needs_attention: "text-crit border-crit/45",
  degraded: "text-warn border-warn/45",
  paused: "text-muted border-line",
};

export const DOT: Record<HealthState, string> = {
  scanning: "bg-ok",
  idle: "bg-off",
  awaiting_pairing: "bg-accent",
  offline: "bg-crit",
  needs_attention: "bg-crit",
  degraded: "bg-warn",
  paused: "bg-off",
};

/** A Health state always carries its word, never colour alone; then its top reason. */
export function StateChip({
  state,
  reasons = [],
  className,
}: {
  state: HealthState;
  reasons?: Reason[];
  className?: string;
}) {
  // Self-pause is a warning; an Operator's pause stays neutral.
  const selfPaused = state === "paused" && reasons[0]?.code !== "paused_operator";
  const top = state === "offline" ? undefined : reasons[0];
  const more = state === "offline" ? 0 : Math.max(0, reasons.length - 1);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border bg-surface px-2 py-px text-xs whitespace-nowrap",
          selfPaused ? "border-warn/45 text-warn" : TONE[state],
        )}
      >
        <span
          className={cn("size-2 rounded-full", selfPaused ? "bg-warn" : DOT[state])}
          aria-hidden
        />
        {HEALTH_LABEL[state]}
      </span>
      {top && <span className="text-xs">{top.text}</span>}
      {more > 0 && <span className="text-xs text-muted">+{more} more</span>}
    </span>
  );
}

const HACKRF: Record<NonNullable<Doc<"receiverStatus">["snapshot"]>["hackrf"]["state"], string> = {
  detached: "Detached",
  needs_permission: "No permission",
  opening: "Opening",
  ready: "Ready",
  streaming: "Streaming",
  recovering: "Recovering",
  needs_attention: "Replug",
};

/** "Full", or "Short · warm": a short window covers only the Fix window. */
export const windowLabel = (w: NonNullable<Doc<"receiverStatus">["snapshot"]>["window"]) =>
  w.mode === "full" ? "Full" : `Short · ${w.reason === "battery" ? "on battery" : "warm"}`;

/** Missing phone settings: a badge, never a Health state (scanning still works). */
export function SetupBadge({ gaps }: { gaps: SetupGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <span
      className="rounded-full border border-warn/45 px-1.5 text-xs whitespace-nowrap text-warn"
      title={gaps.map((g) => SETUP_GAPS[g]).join(", ")}
    >
      Setup incomplete: {gaps.map((g) => SETUP_GAPS[g]).join(", ")}
    </span>
  );
}

export function hackrfLabel(s: Doc<"receiverStatus">["snapshot"]): string {
  if (!s) return "—";
  if ((s.hackrf.faults.FIRMWARE_UNSUPPORTED ?? 0) > 0) return "Update firmware";
  const label = HACKRF[s.hackrf.state];
  return s.hackrf.state === "recovering" && s.hackrf.ladder > 0
    ? `${label} L${s.hackrf.ladder}`
    : label;
}
