// Pure helpers for the Health view: grouping, filtering, the checklist handed
// to Claude and the per-predicate symmetry of typed relations.
import { HEALTH_CHECKS, PREDICATES, type HealthCheck, type HealthIssue, type Relation, type Severity } from '../../../shared/model.ts';

export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Every check the server runs, in schema order. */
export const ALL_CHECKS = Object.keys(HEALTH_CHECKS) as HealthCheck[];

const CHECK_INFO = HEALTH_CHECKS as Record<string, { label: string; description: string } | undefined>;

export function checkInfo(check: string): { label: string; description: string } {
  return CHECK_INFO[check] ?? { label: check, description: '' };
}

export interface Filters {
  severity: Severity | null;
  check: HealthCheck | null;
  query: string;
}

export const NO_FILTERS: Filters = { severity: null, check: null, query: '' };

export function hasFilters(f: Filters): boolean {
  return f.severity !== null || f.check !== null || f.query.trim() !== '';
}

/** Every whitespace-separated term must appear in the check, a page id or the message. */
export function matches(issue: HealthIssue, f: Filters): boolean {
  if (f.severity && issue.severity !== f.severity) return false;
  if (f.check && issue.check !== f.check) return false;
  const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [issue.check, checkInfo(issue.check).label, issue.page ?? '', issue.other ?? '', issue.message].join('\n').toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

export interface CheckGroup {
  check: HealthCheck;
  /** Worst severity among the group's issues (hot-budget varies with the data). */
  severity: Severity;
  issues: HealthIssue[];
  /** Distinct pages the issues belong to. */
  pages: number;
}

function distinctPages(issues: readonly HealthIssue[]): number {
  return new Set(issues.flatMap((i) => (i.page ? [i.page] : []))).size;
}

/** Issues grouped by check: worst severity first, then schema order. */
export function groupByCheck(issues: readonly HealthIssue[]): CheckGroup[] {
  const byCheck = new Map<HealthCheck, HealthIssue[]>();
  for (const issue of issues) {
    const list = byCheck.get(issue.check);
    if (list) list.push(issue);
    else byCheck.set(issue.check, [issue]);
  }
  const order = (check: HealthCheck): number => {
    const i = ALL_CHECKS.indexOf(check);
    return i < 0 ? ALL_CHECKS.length : i;
  };
  return [...byCheck]
    .map(([check, list]) => ({
      check,
      severity: list.reduce<Severity>((worst, i) => (SEVERITY_RANK[i.severity] < SEVERITY_RANK[worst] ? i.severity : worst), 'info'),
      issues: list,
      pages: distinctPages(list),
    }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || order(a.check) - order(b.check) || a.check.localeCompare(b.check));
}

export function countPages(issues: readonly HealthIssue[]): number {
  return distinctPages(issues);
}

/** `- [ ] <check> · [[page]] — message`; the other page is appended only when the message does not name it. */
export function checklistLine(issue: HealthIssue): string {
  const page = issue.page ? ` · [[${issue.page}]]` : '';
  const other = issue.other && !issue.message.includes(issue.other) ? ` (→ [[${issue.other}]])` : '';
  return `- [ ] ${issue.check}${page} — ${issue.message.replace(/\s+/g, ' ').trim()}${other}`;
}

export function describeFilters(f: Filters): string {
  const parts: string[] = [];
  if (f.severity) parts.push(`severity ${f.severity}`);
  if (f.check) parts.push(`check ${f.check}`);
  const query = f.query.trim();
  if (query) parts.push(`search "${query}"`);
  return parts.join(', ');
}

export function toChecklist(issues: readonly HealthIssue[], vault: string, f: Filters): string {
  const scope = describeFilters(f);
  const heading = `Vault health (${vault}): ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}${scope ? ` — ${scope}` : ''}`;
  return `${heading}\n\n${issues.map(checklistLine).join('\n')}\n`;
}

export interface SymmetryRow {
  predicate: string;
  inverse: string;
  total: number;
  both: number;
  /** Declared with the forward name only: the target page lacks `inverse:`. */
  forwardOnly: number;
  /** Declared with the inverse name only: the source page lacks `predicate:`. */
  inverseOnly: number;
}

export interface Symmetry {
  /** Predicates with an inverse, most one-sided relations first. */
  rows: SymmetryRow[];
  /** Predicates in use without an inverse: one side is enough, so they are not checked. */
  oneWay: { predicate: string; count: number }[];
  /** Relations whose predicate is outside the schema. */
  unknown: number;
}

export function oneSided(row: SymmetryRow): number {
  return row.forwardOnly + row.inverseOnly;
}

export function relationSymmetry(relations: readonly Relation[]): Symmetry {
  const rows: SymmetryRow[] = [];
  const oneWay: Symmetry['oneWay'] = [];
  for (const def of PREDICATES) {
    const list = relations.filter((r) => r.known && r.predicate === def.name);
    if (!list.length) continue;
    if (!def.inverse) {
      oneWay.push({ predicate: def.name, count: list.length });
      continue;
    }
    const row: SymmetryRow = { predicate: def.name, inverse: def.inverse, total: list.length, both: 0, forwardOnly: 0, inverseOnly: 0 };
    for (const r of list) {
      if (r.declaredOnFrom && r.declaredOnTo) row.both++;
      else if (r.declaredOnFrom) row.forwardOnly++;
      else row.inverseOnly++;
    }
    rows.push(row);
  }
  rows.sort((a, b) => oneSided(b) - oneSided(a) || b.total - a.total || a.predicate.localeCompare(b.predicate));
  return { rows, oneWay, unknown: relations.filter((r) => !r.known).length };
}
