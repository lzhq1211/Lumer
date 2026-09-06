import { spawn } from 'node:child_process';
import path from 'node:path';

export async function generatePdfFixtures(outputDirectory: string): Promise<void> {
  const python = path.join(process.cwd(), '.venv/bin/python3');
  const script = path.join(process.cwd(), 'tests/fixtures/create_pdf_fixtures.py');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, [script, outputDirectory], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`PDF fixture generator failed with exit code ${exitCode ?? 'unknown'}`));
    });
  });
}
