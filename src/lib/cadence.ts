import { type Cadence, sameValue } from "@/convex/lib/config";

export const CADENCE_OPTIONS = [
  { key: "steady:5", label: "Every 5 min" },
  { key: "steady:15", label: "Every 15 min" },
  { key: "oneMinute:1", label: "1-min burst for 1 h" },
  { key: "oneMinute:2", label: "1-min burst for 2 h" },
  { key: "oneMinute:4", label: "1-min burst for 4 h" },
  { key: "continuous:15", label: "Continuous for 15 min" },
  { key: "continuous:30", label: "Continuous for 30 min" },
  { key: "continuous:60", label: "Continuous for 60 min" },
] as const;

export type CadenceKey = (typeof CADENCE_OPTIONS)[number]["key"];

export function cadenceKey(c: Cadence): CadenceKey {
  switch (c.kind) {
    case "steady":
      return `steady:${c.minutes}`;
    case "oneMinute":
      return `oneMinute:${c.hours}`;
    case "continuous":
      return `continuous:${c.minutes}`;
  }
}

export const revertOf = (c: Cadence): 5 | 15 => (c.kind === "steady" ? c.minutes : c.revertMinutes);

export function parseCadence(key: CadenceKey, revertMinutes: 5 | 15): Cadence {
  const [kind, n] = key.split(":") as [Cadence["kind"], string];
  const value = Number(n);
  if (kind === "steady") return { kind, minutes: value as 5 | 15 };
  if (kind === "oneMinute") return { kind, hours: value as 1 | 2 | 4, revertMinutes };
  return { kind, minutes: value as 15 | 30 | 60, revertMinutes };
}

export const sameCadence = (a: Cadence, b: Cadence) => sameValue(a, b);

export const formatSeconds = (ms: number) =>
  ms < 10_000
    ? `${(ms / 1000).toFixed(2)} s`
    : ms < 120_000
      ? `${Math.round(ms / 1000)} s`
      : `${Math.floor(ms / 60_000)} min ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")} s`;

/** "2:41" or "1:02:41". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Scans are numbered from 1 for people; k counts from 0 internally. */
export const scanNumber = (k: number) => k + 1;
