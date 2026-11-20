/**
 * Thin progress bar. The CLI reports no percentage, so `value` is usually null and the bar shows
 * an indeterminate sweep: never invent a number.
 */
export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  const known = value !== null;
  const pct = known ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(pct) : undefined}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-sand"
    >
      {known ? (
        <div className="h-full rounded-full bg-info" style={{ width: `${pct}%` }} />
      ) : (
        <div className="animate-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-info" />
      )}
    </div>
  );
}
