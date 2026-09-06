import { ReaderPage } from '@/components/reader/ReaderPage';

interface ReaderRouteProps {
  params: Promise<{ paperId: string }>;
}

export default async function ReaderRoute({ params }: ReaderRouteProps) {
  const { paperId } = await params;
  return <ReaderPage paperId={paperId} />;
}
