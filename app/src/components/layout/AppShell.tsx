import type { ReactNode } from 'react';

import { AmbientVideoBackground } from '@/components/layout/AmbientVideoBackground';
import { GlobalRail } from '@/components/layout/GlobalRail';
import type { GlobalNav } from '@/components/layout/GlobalRail';
import { Topbar } from '@/components/layout/Topbar';
import { ViewportGuard } from '@/components/layout/ViewportGuard';

interface AppShellProps {
  activeNav: GlobalNav;
  title: string;
  subtitle: string;
  vortexTheme?: boolean;
  settingsPage?: boolean;
  backHref?: string;
  backLabel?: string;
  topbarActions?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  activeNav,
  title,
  subtitle,
  vortexTheme = false,
  settingsPage = false,
  backHref,
  backLabel,
  topbarActions,
  children,
}: AppShellProps) {
  const isLibrarySurface = activeNav === 'library' || activeNav === 'tag';
  const isVortexSurface = isLibrarySurface || vortexTheme;
  const shellClasses = [
    'lumer-app-shell',
    isVortexSurface ? 'lumer-app-shell--vortex' : '',
    isLibrarySurface ? 'lumer-app-shell--library-vortex' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={shellClasses}>
      {isLibrarySurface ? <AmbientVideoBackground /> : null}
      <GlobalRail activeNav={activeNav} />
      <Topbar
        actions={topbarActions}
        backHref={backHref}
        backLabel={backLabel}
        title={title}
        subtitle={subtitle}
        settingsPage={settingsPage}
      />
      <main className="lumer-page-workspace">{children}</main>
      <ViewportGuard />
    </div>
  );
}
