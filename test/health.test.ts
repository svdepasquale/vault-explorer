import { describe, expect, it } from 'vitest';
import { computeHealth, type HealthInput } from '../src/core/health.ts';
import { canonicalize } from '../src/core/relations.ts';
import { HOT_BUDGET_BYTES, OVERSIZED_BYTES, type HealthIssue, type Link, type Relation } from '../src/shared/model.ts';
import { makePage } from './helpers/page.ts';

const NOW = new Date('2026-06-01T12:00:00Z');

function health(input: Partial<HealthInput>): HealthIssue[] {
  return computeHealth({ pages: [], links: [], relations: [], unresolved: [], ambiguous: [], hot: null, missingFrontmatter: [], now: NOW, ...input });
}

const only = (issues: HealthIssue[], check: HealthIssue['check']): HealthIssue[] => issues.filter((i) => i.check === check);

const link = (source: string, target: string): Link => ({ source, target, body: 1, related: false, since: null });

/** A relation as buildVaultModel merges it, declared on one side or both. */
function relation(from: string, predicate: string, to: string, declaredOn: 'from' | 'to' | 'both'): Relation {
  const c = canonicalize(from, predicate, to);
  return {
    from: c.from,
    predicate: c.predicate,
    to: c.to,
    declaredOnFrom: declaredOn !== 'to',
    declaredOnTo: declaredOn !== 'from',
    hasInverse: c.hasInverse,
    known: c.known,
    expectedOnFrom: c.hasInverse,
    expectedOnTo: c.hasInverse,
    since: null,
  };
}

describe('computeHealth — relations', () => {
  it('reports a forward-only declaration on the target page, which lacks the inverse', () => {
    const issues = health({ relations: [relation('entities/alpha', 'hosted_on', 'entities/beta', 'from')] });
    expect(issues).toEqual([
      {
        check: 'relation-asymmetric',
        severity: 'warning',
        page: 'entities/beta',
        other: 'entities/alpha',
        message: 'entities/alpha declares hosted_on → entities/beta; add hosts: [[alpha]] here',
      },
    ]);
  });

  it('reports an inverse-only declaration on the source page, which lacks the forward name', () => {
    const issues = health({ relations: [relation('entities/alpha', 'documented_in', 'sources/gamma', 'to')] });
    expect(issues).toEqual([
      {
        check: 'relation-asymmetric',
        severity: 'warning',
        page: 'entities/alpha',
        other: 'sources/gamma',
        message: 'sources/gamma declares documents → entities/alpha; add documented_in: [[gamma]] here',
      },
    ]);
  });

  it('accepts a relation declared on both pages', () => {
    expect(health({ relations: [relation('entities/alpha', 'hosted_on', 'entities/beta', 'both')] })).toEqual([]);
  });

  it.each(['depends_on', 'part_of', 'related_to'])('does not flag one-sided %s, which has no inverse', (predicate) => {
    expect(health({ relations: [relation('entities/alpha', predicate, 'entities/beta', 'from')] })).toEqual([]);
  });

  it('flags a predicate outside the schema, and only that', () => {
    expect(health({ relations: [relation('runbooks/rotate', 'inspired_by', 'sources/gamma', 'from')] })).toEqual([
      {
        check: 'relation-unknown-predicate',
        severity: 'warning',
        page: 'runbooks/rotate',
        other: 'sources/gamma',
        message: 'Predicate "inspired_by" is not in the schema',
      },
    ]);
  });
});

