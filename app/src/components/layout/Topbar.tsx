import { ArrowLeft, Settings } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface TopbarProps {
  title: string;
  subtitle: string;
  settingsPage?: boolean;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
}

export function Topbar({
  title,
  subtitle,
  settingsPage = false,
  backHref,
  backLabel = '返回',
  actions,
}: TopbarProps) {
  return (
    <header className="lumer-topbar-row">
      <div className="lumer-topbar">
        <div className="lumer-topbar-copy">
          {backHref ? (
            <Link className="lumer-topbar-back" href={backHref}>
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.75} />
              {backLabel}
            </Link>
          ) : null}
          <div className="lumer-topbar-title">
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
        </div>

        {settingsPage ? (
          <Link className="lumer-button lumer-button-ghost" href="/">
            <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.75} />
            返回文献库
          </Link>
        ) : (
          <div className="lumer-topbar-actions">
            {actions}
            <Link
              aria-label="设置"
              className="lumer-icon-button lumer-tooltip"
              data-tooltip="设置"
              href="/settings"
            >
              <Settings aria-hidden="true" size={18} strokeWidth={1.75} />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
