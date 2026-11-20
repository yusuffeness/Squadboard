import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Dark output box (v2-04): a header area, then a body that follows new lines while the user is
 * at the bottom and stays put when they scroll up to read.
 */
export function DarkLogPanel({
  header,
  toolbar,
  children,
  followKey,
  label,
}: {
  header?: ReactNode;
  /** Row under the header (tabs). */
  toolbar?: ReactNode;
  children: ReactNode;
  /** Changes when new content arrives (e.g. the event count). */
  followKey?: number;
  /** Accessible name of the scrolling region. */
  label: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [followKey]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card bg-console text-console-ink shadow-card">
      {header && <div className="border-b border-console-raised p-4 sm:p-6">{header}</div>}
      {toolbar && <div className="px-4 pt-4 sm:px-6">{toolbar}</div>}
      <div
        ref={bodyRef}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-64 flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed sm:p-6"
      >
        {children}
      </div>
    </section>
  );
}