describe('computeHealth — orphans', () => {
  const pages = [
    makePage('index'),
    makePage('hot', { indexed: false }),
    makePage('entities/_index'),
    makePage('entities/lonely'),
    makePage('entities/hub', { type: 'entity' }),
    makePage('entities/spoke', { type: 'entity' }),
    makePage('entities/app', { type: 'entity' }),
    makePage('entities/host', { type: 'entity' }),
    makePage('entities/archived', { type: 'entity', indexed: false }),
    makePage('folds/fold-1'),
  ];
  const links = [
    link('index', 'entities/lonely'),
    link('entities/_index', 'entities/lonely'),
    link('entities/spoke', 'entities/hub'),
    link('folds/fold-1', 'entities/spoke'),
  ];
  const relations = [relation('entities/app', 'hosted_on', 'entities/host', 'from')];
  const orphans = only(health({ pages, links, relations }), 'orphan');

  it('flags indexed pages reached only from navigation pages, or not at all', () => {
    expect(orphans.map((i) => i.page)).toEqual(['entities/app', 'entities/lonely']);
    expect(orphans[0]).toMatchObject({ severity: 'warning', message: 'Only navigation pages link here' });
  });

  it('never flags navigation pages, folds or unindexed pages', () => {
    const flagged = new Set(orphans.map((i) => i.page));
    for (const id of ['index', 'hot', 'entities/_index', 'folds/fold-1', 'entities/archived']) expect(flagged.has(id)).toBe(false);
  });

  it('counts links from folds, and a relation reaches the page it is declared towards', () => {
    const flagged = new Set(orphans.map((i) => i.page));
    expect(flagged.has('entities/spoke')).toBe(false);
    expect(flagged.has('entities/hub')).toBe(false);
    expect(flagged.has('entities/host')).toBe(false);
  });
});

describe('computeHealth — stale, oversized, hot budget', () => {
  it('flags active-like statuses not updated for more than 60 days', () => {
    const pages = [
      makePage('entities/a', { status: 'active', updated: '2026-04-01' }), // 61 days before NOW
      makePage('entities/b', { status: 'developing', updated: '2026-04-02' }), // 60 days: not yet
      makePage('entities/c', { status: 'done', updated: '2025-01-01' }), // not an active-like status
      makePage('entities/d', { status: 'watchlist', updated: null }), // nothing to measure
      makePage('entities/e', { status: 'planned', updated: '2025-12-01' }),
    ];
    const stale = only(health({ pages }), 'stale');
    expect(stale.map((i) => i.page)).toEqual(['entities/a', 'entities/e']);
    expect(stale[0]).toMatchObject({ severity: 'info', message: 'status: active, last updated 2026-04-01 (61 days ago)' });
  });

  it('flags pages over the size threshold, navigation pages excepted', () => {
    const pages = [
      makePage('entities/big', { bytes: OVERSIZED_BYTES + 1 }),
      makePage('entities/limit', { bytes: OVERSIZED_BYTES }),
      makePage('index', { bytes: OVERSIZED_BYTES * 4 }),
    ];
    const oversized = only(health({ pages }), 'oversized');
    expect(oversized).toEqual([{ check: 'oversized', severity: 'info', page: 'entities/big', message: '24 KB (threshold 24 KB)' }]);
  });

  it.each<[number, 'warning' | 'error' | null]>([
    [Math.floor(HOT_BUDGET_BYTES * 0.9), null],
    [Math.floor(HOT_BUDGET_BYTES * 0.9) + 1, 'warning'],
    [HOT_BUDGET_BYTES, 'warning'],
    [HOT_BUDGET_BYTES + 1, 'error'],
  ])('hot.md at %i bytes → %s', (bytes, severity) => {
    const issues = only(health({ hot: { id: 'hot', bytes, budget: HOT_BUDGET_BYTES, updated: null, sections: [] } }), 'hot-budget');
    expect(issues.map((i) => i.severity)).toEqual(severity ? [severity] : []);
  });

  it('states the hot budget in bytes and percent', () => {
    const [issue] = health({ hot: { id: 'hot', bytes: HOT_BUDGET_BYTES + 1, budget: HOT_BUDGET_BYTES, updated: null, sections: [] } });
    expect(issue).toEqual({ check: 'hot-budget', severity: 'error', page: 'hot', message: '7169 B of 7168 B (100%)' });
  });
});

