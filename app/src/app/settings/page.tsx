import { AppShell } from '@/components/layout/AppShell';
import { SettingsForm } from '@/components/settings/SettingsForm';

export default function SettingsPage() {
  return (
    <AppShell activeNav={null} title="设置" subtitle="Vault、Provider 与本地数据边界" settingsPage vortexTheme>
      <SettingsForm />
    </AppShell>
  );
}
