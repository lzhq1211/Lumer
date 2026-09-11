import { describe, expect, it, vi } from 'vitest';

import { fetchEasyScholarLabels } from '@/lib/easyscholar/easyscholar-client';

describe('EasyScholar client', () => {
  it('拒绝未配置 SecretKey', async () => {
    await expect(fetchEasyScholarLabels('Nature', '')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('读取官方标签字段', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { officialRank: { all: { sci: 'Q1', ccf: 'A' } } } }), { status: 200 })));
    await expect(fetchEasyScholarLabels('Nature', 'secret')).resolves.toEqual({ sci: 'Q1', ccf: 'A' });
  });
});
