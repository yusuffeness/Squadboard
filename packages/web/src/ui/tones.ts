import type { Tone } from '../lib/board';

/** Status colours (v2-19 "Durumlar"). Full class names so Tailwind can see them. */
export const TONE: Record<Tone, { pill: string; dot: string; text: string }> = {
  idle: { pill: 'bg-sand text-muted', dot: 'bg-idle', text: 'text-muted' },
  info: { pill: 'bg-info-soft text-info', dot: 'bg-info', text: 'text-info' },
  warn: { pill: 'bg-warn-soft text-warn', dot: 'bg-warn', text: 'text-warn' },
  review: { pill: 'bg-review-soft text-review', dot: 'bg-review', text: 'text-review' },
  success: { pill: 'bg-success-soft text-success-strong', dot: 'bg-success', text: 'text-success' },
  danger: { pill: 'bg-danger-soft text-danger', dot: 'bg-danger', text: 'text-danger' },
};
