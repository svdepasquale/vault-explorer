import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The synthetic vault under test/fixtures, in its final state. Never edited by tests. */
export const FIXTURE_VAULT = fileURLToPath(new URL('../fixtures/vault', import.meta.url));

export function makeTempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `vault-explorer-${label}-`));
}

export async function removeTempDir(dir: string | undefined): Promise<void> {
  if (dir) await rm(dir, { recursive: true, force: true });
}

/** Copy the fixture vault (or one file/folder of it) into `dest`. */
export async function copyFixture(dest: string, relative = ''): Promise<void> {
  await cp(join(FIXTURE_VAULT, relative), join(dest, relative), { recursive: true });
}
