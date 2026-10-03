import { mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildVaultModel } from '../src/core/model.ts';
import { HOT_BUDGET_BYTES, type Link, type PageKind, type Relation, type VaultModel } from '../src/shared/model.ts';
import { copyFixture, FIXTURE_VAULT, makeTempDir, removeTempDir } from './helpers/fixture.ts';
import { commitAll, git, initRepo } from './helpers/git.ts';

// Scripted history (author = committer date), oldest first. The fixture folder
// holds the final state; earlier versions live here. A non-UTC offset on
// purpose: `%aI` prints UTC as `Z` in recent git and as `+00:00` in older ones.
const C1 = '2026-01-05T09:00:00+01:00'; // seed: alpha v1, beta as beta-draft, rotate draft, legacy
const C2 = '2026-02-10T09:00:00+01:00'; // alpha links beta (body + hosted_on); rotate deleted
const C3 = '2026-03-15T09:00:00+01:00'; // pure rename beta-draft → beta; rotate re-created
const C4 = '2026-04-20T09:00:00+01:00'; // legacy deleted, never re-created → ghost
const C5 = '2026-05-01T09:00:00+01:00'; // everything else, beta gains hosts/related lines
const NOW = new Date('2026-06-01T00:00:00Z');

// No mention of beta anywhere, so the alpha → beta pair is first written in C2.
const ALPHA_V1 = `---
name: Alpha
description: Fixture entity
type: entity
tags: [fixture]
status: active
created: 2026-01-05
updated: 2026-01-05
---
# Alpha

Alpha is rotated with [[rotate]].
`;

// Byte-identical to beta.md at C3 (git mv, no edit → R100). C5 only inserts
// lines, so the gamma lines below are never re-added under the new name.
const BETA_DRAFT = `---
name: Beta
description: Fixture entity that hosts alpha
type: entity
tags: [fixture]
relations:
  depends_on: ["[[gamma]]"]
---
# Beta

Beta reads its configuration from [[sources/gamma|the gamma source]].
`;

// Deliberately unlike beta-draft, so rename detection cannot pair them.
const ROTATE_DRAFT = `---
name: Rotate alpha
description: First draft of the rotation runbook
type: meta
tags: [draft]
---
# Rotate alpha (draft)

Steps to be written.
`;

const LEGACY = `---
name: Legacy
description: Fixture entity that gets retired
type: entity
tags: [fixture]
---
# Legacy

Superseded by [[alpha]].
`;

async function write(root: string, relative: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, relative)), { recursive: true });
  await writeFile(join(root, relative), text);
}

async function scriptHistory(vault: string): Promise<void> {
  await initRepo(vault);
  for (const file of ['index.md', 'entities/_index.md', 'sources/_index.md', 'sources/gamma.md']) await copyFixture(vault, `wiki/${file}`);
  await write(vault, 'wiki/entities/alpha.md', ALPHA_V1);
  await write(vault, 'wiki/entities/beta-draft.md', BETA_DRAFT);
  await write(vault, 'wiki/runbooks/rotate.md', ROTATE_DRAFT);
  await write(vault, 'wiki/entities/legacy.md', LEGACY);
  await commitAll(vault, 'seed: first pages', C1);

  await copyFixture(vault, 'wiki/entities/alpha.md');
  await rm(join(vault, 'wiki/runbooks/rotate.md'));
  await commitAll(vault, 'alpha: run on beta, drop the rotate draft', C2);

  await git(vault, ['mv', 'wiki/entities/beta-draft.md', 'wiki/entities/beta.md']);
  await copyFixture(vault, 'wiki/runbooks/rotate.md');
  await commitAll(vault, 'beta: final name, rotate: rewrite', C3);

  await rm(join(vault, 'wiki/entities/legacy.md'));
  await commitAll(vault, 'legacy: retire', C4);

  await copyFixture(vault);
  // Committed but never pages: a dot-folder note and an attachment.
  await write(vault, 'wiki/.obsidian/workspace.md', 'editor state, mentions [[alpha]]\n');
  await write(vault, 'wiki/entities/diagram.png', 'not really a png\n');
  await commitAll(vault, 'fixture: final state', C5);
}

