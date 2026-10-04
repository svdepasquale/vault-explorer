import {
  isOneSided,
  OVERSIZED_BYTES,
  PAGE_KINDS,
  PREDICATES,
  STALE_STATUSES,
  type Page,
  type PageKind,
} from '../../../shared/model.ts';
import type { Derived } from '../../app/derived.ts';

export interface KindCount {
  kind: PageKind;
  count: number;
}

export interface PredicateStat {
  /** Canonical predicate name, the graph filter key. */
  name: string;
  label: string;
  total: number;
  twoSided: number;
  oneSided: number;
  /** One-sided relations whose `from` page declares it (the target lacks the inverse). */
  missingOnTarget: number;
  /** One-sided relations declared only through the inverse on `to`. */
  missingOnSource: number;
  hasInverse: boolean;
  known: boolean;
}

export interface PageMetric {
  page: Page;
  value: number;
  /** Past a health threshold (stale for ages). */
  flagged: boolean;
}

export interface OverviewStats {
  pages: number;
  kinds: KindCount[];
  notIndexed: number;
  linkPairs: number;
  bodyRefs: number;
  relatedPairs: number;
  relations: number;
  withInverse: number;
  twoSided: number;
  oneSided: number;
  noInverse: number;
  unknownPredicates: number;
  tagsDistinct: number;
  tagUses: number;
  tagsOnce: number;
  commits: number;
  firstCommit: string | null;
  lastCommit: string | null;
  bytes: number;
  words: number;
  medianBytes: number;
  noDomain: number;
  noStatus: number;
  predicates: PredicateStat[];
  mostLinked: PageMetric[];
  largest: PageMetric[];
  oversized: number;
  untouched: PageMetric[];
  staleCount: number;
  activeLike: number;
}

const TOP = 10;
const PREDICATE_LABEL = new Map(PREDICATES.map((p) => [p.name, p.label]));

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function predicateStats(derived: Derived): PredicateStat[] {
  const byName = new Map<string, PredicateStat>();
  for (const r of derived.model.relations) {
    let stat = byName.get(r.predicate);
    if (!stat) {
      stat = {
        name: r.predicate,
        label: PREDICATE_LABEL.get(r.predicate) ?? r.predicate,
        total: 0,
        twoSided: 0,
        oneSided: 0,
        missingOnTarget: 0,
        missingOnSource: 0,
        hasInverse: r.hasInverse,
        known: r.known,
      };
      byName.set(r.predicate, stat);
    }
    stat.total++;
    if (!r.hasInverse) continue;
    if (!isOneSided(r)) {
      stat.twoSided++;
    } else {
      stat.oneSided++;
      if (r.declaredOnFrom) stat.missingOnTarget++;
      else stat.missingOnSource++;
    }
  }
  return [...byName.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export function computeStats(derived: Derived): OverviewStats {
  const { model } = derived;
  const pages = model.pages;

  const kindCounts = new Map<PageKind, number>();
  for (const p of pages) kindCounts.set(p.kind, (kindCounts.get(p.kind) ?? 0) + 1);
  const kinds = PAGE_KINDS.flatMap((kind) => {
    const count = kindCounts.get(kind) ?? 0;
    return count ? [{ kind, count }] : [];
  });

  let twoSided = 0;
  let oneSided = 0;
  let noInverse = 0;
  let unknownPredicates = 0;
  for (const r of model.relations) {
    if (!r.known) unknownPredicates++;
    if (!r.hasInverse) noInverse++;
    else if (!isOneSided(r)) twoSided++;
    else oneSided++;
  }

  const mostLinked = pages
    .map((page) => ({ page, value: derived.inbound.get(page.id) ?? 0, flagged: false }))
    .filter((m) => m.value > 0)
    .sort((a, b) => b.value - a.value || a.page.id.localeCompare(b.page.id))
    .slice(0, TOP);

  // Same scope as the health check: navigation pages are not held to the size threshold.
  const sized = pages.filter((p) => p.kind !== 'nav');
  const largest = sized
    .map((page) => ({ page, value: page.bytes, flagged: page.bytes > OVERSIZED_BYTES }))
    .sort((a, b) => b.value - a.value || a.page.id.localeCompare(b.page.id))
    .slice(0, TOP);

  // Same scope as the stale check: archived pages (index: false) are exempt.
  const activeLike = pages.filter((p) => p.indexed && p.status !== null && STALE_STATUSES.includes(p.status));
  const aged = activeLike.flatMap((page) => {
    const age = derived.ageDays(page);
    // The stale badge is the server's health verdict, so both views always agree.
    return age === null ? [] : [{ page, value: age, flagged: derived.healthOf.get(page.id)?.some((i) => i.check === 'stale') ?? false }];
  });
  const untouched = [...aged].sort((a, b) => b.value - a.value || a.page.id.localeCompare(b.page.id)).slice(0, TOP);

  return {
    pages: pages.length,
    kinds,
    notIndexed: pages.filter((p) => !p.indexed).length,
    linkPairs: model.links.length,
    bodyRefs: model.links.reduce((sum, l) => sum + l.body, 0),
    relatedPairs: model.links.filter((l) => l.related).length,
    relations: model.relations.length,
    withInverse: twoSided + oneSided,
    twoSided,
    oneSided,
    noInverse,
    unknownPredicates,
    tagsDistinct: derived.tags.length,
    tagUses: derived.tags.reduce((sum, [, n]) => sum + n, 0),
    tagsOnce: derived.tags.filter(([, n]) => n === 1).length,
    commits: model.commits.length,
    firstCommit: model.commits[0]?.date ?? null,
    lastCommit: model.commits[model.commits.length - 1]?.date ?? null,
    bytes: pages.reduce((sum, p) => sum + p.bytes, 0),
    words: pages.reduce((sum, p) => sum + p.words, 0),
    medianBytes: median(pages.map((p) => p.bytes)),
    noDomain: pages.filter((p) => !p.domain).length,
    noStatus: pages.filter((p) => !p.status).length,
    predicates: predicateStats(derived),
    mostLinked,
    largest,
    oversized: sized.filter((p) => p.bytes > OVERSIZED_BYTES).length,
    untouched,
    staleCount: aged.filter((m) => m.flagged).length,
    activeLike: activeLike.length,
  };
}
