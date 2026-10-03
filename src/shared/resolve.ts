export interface Resolution {
  id: string | null;
  /** A bare name matched several pages; `id` is the closest one. */
  ambiguous: boolean;
  /** The link points to a non-page file (image, pdf, ...). */
  attachment: boolean;
}

const ATTACHMENT = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|pdf|mp3|mp4|mov|webm|wav|ogg|csv|json|ya?ml|txt|zip|canvas|excalidraw|base)$/i;

function folderOf(id: string): string {
  const i = id.lastIndexOf('/');
  return i >= 0 ? id.slice(0, i) : '';
}

function stemOf(id: string): string {
  const i = id.lastIndexOf('/');
  return i >= 0 ? id.slice(i + 1) : id;
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Normalize a wikilink target to a page-id-like string. */
export function normalizeTarget(raw: string): string {
  let t = raw.trim().replace(/\\/g, '/');
  t = t.replace(/^\.\//, '').replace(/^\/+/, '');
  if (t.toLowerCase().endsWith('.md')) t = t.slice(0, -3);
  if (t.startsWith('wiki/')) t = t.slice(5);
  return t;
}

/**
 * Resolve wikilinks the way the vault writes them: `[[folder/x]]` by path,
 * bare `[[x]]` by file stem; case-insensitive as a fallback (macOS file names).
 * A stem shared by several pages (`_index`) prefers the source's own folder,
 * then the shortest path.
 */
export function createResolver(ids: Iterable<string>): (raw: string, fromId: string) => Resolution {
  const byId = new Set<string>();
  const byIdLower = new Map<string, string[]>();
  const byStem = new Map<string, string[]>();
  const byStemLower = new Map<string, string[]>();
  for (const id of ids) {
    byId.add(id);
    pushTo(byIdLower, id.toLowerCase(), id);
    pushTo(byStem, stemOf(id), id);
    pushTo(byStemLower, stemOf(id).toLowerCase(), id);
  }

  const pick = (candidates: string[], fromId: string): Resolution => {
    if (candidates.length === 1) return { id: candidates[0] ?? null, ambiguous: false, attachment: false };
    const sameFolder = candidates.filter((c) => folderOf(c) === folderOf(fromId));
    const pool = sameFolder.length === 1 ? sameFolder : [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b));
    return { id: pool[0] ?? null, ambiguous: true, attachment: false };
  };

  return (raw: string, fromId: string): Resolution => {
    const target = normalizeTarget(raw);
    if (!target) return { id: null, ambiguous: false, attachment: false };
    if (ATTACHMENT.test(target)) return { id: null, ambiguous: false, attachment: true };

    if (target.includes('/')) {
      if (byId.has(target)) return { id: target, ambiguous: false, attachment: false };
      const lower = byIdLower.get(target.toLowerCase());
      if (lower?.length) return pick(lower, fromId);
      const suffix = [...byId].filter((id) => id.endsWith(`/${target}`));
      if (suffix.length) return pick(suffix, fromId);
      return { id: null, ambiguous: false, attachment: false };
    }

    const exact = byStem.get(target);
    if (exact?.length) return pick(exact, fromId);
    const lower = byStemLower.get(target.toLowerCase());
    if (lower?.length) return pick(lower, fromId);
    return { id: null, ambiguous: false, attachment: false };
  };
}
