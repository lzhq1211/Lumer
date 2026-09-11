import { PublicationLabelRecord, PublicationLabelRecordSchema } from '@/domain/publication-label';

const EASY_SCHOLAR_ENDPOINT = 'https://easyscholar.cc/open/getPublicationRank';

export class EasyScholarError extends Error {
  constructor(message: string, readonly code: 'NOT_CONFIGURED' | 'REQUEST_FAILED' | 'INVALID_RESPONSE') {
    super(message);
    this.name = 'EasyScholarError';
  }
}

function readLabels(payload: unknown): PublicationLabelRecord {
  if (!payload || typeof payload !== 'object') throw new EasyScholarError('EasyScholar 返回格式无效。', 'INVALID_RESPONSE');
  const data = payload as { data?: { officialRank?: { all?: unknown } } };
  const labels = data.data?.officialRank?.all;
  const parsed = PublicationLabelRecordSchema.safeParse(labels ?? {});
  if (!parsed.success) throw new EasyScholarError('EasyScholar 标签数据格式无效。', 'INVALID_RESPONSE');
  return parsed.data;
}

export async function fetchEasyScholarLabels(
  publicationName: string,
  secretKey: string,
  signal?: AbortSignal,
): Promise<PublicationLabelRecord> {
  const name = publicationName.trim();
  const key = secretKey.trim();
  if (!name) return {};
  if (!key) throw new EasyScholarError('未配置 EasyScholar SecretKey。', 'NOT_CONFIGURED');
  const url = new URL(EASY_SCHOLAR_ENDPOINT);
  url.searchParams.set('secretKey', key);
  url.searchParams.set('publicationName', name);
  let response: Response;
  try {
    response = await fetch(url, { signal, redirect: 'follow' });
  } catch (error) {
    throw new EasyScholarError(`EasyScholar 请求失败：${error instanceof Error ? error.message : '网络错误'}`, 'REQUEST_FAILED');
  }
  if (response.url && !['easyscholar.cc', 'www.easyscholar.cc'].includes(new URL(response.url).hostname)) {
    throw new EasyScholarError('EasyScholar 请求发生了不安全跳转。', 'REQUEST_FAILED');
  }
  if (!response.ok) throw new EasyScholarError(`EasyScholar 返回 HTTP ${response.status}。`, 'REQUEST_FAILED');
  return readLabels(await response.json());
}
