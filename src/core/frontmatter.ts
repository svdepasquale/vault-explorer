import { parse } from 'yaml';

export interface Frontmatter {
  present: boolean;
  raw: string | null;
  data: Record<string, unknown>;
  /** Strict YAML error message; `data` then comes from the lenient parser. */
  error: string | null;
  /** Keys whose value YAML cut at an unquoted ` #` (a comment) that line-based readers keep. */
  cuts: string[];
  body: string;
}

const BLOCK = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Split and parse the leading `---` block. Never throws. */
export function readFrontmatter(text: string): Frontmatter {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const match = BLOCK.exec(src);
  if (!match) return { present: false, raw: null, data: {}, error: null, cuts: [], body: src };
  const raw = match[1] ?? '';
  const body = src.slice(match[0].length);
  try {
    const parsed: unknown = parse(raw);
    if (parsed === null || parsed === undefined) return { present: true, raw, data: {}, error: null, cuts: [], body };
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { present: true, raw, data: lenientParse(raw), error: 'frontmatter is not a key/value mapping', cuts: [], body };
    }
    const data = parsed as Record<string, unknown>;
    return { present: true, raw, data, error: null, cuts: commentCuts(raw, data), body };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { present: true, raw, data: lenientParse(raw), error: message.split('\n')[0] ?? message, cuts: [], body };
  }
}

/**
 * Keys whose plain value YAML ended at an unquoted ` #` (whitespace + `#` starts a
 * comment): the vault's own line-based tools read the full line, YAML does not.
 */
export function commentCuts(raw: string, data: Record<string, unknown>): string[] {
  const lines = lenientParse(raw);
  const cuts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const line = lines[key];
    if (typeof value !== 'string' || typeof line !== 'string') continue;
    if (line.length > value.length && line.startsWith(value) && /^[ \t]+#/.test(line.slice(value.length))) cuts.push(key);
  }
  return cuts;
}

/**
 * Line-based fallback for frontmatter that strict YAML rejects. Understands what
 * the vault scripts themselves parse with regexes: top-level `key: value`, inline
 * `[a, b]` lists, block `- item` lists and one level of nested maps (`relations:`).
 */
export function lenientParse(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let key: string | null = null;
  let nested: Record<string, unknown> | null = null;
  let nestedKey: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const top = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (top) {
      key = top[1] ?? null;
      nested = null;
      nestedKey = null;
      const value = top[2]?.trim();
      if (key) out[key] = value ? scalarOrList(value) : null;
      continue;
    }
    if (!key) continue;

    const item = /^[ \t]+-[ \t]*(.*)$/.exec(line);
    if (item) {
      const value = scalarOrList((item[1] ?? '').trim());
      if (nested && nestedKey) nested[nestedKey] = appendTo(nested[nestedKey], value);
      else out[key] = appendTo(out[key], value);
      continue;
    }

    const sub = /^[ \t]+([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (sub && sub[1]) {
      if (!nested) {
        nested = {};
        out[key] = nested;
      }
      nestedKey = sub[1];
      const value = sub[2]?.trim();
      nested[nestedKey] = value ? scalarOrList(value) : null;
    }
  }
  return out;
}

function appendTo(current: unknown, value: unknown): unknown[] {
  if (Array.isArray(current)) return [...current, value];
  return current === null || current === undefined ? [value] : [current, value];
}

function scalarOrList(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']') && !value.startsWith('[[')) {
    return splitInlineList(value.slice(1, -1)).map(unquote);
  }
  return unquote(value);
}

/** Split `a, "b, c", [[d]]` on top-level commas, respecting quotes and `[[...]]`. */
export function splitInlineList(inner: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function unquote(value: string): unknown {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** `YYYY-MM-DD` from a frontmatter date value, or null. */
export function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return m?.[1] ?? null;
  }
  return null;
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function asStringList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const out: string[] = [];
  for (const item of items) {
    const s = asString(item);
    if (s) out.push(s.replace(/^#/, ''));
  }
  return out;
}