const EXPECTED_KINDS: Record<string, PageKind> = {
  index: 'nav',
  hot: 'nav',
  'entities/_index': 'nav',
  'sources/_index': 'nav',
  'entities/alpha': 'entity',
  'entities/archived': 'entity',
  'entities/beta': 'entity',
  'sources/gamma': 'source',
  'runbooks/rotate': 'runbook',
  'meta/profile/feedback-x': 'profile',
  'folds/fold-1': 'fold',
  'meta/broken-yaml': 'meta',
  'meta/no-frontmatter': 'meta',
};

// Health does not depend on git: the same list with and without history.
const EXPECTED_HEALTH = [
  'error frontmatter-missing meta/no-frontmatter',
  'error frontmatter-yaml meta/broken-yaml',
  'error link-unresolved entities/alpha',
  'error relation-unresolved meta/broken-yaml',
  'warning orphan meta/broken-yaml',
  'warning orphan meta/no-frontmatter',
  'warning orphan meta/profile/feedback-x',
  'warning relation-asymmetric entities/alpha',
  'warning relation-unknown-predicate runbooks/rotate',
  'info link-ambiguous entities/beta',
  'info related-deprecated entities/beta',
  'info stale entities/alpha',
];

const healthLines = (model: VaultModel): string[] => model.health.map((i) => `${i.severity} ${i.check} ${i.page}`);
const relationKey = (r: Pick<Relation, 'from' | 'predicate' | 'to'>): string => `${r.from} ${r.predicate} ${r.to}`;

function finder(model: () => VaultModel) {
  return {
    page: (id: string) => {
      const found = model().pages.find((p) => p.id === id);
      if (!found) throw new Error(`no page ${id}`);
      return found;
    },
    link: (source: string, target: string): Link | undefined => model().links.find((l) => l.source === source && l.target === target),
    relation: (from: string, predicate: string, to: string): Relation | undefined =>
      model().relations.find((r) => r.from === from && r.predicate === predicate && r.to === to),
  };
}

