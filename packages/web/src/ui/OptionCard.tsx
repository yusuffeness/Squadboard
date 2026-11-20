import { Check, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Big selectable tile with an icon (v2-19 "Seçenek kartları"). Use inside an element with
 * `role="radiogroup"`; the selected one gets a coral border and a tick.
 */
export function OptionCard({
  icon: Icon,
  label,
  hint,
  selected,
  onSelect,
  disabled = false,
  leading,
}: {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  /** Custom visual instead of the icon tile (an agent avatar). */
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`relative flex min-h-11 flex-col items-center justify-center gap-2 rounded-tile border-2 px-3 py-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? 'border-accent bg-accent-soft/40'
          : 'border-line bg-surface hover:border-line-strong'
      }`}
    >
      {selected && (
        <span
          aria-hidden
          className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-accent text-white"
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      )}
      {leading ??
        (Icon && (
          <span
            aria-hidden
            className={`inline-flex size-11 items-center justify-center rounded-xl ${
              selected ? 'bg-accent-soft text-accent' : 'bg-sand text-ink'
            }`}
          >
            <Icon className="size-5" />
          </span>
        ))}
      <span className="font-bold">{label}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </button>
  );
}
