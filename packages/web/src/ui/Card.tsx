import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'li';
  /** `warm`: the "Kararın lazım" yellow; `flat`: no shadow (cards inside cards). */
  tone?: 'default' | 'warm' | 'flat';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children?: ReactNode;
}

const TONE = {
  default: 'border border-line bg-surface/90 shadow-card',
  warm: 'border border-warn/25 bg-warn-tint shadow-card',
  flat: 'border border-line bg-surface',
};

const PADDING = { none: '', sm: 'p-3', md: 'p-4 sm:p-5', lg: 'p-5 sm:p-8' };

/** Rounded warm-white panel used across the app (v2-19). */
export function Card({
  as: Tag = 'div',
  tone = 'default',
  padding = 'md',
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <Tag className={`rounded-card ${TONE[tone]} ${PADDING[padding]} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