describe('buildVaultModel — fixture vault with git history', () => {
  let root: string;
  let vault: string;
  let model: VaultModel;
  const { page, link, relation } = finder(() => model);

  beforeAll(async () => {
    root = await makeTempDir('model');
    vault = join(root, 'vault');
    await mkdir(vault);
    await scriptHistory(vault);
    // Untracked extras the parser must skip or notice.
    await write(root, 'outside/private.md', '# Outside the vault\n');
    await symlink(join(root, 'outside/private.md'), join(vault, 'wiki/entities/leak.md'));
    await write(vault, 'wiki/node_modules/pkg/readme.md', '# vendored\n');
    await write(vault, 'scripts/retrieve.py', '# stub: the recall capability only checks that this file exists\n');
    model = await buildVaultModel(vault, { now: NOW, version: 7 });
  }, 60_000);

  afterAll(() => removeTempDir(root));

  it('describes the vault and its capabilities', () => {
    expect(model).toMatchObject({ schema: 1, version: 7, generatedAt: NOW.toISOString() });
    expect(model.vault).toMatchObject({ root: vault, name: 'vault', remote: null, branch: 'main', capabilities: { git: true, recall: true } });
    expect(model.vault.head).toMatch(/^[0-9a-f]{7,}$/);
    expect(model.commits.at(-1)?.hash.startsWith(model.vault.head ?? 'no head')).toBe(true);
  });

  it('lists every page and skips dot-folders, node_modules, symlinks and attachments', () => {
    expect(model.pages.map((p) => p.id).sort()).toEqual(Object.keys(EXPECTED_KINDS).sort());
  });

  it('derives kinds from folder and type', () => {
    expect(Object.fromEntries(model.pages.map((p) => [p.id, p.kind]))).toEqual(EXPECTED_KINDS);
  });

  it('reads page fields from the frontmatter', () => {
    expect(page('entities/alpha')).toMatchObject({
      path: 'wiki/entities/alpha.md',
      stem: 'alpha',
      folder: 'entities',
      title: 'Alpha',
      description: 'Fixture entity hosted on beta',
      type: 'entity',
      status: 'active',
      tags: ['fixture', 'compute'],
      created: '2026-01-05',
      updated: '2026-01-10',
      indexed: true,
      frontmatterError: null,
    });
    expect(page('entities/archived').indexed).toBe(false);
    expect(page('hot').indexed).toBe(false);
    expect(page('meta/no-frontmatter')).toMatchObject({ title: 'no-frontmatter', type: null, frontmatter: {} });
  });

  it('falls back to the lenient parse for invalid YAML', () => {
    const broken = page('meta/broken-yaml');
    expect(broken.frontmatterError).toMatch(/^Map keys must be unique/);
    expect(broken).toMatchObject({ title: 'Broken YAML', description: 'the duplicate key above makes strict YAML throw', type: 'meta', tags: ['fixture', 'lenient'] });
    expect(link('meta/broken-yaml', 'sources/gamma')).toMatchObject({ body: 0, related: true });
    expect(relation('meta/broken-yaml', 'part_of', 'entities/alpha')).toBeDefined();
  });

  it('counts body links per pair and skips code, embeds of attachments, same-page anchors and dead links', () => {
    expect(link('entities/alpha', 'entities/beta')).toMatchObject({ body: 3, related: false });
    expect(link('entities/alpha', 'runbooks/rotate')).toMatchObject({ body: 1, related: false });
    expect(model.links.filter((l) => l.source === 'entities/alpha').map((l) => l.target).sort()).toEqual(['entities/beta', 'runbooks/rotate']);
  });

  it('merges related: entries into the same link as body mentions', () => {
    expect(link('entities/beta', 'runbooks/rotate')).toMatchObject({ body: 1, related: true });
  });

  it('records dead links and dead relations with where they were written', () => {
    expect(model.unresolved).toEqual(
      expect.arrayContaining([
        { source: 'entities/alpha', raw: 'missing-page', where: 'body' },
        { source: 'meta/broken-yaml', raw: 'nowhere', where: 'relations', predicate: 'depends_on' },
      ]),
    );
    expect(model.unresolved).toHaveLength(2);
  });

  it('merges typed relations in canonical direction across both pages', () => {
    const shape = model.relations.map(({ since: _since, ...r }) => r).sort((a, b) => relationKey(a).localeCompare(relationKey(b)));
    expect(shape).toEqual([
      { from: 'entities/alpha', predicate: 'documented_in', to: 'sources/gamma', declaredOnFrom: false, declaredOnTo: true, hasInverse: true, known: true },
      { from: 'entities/alpha', predicate: 'hosted_on', to: 'entities/beta', declaredOnFrom: true, declaredOnTo: true, hasInverse: true, known: true },
      { from: 'entities/beta', predicate: 'depends_on', to: 'sources/gamma', declaredOnFrom: true, declaredOnTo: false, hasInverse: false, known: true },
      { from: 'meta/broken-yaml', predicate: 'depends_on', to: 'sources/gamma', declaredOnFrom: true, declaredOnTo: false, hasInverse: false, known: true },
      { from: 'meta/broken-yaml', predicate: 'part_of', to: 'entities/alpha', declaredOnFrom: true, declaredOnTo: false, hasInverse: false, known: true },
      { from: 'runbooks/rotate', predicate: 'inspired_by', to: 'sources/gamma', declaredOnFrom: true, declaredOnTo: false, hasInverse: false, known: false },
    ]);
  });

  it('keeps only commits that touched pages, oldest first', () => {
    expect(model.commits.map((c) => [c.date, c.subject])).toEqual([
      [C1, 'seed: first pages'],
      [C2, 'alpha: run on beta, drop the rotate draft'],
      [C3, 'beta: final name, rotate: rewrite'],
      [C4, 'legacy: retire'],
      [C5, 'fixture: final state'],
    ]);
    expect(model.commits[1]?.changes).toEqual(
      expect.arrayContaining([
        { status: 'M', id: 'entities/alpha' },
        { status: 'D', id: 'runbooks/rotate' },
      ]),
    );
    expect(model.commits[2]?.changes).toEqual(
      expect.arrayContaining([
        { status: 'R', id: 'entities/beta', from: 'entities/beta-draft' },
        { status: 'A', id: 'runbooks/rotate' },
      ]),
    );
    // The committed .obsidian note and the attachment are not page changes.
    expect(model.commits[4]?.changes.map((c) => c.id).sort()).toEqual([
      'entities/archived',
      'entities/beta',
      'folds/fold-1',
      'hot',
      'meta/broken-yaml',
      'meta/no-frontmatter',
      'meta/profile/feedback-x',
    ]);
  });

  it('follows the rename, so beta keeps the history of beta-draft', () => {
    expect(page('entities/beta').git).toEqual({ commits: [0, 2, 4], first: C1, last: C5 });
  });

  it('keeps the earlier history of a page deleted and re-created', () => {
    expect(page('runbooks/rotate').git).toEqual({ commits: [0, 1, 2], first: C1, last: C3 });
    expect(page('entities/alpha').git).toEqual({ commits: [0, 1], first: C1, last: C2 });
  });

  it('turns a page deleted for good into a ghost', () => {
    expect(model.ghosts).toEqual([{ id: 'entities/legacy', created: C1, deleted: C4, commits: [0, 3] }]);
  });

  it('dates each link with the first commit that wrote it on its source page', () => {
    expect(link('entities/alpha', 'runbooks/rotate')?.since).toBe(C1);
    expect(link('entities/alpha', 'entities/beta')?.since).toBe(C2);
    expect(link('sources/gamma', 'entities/alpha')?.since).toBe(C1);
    expect(link('runbooks/rotate', 'entities/alpha')?.since).toBe(C3);
    expect(link('entities/beta', 'runbooks/rotate')?.since).toBe(C5);
  });

  it('dates each relation with the first commit that linked the pair on either page', () => {
    expect(relation('entities/alpha', 'hosted_on', 'entities/beta')?.since).toBe(C2);
    expect(relation('entities/alpha', 'documented_in', 'sources/gamma')?.since).toBe(C1);
    expect(relation('runbooks/rotate', 'inspired_by', 'sources/gamma')?.since).toBe(C3);
    expect(relation('meta/broken-yaml', 'part_of', 'entities/alpha')?.since).toBe(C5);
  });

  it('has a link and a relation from beta to gamma (precondition of the two dating bugs below)', () => {
    expect(link('entities/beta', 'sources/gamma')).toMatchObject({ body: 1 });
    expect(relation('entities/beta', 'depends_on', 'sources/gamma')).toBeDefined();
  });

  // BUG (src/core/git.ts:159-161 + src/core/model.ts:288-297): readLinkHistory
  // keys first-seen dates by the page path AT THE TIME of each commit, and
  // datePairs looks them up by today's page id. Links written on beta while it
  // was still beta-draft are never re-added after the (pure) rename, so they
  // get since = null instead of C1, although foldHistory follows the rename.
  it.fails('dates a link written before its page was renamed (Link.since)', () => {
    expect(link('entities/beta', 'sources/gamma')?.since).toBe(C1);
  });

  it.fails('dates a relation declared before its page was renamed (Relation.since)', () => {
    expect(relation('entities/beta', 'depends_on', 'sources/gamma')?.since).toBe(C1);
  });

  it('summarises hot.md sections with resolved links', async () => {
    const { size } = await stat(join(FIXTURE_VAULT, 'wiki/hot.md'));
    expect(model.hot).toEqual({
      id: 'hot',
      bytes: size,
      budget: HOT_BUDGET_BYTES,
      updated: '2026-05-01',
      sections: [
        {
          title: 'Open threads',
          items: [
            { text: 'Decide where [[alpha]] runs — see [[rotate]]', links: ['entities/alpha', 'runbooks/rotate'] },
            { text: 'Review [[sources/gamma|gamma]] before the next fold', links: ['sources/gamma'] },
          ],
        },
        { title: 'Recently closed', items: [{ text: 'Merged [[beta]] into the graph', links: ['entities/beta'] }] },
      ],
    });
  });

  it('computes the health report', () => {
    expect(healthLines(model)).toEqual(EXPECTED_HEALTH);
    const asymmetric = model.health.find((i) => i.check === 'relation-asymmetric');
    expect(asymmetric).toMatchObject({ other: 'sources/gamma', message: 'sources/gamma declares documents → entities/alpha; add documented_in: [[gamma]] here' });
    expect(model.health.find((i) => i.check === 'link-ambiguous')).toMatchObject({ other: 'entities/_index' });
    expect(model.health.find((i) => i.check === 'stale')?.message).toBe('status: active, last updated 2026-01-10 (142 days ago)');
  });
});

