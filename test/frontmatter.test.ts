import { describe, expect, it } from 'vitest';
import { asStringList, lenientParse, normalizeDate, readFrontmatter, splitInlineList } from '../src/core/frontmatter.ts';
import { readRelations } from '../src/core/relations.ts';

describe('readFrontmatter — strict YAML', () => {
  it('splits the block from the body and parses a mapping', () => {
    const fm = readFrontmatter('---\nname: Alpha\ntags: [one, two]\ncreated: 2026-01-10\n---\n# Alpha\n\nBody.\n');
    expect(fm.present).toBe(true);
    expect(fm.error).toBeNull();
    expect(fm.raw).toBe('name: Alpha\ntags: [one, two]\ncreated: 2026-01-10');
    // YAML 1.2 core schema: an unquoted date stays a string.
    expect(fm.data).toEqual({ name: 'Alpha', tags: ['one', 'two'], created: '2026-01-10' });
    expect(fm.body).toBe('# Alpha\n\nBody.\n');
  });

  it('keeps nested relations and quoted wikilinks as YAML data', () => {
    const fm = readFrontmatter('---\nrelations:\n  hosted_on: ["[[beta]]"]\n  depends_on:\n    - "[[gamma]]"\n---\n');
    expect(fm.error).toBeNull();
    expect(fm.data).toEqual({ relations: { hosted_on: ['[[beta]]'], depends_on: ['[[gamma]]'] } });
    expect(fm.body).toBe('');
  });

  it.each([
    ['an empty block', '---\n---\nBody'],
    ['a block holding one blank line', '---\n\n---\nBody'],
    ['a comment-only block', '---\n# nothing yet\n---\nBody'],
  ])('treats %s as present with no data', (_label, text) => {
    const fm = readFrontmatter(text);
    expect(fm).toMatchObject({ present: true, data: {}, error: null, body: 'Body' });
  });

  it('strips a UTF-8 BOM and understands CRLF line endings', () => {
    const fm = readFrontmatter('﻿---\r\nname: Alpha\r\ntype: entity\r\n---\r\nBody\r\n');
    expect(fm.present).toBe(true);
    expect(fm.error).toBeNull();
    expect(fm.data).toEqual({ name: 'Alpha', type: 'entity' });
    expect(fm.body).toBe('Body\r\n');
  });

  it('accepts `...` as the closing marker and a block at end of file', () => {
    expect(readFrontmatter('---\nname: A\n...\nBody').data).toEqual({ name: 'A' });
    expect(readFrontmatter('---\nname: A\n---').body).toBe('');
  });

  it('reports no frontmatter when the file does not start with ---', () => {
    const text = '# Title\n\n---\nname: not frontmatter\n---\n';
    expect(readFrontmatter(text)).toEqual({ present: false, raw: null, data: {}, error: null, body: text });
  });

  it('reports no frontmatter for an unterminated block', () => {
    const text = '---\nname: A\nno closing marker\n';
    expect(readFrontmatter(text)).toMatchObject({ present: false, body: text });
  });

  it.each([
    ['a list', '---\n- one\n- two\n---\n'],
    ['a scalar', '---\njust a sentence\n---\n'],
  ])('flags %s as not a key/value mapping', (_label, text) => {
    const fm = readFrontmatter(text);
    expect(fm.present).toBe(true);
    expect(fm.error).toBe('frontmatter is not a key/value mapping');
  });
});

