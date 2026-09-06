import { Library, Tags } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export type GlobalNav = 'library' | 'tag' | null;

interface GlobalRailProps {
  activeNav: GlobalNav;
}

export function GlobalRail({ activeNav }: GlobalRailProps) {
  return (
    <aside className="lumer-rail-column" aria-label="全局导航">
      <div className="lumer-rail">
        <div className="lumer-mark" aria-label="Lumer">
          <Image alt="" aria-hidden="true" className="lumer-mark-image" height={824} src="/lumer-mark.png" width={772} />
        </div>

        <nav className="lumer-rail-nav" aria-label="主导航">
          <Link
            aria-label="文献库"
            aria-current={activeNav === 'library' ? 'page' : undefined}
            className={`lumer-rail-button lumer-tooltip ${activeNav === 'library' ? 'is-selected' : ''}`}
            data-tooltip="文献库"
            href="/"
          >
            <Library aria-hidden="true" size={20} strokeWidth={1.75} />
          </Link>
          <Link
            aria-label="标签"
            aria-current={activeNav === 'tag' ? 'page' : undefined}
            className={`lumer-rail-button lumer-tooltip ${activeNav === 'tag' ? 'is-selected' : ''}`}
            data-tooltip="标签"
            href="/?view=tag"
          >
            <Tags aria-hidden="true" size={20} strokeWidth={1.75} />
          </Link>
        </nav>

        <div className="lumer-rail-signature" aria-hidden="true">LA</div>
      </div>
    </aside>
  );
}
