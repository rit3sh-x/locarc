import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { mhz } from "../lib/channels";
import { useNow } from "../lib/time";
import { Button } from "./ui/button";
import { toast } from "./ui/toast";

const signed = (x: number, unit: string) =>
  `${x > 0 ? "+" : ""}${x.toFixed(unit === "ppm" ? 2 : 1)} ${unit}`;

/** The live calibration session: Measure (progress per Receiver) → Review (tick, Apply). */
export function CalibrationPanel() {
  const session = useQuery(api.calibration.active);
  const apply = useMutation(api.calibration.apply);
  const cancel = useMutation(api.calibration.cancel);
  const now = useNow(1000);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  if (!session) return null;
  const measured = new Set(session.measurements.map((m) => m.receiver));
  const left = Math.max(0, Math.ceil((session.at + 60_000 - now) / 1000));

  return (
    <section
      aria-label="Calibration session"
      className="grid gap-3 rounded-lg border border-accent/40 bg-accent-soft/40 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base">
          {session.mode === "full" ? "Calibration session" : "Frequency calibration"} ·{" "}
          <span className="num">{mhz(session.referenceHz)}</span>
        </h2>
        <span className="text-sm text-muted">by {session.by}</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => cancel({ session: session._id }).catch(toast.error)}
        >
          Cancel
        </Button>
      </div>
      {session.state === "measuring" ? (
        <>
          <p className="text-sm">
            Scanning is paused while each Receiver measures the reference carrier (about 30 s, at
            most <span className="num">{left}</span> s more).
          </p>
          <ul className="grid gap-1 text-sm" data-testid="calibration-progress">
            {session.participants.map((p) => (
              <li key={p}>
                {session.names[p]}: {measured.has(p) ? "measured ✓" : "measuring…"}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {session.missing.length > 0 && (
            <p className="text-warn">
              No measurement from {session.missing.map((m) => session.names[m]).join(", ")}.
            </p>
          )}
          <table className="w-full text-left text-sm" data-testid="calibration-review">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Apply</th>
                <th className="py-1 font-medium">Receiver</th>
                <th className="py-1 text-right font-medium">Measured</th>
                {session.mode === "full" && (
                  <th className="py-1 text-right font-medium">Offset (median − own)</th>
                )}
                <th className="py-1 text-right font-medium">ppm</th>
              </tr>
            </thead>
            <tbody>
              {(session.proposals ?? []).map((p) => (
                <tr key={p.receiver}>
                  <td className="py-1">
                    <input
                      type="checkbox"
                      aria-label={`Apply to ${session.names[p.receiver]}`}
                      checked={!unticked.has(p.receiver)}
                      onChange={(e) => {
                        const next = new Set(unticked);
                        if (e.target.checked) next.delete(p.receiver);
                        else next.add(p.receiver);
                        setUnticked(next);
                      }}
                    />
                  </td>
                  <td className="py-1">{session.names[p.receiver]}</td>
                  <td className="num py-1 text-right">{p.measuredDbm.toFixed(1)} dBm</td>
                  {session.mode === "full" && (
                    <td className="num py-1 text-right">
                      {p.offsetDb === null ? "—" : signed(p.offsetDb, "dB")}
                    </td>
                  )}
                  <td className="num py-1 text-right">{signed(p.ppm, "ppm")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            variant="primary"
            className="justify-self-start"
            onClick={async () => {
              const receivers = (session.proposals ?? [])
                .map((p) => p.receiver)
                .filter((r) => !unticked.has(r));
              try {
                await apply({ session: session._id, receivers: receivers as Id<"receivers">[] });
                toast.success(
                  `Calibration applied to ${receivers.length} Receiver${receivers.length === 1 ? "" : "s"}`,
                );
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            Apply to ticked
          </Button>
        </>
      )}
    </section>
  );
}
