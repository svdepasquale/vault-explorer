import { pageKind } from '../../src/core/model.ts';
import type { Page } from '../../src/shared/model.ts';

/**
 * A complete, healthy `Page` for unit tests: every universal field present,
 * indexed, small. Override only what the test is about.
 */
export function makePage(id: string, overrides: Partial<Page> = {}): Page {
  const slash = id.lastIndexOf('/');
  const stem = slash >= 0 ? id.slice(slash + 1) : id;
  const folder = slash >= 0 ? id.slice(0, slash) : '';
  const type = overrides.type ?? 'meta';
  return {
    id,
    path: `wiki/${id}.md`,
    stem,
    folder,
    title: stem,
    description: `About ${stem}`,
    type,
    kind: pageKind(id, folder, type),
    status: null,
    domain: null,
    tags: ['fixture'],
    created: null,
    updated: null,
    address: null,
    indexed: true,
    bytes: 512,
    words: 64,
    frontmatter: { name: stem, description: `About ${stem}`, type, tags: ['fixture'] },
    frontmatterError: null,
    git: { first: null, last: null, commits: [] },
    ...overrides,
  };
}
