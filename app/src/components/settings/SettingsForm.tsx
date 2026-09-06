'use client';

import { Check, FolderCog, KeyRound, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import type { SettingsProviderStatus } from '@/application/provider-status-service';
import { AlertBanner } from '@/components/ui/AlertBanner';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { LumerConfigInput, SettingsView } from '@/lib/config/lumer-config';
import type { AIProvider, AnalyzeProvider, ChatProvider } from '@/types';

interface SuccessEnvelope<T> { data: T }
interface ErrorEnvelope { error: { code: string; message: string; retryable: boolean; details: Record<string, unknown> | null } }
interface ProviderConfigView {
  app: string | null;
  model: string | null;
  base_url_configured: boolean;
  has_api_key: boolean;
  config_file_present: boolean;
}
interface ProviderConfigForm {
  app: string;
  base_url: string;
  model: string;
  api_key: string;
}

const emptyForm: LumerConfigInput = {
  vault_path: '',
  default_chat_provider: null,
  default_analyze_provider: null,
};

const emptyProviderConfig: ProviderConfigForm = {
  app: '',
  base_url: '',
  model: '',
  api_key: '',
};

function providerLabel(provider: AIProvider): string {
  return provider === 'codex' ? 'Codex' : 'API';
}

function providerStateCopy(status: SettingsProviderStatus): { tone: 'success' | 'warning' | 'danger'; label: string; detail: string } {
  if (status.transport === 'http') {
    if (!status.configured) return { tone: 'warning', label: '未配置', detail: '请在自定义 API 中填写地址与模型' };
    if (status.authenticated === false) return { tone: 'danger', label: '鉴权失败', detail: 'API 服务拒绝了鉴权' };
    if (!status.available) return { tone: 'danger', label: '不可用', detail: 'API 服务或配置模型当前不可用' };
    return { tone: 'success', label: '可用', detail: status.detected_model ? `已确认模型：${status.detected_model}` : 'API 服务已连接' };
  }
  if (!status.installed) return { tone: 'danger', label: '缺失', detail: '未检测到 Codex CLI' };
  if (!status.authenticated) return { tone: 'warning', label: '未登录', detail: 'Codex CLI 已安装，但尚未登录' };
  if (!status.available) return { tone: 'danger', label: '不可用', detail: 'Codex 当前无法使用' };
  return { tone: 'success', label: '可用', detail: 'Codex CLI 已安装并登录' };
}

export function SettingsForm() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [form, setForm] = useState<LumerConfigInput>(emptyForm);
  const [savedForm, setSavedForm] = useState<LumerConfigInput>(emptyForm);
  const [providers, setProviders] = useState<SettingsProviderStatus[]>([]);
  const [providerConfig, setProviderConfig] = useState<ProviderConfigView | null>(null);
  const [providerConfigForm, setProviderConfigForm] = useState<ProviderConfigForm>(emptyProviderConfig);
  const [loading, setLoading] = useState(true);
  const [refreshingProviders, setRefreshingProviders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [providerConfigLoading, setProviderConfigLoading] = useState(true);
  const [savingProviderConfig, setSavingProviderConfig] = useState(false);
  const [providerConfigMessage, setProviderConfigMessage] = useState<string | null>(null);
  const [providerConfigError, setProviderConfigError] = useState<ErrorEnvelope['error'] | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<ErrorEnvelope['error'] | null>(null);

  const loadProviders = useCallback(async () => {
    setRefreshingProviders(true);
    try {
      const response = await fetch('/api/providers', { cache: 'no-store' });
      const payload = await response.json() as SuccessEnvelope<SettingsProviderStatus[]> | ErrorEnvelope;
      if (!response.ok || !('data' in payload)) throw new Error('Provider status unavailable');
      setProviders(payload.data);
    } catch {
      setProviders([
        { provider: 'codex', transport: 'cli', configured: false, installed: false, authenticated: false, available: false, detected_model: null, failure_code: 'PROVIDER_UNAVAILABLE' },
        { provider: 'openai_compatible', transport: 'http', configured: false, installed: null, authenticated: null, available: false, detected_model: null, failure_code: 'PROVIDER_NOT_CONFIGURED' },
      ]);
    } finally {
      setRefreshingProviders(false);
    }
  }, []);

  const loadProviderConfig = useCallback(async () => {
    setProviderConfigLoading(true);
    try {
      const response = await fetch('/api/provider-config', { cache: 'no-store' });
      const payload = await response.json() as SuccessEnvelope<ProviderConfigView> | ErrorEnvelope;
      if (!response.ok || !('data' in payload)) throw new Error('Provider config unavailable');
      setProviderConfig(payload.data);
      setProviderConfigForm((current) => ({
        ...current,
        app: payload.data.app ?? '',
        model: payload.data.model ?? '',
        // Base URL is deliberately not returned by the redacted GET endpoint.
        base_url: '',
        api_key: '',
      }));
    } catch {
      setProviderConfigError({ code: 'INTERNAL_ERROR', message: '无法读取自定义 API 配置。', retryable: true, details: null });
    } finally {
      setProviderConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/settings', { cache: 'no-store' });
        const payload = await response.json() as SuccessEnvelope<SettingsView> | ErrorEnvelope;
        if (!response.ok || !('data' in payload)) throw new Error('Settings unavailable');
        if (cancelled) return;
        const initialForm = payload.data.config ? {
          vault_path: payload.data.config.vault_path,
          default_chat_provider: payload.data.config.default_chat_provider,
          default_analyze_provider: payload.data.config.default_analyze_provider,
        } : emptyForm;
        setSettings(payload.data);
        setForm(initialForm);
        setSavedForm(initialForm);
      } catch {
        if (!cancelled) setError({ code: 'INTERNAL_ERROR', message: '无法读取本地设置。', retryable: true, details: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) await Promise.all([loadProviders(), loadProviderConfig()]);
    };
    void load();
    return () => { cancelled = true; };
  }, [loadProviderConfig, loadProviders]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(savedForm), [form, savedForm]);
  const absolutePath = /^(?:\/|[A-Za-z]:[\\/])/.test(form.vault_path.trim());
  const providerAvailable = (provider: AIProvider | null) => provider === null || providers.some((item) => item.provider === provider && item.available);
  const providerSelectionValid = providerAvailable(form.default_chat_provider) && providerAvailable(form.default_analyze_provider);
  const canSave = dirty && absolutePath && providerSelectionValid && !saving;
  const canSaveProviderConfig = providerConfigForm.app.trim().length > 0
    && providerConfigForm.base_url.trim().length > 0
    && providerConfigForm.model.trim().length > 0
    && !savingProviderConfig

  const updateProviderConfigField = (field: keyof ProviderConfigForm, value: string) => {
    setProviderConfigForm((current) => ({ ...current, [field]: value }));
    setProviderConfigMessage(null);
    setProviderConfigError(null);
  };

  const handleProviderConfigSave = async () => {
    if (!canSaveProviderConfig) return;
    setSavingProviderConfig(true);
    setProviderConfigMessage(null);
    setProviderConfigError(null);
    try {
      const response = await fetch('/api/provider-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: providerConfigForm.app,
          base_url: providerConfigForm.base_url,
          model: providerConfigForm.model,
          api_key: providerConfigForm.api_key,
        }),
      });
      const payload = await response.json() as SuccessEnvelope<ProviderConfigView> | ErrorEnvelope;
      if (!response.ok || !('data' in payload)) {
        setProviderConfigError('error' in payload ? payload.error : { code: 'INTERNAL_ERROR', message: '自定义 API 保存失败。', retryable: true, details: null });
        return;
      }
      setProviderConfig(payload.data);
      setProviderConfigForm((current) => ({ ...current, api_key: '', base_url: '' }));
      setProviderConfigMessage('当前服务已更新，重启后对新进程生效。');
      await loadProviders();
    } catch {
      setProviderConfigError({ code: 'INTERNAL_ERROR', message: '自定义 API 保存失败，当前配置未更改。', retryable: true, details: null });
    } finally {
      setSavingProviderConfig(false);
    }
  };

  const handleProviderConfigClearKey = async () => {
    if (!providerConfig?.has_api_key || !window.confirm('确认清除当前 API Key？')) return;
    setSavingProviderConfig(true);
    setProviderConfigMessage(null);
    setProviderConfigError(null);
    try {
      const response = await fetch('/api/provider-config/api-key', { method: 'DELETE' });
      const payload = await response.json() as SuccessEnvelope<ProviderConfigView> | ErrorEnvelope;
      if (!response.ok || !('data' in payload)) {
        setProviderConfigError('error' in payload ? payload.error : { code: 'INTERNAL_ERROR', message: 'API Key 清除失败。', retryable: true, details: null });
        return;
      }
      setProviderConfig(payload.data);
      setProviderConfigMessage('API Key 已清除。');
      await loadProviders();
    } catch {
      setProviderConfigError({ code: 'INTERNAL_ERROR', message: 'API Key 清除失败，当前配置未更改。', retryable: true, details: null });
    } finally {
      setSavingProviderConfig(false);
    }
  };

  const handleSave = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await response.json() as SuccessEnvelope<SettingsView> | ErrorEnvelope;
      if (!response.ok || !('data' in payload)) {
        setError('error' in payload ? payload.error : { code: 'INTERNAL_ERROR', message: '配置保存失败。', retryable: true, details: null });
        return;
      }
      const persisted = payload.data.config ? {
        vault_path: payload.data.config.vault_path,
        default_chat_provider: payload.data.config.default_chat_provider,
        default_analyze_provider: payload.data.config.default_analyze_provider,
      } : emptyForm;
      setSettings(payload.data);
      setForm(persisted);
      setSavedForm(persisted);
      setSaveMessage('路径已验证，设置已原子保存。');
    } catch {
      setError({ code: 'INTERNAL_ERROR', message: '配置保存失败，当前设置未更改。', retryable: true, details: null });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="lumer-settings-skeleton" aria-label="正在读取设置" />;

  const invalidPath = error?.code === 'VAULT_PATH_INVALID' || error?.code === 'VAULT_PERMISSION_DENIED' || error?.code === 'VAULT_UNAVAILABLE';

  return (
    <form className="lumer-settings-column" onSubmit={(event) => void handleSave(event)}>
      {error && (
        <AlertBanner tone="danger" title="配置保存失败">{error.message}当前已保存设置未更改，表单输入已保留。</AlertBanner>
      )}
      {saveMessage && <AlertBanner tone="success" title="设置已保存">{saveMessage}</AlertBanner>}

      <div className="lumer-page-heading lumer-settings-heading">
        <div>
          <p className="lumer-eyebrow">LOCAL CONFIGURATION</p>
          <h1>本地设置</h1>
          <p>配置 Vault、默认 Provider 与本机自定义 API。</p>
        </div>
        <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
          <Save aria-hidden="true" size={16} strokeWidth={1.75} />保存设置
        </Button>
      </div>

      <section className="lumer-settings-section">
        <div className="lumer-section-title">
          <span><FolderCog aria-hidden="true" size={18} strokeWidth={1.75} /></span>
          <div><h2>Obsidian Vault</h2><p>唯一业务数据根，更换路径不会迁移旧 Vault 内容。</p></div>
        </div>
        <div className="lumer-field">
          <label htmlFor="vault-path">Vault 绝对路径</label>
          <div className="lumer-field-row">
            <input
              aria-invalid={invalidPath || (!absolutePath && form.vault_path.length > 0)}
              id="vault-path"
              onChange={(event) => { setForm((current) => ({ ...current, vault_path: event.target.value })); setSaveMessage(null); setError(null); }}
              placeholder="/Users/name/Documents/Research Vault"
              value={form.vault_path}
            />
            <Button type="submit" disabled={!canSave} loading={saving}>验证路径</Button>
          </div>
          {!absolutePath && form.vault_path.length > 0 && <p className="lumer-field-error">Vault 路径必须是绝对路径。</p>}
        </div>
        {settings?.vault_status === 'valid' && !dirty && (
          <AlertBanner tone="success" title="Vault 已验证">目录可读、可写{settings.obsidian_initialized ? '，已识别 Obsidian。' : '；未检测到 .obsidian，仍可使用。'}</AlertBanner>
        )}
        {settings?.vault_status === 'unconfigured' && !dirty && (
          <AlertBanner tone="info" title="Vault 尚未配置">输入一个已存在的可读写目录后保存。</AlertBanner>
        )}
      </section>

      <section className="lumer-settings-section">
        <div className="lumer-section-title">
          <span><ShieldCheck aria-hidden="true" size={18} strokeWidth={1.75} /></span>
          <div><h2>默认 Provider</h2><p>自由对话与论文分析独立选择，不会静默 fallback。</p></div>
        </div>

        <div className="lumer-setting-row">
          <div><strong>自由对话</strong><span>用于 Reader 中的解释、翻译与自由对话</span></div>
          <select aria-label="默认自由对话 Provider" value={form.default_chat_provider ?? ''} onChange={(event) => setForm((current) => ({ ...current, default_chat_provider: (event.target.value || null) as ChatProvider | null }))}>
            <option value="">未设置</option>
            {providers.map((item) => <option disabled={!item.available} key={item.provider} value={item.provider}>{providerLabel(item.provider)}{item.available ? '' : ' · 不可用'}</option>)}
          </select>
        </div>

        <div className="lumer-setting-row">
          <div><strong>论文分析</strong><span>每次 Analyze / Retry 都创建独立 Provider 任务</span></div>
          <select aria-label="默认论文分析 Provider" value={form.default_analyze_provider ?? ''} onChange={(event) => setForm((current) => ({ ...current, default_analyze_provider: (event.target.value || null) as AnalyzeProvider | null }))}>
            <option value="">未设置</option>
            {providers.map((item) => <option disabled={!item.available} key={item.provider} value={item.provider}>{providerLabel(item.provider)}{item.available ? '' : ' · 不可用'}</option>)}
          </select>
        </div>

        <div className="lumer-provider-header">
          <strong>Provider 状态</strong>
          <Button type="button" variant="ghost" loading={refreshingProviders} onClick={() => void loadProviders()}>
            <RefreshCw aria-hidden="true" size={15} strokeWidth={1.75} />刷新状态
          </Button>
        </div>
        <div className="lumer-provider-list">
          {providers.map((provider) => {
            const copy = providerStateCopy(provider);
            return (
              <div className="lumer-provider-row" key={provider.provider}>
                <span className="lumer-provider-mark">{provider.transport === 'http' ? 'OA' : 'CX'}</span>
                <div><strong>{provider.provider === 'openai_compatible' ? 'API（OpenAI-compatible）' : 'Codex CLI'}</strong><span>{copy.detail}</span></div>
                <StatusBadge tone={copy.tone}>{copy.tone === 'success' && <Check aria-hidden="true" size={13} />}{copy.label}</StatusBadge>
              </div>
            );
          })}
          <div className="lumer-provider-row" aria-label="Claude Code 未接入">
            <span className="lumer-provider-mark">CL</span>
            <div><strong>Claude Code</strong><span>未接入</span></div>
            <Button disabled type="button" variant="ghost">未接入</Button>
          </div>
        </div>

        <p className="lumer-credential-note">
          Lumer 不保存 Codex 密钥、Token、Cookie、CLI 路径或权限参数；自定义 API 配置仅保存于本机配置文件。
        </p>
      </section>

      <section className="lumer-settings-section" aria-labelledby="custom-api-title">
        <div className="lumer-section-title">
          <span><KeyRound aria-hidden="true" size={18} strokeWidth={1.75} /></span>
          <div><h2 id="custom-api-title">自定义 API</h2><p>填写一个 OpenAI-compatible 服务，配置只保存在本机。</p></div>
        </div>
        {providerConfigError && <AlertBanner tone="danger" title="自定义 API 操作失败">{providerConfigError.message}</AlertBanner>}
        {providerConfigMessage && <AlertBanner tone="success" title="自定义 API 已更新">{providerConfigMessage}</AlertBanner>}
        {providerConfigLoading ? <div className="lumer-inline-skeleton" aria-label="正在读取自定义 API 配置" /> : (
          <div className="lumer-provider-config-grid">
            <div className="lumer-field">
              <label htmlFor="provider-app">App / 服务名称</label>
              <input id="provider-app" value={providerConfigForm.app} onChange={(event) => updateProviderConfigField('app', event.target.value)} placeholder="例如：本地模型服务" />
            </div>
            <div className="lumer-field">
              <label htmlFor="provider-base-url">API URL</label>
              <input id="provider-base-url" value={providerConfigForm.base_url} onChange={(event) => updateProviderConfigField('base_url', event.target.value)} placeholder={providerConfig?.base_url_configured ? '已配置但不回显，请重新填写' : 'https://api.example.com/v1'} />
            </div>
            <div className="lumer-field">
              <label htmlFor="provider-model">模型</label>
              <input id="provider-model" value={providerConfigForm.model} onChange={(event) => updateProviderConfigField('model', event.target.value)} placeholder="例如：gpt-4o-mini" />
            </div>
            <div className="lumer-field">
              <label htmlFor="provider-api-key">API Key</label>
              <input id="provider-api-key" type="password" autoComplete="new-password" value={providerConfigForm.api_key} onChange={(event) => updateProviderConfigField('api_key', event.target.value)} placeholder={providerConfig?.has_api_key ? '已配置，留空以保留' : '可选'} />
              {providerConfig?.has_api_key && <p className="lumer-field-hint">当前 API Key：已配置</p>}
            </div>
          </div>
        )}
        <div className="lumer-provider-config-actions">
          <Button type="button" variant="primary" loading={savingProviderConfig} disabled={!canSaveProviderConfig} onClick={() => void handleProviderConfigSave()}>
            <Save aria-hidden="true" size={15} strokeWidth={1.75} />保存 API 配置
          </Button>
          <Button type="button" variant="ghost" loading={refreshingProviders} onClick={() => { void loadProviderConfig(); void loadProviders(); }}>
            <RefreshCw aria-hidden="true" size={15} strokeWidth={1.75} />刷新状态
          </Button>
          <Button type="button" variant="ghost" disabled={!providerConfig?.has_api_key || savingProviderConfig} onClick={() => void handleProviderConfigClearKey()}>
            <Trash2 aria-hidden="true" size={15} strokeWidth={1.75} />清除 API Key
          </Button>
        </div>
      </section>
    </form>
  );
}
