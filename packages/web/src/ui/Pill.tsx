import type { ReactNode } from 'react';
import type { Tone } from '../lib/board';
import { TONE } from './tones';

/** Small rounded label (chips like "sonnet", counters). */
export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-sand px-2.5 py-0.5 text-xs font-bold text-muted ${className}`}
    >
      {children}
    </span>
  );
}

/** Status with a dot; the text always names the status, colour only helps (v2-19 "Durumlar"). */
export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${TONE[tone].pill}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${TONE[tone].dot}`} />
      {label}
    </span>
  );
}

/** A coloured dot with a text label next to it ("● Çalışıyor" in the agent strip). */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold">
      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${TONE[tone].dot}`} />
      <span className={tone === 'idle' ? 'text-muted' : 'text-ink'}>{label}</span>
    </span>
  );
}
