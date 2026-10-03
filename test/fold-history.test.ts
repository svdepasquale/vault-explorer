import { describe, expect, it } from 'vitest';
import type { RawChange, RawCommit } from '../src/core/git.ts';
import { foldHistory } from '../src/core/model.ts';
import { makePage } from './helpers/page.ts';

const day = (n: number): string => `2026-01-${String(n).padStart(2, '0')}T12:00:00+00:00`;
const commit = (n: number, ...changes: RawChange[]): RawCommit => ({ hash: `c${n}`, date: day(n), subject: `commit ${n}`, changes });
const A = (path: string): RawChange => ({ status: 'A', path });
const M = (path: string): RawChange => ({ status: 'M', path });
const D = (path: string): RawChange => ({ status: 'D', path });
const R = (from: string, path: string): RawChange => ({ status: 'R', from, path });

function fold(raw: RawCommit[], currentIds: string[]) {
  const pages = currentIds.map((id) => makePage(id));
  const result = foldHistory(raw, new Set(currentIds), pages);
  const byId = new Map(pages.map((p) => [p.id, p]));
  return { ...result, page: (id: string) => byId.get(id)?.git };
}

describe('foldHistory', () => {
  it('turns raw paths into page changes, oldest first', () => {
    const { commits } = fold([commit(1, A('entities/alpha.md')), commit(2, M('entities/alpha.md'))], ['entities/alpha']);
    expect(commits).toEqual([
      { hash: 'c1', date: day(1), subject: 'commit 1', changes: [{ status: 'A', id: 'entities/alpha' }] },
      { hash: 'c2', date: day(2), subject: 'commit 2', changes: [{ status: 'M', id: 'entities/alpha' }] },
    ]);
  });

  it('follows a rename, so the page keeps the history of its old name', () => {
    const { commits, ghosts, page } = fold(
      [
        commit(1, A('entities/draft.md')),
        commit(2, M('entities/draft.md')),
        commit(3, R('entities/draft.md', 'entities/final.md')),
        commit(4, M('entities/final.md')),
      ],
      ['entities/final'],
    );
    expect(commits[2]?.changes).toEqual([{ status: 'R', id: 'entities/final', from: 'entities/draft' }]);
    expect(page('entities/final')).toEqual({ commits: [0, 1, 2, 3], first: day(1), last: day(4) });
    expect(ghosts).toEqual([]);
  });

  it('turns a page deleted and never re-created into a ghost', () => {
    const { ghosts } = fold(
      [commit(1, A('entities/gone.md'), A('entities/kept.md')), commit(2, M('entities/gone.md')), commit(3, D('entities/gone.md'))],
      ['entities/kept'],
    );
    expect(ghosts).toEqual([{ id: 'entities/gone', created: day(1), deleted: day(3), commits: [0, 1, 2] }]);
  });

  it('keeps the earlier history of a page deleted and re-created at the same path', () => {
    const { ghosts, page } = fold(
      [commit(1, A('runbooks/x.md')), commit(2, D('runbooks/x.md')), commit(3, A('runbooks/x.md')), commit(4, M('runbooks/x.md'))],
      ['runbooks/x'],
    );
    expect(page('runbooks/x')).toEqual({ commits: [0, 1, 2, 3], first: day(1), last: day(4) });
    expect(ghosts).toEqual([]);
  });

  it('merges two lives of a page that is gone for good into one ghost', () => {
    const { ghosts } = fold(
      [commit(1, A('meta/x.md')), commit(2, D('meta/x.md')), commit(3, A('meta/x.md')), commit(4, D('meta/x.md'))],
      [],
    );
    expect(ghosts).toEqual([{ id: 'meta/x', created: day(1), deleted: day(4), commits: [0, 1, 2, 3] }]);
  });

  it('names a ghost after its last path, with the history of its old names', () => {
    const { ghosts } = fold([commit(1, A('a/old.md')), commit(2, R('a/old.md', 'a/new.md')), commit(3, D('a/new.md'))], []);
    expect(ghosts).toEqual([{ id: 'a/new', created: day(1), deleted: day(3), commits: [0, 1, 2] }]);
  });

  it('sorts ghosts by their last deletion date', () => {
    // x dies first, so it is met first; its second death moves it after y.
    const { ghosts } = fold(
      [commit(1, A('x.md'), A('y.md')), commit(2, D('x.md')), commit(3, D('y.md')), commit(4, A('x.md')), commit(5, D('x.md'))],
      [],
    );
    expect(ghosts.map((g) => [g.id, g.deleted])).toEqual([
      ['y', day(3)],
      ['x', day(5)],
    ]);
  });

  it('ignores non-markdown files and dot-folders, and drops commits left without page changes', () => {
    const { commits, page } = fold(
      [
        commit(1, A('assets/diagram.png')),
        commit(2, A('.obsidian/workspace.md')),
        commit(3, A('entities/alpha.md'), A('entities/alpha.png')),
      ],
      ['entities/alpha'],
    );
    expect(commits).toHaveLength(1);
    expect(commits[0]?.hash).toBe('c3');
    expect(page('entities/alpha')).toEqual({ commits: [0], first: day(3), last: day(3) });
  });

  it('reads a rename across the markdown boundary as an addition or a deletion', () => {
    const { commits, ghosts, page } = fold(
      [commit(1, A('notes.txt'), A('entities/alpha.md')), commit(2, R('notes.txt', 'meta/notes.md'), R('entities/alpha.md', 'entities/alpha.txt'))],
      ['meta/notes'],
    );
    expect(commits[1]?.changes).toEqual([
      { status: 'A', id: 'meta/notes' },
      { status: 'D', id: 'entities/alpha' },
    ]);
    expect(page('meta/notes')).toEqual({ commits: [1], first: day(2), last: day(2) });
    expect(ghosts.map((g) => g.id)).toEqual(['entities/alpha']);
  });

  it('leaves a page without history with empty git info', () => {
    const { page } = fold([commit(1, A('entities/alpha.md'))], ['entities/alpha', 'entities/untracked']);
    expect(page('entities/untracked')).toEqual({ commits: [], first: null, last: null });
  });
});
