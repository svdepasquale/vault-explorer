import { describe, expect, it } from 'vitest';
import { isOneSided } from '../src/shared/model.ts';
import { canonicalize, predicateDef, readLinkList, readRelations } from '../src/core/relations.ts';
import { PREDICATES } from '../src/shared/model.ts';

describe('canonicalize', () => {
  it('keeps a forward declaration as written', () => {
    expect(canonicalize('entities/alpha', 'hosted_on', 'entities/beta')).toEqual({
      from: 'entities/alpha',
      predicate: 'hosted_on',
      to: 'entities/beta',
      known: true,
      hasInverse: true,
      forward: true,
    });
  });

  it('marks forward predicates that have no inverse', () => {
    expect(canonicalize('entities/alpha', 'depends_on', 'sources/gamma')).toMatchObject({ known: true, hasInverse: false, forward: true });
  });

  it('rewrites an inverse declaration into the forward direction', () => {
    expect(canonicalize('entities/beta', 'hosts', 'entities/alpha')).toEqual({
      from: 'entities/alpha',
      predicate: 'hosted_on',
      to: 'entities/beta',
      known: true,
      hasInverse: true,
      forward: false,
    });
  });

  it.each(PREDICATES.filter((p) => p.inverse !== null).map((p) => [p.name, p.inverse ?? '']))(
    '%s and its inverse %s meet on the same canonical edge',
    (name, inverse) => {
      const forward = canonicalize('a', name, 'b');
      const backward = canonicalize('b', inverse, 'a');
      expect({ ...backward, forward: true }).toEqual(forward);
      expect(backward.forward).toBe(false);
    },
  );

  it('passes unknown predicates through, flagged', () => {
    expect(canonicalize('runbooks/rotate', 'inspired_by', 'sources/gamma')).toEqual({
      from: 'runbooks/rotate',
      predicate: 'inspired_by',
      to: 'sources/gamma',
      known: false,
      hasInverse: false,
      forward: true,
    });
  });
});

describe('predicateDef', () => {
  it('knows forward names only', () => {
    expect(predicateDef('hosted_on')?.inverse).toBe('hosts');
    expect(predicateDef('hosts')).toBeUndefined();
    expect(predicateDef('inspired_by')).toBeUndefined();
  });
});

describe('readLinkList', () => {
  it('reads wikilink targets and plain names, skipping non-strings and blanks', () => {
    expect(readLinkList(['[[alpha]]', '[[beta|Beta]]', '[[gamma#Setup]]', 'plain-name', 3, null, '  '])).toEqual([
      'alpha',
      'beta',
      'gamma',
      'plain-name',
    ]);
  });

  it('reads a single string, several links in it included', () => {
    expect(readLinkList('[[alpha]]')).toEqual(['alpha']);
    expect(readLinkList('[[alpha]], [[beta]]')).toEqual(['alpha', 'beta']);
  });

  it('ignores same-page anchors', () => {
    expect(readLinkList(['[[#Heading]]'])).toEqual([]);
  });
});

describe('readRelations', () => {
  it('flattens a relations: map into predicate/target pairs', () => {
    expect(readRelations({ hosted_on: '[[beta]]', depends_on: ['[[gamma]]', '[[delta|D]]'] })).toEqual([
      { predicate: 'hosted_on', raw: 'beta' },
      { predicate: 'depends_on', raw: 'gamma' },
      { predicate: 'depends_on', raw: 'delta' },
    ]);
  });

  it.each([
    ['null', null],
    ['a string', '[[beta]]'],
    ['a list', ['[[beta]]']],
  ])('returns nothing for %s', (_label, value) => {
    expect(readRelations(value)).toEqual([]);
  });
});

describe('isOneSided', () => {
  const base = { from: 'entities/a', predicate: 'references', to: 'meta/profile/p', hasInverse: true, known: true, since: null };

  it('does not expect an inverse on a page that uses related: (meta, profile, runbook, nav)', () => {
    expect(isOneSided({ ...base, declaredOnFrom: true, declaredOnTo: false, expectedOnFrom: true, expectedOnTo: false })).toBe(false);
  });

  it('flags the missing side when both pages carry typed relations', () => {
    expect(isOneSided({ ...base, declaredOnFrom: true, declaredOnTo: false, expectedOnFrom: true, expectedOnTo: true })).toBe(true);
    expect(isOneSided({ ...base, declaredOnFrom: false, declaredOnTo: true, expectedOnFrom: true, expectedOnTo: true })).toBe(true);
    expect(isOneSided({ ...base, declaredOnFrom: true, declaredOnTo: true, expectedOnFrom: true, expectedOnTo: true })).toBe(false);
  });
});