describe('readFrontmatter — invalid YAML falls back to the lenient parser', () => {
  const broken = [
    '---',
    'name: Broken page',
    'name: duplicate keys make strict YAML throw',
    'description: still readable',
    'tags: [fixture, "#lenient"]',
    'related: ["[[alpha]]", "[[gamma|Gamma, the source]]"]',
    'see_also: [[delta]], [[epsilon]]',
    '# a comment line',
    'relations:',
    '  hosted_on: "[[beta]]"',
    '  depends_on: ["[[gamma]]", \'[[delta#Setup]]\']',
    '  part_of:',
    '    - "[[alpha]]"',
    "    - '[[epsilon]]'",
    'aliases:',
    '  - first',
    '  - second',
    'index: false',
    'weight: 3',
    'ratio: -0.5',
    'empty:',
    'nothing: ~',
    '---',
    'Body text.',
  ].join('\n');

  it('records the first line of the strict error and still returns the body', () => {
    const fm = readFrontmatter(broken);
    expect(fm.present).toBe(true);
    expect(fm.error).toMatch(/^Map keys must be unique/);
    expect(fm.error).not.toContain('\n');
    expect(fm.body).toBe('Body text.');
  });

  it('reads scalars, inline lists and block lists line by line', () => {
    const { data } = readFrontmatter(broken);
    expect(data['name']).toBe('duplicate keys make strict YAML throw');
    expect(data['description']).toBe('still readable');
    expect(data['tags']).toEqual(['fixture', '#lenient']);
    expect(data['aliases']).toEqual(['first', 'second']);
    expect(data['index']).toBe(false);
    expect(data['weight']).toBe(3);
    expect(data['ratio']).toBe(-0.5);
    expect(data['empty']).toBeNull();
    expect(data['nothing']).toBeNull();
  });

  it('keeps quoted wikilinks whole, commas inside quotes included', () => {
    const { data } = readFrontmatter(broken);
    expect(data['related']).toEqual(['[[alpha]]', '[[gamma|Gamma, the source]]']);
    // An unquoted `[[x]], [[y]]` value is not an inline list; it stays one string.
    expect(data['see_also']).toBe('[[delta]], [[epsilon]]');
  });

  it('reads the nested relations: map, inline and block forms', () => {
    const { data } = readFrontmatter(broken);
    expect(data['relations']).toEqual({
      hosted_on: '[[beta]]',
      depends_on: ['[[gamma]]', '[[delta#Setup]]'],
      part_of: ['[[alpha]]', '[[epsilon]]'],
    });
    expect(readRelations(data['relations'])).toEqual([
      { predicate: 'hosted_on', raw: 'beta' },
      { predicate: 'depends_on', raw: 'gamma' },
      { predicate: 'depends_on', raw: 'delta' },
      { predicate: 'part_of', raw: 'alpha' },
      { predicate: 'part_of', raw: 'epsilon' },
    ]);
  });

  it('closes the nested map at the next top-level key', () => {
    expect(lenientParse('relations:\n  part_of: "[[a]]"\nstatus: active')).toEqual({
      relations: { part_of: '[[a]]' },
      status: 'active',
    });
  });

  it('appends block items to a nested key that already had a value', () => {
    expect(lenientParse('relations:\n  part_of: "[[a]]"\n    - "[[b]]"')).toEqual({
      relations: { part_of: ['[[a]]', '[[b]]'] },
    });
  });
});

describe('splitInlineList', () => {
  it('splits on top-level commas only', () => {
    expect(splitInlineList('a, "b, c", [[d, e]], \'f, g\'')).toEqual(['a', '"b, c"', '[[d, e]]', "'f, g'"]);
  });

  it('drops empty items', () => {
    expect(splitInlineList(' , a,, b ,')).toEqual(['a', 'b']);
  });
});

describe('normalizeDate', () => {
  it.each([
    ['a plain date string', '2026-01-10', '2026-01-10'],
    ['a date-time string', '2026-01-10T23:59:59+02:00', '2026-01-10'],
    ['a padded string', '  2026-03-04  ', '2026-03-04'],
    ['a Date object', new Date('2026-02-03T00:00:00Z'), '2026-02-03'],
  ])('reads %s', (_label, value, expected) => {
    expect(normalizeDate(value)).toBe(expected);
  });

  it.each([
    ['an invalid Date', new Date('not a date')],
    ['a non-ISO string', '10/01/2026'],
    ['a short date', '2026-1-2'],
    ['a number', 20260110],
    ['null', null],
    ['undefined', undefined],
  ])('returns null for %s', (_label, value) => {
    expect(normalizeDate(value)).toBeNull();
  });
});

describe('asStringList', () => {
  it('drops leading # from tags and ignores non-scalars', () => {
    expect(asStringList(['#one', 'two', 3, true, null, { no: 1 }, '  '])).toEqual(['one', 'two', '3', 'true']);
  });

  it('splits a comma-separated string', () => {
    expect(asStringList('a, #b ,c')).toEqual(['a', 'b', 'c']);
  });
});
