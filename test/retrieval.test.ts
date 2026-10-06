import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRetrieve, retrieveCandidates } from '../src/core/retrieval.ts';
import { makeTempDir, removeTempDir } from './helpers/fixture.ts';

async function stubRetrieve(dir: string): Promise<string> {
  const path = join(dir, 'scripts', 'retrieve.py');
  await mkdir(join(dir, 'scripts'), { recursive: true });
  await writeFile(path, '# stub\n');
  return path;
}

describe('where recall finds retrieve.py', () => {
  let root: string;
  let vault: string;

  beforeAll(async () => {
    root = await makeTempDir('retrieval');
    vault = join(root, 'vault');
    await mkdir(vault);
  });

  afterAll(() => removeTempDir(root));

  it('lists VAULT_ENGINE first, then a vault-engine checkout next to the vault, then the vault itself', () => {
    expect(retrieveCandidates(vault, { VAULT_ENGINE: '/opt/engine' })).toEqual([
      join('/opt/engine', 'scripts', 'retrieve.py'),
      join(root, 'vault-engine', 'scripts', 'retrieve.py'),
      join(vault, 'scripts', 'retrieve.py'),
    ]);
    expect(retrieveCandidates(vault, {})).toHaveLength(2);
  });

  it('finds nothing when no candidate exists', async () => {
    expect(await findRetrieve(vault, {})).toBeNull();
  });

  it('prefers the sibling vault-engine checkout over the vault’s own scripts', async () => {
    const own = await stubRetrieve(vault);
    expect(await findRetrieve(vault, {})).toBe(own);
    const engine = await stubRetrieve(join(root, 'vault-engine'));
    expect(await findRetrieve(vault, {})).toBe(engine);
  });

  it('lets VAULT_ENGINE override both', async () => {
    const custom = await stubRetrieve(join(root, 'elsewhere'));
    expect(await findRetrieve(vault, { VAULT_ENGINE: join(root, 'elsewhere') })).toBe(custom);
  });
});
