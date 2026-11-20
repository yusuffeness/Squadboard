import { Check } from 'lucide-react';
import { Fragment } from 'react';

/** "✓ Klasör — 2 Ekip — 3 Hazır" (v2-07). `current` is 1-based. */
export function Steps({
  steps,
  current,
}: {
  steps: readonly { label: string; hint?: string }[];
  current: number;
}) {
  return (
    <ol aria-label="Adımlar" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {steps.map((step, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <Fragment key={step.label}>
            {i > 0 && (
              <li
                aria-hidden
                className={`hidden h-0.5 w-10 rounded-full sm:block ${done || active ? 'bg-success' : 'bg-line-strong'}`}
              />
            )}
            <li
              aria-current={active ? 'step' : undefined}
              className="flex items-center gap-2.5"
              title={step.hint}
            >
              <span
                aria-hidden
                className={`inline-flex size-9 items-center justify-center rounded-full font-bold ${
                  done
                    ? 'bg-success text-white'
                    : active
                      ? 'bg-accent text-white'
                      : 'border border-line-strong bg-surface text-muted'
                }`}
              >
                {done ? <Check className="size-4" strokeWidth={3} /> : n}
              </span>
              <span className="font-bold">
                {step.label}
                <span className="sr-only">{done ? ' (tamam)' : active ? ' (şu an)' : ''}</span>
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
