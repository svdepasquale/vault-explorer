import { describe, expect, it } from 'vitest';
import { countWords, extractWikilinks, readSections, stripCode } from '../src/core/markdown.ts';

const targets = (markdown: string): string[] => extractWikilinks(stripCode(markdown)).map((ref) => ref.target);

describe('extractWikilinks', () => {
  it('reads a bare link', () => {
    expect(extractWikilinks('see [[alpha]]')).toEqual([{ target: 'alpha', anchor: null, alias: null, embed: false }]);
  });

  it('reads alias and anchor together, with a folder prefix', () => {
    expect(extractWikilinks('[[entities/alpha#Setup steps|the setup]]')).toEqual([
      { target: 'entities/alpha', anchor: 'Setup steps', alias: 'the setup', embed: false },
    ]);
  });

  it('accepts the \\| escape used inside markdown tables', () => {
    expect(extractWikilinks('| peer | [[alpha\\|Alpha]] |')).toEqual([{ target: 'alpha', anchor: null, alias: 'Alpha', embed: false }]);
  });

  it('marks embeds', () => {
    expect(extractWikilinks('![[diagram.png]] and ![[alpha#Summary]]')).toEqual([
      { target: 'diagram.png', anchor: null, alias: null, embed: true },
      { target: 'alpha', anchor: 'Summary', alias: null, embed: true },
    ]);
  });

  it('keeps same-page [[#heading]] links with an empty target', () => {
    expect(extractWikilinks('[[#Local heading]]')).toEqual([{ target: '', anchor: 'Local heading', alias: null, embed: false }]);
  });

  it('turns an empty alias or anchor into null', () => {
    expect(extractWikilinks('[[alpha|]] [[beta#]]')).toEqual([
      { target: 'alpha', anchor: null, alias: null, embed: false },
      { target: 'beta', anchor: null, alias: null, embed: false },
    ]);
  });

  it('ignores empty links and links broken across lines', () => {
    expect(extractWikilinks('[[]] [[ ]] [[#]] [[alpha\nbeta]]')).toEqual([]);
  });

  it('returns every link of a line, in order', () => {
    expect(extractWikilinks('[[a]], [[b|B]] then [[c#x]]').map((ref) => ref.target)).toEqual(['a', 'b', 'c']);
  });
});

describe('stripCode', () => {
  it('blanks a backtick fence and keeps the line structure', () => {
    const text = 'before [[a]]\n```js\n[[b]]\n```\nafter [[c]]';
    const stripped = stripCode(text);
    expect(stripped.split('\n')).toHaveLength(text.split('\n').length);
    expect(targets(text)).toEqual(['a', 'c']);
  });

  it('closes a longer tilde fence only with a fence at least as long', () => {
    expect(targets('~~~~\n[[b]]\n~~~\n[[still-code]]\n~~~~\n[[c]]')).toEqual(['c']);
  });

  it('closes a longer backtick fence only with a fence at least as long', () => {
    expect(targets('````md\n```\n[[inner]]\n```\n````\n[[after]]')).toEqual(['after']);
  });

  it('does not close a backtick fence with tildes, or with a fence that has trailing text', () => {
    expect(targets('```\n[[a]]\n~~~\n[[b]]\n``` not a close\n[[c]]\n```\n[[d]]')).toEqual(['d']);
  });

  it('accepts fences indented by up to three spaces', () => {
    expect(targets('   ```\n[[a]]\n   ```\n[[b]]')).toEqual(['b']);
  });

  it('blanks everything after an unclosed fence', () => {
    expect(targets('[[a]]\n```\n[[b]]\n[[c]]')).toEqual(['a']);
  });

  it('blanks inline code spans, multi-backtick spans included', () => {
    expect(targets('see `[[a]]` and ``[[b]] with ` tick`` but [[c]]')).toEqual(['c']);
  });

  it('leaves text without code untouched', () => {
    const text = '# Title\n\n- [[a]]\n- [[b]]\n';
    expect(stripCode(text)).toBe(text);
  });

  // BUG (src/core/markdown.ts:31): a line that starts with three backticks is
  // always taken as a fence opener. CommonMark (and markdown-it, which renders
  // the page in the SPA) reads "```x```" on one line as an inline code span —
  // a backtick fence's info string cannot contain backticks — so the links on
  // the following lines are real, but stripCode blanks them until the next ```.
  it('treats a one-line ```code``` span as inline code, not as a fence', () => {
    expect(targets('```[[a]]```\n[[b]]')).toEqual(['b']);
  });
});

describe('readSections', () => {
  const hot = [
    '# Hot',
    '',
    '## Open threads',
    '- first [[alpha]]',
    '* second',
    '  - nested items are not top-level',
    '### Sub-heading keeps the section',
    '+ third',
    '# Top-level heading closes it',
    '- not in any section',
    '## Closed ##',
    '- done `with code`',
    '```',
    '## not a heading inside a fence',
    '- not an item inside a fence',
    '```',
  ].join('\n');

  it('collects top-level list items under ## headings', () => {
    expect(readSections(hot)).toEqual([
      { title: 'Open threads', items: [{ text: 'first [[alpha]]' }, { text: 'second' }, { text: 'third' }] },
      { title: 'Closed', items: [{ text: 'done `with code`' }] },
    ]);
  });

  it('returns no sections for text without ## headings', () => {
    expect(readSections('# Only a title\n- an item')).toEqual([]);
  });

  // BUG (src/core/markdown.ts:80): items are matched on the code-stripped line,
  // so an item whose whole text is inline code ("- `npm test`") is blanked to
  // "-  " and dropped from the section (and from the hot.md summary).
  it('keeps an item whose whole text is inline code', () => {
    expect(readSections('## Commands\n- `npm test`')).toEqual([{ title: 'Commands', items: [{ text: '`npm test`' }] }]);
  });
});

describe('countWords', () => {
  it('counts tokens that contain a letter or a digit', () => {
    // Alpha, runs, on, beta, 2, times, see, [[x]] — not the dash, not "!!".
    expect(countWords('Alpha runs on beta — 2 times, see: [[x]] !!')).toBe(8);
  });

  it('counts non-Latin words', () => {
    expect(countWords('città über 東京')).toBe(3);
  });
});
