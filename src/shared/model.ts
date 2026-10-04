// API contract shared by the server (src/core, src/server) and the SPA (src/web).
// Erasable TypeScript only: Node runs these files with type stripping, so no
// enums, namespaces or parameter properties, and type imports use `import type`.

/** Page kinds, derived from folder + frontmatter `type` (runbooks and folds are `type: meta`). */
export const PAGE_KINDS = ['entity', 'source', 'runbook', 'profile', 'meta', 'fold', 'nav'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const KIND_LABELS: Record<PageKind, string> = {
  entity: 'Entity',
  source: 'Source',
  runbook: 'Runbook',
  profile: 'Profile',
  meta: 'Meta',
  fold: 'Fold',
  nav: 'Navigation',
};

export const KIND_DESCRIPTIONS: Record<PageKind, string> = {
  entity: 'Projects, services and machines (wiki/entities)',
  source: 'External references: SaaS, dashboards, docs (wiki/sources)',
  runbook: 'Reusable operational procedures (wiki/runbooks)',
  profile: 'Identity, preferences and feedback rules (wiki/meta/profile)',
  meta: 'Dated syntheses, reports and other meta pages',
  fold: 'Extractive rollups of the old log (wiki/folds)',
  nav: 'Indexes and caches: index, _index, hot, log, overview',
};

/** Typed-graph predicates of the vault schema (vault CLAUDE.md §Typed graph). */
export interface PredicateDef {
  /** Canonical (forward) name, e.g. `hosted_on`. */
  name: string;
  /** Name declared on the other page, or null when the predicate has no inverse. */
  inverse: string | null;
  /** Reading of the edge from the declaring page. */
  label: string;
  /** Reading of the edge from the target page. */
  inverseLabel: string;
}

export const PREDICATES: readonly PredicateDef[] = [
  { name: 'hosted_on', inverse: 'hosts', label: 'hosted on', inverseLabel: 'hosts' },
  { name: 'depends_on', inverse: null, label: 'depends on', inverseLabel: 'dependency of' },
  { name: 'monitored_by', inverse: 'monitors', label: 'monitored by', inverseLabel: 'monitors' },
  { name: 'documented_in', inverse: 'documents', label: 'documented in', inverseLabel: 'documents' },
  { name: 'replaces', inverse: 'replaced_by', label: 'replaces', inverseLabel: 'replaced by' },
  { name: 'blocks', inverse: 'blocked_by', label: 'blocks', inverseLabel: 'blocked by' },
  { name: 'part_of', inverse: null, label: 'part of', inverseLabel: 'has part' },
  { name: 'consumed_by', inverse: 'consumes', label: 'consumed by', inverseLabel: 'consumes' },
  { name: 'managed_by', inverse: 'manages', label: 'managed by', inverseLabel: 'manages' },
  { name: 'references', inverse: 'referenced_by', label: 'references', inverseLabel: 'referenced by' },
  { name: 'implements', inverse: 'implemented_by', label: 'implements', inverseLabel: 'implemented by' },
  { name: 'related_to', inverse: null, label: 'related to', inverseLabel: 'related to' },
];

/** Health thresholds, shared so the UI can explain them. */
export const STALE_DAYS = 60;
export const STALE_STATUSES: readonly string[] = ['active', 'developing', 'planned', 'watchlist'];
export const OVERSIZED_BYTES = 24 * 1024;
/** Same threshold as the SessionStart hook (`wiki-hot-cache.sh`). */
export const HOT_BUDGET_BYTES = 7168;

export interface PageGit {
  /** ISO date-time of the first commit touching the page, renames followed. */
  first: string | null;
  /** ISO date-time of the last commit touching the page. */
  last: string | null;
  /** Indices into `VaultModel.commits`, oldest first. */
  commits: number[];
}

export interface Page {
  /** Path under `wiki/` without `.md`, e.g. `entities/platform`. Stable key everywhere. */
  id: string;
  /** Path relative to the vault root, e.g. `wiki/entities/platform.md`. */
  path: string;
  /** File name without extension, e.g. `platform`. */
  stem: string;
  /** Folder under `wiki/`, `''` for the root. */
  folder: string;
  /** Frontmatter `name`, else `title`, else the stem. */
  title: string;
  description: string | null;
  /** Raw frontmatter `type`. Use `kind` for grouping. */
  type: string | null;
  kind: PageKind;
  status: string | null;
  domain: string | null;
  tags: string[];
  /** `YYYY-MM-DD` from frontmatter: the vault's authoritative dates. */
  created: string | null;
  updated: string | null;
  address: string | null;
  /** False for `index: false` pages and for hot/log (excluded from retrieval). */
  indexed: boolean;
  bytes: number;
  words: number;
  frontmatter: Record<string, unknown>;
  /** Strict YAML parse error; `frontmatter` then holds a lenient line-based parse. */
  frontmatterError: string | null;
  /** Frontmatter keys whose value an unquoted ` #` cut short (YAML comment). */
  frontmatterCuts: string[];
  git: PageGit;
}

/** Resolved wikilinks between two pages, aggregated per ordered pair. */
export interface Link {
  source: string;
  target: string;
  /** Occurrences in the body (code blocks and inline code excluded). */
  body: number;
  /** Declared in the frontmatter `related:` list. */
  related: boolean;
  /** ISO date-time of the first commit that wrote this link on `source`; null when git cannot tell. */
  since: string | null;
}

/** A typed relation in canonical (forward) direction, merged across both pages. */
export interface Relation {
  from: string;
  predicate: string;
  to: string;
  /** `from` declares `predicate: [[to]]`. */
  declaredOnFrom: boolean;
  /** `to` declares `inverse: [[from]]`. */
  declaredOnTo: boolean;
  /** The schema defines an inverse, so both pages should declare the edge. */
  hasInverse: boolean;
  /** The predicate is part of the schema. */
  known: boolean;
  /** The schema wants `from` to declare it: the predicate has an inverse and `from` is an entity/source page. */
  expectedOnFrom: boolean;
  /** The schema wants `to` to declare the inverse: same rule on the `to` page. */
  expectedOnTo: boolean;
  /** ISO date-time of the first commit declaring it on either page; null when git cannot tell. */
  since: string | null;
}

/**
 * Kinds whose pages carry a typed `relations:` block (vault schema). Meta, profile,
 * runbook and navigation pages use `related:`, so they are never expected to declare
 * an inverse.
 */
export const TYPED_RELATION_KINDS: readonly PageKind[] = ['entity', 'source'];

/** A relation the schema wants declared on a page that does not declare it. */
export function isOneSided(r: Relation): boolean {
  return (r.expectedOnFrom && !r.declaredOnFrom) || (r.expectedOnTo && !r.declaredOnTo);
}

export interface Unresolved {
  source: string;
  raw: string;
  where: 'body' | 'relations' | 'related';
  predicate?: string;
}

export type ChangeStatus = 'A' | 'M' | 'D' | 'R';

export interface CommitChange {
  status: ChangeStatus;
  /** Page id after the change. */
  id: string;
  /** Previous page id, for renames. */
  from?: string;
}

/** A commit that changed at least one page under `wiki/`. */
export interface Commit {
  hash: string;
  /** ISO date-time (author date). */
  date: string;
  subject: string;
  changes: CommitChange[];
}

/** A page that existed in git history and is gone from the working tree. */
export interface GhostPage {
  id: string;
  created: string | null;
  deleted: string;
  commits: number[];
}

export type Severity = 'error' | 'warning' | 'info';

export const HEALTH_CHECKS = {
  'frontmatter-missing': { label: 'No frontmatter', description: 'The page has no YAML frontmatter block.' },
  'frontmatter-yaml': { label: 'Invalid YAML', description: 'The frontmatter is not valid YAML; a lenient line parse was used instead.' },
  'frontmatter-comment-cut': { label: 'Value cut by #', description: 'An unquoted " #" starts a YAML comment, so the rest of the value is dropped; quote the value.' },
  'field-missing': { label: 'Missing fields', description: 'One of the universal fields name, description, type, tags is missing.' },
  'link-unresolved': { label: 'Dead wikilink', description: 'A body wikilink points to no page.' },
  'link-ambiguous': { label: 'Ambiguous wikilink', description: 'A bare wikilink matches several pages; the closest one was picked.' },
  'relation-unresolved': { label: 'Dead relation', description: 'A typed relation points to no page.' },
  'relation-asymmetric': { label: 'One-sided relation', description: 'A predicate with an inverse is declared on one entity/source page only; the schema wants both (meta, profile, runbook and navigation pages use related: instead).' },
  'relation-unknown-predicate': { label: 'Unknown predicate', description: 'The relations block uses a predicate outside the schema.' },
  'related-deprecated': { label: 'related: on entity/source', description: 'Entity and source pages use typed relations:, not related:.' },
  orphan: { label: 'Orphan', description: 'No page links here except navigation pages.' },
  stale: { label: 'Stale', description: 'An active-like status with no update for a long time (archived pages exempt).' },
  oversized: { label: 'Oversized', description: 'Large page; atomic notes split when they cover two concepts.' },
  'hot-budget': { label: 'hot.md budget', description: 'hot.md is injected at every SessionStart and has a byte budget.' },
} as const satisfies Record<string, { label: string; description: string }>;

export type HealthCheck = keyof typeof HEALTH_CHECKS;

export interface HealthIssue {
  check: HealthCheck;
  severity: Severity;
  /** Page the fix belongs to, when there is one. */
  page: string | null;
  message: string;
  /** Second page involved (link target, relation counterpart). */
  other?: string | null;
}

export interface HotItem {
  /** Raw markdown of the list item (first line). */
  text: string;
  /** Resolved page ids linked from the item. */
  links: string[];
}

export interface HotSection {
  title: string;
  items: HotItem[];
}

export interface HotSummary {
  id: string;
  bytes: number;
  budget: number;
  updated: string | null;
  sections: HotSection[];
}

export interface VaultInfo {
  root: string;
  name: string;
  /** Git remote of `origin`, credentials stripped. */
  remote: string | null;
  branch: string | null;
  head: string | null;
  capabilities: {
    git: boolean;
    /** `scripts/retrieve.py` exists, so the recall lens can run. */
    recall: boolean;
  };
}

export interface VaultModel {
  schema: 1;
  /** Bumped by the server on every rebuild. */
  version: number;
  generatedAt: string;
  buildMs: number;
  vault: VaultInfo;
  pages: Page[];
  links: Link[];
  relations: Relation[];
  unresolved: Unresolved[];
  /** Oldest first; only commits touching `wiki/**.md`. */
  commits: Commit[];
  ghosts: GhostPage[];
  hot: HotSummary | null;
  health: HealthIssue[];
}

// ── API payloads ───────────────────────────────────────────────────────────

export interface StatusResponse {
  app: 'vault-explorer';
  appVersion: string;
  vault: string | null;
  ready: boolean;
  building: boolean;
  error: string | null;
  modelVersion: number;
  recent: string[];
  platform: string;
}

export interface PageContentResponse {
  id: string;
  /** Body without the frontmatter block. */
  markdown: string;
}

export interface RecallCandidate {
  pageId: string | null;
  path: string;
  chunkId: string | null;
  score: number | null;
  bm25: number | null;
  snippet: string;
}

export interface RecallResponse {
  query: string;
  strategy: string | null;
  elapsedMs: number;
  candidates: RecallCandidate[];
}

export interface ApiError {
  error: string;
  code?: string;
}
