import { PREDICATES, type PredicateDef } from '../shared/model.ts';
import { extractWikilinks } from './markdown.ts';

const FORWARD = new Map<string, PredicateDef>(PREDICATES.map((p) => [p.name, p]));
const INVERSE = new Map<string, PredicateDef>();
for (const p of PREDICATES) if (p.inverse) INVERSE.set(p.inverse, p);

export interface DeclaredRelation {
  predicate: string;
  /** Target as written, without the brackets. */
  raw: string;
}

/** Read every target of a list-of-wikilinks frontmatter value (`relations` values, `related`). */
export function readLinkList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const links = extractWikilinks(item);
    if (links.length) {
      for (const link of links) if (link.target) out.push(link.target);
    } else if (item.trim()) {
      out.push(item.trim());
    }
  }
  return out;
}

/** Flatten a `relations:` mapping into (predicate, target) pairs. */
export function readRelations(value: unknown): DeclaredRelation[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: DeclaredRelation[] = [];
  for (const [predicate, targets] of Object.entries(value as Record<string, unknown>)) {
    for (const raw of readLinkList(targets)) out.push({ predicate, raw });
  }
  return out;
}

export interface CanonicalRelation {
  from: string;
  predicate: string;
  to: string;
  known: boolean;
  hasInverse: boolean;
  /** The declaration used the forward name (declared on `from`). */
  forward: boolean;
}

/** Rewrite an inverse declaration (`B hosts A`) into its forward form (`A hosted_on B`). */
export function canonicalize(source: string, predicate: string, target: string): CanonicalRelation {
  const fwd = FORWARD.get(predicate);
  if (fwd) return { from: source, predicate, to: target, known: true, hasInverse: fwd.inverse !== null, forward: true };
  const inv = INVERSE.get(predicate);
  if (inv) return { from: target, predicate: inv.name, to: source, known: true, hasInverse: true, forward: false };
  return { from: source, predicate, to: target, known: false, hasInverse: false, forward: true };
}

export function predicateDef(name: string): PredicateDef | undefined {
  return FORWARD.get(name);
}
