import { ExtractedPaper, ExtractedPaperSchema } from '@/domain/paper';
import { UuidSchema } from '@/domain/storage-types';
import {
  removeVaultFile,
  vaultPathExists,
  writeStagedBytes,
} from '@/lib/storage/staged-file';
import { VersionedJsonRepository } from '@/lib/storage/versioned-json-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export class ExtractionRepository {
  private readonly json: VersionedJsonRepository<'extracted_paper'>;

  constructor(private readonly context: VaultContext) {
    this.json = new VersionedJsonRepository(context, 'extracted_paper');
  }

  relativePath(paperId: string): string {
    return `.lumer/extractions/${UuidSchema.parse(paperId)}.json`;
  }

  async read(paperId: string): Promise<ExtractedPaper> {
    return this.json.read(this.relativePath(paperId));
  }

  async exists(paperId: string): Promise<boolean> {
    return vaultPathExists(this.context, this.relativePath(paperId));
  }

  async writeStaged(relativePath: string, extraction: ExtractedPaper): Promise<void> {
    const validated = ExtractedPaperSchema.parse(extraction);
    await writeStagedBytes(this.context, relativePath, `${JSON.stringify(validated, null, 2)}\n`);
  }

  async remove(relativePath: string): Promise<boolean> {
    return removeVaultFile(this.context, relativePath);
  }
}
