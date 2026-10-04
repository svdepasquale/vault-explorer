import type { Commit, HealthIssue, Link, Page, Relation, VaultModel } from '../../shared/model.ts';
import { calendarDaysSince } from './dates.ts';
import { useStore } from './store.ts';

/** Indexes over the model, computed once per model object. */
export interface Derived {
  model: VaultModel;
  pageById: Map<string, Page>;
  /** Links leaving / entering a page (body + related). */
  linksFrom: Map<string, Link[]>;
  linksTo: Map<string, Link[]>;
  /** Typed relations where the page is `from` or `to`. */
  relationsOf: Map<string, Relation[]>;
  healthOf: Map<string, HealthIssue[]>;
  /** Distinct pages linking here (body, related or typed), navigation pages excluded. */
  inbound: Map<string, number>;
  /** Pages directly connected (either direction, any link kind). */
  neighbors: Map<string, Set<string>>;
  commitsOf: (page: Page) => Commit[];
  /** Days since the page's last update: frontmatter `updated`, else last commit. */
  ageDays: (page: Page) => number | null;
  /** When the page entered the vault (epoch ms): first commit, else frontmatter `created`. */
  bornAt: (page: Page) => number | null;
  /** First and last instant of the vault's history (epoch ms), for time scales. */
  timeRange: [number, number] | null;
  tags: [string, number][];
  domains: [string, number][];
  statuses: [string, number][];
}

let cache: { model: VaultModel; derived: Derived } | null = null;

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function counted(values: Iterable<string>): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function timeRangeOf(model: VaultModel): [number, number] | null {
  const first = model.commits[0]?.date;
  const last = model.commits[model.commits.length - 1]?.date;
  if (!first || !last) return null;
  return [Date.parse(first), Math.max(Date.parse(last), Date.parse(model.generatedAt))];
}

export function derive(model: VaultModel): Derived {
  if (cache?.model === model) return cache.derived;
  const pageById = new Map(model.pages.map((p) => [p.id, p]));
  const linksFrom = new Map<string, Link[]>();
  const linksTo = new Map<string, Link[]>();
  const relationsOf = new Map<string, Relation[]>();
  const healthOf = new Map<string, HealthIssue[]>();
  const inboundSets = new Map<string, Set<string>>();
  const neighbors = new Map<string, Set<string>>();

  const connect = (a: string, b: string): void => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)?.add(b);
    neighbors.get(b)?.add(a);
  };
  const countInbound = (target: string, source: string): void => {
    if (pageById.get(source)?.kind === 'nav') return;
    if (!inboundSets.has(target)) inboundSets.set(target, new Set());
    inboundSets.get(target)?.add(source);
  };

  for (const l of model.links) {
    push(linksFrom, l.source, l);
    push(linksTo, l.target, l);
    connect(l.source, l.target);
    countInbound(l.target, l.source);
  }
  for (const r of model.relations) {
    push(relationsOf, r.from, r);
    push(relationsOf, r.to, r);
    connect(r.from, r.to);
    if (r.declaredOnFrom) countInbound(r.to, r.from);
    if (r.declaredOnTo) countInbound(r.from, r.to);
  }
  for (const h of model.health) if (h.page) push(healthOf, h.page, h);

  const inbound = new Map<string, number>();
  for (const [id, set] of inboundSets) inbound.set(id, set.size);

  const today = Date.now();
  const derived: Derived = {
    model,
    pageById,
    linksFrom,
    linksTo,
    relationsOf,
    healthOf,
    inbound,
    neighbors,
    commitsOf: (page) => page.git.commits.map((i) => model.commits[i]).filter((c): c is Commit => c !== undefined),
    ageDays: (page) => calendarDaysSince(page.updated ?? page.git.last, today),
    bornAt: (page) => {
      const stamp = page.git.first ? Date.parse(page.git.first) : page.created ? Date.parse(`${page.created}T12:00:00Z`) : Number.NaN;
      return Number.isNaN(stamp) ? null : stamp;
    },
    timeRange: timeRangeOf(model),
    tags: counted(model.pages.flatMap((p) => p.tags)),
    domains: counted(model.pages.flatMap((p) => (p.domain ? [p.domain] : []))),
    statuses: counted(model.pages.flatMap((p) => (p.status ? [p.status] : []))),
  };
  cache = { model, derived };
  return derived;
}

/** The derived indexes of the loaded model, or null before a vault is loaded. */
export function useDerived(): Derived | null {
  const model = useStore((s) => s.model);
  return model ? derive(model) : null;
}
