import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

interface AlertBannerProps {
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  children: ReactNode;
}

const icons = { info: Info, success: CheckCircle2, warning: TriangleAlert, danger: AlertCircle };

export function AlertBanner({ tone, title, children }: AlertBannerProps) {
  const Icon = icons[tone];
  return (
    <div className={`lumer-alert lumer-alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
      <div><strong>{title}</strong><div>{children}</div></div>
    </div>
  );
}
