import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsForm } from '@/components/settings/SettingsForm';

const settingsPayload = {
  data: {
    config: {
      schema_version: 2,
      vault_path: '/tmp/lumer-vault',
      default_chat_provider: null,
      default_analyze_provider: null,
      openai_compatible: null,
    },
    vault_status: 'valid',
    obsidian_initialized: true,
  },
};

const providersPayload = {
  data: [
    { provider: 'codex', transport: 'cli', configured: true, installed: true, authenticated: true, available: true, detected_model: null, failure_code: null },
    { provider: 'openai_compatible', transport: 'http', configured: true, installed: null, authenticated: true, available: true, detected_model: 'fixture-model', failure_code: null },
  ],
};

const providerConfigPayload = {
  data: {
    app: 'Fixture API',
    model: 'fixture-model',
    base_url_configured: true,
    has_api_key: true,
    config_file_present: true,
  },
};

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SettingsForm custom API', () => {
  it('loads redacted config and removes the Settings data-boundary banners', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/settings')) return response(settingsPayload);
      if (url.endsWith('/api/providers')) return response(providersPayload);
      if (url.endsWith('/api/provider-config')) return response(providerConfigPayload);
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsForm />);

    expect(await screen.findByDisplayValue('Fixture API')).toBeInTheDocument();
    expect(screen.getByDisplayValue('fixture-model')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('https://provider.example/v1')).not.toBeInTheDocument();
    expect(screen.queryByText('数据发送边界')).not.toBeInTheDocument();
    expect(screen.getByText('当前 API Key：已配置')).toBeInTheDocument();
  });

  it('saves the custom API and refreshes provider status without displaying the key', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/settings')) return response(settingsPayload);
      if (url.endsWith('/api/providers')) return response(providersPayload);
      if (url.endsWith('/api/provider-config') && init?.method === 'PUT') return response(providerConfigPayload);
      if (url.endsWith('/api/provider-config')) return response(providerConfigPayload);
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsForm />);
    const app = await screen.findByLabelText('App / 服务名称');
    fireEvent.change(app, { target: { value: 'New API' } });
    fireEvent.change(screen.getByLabelText('API URL'), { target: { value: 'https://provider.example/v1' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'new-model' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 API 配置' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/provider-config', expect.objectContaining({ method: 'PUT' })));
    const saveCall = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/api/provider-config') && init?.method === 'PUT');
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({ app: 'New API', base_url: 'https://provider.example/v1', model: 'new-model', api_key: 'new-secret' });
    expect(await screen.findByText('当前服务已更新，重启后对新进程生效。')).toBeInTheDocument();
    expect(screen.queryByText('new-secret')).not.toBeInTheDocument();
  });

  it('requires confirmation before clearing an existing API key', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/settings')) return response(settingsPayload);
      if (url.endsWith('/api/providers')) return response(providersPayload);
      if (url.endsWith('/api/provider-config/api-key') && init?.method === 'DELETE') {
        return response({ data: { ...providerConfigPayload.data, has_api_key: false } });
      }
      if (url.endsWith('/api/provider-config')) return response(providerConfigPayload);
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);

    render(<SettingsForm />);
    const clearButton = await screen.findByRole('button', { name: '清除 API Key' });
    fireEvent.click(clearButton);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/provider-config/api-key', expect.anything());

    confirmMock.mockReturnValue(true);
    fireEvent.click(clearButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/provider-config/api-key', { method: 'DELETE' }));
  });
});
