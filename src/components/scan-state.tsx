import { cn } from "cn";
import type { Doc } from "@/convex/_generated/dataModel";

type ScanState = Doc<"scans">["state"];

const TONE: Record<ScanState, string> = {
  collecting: "text-accent border-accent/40",
  localizing: "text-accent border-accent/40",
  done: "text-ok border-ok/40",
  no_fix: "text-muted border-line",
  failed: "text-crit border-crit/45",
  discarded: "text-muted border-dashed border-line",
};

export const SCAN_STATE_LABEL: Record<ScanState, string> = {
  collecting: "Collecting",
  localizing: "Localizing",
  done: "Done",
  no_fix: "No Fix",
  failed: "Failed",
  discarded: "Discarded",
};

export function ScanStateChip({ state }: { state: ScanState }) {
  return (
    <span
      className={cn(
        "rounded-full border bg-surface px-2 py-px text-xs whitespace-nowrap",
        TONE[state],
      )}
    >
      {SCAN_STATE_LABEL[state]}
    </span>
  );
}
