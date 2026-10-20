// What the daily purge keeps. Pure selection logic; the purge mutation only reads what it deletes.

const DAY = 86_400_000;
export const RETENTION = {
  readingsMs: 7 * DAY,
  boardsMs: 7 * DAY,
  scansMs: 30 * DAY,
  fixesMs: 30 * DAY,
  watchedFixesMs: 365 * DAY,
  eventsMs: 30 * DAY,
  closedAlertsMs: 90 * DAY,
  errorsMs: 30 * DAY,
  activityMs: 30 * DAY,
  invitesGraceMs: 7 * DAY,
  pairingCodesMs: DAY,
} as const;

export const HOUR = 3_600_000;
export const hourOf = (t: number) => Math.floor(t / HOUR) * HOUR;

export type ThinnableFix = {
  id: string;
  freqHz: number;
  at: number;
  uncertaintyM: number;
};

/**
 * Fixes crossing the 30-day mark: unwatched Channels lose them; watched ones keep the single
 * best (smallest region) per hour. Returns the ids to delete.
 */
export function thinFixes(fixes: ThinnableFix[], watched: Set<number>): string[] {
  const best = new Map<string, ThinnableFix>();
  for (const f of fixes) {
    if (!watched.has(f.freqHz)) continue;
    const key = `${f.freqHz}@${hourOf(f.at)}`;
    const kept = best.get(key);
    if (!kept || f.uncertaintyM < kept.uncertaintyM) best.set(key, f);
  }
  const keep = new Set([...best.values()].map((f) => f.id));
  return fixes.filter((f) => !keep.has(f.id)).map((f) => f.id);
}
