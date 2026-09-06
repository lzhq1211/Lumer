import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Topbar } from '@/components/layout/Topbar';

describe('Topbar', () => {
  it('renders Chinese page context and the Settings link', () => {
    render(<Topbar title="文献库" subtitle="本地论文与阅读状态" />);

    expect(screen.getByText('文献库')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('href', '/settings');
  });
});
