import { parseWikilinkInner, type WikilinkRef } from '../shared/wikilink.ts';

export type { WikilinkRef };

const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;

export function extractWikilinks(text: string): WikilinkRef[] {
  const out: WikilinkRef[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    const parsed = parseWikilinkInner(m[2] ?? '');
    if (parsed) out.push({ ...parsed, embed: m[1] === '!' });
  }
  return out;
}

/**
 * Blank out fenced code blocks and inline code spans, so wikilinks quoted inside
 * code (examples, templates) do not count as links. Line structure is preserved.
 */
export function stripCode(markdown: string): string {
  const lines = markdown.split('\n');
  let fence: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (fence) {
      const close = new RegExp(`^\\s{0,3}${fence.char === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      if (close.test(line)) fence = null;
      lines[i] = '';
      continue;
    }
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open?.[1]) {
      fence = { char: open[1][0] ?? '`', length: open[1].length };
      lines[i] = '';
      continue;
    }
    lines[i] = line.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, ' ');
  }
  return lines.join('\n');
}

export function countWords(markdown: string): number {
  let n = 0;
  for (const token of markdown.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) n++;
  }
  return n;
}

export interface ListItem {
  text: string;
}

export interface Section {
  title: string;
  items: ListItem[];
}

/**
 * `## ` sections with their top-level list items (first line of each item).
 * Structure is read on the code-stripped text, item text from the original line.
 */
export function readSections(markdown: string): Section[] {
  const original = markdown.split('\n');
  const stripped = stripCode(markdown).split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;
  for (let i = 0; i < stripped.length; i++) {
    const line = stripped[i] ?? '';
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1]) {
      current = { title: heading[1], items: [] };
      sections.push(current);
      continue;
    }
    if (/^#\s/.test(line)) {
      current = null;
      continue;
    }
    if (current && /^[-*+]\s+\S/.test(line)) {
      const item = /^[-*+]\s+(.*)$/.exec(original[i] ?? '');
      if (item?.[1]) current.items.push({ text: item[1].trim() });
    }
  }
  return sections;
}