describe('computeHealth — frontmatter, fields, links', () => {
  it('reports a missing block once, without a missing-fields warning on top', () => {
    const pages = [makePage('meta/scratch', { frontmatter: {} })];
    const issues = health({ pages, missingFrontmatter: ['meta/scratch'] });
    expect(issues.filter((i) => i.page === 'meta/scratch' && i.check !== 'orphan')).toEqual([
      { check: 'frontmatter-missing', severity: 'error', page: 'meta/scratch', message: 'No frontmatter block' },
    ]);
  });

  it('reports invalid YAML with the parser message', () => {
    const pages = [makePage('meta/broken', { frontmatterError: 'Map keys must be unique at line 2, column 1:' })];
    expect(only(health({ pages }), 'frontmatter-yaml')).toEqual([
      { check: 'frontmatter-yaml', severity: 'error', page: 'meta/broken', message: 'Map keys must be unique at line 2, column 1:' },
    ]);
  });

  it('lists missing universal fields, empty strings and empty lists included', () => {
    const pages = [makePage('meta/thin', { frontmatter: { name: '', type: 'meta', tags: [] } })];
    expect(only(health({ pages }), 'field-missing')).toEqual([
      { check: 'field-missing', severity: 'warning', page: 'meta/thin', message: 'Missing name, description, tags' },
    ]);
  });

  it('flags related: on entity and source pages only', () => {
    const pages = [
      makePage('entities/alpha', { type: 'entity', frontmatter: { name: 'a', description: 'd', type: 'entity', tags: ['t'], related: [] } }),
      makePage('meta/note', { frontmatter: { name: 'n', description: 'd', type: 'meta', tags: ['t'], related: ['[[alpha]]'] } }),
    ];
    expect(only(health({ pages }), 'related-deprecated').map((i) => i.page)).toEqual(['entities/alpha']);
  });

  it('reports dead links, dead related: entries and dead relations', () => {
    const issues = health({
      unresolved: [
        { source: 'entities/alpha', raw: 'nowhere', where: 'body' },
        { source: 'meta/note', raw: 'gone', where: 'related' },
        { source: 'meta/note', raw: 'missing', where: 'relations', predicate: 'depends_on' },
      ],
    });
    expect(issues.map((i) => [i.check, i.page, i.message])).toEqual([
      ['link-unresolved', 'entities/alpha', '[[nowhere]] points to no page'],
      ['link-unresolved', 'meta/note', '[[gone]] in related: points to no page'],
      ['relation-unresolved', 'meta/note', 'depends_on: [[missing]] points to no page'],
    ]);
  });

  it('reports each ambiguous (page, link) pair once', () => {
    const ambiguous = [
      { source: 'entities/beta', raw: '_index', picked: 'entities/_index' },
      { source: 'entities/beta', raw: '_index', picked: 'entities/_index' },
      { source: 'entities/beta', raw: '_INDEX', picked: 'entities/_index' },
    ];
    expect(only(health({ ambiguous }), 'link-ambiguous')).toEqual([
      {
        check: 'link-ambiguous',
        severity: 'info',
        page: 'entities/beta',
        other: 'entities/_index',
        message: '[[_index]] matches several pages; resolved to entities/_index',
      },
      {
        check: 'link-ambiguous',
        severity: 'info',
        page: 'entities/beta',
        other: 'entities/_index',
        message: '[[_INDEX]] matches several pages; resolved to entities/_index',
      },
    ]);
  });
});

describe('computeHealth — ordering', () => {
  it('sorts by severity, then check, then page', () => {
    const issues = health({
      pages: [makePage('entities/z', { status: 'active', updated: '2025-01-01' }), makePage('entities/y')],
      unresolved: [{ source: 'entities/b', raw: 'x', where: 'body' }],
      missingFrontmatter: ['entities/a'],
    });
    expect(issues.map((i) => `${i.severity} ${i.check} ${i.page}`)).toEqual([
      'error frontmatter-missing entities/a',
      'error link-unresolved entities/b',
      'warning orphan entities/y',
      'warning orphan entities/z',
      'info stale entities/z',
    ]);
  });
});
