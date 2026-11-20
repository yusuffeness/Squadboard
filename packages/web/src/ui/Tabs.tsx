import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

interface SegmentedProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** `tabs` switches panels (tablist); `choice` picks a setting (radiogroup). */
  kind?: 'tabs' | 'choice';
  /** Dark variant for the log panel. */
  dark?: boolean;
  /** For `tabs`: id prefix linking each tab to its panel (`${idPrefix}-panel-${id}`). */
  idPrefix?: string;
  className?: string;
}

/**
 * Pill-shaped segmented control (v2-19 "Bir / İki", Teknik/Sade, Loglar/Dosyalar/Özet).
 * Arrow keys move between options, as the WAI-ARIA tabs and radio patterns expect.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  kind = 'choice',
  dark = false,
  idPrefix,
  className = '',
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (index + step + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    refs.current[next]?.focus();
  }

  return (
    <div
      role={kind === 'tabs' ? 'tablist' : 'radiogroup'}
      aria-label={label}
      className={`inline-flex rounded-2xl p-1 ${dark ? 'bg-console-raised' : 'border border-line bg-sand/70'} ${className}`}
    >
      {items.map((item, i) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role={kind === 'tabs' ? 'tab' : 'radio'}
            aria-selected={kind === 'tabs' ? selected : undefined}
            aria-checked={kind === 'choice' ? selected : undefined}
            aria-controls={kind === 'tabs' && idPrefix ? `${idPrefix}-panel-${item.id}` : undefined}
            id={kind === 'tabs' && idPrefix ? `${idPrefix}-tab-${item.id}` : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`min-h-10 rounded-xl px-4 text-[0.9375rem] font-bold whitespace-nowrap transition-colors ${
              dark
                ? selected
                  ? 'bg-console text-console-ink'
                  : 'text-console-muted hover:text-console-ink'
                : selected
                  ? 'bg-surface text-ink shadow-card'
                  : 'text-muted hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
