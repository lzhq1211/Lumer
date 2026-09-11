'use client';

import { KeyRound, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AlertBanner } from '@/components/ui/AlertBanner';
import { Button } from '@/components/ui/Button';

export function EasyScholarSettings() {
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch('/api/easyscholar-config', { cache: 'no-store' }).then((response) => response.json()).then((payload: { data?: { configured: boolean } }) => {
      if (payload.data) setConfigured(payload.data.configured);
    }).catch(() => undefined);
  }, []);

  const save = async () => {
    if (!key.trim()) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/easyscholar-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret_key: key }) });
      const payload = await response.json() as { data?: { configured: boolean }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || 'EasyScholar 配置保存失败。');
      setConfigured(payload.data.configured); setKey(''); setMessage('EasyScholar SecretKey 已保存。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'EasyScholar 配置保存失败。'); }
    finally { setSaving(false); }
  };

  const clear = async () => {
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/easyscholar-config', { method: 'DELETE' });
      const payload = await response.json() as { data?: { configured: boolean }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || 'EasyScholar 配置清除失败。');
      setConfigured(false); setMessage('EasyScholar SecretKey 已清除。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'EasyScholar 配置清除失败。'); }
    finally { setSaving(false); }
  };

  return <section className="lumer-settings-section">
    <div className="lumer-section-title"><span><KeyRound aria-hidden="true" size={18} strokeWidth={1.75} /></span><div><h2>EasyScholar 期刊标签</h2><p>用于查询 SCI、CCF、JCR 等期刊标签。密钥只保存在本机配置。</p></div></div>
    {error ? <AlertBanner tone="danger" title="保存失败">{error}</AlertBanner> : null}
    {message ? <AlertBanner tone="success" title="已更新">{message}</AlertBanner> : null}
    <div className="lumer-field"><label htmlFor="easyscholar-key">SecretKey</label><div className="lumer-field-row"><input id="easyscholar-key" onChange={(event) => setKey(event.target.value)} placeholder={configured ? '已配置，输入新 Key 可替换' : '输入 EasyScholar SecretKey'} type="password" value={key} /><Button disabled={!key.trim() || saving} loading={saving} onClick={() => void save()} type="button"><Save aria-hidden="true" size={15} />保存</Button>{configured ? <Button disabled={saving} onClick={() => void clear()} type="button" variant="secondary"><Trash2 aria-hidden="true" size={15} />清除</Button> : null}</div></div>
  </section>;
}
