import { AppShell } from '@/components/layout/AppShell';
import { LibraryPage } from '@/components/library/LibraryPage';

interface HomePageProps {
  searchParams: Promise<{ view?: string | string[] }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const view = params.view === 'tag' ? 'tag' : 'library';

  return (
    <AppShell
      activeNav={view}
      title={view === 'tag' ? '标签' : '文献库'}
      subtitle={view === 'tag' ? '在当前文献库中按标签筛选' : '本地论文与阅读状态'}
    >
      <LibraryPage view={view} />
    </AppShell>
  );
}
