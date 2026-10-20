import { cn } from "cn";
import type { Doc } from "@/convex/_generated/dataModel";
import { relative } from "../lib/time";

type R = Pick<Doc<"receivers">, "status" | "configV" | "appliedV" | "rejected" | "configAt">;

/** Applied, Pending, or Rejected: never mistake desired config for running config. */
export function configState(r: R, now: number) {
  if (r.status === "pending") return { tone: "muted", text: "Not paired yet" } as const;
  if (r.rejected && r.rejected.v === r.configV) {
    return { tone: "crit", text: `Rejected v${r.configV}: ${r.rejected.reason}` } as const;
  }
  if (r.appliedV === r.configV) return { tone: "ok", text: `Applied ✓ v${r.configV}` } as const;
  const late = now - r.configAt > 10 * 60_000;
  return {
    tone: late ? "warn" : "muted",
    text: `Pending v${r.configV} · ${relative(r.configAt, now)}`,
  } as const;
}

export function ConfigStateChip({ receiver, now }: { receiver: R; now: number }) {
  const s = configState(receiver, now);
  return (
    <span
      className={cn(
        "inline-block max-w-56 truncate rounded-full border px-2 py-px text-xs",
        s.tone === "ok" && "border-ok/40 text-ok",
        s.tone === "warn" && "border-warn/45 text-warn",
        s.tone === "crit" && "border-crit/45 text-crit",
        s.tone === "muted" && "border-line text-muted",
      )}
      title={s.text}
    >
      {s.text}
    </span>
  );
}

/** "Recalibrate": never calibrated, or the HackRF was swapped since. */
export const needsCalibration = (
  r: Pick<Doc<"receivers">, "calibration" | "hackrfSerial" | "status">,
) =>
  r.status === "active" &&
  (r.calibration === null || (r.hackrfSerial !== null && r.calibration.serial !== r.hackrfSerial));

export function Badge({
  tone,
  children,
}: {
  tone: "warn" | "muted" | "accent";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 text-xs whitespace-nowrap",
        tone === "warn" && "border-warn/45 text-warn",
        tone === "muted" && "border-line text-muted",
        tone === "accent" && "border-accent/40 text-accent",
      )}
    >
      {children}
    </span>
  );
}
