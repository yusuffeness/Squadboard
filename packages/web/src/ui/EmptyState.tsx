import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Dashed box with a quiet icon and a short line (v2-19 "Boş durum", v2-02 columns). */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  size = 'sm',
}: {
  icon: LucideIcon;
  title: string;
  /** Optional second line. */
  children?: ReactNode;
  action?: ReactNode;
  /** `lg` for whole-page states (no project, coming soon). */
  size?: 'sm' | 'lg';
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-tile border-2 border-dashed border-line-strong/70 text-center ${
        size === 'lg' ? 'px-6 py-14' : 'px-4 py-8'
      }`}
    >
      <Icon aria-hidden className={size === 'lg' ? 'size-10 text-faint' : 'size-6 text-faint'} />
      <p className={`font-bold text-muted ${size === 'lg' ? 'text-xl text-ink' : ''}`}>{title}</p>
      {children && <div className="max-w-md text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
