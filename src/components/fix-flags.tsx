type Flags = { unconfirmed: boolean; poorFit: boolean; collinear: boolean; receiverMoved: boolean };

/** Quality flags in words: 3-Receiver, poor fit (χ²/dof), collinear, Receiver moved. */
export function FixFlags({
  fix,
  quiet = false,
}: {
  fix: { flags: Flags; chi2PerDof?: number | null; receiverCount?: number };
  /** Render nothing (not a dash) when there are no flags. */
  quiet?: boolean;
}) {
  const flags = [
    fix.flags.unconfirmed && "3 Receivers",
    fix.flags.poorFit &&
      (fix.chi2PerDof == null ? "poor fit" : `poor fit χ²/dof ${fix.chi2PerDof.toFixed(1)}`),
    fix.flags.collinear && "collinear",
    fix.flags.receiverMoved && "Receiver moved?",
  ].filter(Boolean) as string[];
  if (flags.length === 0) return quiet ? null : <span className="text-muted">—</span>;

  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f}
          className="rounded-full border border-warn/45 px-1.5 text-xs whitespace-nowrap text-warn"
        >
          {f}
        </span>
      ))}
    </span>
  );
}