describe('buildVaultModel — the same fixture without git', () => {
  let root: string;
  let model: VaultModel;

  beforeAll(async () => {
    root = await makeTempDir('nogit');
    await copyFixture(root);
    model = await buildVaultModel(root, { now: NOW });
  });

  afterAll(() => removeTempDir(root));

  it('reports neither git nor recall', () => {
    expect(model.vault).toMatchObject({ remote: null, branch: null, head: null, capabilities: { git: false, recall: false } });
    expect(model.commits).toEqual([]);
    expect(model.ghosts).toEqual([]);
  });

  it('leaves git info and link dates empty', () => {
    for (const p of model.pages) expect(p.git).toEqual({ first: null, last: null, commits: [] });
    for (const l of model.links) expect(l.since).toBeNull();
    for (const r of model.relations) expect(r.since).toBeNull();
  });

  it('still parses pages and computes the same health report', () => {
    expect(model.pages).toHaveLength(Object.keys(EXPECTED_KINDS).length);
    expect(healthLines(model)).toEqual(EXPECTED_HEALTH);
  });
});

describe('buildVaultModel — link dates for page paths with spaces', () => {
  let root: string;
  let model: VaultModel;
  const { link } = finder(() => model);

  beforeAll(async () => {
    root = await makeTempDir('spaces');
    await initRepo(root);
    await write(root, 'wiki/entities/alpha.md', '---\nname: Alpha\n---\n# Alpha\n');
    await write(root, 'wiki/entities/plain.md', '---\nname: Plain\n---\nSee [[alpha]].\n');
    await write(root, 'wiki/entities/with space.md', '---\nname: With space\n---\nSee [[alpha]].\n');
    await commitAll(root, 'seed', C1);
    model = await buildVaultModel(root, { now: NOW });
  }, 60_000);

  afterAll(() => removeTempDir(root));

  it('dates a link on a page whose path has no space', () => {
    expect(link('entities/plain', 'entities/alpha')?.since).toBe(C1);
  });

  it('finds the link on the page whose path has a space', () => {
    expect(link('entities/with space', 'entities/alpha')).toMatchObject({ body: 1 });
  });

  it('history of the page with a space touches it like any other page', () => {
    expect(model.commits[0]?.changes).toContainEqual({ status: 'A', id: 'entities/with space' });
  });

  // BUG (src/core/git.ts:159-161): git appends a TAB to the `+++ b/<path>`
  // header when the path contains a space (measured with git 2.55:
  // "+++ b/entities/with space.md\t"), so `/\.md$/i` fails, `page` stays null
  // and no link or relation on such a page is ever dated.
  it.fails('dates a link on a page whose path has a space', () => {
    expect(link('entities/with space', 'entities/alpha')?.since).toBe(C1);
  });
});
