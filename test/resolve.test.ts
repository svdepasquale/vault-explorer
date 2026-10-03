import { describe, expect, it } from 'vitest';
import { createResolver, normalizeTarget } from '../src/shared/resolve.ts';

const IDS = [
  'index',
  'hot',
  'entities/_index',
  'entities/alpha',
  'entities/beta',
  'sources/_index',
  'sources/gamma',
  'folds/_index',
  'folds/fold-1',
  'runbooks/rotate',
  'meta/profile/feedback-x',
  'archive/Old-Note',
];

const resolve = createResolver(IDS);
const page = (id: string) => ({ id, ambiguous: false, attachment: false });
const nothing = { id: null, ambiguous: false, attachment: false };

describe('normalizeTarget', () => {
  it.each([
    ['wiki/entities/alpha.md', 'entities/alpha'],
    ['./entities/alpha', 'entities/alpha'],
    ['//entities/alpha', 'entities/alpha'],
    ['entities\\alpha', 'entities/alpha'],
    ['  Alpha.MD  ', 'Alpha'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeTarget(raw)).toBe(expected);
  });
});

describe('createResolver — path links', () => {
  it.each(['entities/alpha', 'wiki/entities/alpha.md', './entities/alpha', '/entities/alpha', 'entities\\alpha', ' entities/alpha '])(
    'resolves %s by path',
    (raw) => {
      expect(resolve(raw, 'index')).toEqual(page('entities/alpha'));
    },
  );

  it('falls back to a case-insensitive path match', () => {
    expect(resolve('ENTITIES/Alpha', 'index')).toEqual(page('entities/alpha'));
  });

  it('resolves a partial path by suffix', () => {
    expect(resolve('profile/feedback-x', 'index')).toEqual(page('meta/profile/feedback-x'));
  });

  it('prefers the same folder when a partial path matches several pages', () => {
    const r = createResolver(['a/shared/note', 'b/shared/note', 'a/shared/other']);
    expect(r('shared/note', 'b/shared/other')).toEqual({ id: 'b/shared/note', ambiguous: true, attachment: false });
  });

  it('returns nothing for an unknown path', () => {
    expect(resolve('entities/nowhere', 'index')).toEqual(nothing);
  });
});

describe('createResolver — bare stems', () => {
  it('resolves a bare stem, with or without .md', () => {
    expect(resolve('alpha', 'index')).toEqual(page('entities/alpha'));
    expect(resolve('alpha.md', 'index')).toEqual(page('entities/alpha'));
  });

  it('falls back to a case-insensitive stem match', () => {
    expect(resolve('Alpha', 'index')).toEqual(page('entities/alpha'));
    expect(resolve('old-note', 'index')).toEqual(page('archive/Old-Note'));
  });

  it('prefers an exact-case stem over a case-insensitive one', () => {
    const r = createResolver(['a/Readme', 'b/readme']);
    expect(r('readme', 'x')).toEqual(page('b/readme'));
    expect(r('Readme', 'x')).toEqual(page('a/Readme'));
    // Only the case-insensitive pass matches both: ambiguous, shortest then alphabetical.
    expect(r('README', 'x')).toEqual({ id: 'a/Readme', ambiguous: true, attachment: false });
  });

  it('returns nothing for an unknown or empty target', () => {
    expect(resolve('nowhere', 'index')).toEqual(nothing);
    expect(resolve('', 'index')).toEqual(nothing);
    expect(resolve('   ', 'index')).toEqual(nothing);
  });
});

describe('createResolver — ambiguous _index', () => {
  it.each([
    ['entities/beta', 'entities/_index'],
    ['sources/gamma', 'sources/_index'],
    ['folds/fold-1', 'folds/_index'],
  ])('from %s prefers the same folder (%s)', (from, expected) => {
    expect(resolve('_index', from)).toEqual({ id: expected, ambiguous: true, attachment: false });
  });

  it('without a same-folder candidate picks the shortest path', () => {
    expect(resolve('_index', 'index')).toEqual({ id: 'folds/_index', ambiguous: true, attachment: false });
    expect(resolve('_index', 'meta/profile/feedback-x')).toEqual({ id: 'folds/_index', ambiguous: true, attachment: false });
  });
});

describe('createResolver — attachments', () => {
  it.each(['diagram.png', 'docs/spec.PDF', 'data.yaml', 'board.canvas', 'clip.MP4', 'photo.jpeg'])('%s is an attachment', (raw) => {
    expect(resolve(raw, 'index')).toEqual({ id: null, ambiguous: false, attachment: true });
  });

  it('a .md target is a page, not an attachment', () => {
    expect(resolve('gamma.md', 'index')).toEqual(page('sources/gamma'));
  });
});
