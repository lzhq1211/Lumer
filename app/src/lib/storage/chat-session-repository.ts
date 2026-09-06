import { ChatSessionStore, ChatSessionStoreSchema } from '@/domain/chat-session';
import { UuidSchema } from '@/domain/storage-types';
import { removeVaultFile, vaultPathExists } from '@/lib/storage/staged-file';
import { VersionedJsonRepository } from '@/lib/storage/versioned-json-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export class ChatSessionRepository {
  private readonly json: VersionedJsonRepository<'chat_session'>;
  constructor(private readonly context: VaultContext) { this.json = new VersionedJsonRepository(context, 'chat_session'); }
  relativePath(paperId: string): string { return `.lumer/sessions/${UuidSchema.parse(paperId)}.json`; }
  async read(paperId: string): Promise<ChatSessionStore | null> {
    const relativePath = this.relativePath(paperId);
    if (!await vaultPathExists(this.context, relativePath)) return null;
    return this.json.read(relativePath);
  }
  async write(value: ChatSessionStore): Promise<ChatSessionStore> {
    const validated = ChatSessionStoreSchema.parse(value);
    return this.json.write(this.relativePath(validated.paper_id), validated);
  }
  async remove(paperId: string): Promise<boolean> { return removeVaultFile(this.context, this.relativePath(paperId)); }
}
