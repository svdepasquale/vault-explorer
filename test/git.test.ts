import { describe, expect, it } from 'vitest';
import { parseLog, sanitizeRemote } from '../src/core/git.ts';

// `git log --name-status --format=%x1e%H%x1f%aI%x1f%s` framing.
const RECORD = '\x1e';
const FIELD = '\x1f';
const record = (hash: string, date: string, subject: string, ...lines: string[]): string =>
  `${RECORD}${hash}${FIELD}${date}${FIELD}${subject}\n\n${lines.join('\n')}\n`;

describe('parseLog', () => {
  it('reads A, M and D changes, newest first as git prints them', () => {
    const out =
      record('c2', '2026-02-01T10:00:00+00:00', 'alpha: edit, legacy: drop', 'M\tentities/alpha.md', 'D\tentities/legacy.md') +
      record('c1', '2026-01-01T09:30:00+01:00', 'seed', 'A\tentities/alpha.md', 'A\tentities/legacy.md');
    expect(parseLog(out)).toEqual([
      {
        hash: 'c2',
        date: '2026-02-01T10:00:00+00:00',
        subject: 'alpha: edit, legacy: drop',
        changes: [
          { status: 'M', path: 'entities/alpha.md' },
          { status: 'D', path: 'entities/legacy.md' },
        ],
      },
      {
        hash: 'c1',
        date: '2026-01-01T09:30:00+01:00',
        subject: 'seed',
        changes: [
          { status: 'A', path: 'entities/alpha.md' },
          { status: 'A', path: 'entities/legacy.md' },
        ],
      },
    ]);
  });

  it('reads renames with any similarity score, keeping the old path', () => {
    const out = record('c3', '2026-03-01T00:00:00Z', 'renames', 'R100\tentities/draft.md\tentities/final.md', 'R087\ta.md\tb.md');
    expect(parseLog(out)[0]?.changes).toEqual([
      { status: 'R', from: 'entities/draft.md', path: 'entities/final.md' },
      { status: 'R', from: 'a.md', path: 'b.md' },
    ]);
  });

  it('reads a copy as an addition of the new path', () => {
    const out = record('c4', '2026-03-02T00:00:00Z', 'copy', 'C075\tsources/a.md\tsources/a-copy.md');
    expect(parseLog(out)[0]?.changes).toEqual([{ status: 'A', path: 'sources/a-copy.md' }]);
  });

  it('reads a type change (file ↔ symlink) as a modification', () => {
    const out = record('c5', '2026-03-03T00:00:00Z', 'type change', 'T\tmeta/linked.md');
    expect(parseLog(out)[0]?.changes).toEqual([{ status: 'M', path: 'meta/linked.md' }]);
  });

  it('keeps paths with spaces and non-ASCII characters (core.quotepath=off)', () => {
    const out = record('c6', '2026-03-04T00:00:00Z', 'names', 'A\tentities/my page.md', 'A\tentities/città.md');
    expect(parseLog(out)[0]?.changes).toEqual([
      { status: 'A', path: 'entities/my page.md' },
      { status: 'A', path: 'entities/città.md' },
    ]);
  });

  it('ignores unknown status letters and incomplete lines', () => {
    const out = record('c7', '2026-03-05T00:00:00Z', 'noise', 'X\tweird.md', 'U\tunmerged.md', 'R100\tonly-one-path.md', 'M', 'M\tkept.md');
    expect(parseLog(out)[0]?.changes).toEqual([{ status: 'M', path: 'kept.md' }]);
  });

  it('keeps a commit without changes and an empty subject', () => {
    expect(parseLog(record('c8', '2026-03-06T00:00:00Z', ''))).toEqual([
      { hash: 'c8', date: '2026-03-06T00:00:00Z', subject: '', changes: [] },
    ]);
  });

  it('skips records without a date and returns nothing for empty output', () => {
    expect(parseLog(`${RECORD}c9\n\nM\ta.md\n`)).toEqual([]);
    expect(parseLog('')).toEqual([]);
    expect(parseLog('\n')).toEqual([]);
  });
});

describe('sanitizeRemote', () => {
  it('strips user info from URL remotes', () => {
    expect(sanitizeRemote('https://someone:not-a-real-credential@example.invalid/owner/repo.git')).toBe(
      'https://example.invalid/owner/repo.git',
    );
    expect(sanitizeRemote('ssh://git@example.invalid:22/owner/repo.git')).toBe('ssh://example.invalid:22/owner/repo.git');
  });

  it('leaves scp-style and credential-free remotes alone', () => {
    expect(sanitizeRemote('git@example.invalid:owner/repo.git')).toBe('git@example.invalid:owner/repo.git');
    expect(sanitizeRemote('https://example.invalid/owner/repo.git')).toBe('https://example.invalid/owner/repo.git');
  });
});
