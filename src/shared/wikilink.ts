// Wikilink syntax shared by the server parser and the SPA renderer.

export interface WikilinkRef {
  /** Page part, as written (may carry a folder prefix). Empty for same-page `[[#heading]]`. */
  target: string;
  anchor: string | null;
  alias: string | null;
  /** `![[...]]` transclusion. */
  embed: boolean;
}

/** Parse the inside of `[[...]]`: `target#anchor|alias`, with `\|` (table escape) accepted. */
export function parseWikilinkInner(inner: string): Omit<WikilinkRef, 'embed'> | null {
  const s = inner.replace(/\\\|/g, '|');
  const pipe = s.indexOf('|');
  const left = pipe >= 0 ? s.slice(0, pipe) : s;
  const alias = pipe >= 0 ? s.slice(pipe + 1).trim() || null : null;
  const hash = left.indexOf('#');
  const target = (hash >= 0 ? left.slice(0, hash) : left).trim();
  const anchor = hash >= 0 ? left.slice(hash + 1).trim() || null : null;
  if (!target && !anchor) return null;
  return { target, anchor, alias };
}
