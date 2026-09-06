import {
  getVaultOperationCoordinator,
  VaultOperationCoordinatorError,
} from '@/application/vault-operation-coordinator';
import { analyzeCoordinator } from '@/application/analyze-coordinator';
import { AnalysisRunControlService } from '@/application/analysis-run-control-service';
import { AnnotationRecoveryService } from '@/application/annotation-recovery-service';
import { FinalizationRecoveryService } from '@/application/finalization-recovery-service';
import { SettingsService, SettingsServiceError } from '@/application/settings-service';
import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';
import { resolveExistingVaultPath } from '@/lib/storage/vault-path';

export async function getConfiguredVaultAccess() {
  const repository = new LumerConfigRepository();
  const coordinator = getVaultOperationCoordinator(repository);
  const settings = await new SettingsService(repository, coordinator).getSettings();
  if (!settings.config) {
    throw new VaultOperationCoordinatorError('VAULT_NOT_CONFIGURED', 'Vault 尚未配置。');
  }
  if (settings.vault_status === 'permission_denied') {
    throw new SettingsServiceError('VAULT_PERMISSION_DENIED', 'Vault 目录不可读写。', 403, false);
  }
  if (settings.vault_status !== 'valid' || !coordinator.context) {
    throw new SettingsServiceError('VAULT_UNAVAILABLE', 'Vault 目录当前不可用。', 503, true);
  }
  const context = coordinator.context;
  await coordinator.runMutation('annotation', async (recoveryContext) => {
    await new AnnotationRecoveryService().recover(recoveryContext);
    await new FinalizationRecoveryService().recover(recoveryContext);
    await new AnalysisRunControlService(analyzeCoordinator).interruptUnownedRunning(recoveryContext);
  });
  return { coordinator, context };
}

export async function resolveConfiguredVaultPath(relativePath: string): Promise<string> {
  const { context } = await getConfiguredVaultAccess();
  const resolved = await resolveExistingVaultPath(context, relativePath);
  return resolved.absolutePath;
}
