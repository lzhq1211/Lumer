import { AnalysisPage } from '@/components/analysis/AnalysisPage';

interface PageProps { params: Promise<{ paperId: string; runId: string }> }

export default async function PaperAnalysisRoute({ params }: PageProps) {
  const { paperId, runId } = await params;
  return <AnalysisPage paperId={paperId} runId={runId} />;
}
