import type { ReactNode } from 'react';

interface StatusBadgeProps {
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`lumer-status-badge lumer-status-${tone}`}>{children}</span>;
}
