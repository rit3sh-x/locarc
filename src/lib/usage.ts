import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type OrgConfig, sameSegments } from "@/convex/lib/config";
import { projectMonth, type Usage } from "@/convex/lib/usage";
import { useBoard } from "./emitters";

/** The usage meter's projection for `values` (the saved config, or a draft being edited). */
export function useUsage(values?: OrgConfig, opts: { running?: boolean } = {}): Usage | null {
  const live = useQuery(api.live.run);
  const receivers = useQuery(api.receivers.list);
  const config = useQuery(api.orgConfig.current);
  const board = useBoard();
  if (!live || !receivers || !config || board === undefined) return null;
  const v = values ?? config.values;
  const running = opts.running ?? live.run !== null;
  return projectMonth({
    cadence: running ? v.cadence : null,
    burstEndsAt: values ? null : (live.run?.burstEndsAt ?? null),
    now: Date.now(),
    segments: v.segments,
    receivers: receivers.filter((r) => r.status === "active").length,
    // Today's plan uses the latest board's count; a different draft plan is estimated by width.
    emitters:
      board.rows.length > 0 && sameSegments(v.segments, config.values.segments)
        ? board.rows.length
        : null,
  });
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
