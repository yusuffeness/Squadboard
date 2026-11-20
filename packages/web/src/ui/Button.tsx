import { LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'approve' | 'secondary' | 'danger' | 'ghost';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-button hover:bg-accent-strong',
  approve: 'bg-success text-white shadow-button hover:bg-success-strong',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-sand',
  danger: 'border border-danger/25 bg-danger-soft text-danger hover:border-danger/50',
  ghost: 'text-muted hover:bg-sand hover:text-ink',
};

const SIZE = {
  md: 'min-h-11 rounded-xl px-4 text-[0.9375rem]',
  lg: 'min-h-14 rounded-2xl px-6 text-lg',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof SIZE;
  icon?: LucideIcon;
  /** Icon after the label (arrows). */
  trailingIcon?: LucideIcon;
  /** Shows a spinner, keeps the width and blocks clicks. */
  loading?: boolean;
  children?: ReactNode;
}

/**
 * v2-19 "Düğmeler": Birincil, Onayla, İkincil, Reddet, Vazgeç (ghost); disabled is "Kapalı".
 * Every size is at least 44px tall (touch target rule).
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  trailingIcon: Trailing,
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const off = disabled || loading;
  return (
    <button
      type={type}
      disabled={off}
      aria-busy={loading || undefined}
      className={`inline-flex min-w-11 shrink-0 items-center justify-center gap-2 font-bold whitespace-nowrap transition-colors ${SIZE[size]} ${
        disabled && !loading
          ? 'cursor-not-allowed bg-sand text-faint shadow-none'
          : `${VARIANT[variant]} ${loading ? 'cursor-progress opacity-80' : ''}`
      } ${className}`}
      {...rest}
    >
      {loading ? (
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
      ) : (
        Icon && <Icon aria-hidden className="size-4" />
      )}
      {children}
      {Trailing && !loading && <Trailing aria-hidden className="size-4" />}
    </button>
  );
}
