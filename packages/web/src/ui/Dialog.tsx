import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Modal on the native <dialog> (focus trap, Esc and the backdrop come with it), styled like v2-17.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-[min(44rem,calc(100vw-2rem))] max-w-none rounded-[2rem] bg-surface p-0 text-ink shadow-pop backdrop:bg-ink/35 backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="flex flex-col gap-5 p-5 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="text-2xl font-extrabold sm:text-3xl">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-muted sm:text-lg">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Kapat"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-sand"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          {children}
          {footer}
        </div>
      )}
    </dialog>
  );
}
