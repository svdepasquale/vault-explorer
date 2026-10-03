import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertVault, listMarkdown, pageKind, VaultError } from '../src/core/model.ts';
import type { PageKind } from '../src/shared/model.ts';
import { makeTempDir, removeTempDir } from './helpers/fixture.ts';

describe('pageKind', () => {
  it.each<[string, string | null, PageKind]>([
    ['index', null, 'nav'],
    ['hot', 'meta', 'nav'],
    ['log', null, 'nav'],
    ['overview', null, 'nav'],
    ['entities/_index', 'meta', 'nav'],
    ['meta/index', 'meta', 'meta'], // only the root index/hot/log/overview are navigation
    ['meta/profile/feedback-x', 'feedback', 'profile'],
    ['meta/profile/deep/someone', null, 'profile'],
    ['entities/me', 'user', 'profile'], // a profile type wins over the folder
    ['runbooks/rotate', 'meta', 'runbook'],
    ['folds/fold-1', 'meta', 'fold'],
    ['entities/alpha', 'entity', 'entity'],
    ['meta/alpha-report', 'entity', 'entity'],
    ['sources/gamma', 'source', 'source'],
    ['notes/vendor-docs', 'source', 'source'],
    ['meta/synthesis', 'meta', 'meta'],
    ['loose', null, 'meta'],
  ])('%s (type %s) is %s', (id, type, kind) => {
    const folder = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
    expect(pageKind(id, folder, type)).toBe(kind);
  });
});

describe('assertVault and listMarkdown', () => {
  let root: string;

  beforeAll(async () => {
    root = await makeTempDir('list');
    const tree = join(root, 'tree');
    for (const dir of ['.obsidian', 'node_modules/pkg', 'sub/deeper']) await mkdir(join(tree, dir), { recursive: true });
    for (const file of ['a.md', 'b.md', 'c-upper.MD', 'notes.txt', '.hidden.md', '.obsidian/x.md', 'node_modules/pkg/y.md', 'sub/c.md', 'sub/deeper/d.md']) {
      await writeFile(join(tree, file), '# page\n');
    }
    await symlink('a.md', join(tree, 'link.md'));
    await symlink('sub', join(tree, 'linkdir'));
    await mkdir(join(root, 'vault/wiki'), { recursive: true });
    await mkdir(join(root, 'wiki-is-a-file'));
    await writeFile(join(root, 'wiki-is-a-file/wiki'), 'not a folder\n');
    await writeFile(join(root, 'plain-file'), 'not a folder\n');
  });

  afterAll(() => removeTempDir(root));

  it('lists .md files recursively, sorted, as relative paths', async () => {
    expect(await listMarkdown(join(root, 'tree'))).toEqual(['a.md', 'b.md', 'c-upper.MD', 'sub/c.md', 'sub/deeper/d.md']);
  });

  it('accepts a directory that holds a wiki/ folder', async () => {
    await expect(assertVault(join(root, 'vault'))).resolves.toBeUndefined();
  });

  it.each([
    ['a missing path', 'missing', 'not-found'],
    ['a file', 'plain-file', 'not-a-directory'],
    ['a folder without wiki/', 'tree', 'no-wiki'],
    ['a folder whose wiki is a file', 'wiki-is-a-file', 'no-wiki'],
  ])('rejects %s', async (_label, path, code) => {
    const error = await assertVault(join(root, path)).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(VaultError);
    expect(error).toMatchObject({ code });
  });
});
