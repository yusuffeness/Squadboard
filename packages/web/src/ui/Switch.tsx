/** On/off toggle with `role="switch"` (design accessibility rule). 44px tall hit area. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; shown only to screen readers. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className={`relative inline-block h-8 w-[3.25rem] rounded-full transition-colors ${
          checked ? 'bg-success' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-1 left-1 size-6 rounded-full bg-surface shadow-card transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </span>
    </button>
  );
}
