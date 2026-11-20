import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/** Soft banner for errors and warnings (v2-19 "Bildirimler": "Ajan hata verdi · yeniden dene"). */
export function Notice({
  tone = 'danger',
  children,
  action,
}: {
  tone?: 'danger' | 'warn';
  children: ReactNode;
  action?: ReactNode;
}) {
  const Icon = tone === 'danger' ? TriangleAlert : CircleAlert;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-3 rounded-tile px-4 py-3 font-semibold ${
        tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'
      }`}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {action}
    </div>
  );
}
