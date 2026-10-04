import {
  OVERSIZED_BYTES,
  isOneSided,
  STALE_DAYS,
  STALE_STATUSES,
  type HealthIssue,
  type HotSummary,
  type Link,
  type Page,
  type Relation,
  type Severity,
  type Unresolved,
} from '../shared/model.ts';
import { predicateDef } from './relations.ts';

export interface HealthInput {
  pages: Page[];
  links: Link[];
  relations: Relation[];
  unresolved: Unresolved[];
  ambiguous: { source: string; raw: string; picked: string }[];
  hot: HotSummary | null;
  missingFrontmatter: string[];
  now: Date;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const REQUIRED_FIELDS = ['name', 'description', 'type', 'tags'] as const;
const DAY_MS = 86_400_000;

export function computeHealth(input: HealthInput): HealthIssue[] {
  const { pages, links, relations, unresolved, ambiguous, hot, now } = input;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const issues: HealthIssue[] = [];

  for (const id of input.missingFrontmatter) {
    issues.push({ check: 'frontmatter-missing', severity: 'error', page: id, message: 'No frontmatter block' });
  }

  for (const page of pages) {
    if (page.frontmatterError) {
      issues.push({ check: 'frontmatter-yaml', severity: 'error', page: page.id, message: page.frontmatterError });
    }
    for (const key of page.frontmatterCuts) {
      const value = page.frontmatter[key];
      issues.push({
        check: 'frontmatter-comment-cut',
        severity: 'warning',
        page: page.id,
        message: `${key}: cut at an unquoted " #" after ${typeof value === 'string' ? value.length : 0} chars (YAML comment); quote the value`,
      });
    }
    if (input.missingFrontmatter.includes(page.id)) continue;
    const missing = REQUIRED_FIELDS.filter((f) => {
      const v = page.frontmatter[f];
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    });
    if (missing.length) {
      issues.push({ check: 'field-missing', severity: 'warning', page: page.id, message: `Missing ${missing.join(', ')}` });
    }
    if ((page.kind === 'entity' || page.kind === 'source') && page.frontmatter['related'] !== undefined) {
      issues.push({
        check: 'related-deprecated',
        severity: 'info',
        page: page.id,
        message: 'Uses related: — entity and source pages declare typed relations: instead',
      });
    }
  }

  const seenUnresolved = new Set<string>();
  for (const u of unresolved) {
    const key = `${u.source}\u0000${u.where}\u0000${u.predicate ?? ''}\u0000${u.raw}`;
    if (seenUnresolved.has(key)) continue;
    seenUnresolved.add(key);
    if (u.where === 'relations') {
      issues.push({
        check: 'relation-unresolved',
        severity: 'error',
        page: u.source,
        message: `${u.predicate ?? 'relation'}: [[${u.raw}]] points to no page`,
      });
    } else {
      issues.push({
        check: 'link-unresolved',
        severity: 'error',
        page: u.source,
        message: `[[${u.raw}]]${u.where === 'related' ? ' in related:' : ''} points to no page`,
      });
    }
  }

  const seenAmbiguous = new Set<string>();
  for (const a of ambiguous) {
    const key = `${a.source}\u0000${a.raw}`;
    if (seenAmbiguous.has(key)) continue;
    seenAmbiguous.add(key);
    issues.push({
      check: 'link-ambiguous',
      severity: 'info',
      page: a.source,
      other: a.picked,
      message: `[[${a.raw}]] matches several pages; resolved to ${a.picked}`,
    });
  }

  for (const r of relations) {
    if (!r.known) {
      issues.push({
        check: 'relation-unknown-predicate',
        severity: 'warning',
        page: r.from,
        other: r.to,
        message: `Predicate "${r.predicate}" is not in the schema`,
      });
      continue;
    }
    if (!isOneSided(r)) continue;
    const def = predicateDef(r.predicate);
    if (!def?.inverse) continue;
    if (r.expectedOnTo && !r.declaredOnTo) {
      issues.push({
        check: 'relation-asymmetric',
        severity: 'warning',
        page: r.to,
        other: r.from,
        message: `${r.from} declares ${r.predicate} → ${r.to}; add ${def.inverse}: [[${stem(r.from)}]] here`,
      });
    } else {
      issues.push({
        check: 'relation-asymmetric',
        severity: 'warning',
        page: r.from,
        other: r.to,
        message: `${r.to} declares ${def.inverse} → ${r.from}; add ${r.predicate}: [[${stem(r.to)}]] here`,
      });
    }
  }

  // Orphans: nothing but navigation pages points here (links or relations, either side).
  const reached = new Set<string>();
  for (const l of links) {
    const src = byId.get(l.source);
    if (src && src.kind !== 'nav') reached.add(l.target);
  }
  for (const r of relations) {
    if (r.declaredOnFrom) reached.add(r.to);
    if (r.declaredOnTo) reached.add(r.from);
  }
  for (const page of pages) {
    // Folds are log rollups, reachable through folds/_index by design.
    if (page.kind === 'nav' || page.kind === 'fold' || !page.indexed || reached.has(page.id)) continue;
    issues.push({ check: 'orphan', severity: 'warning', page: page.id, message: 'Only navigation pages link here' });
  }

  for (const page of pages) {
    // Archived pages (index: false) are exempt, as in the vault's own lint.
    if (page.indexed && page.status && STALE_STATUSES.includes(page.status) && page.updated) {
      const age = Math.floor((now.getTime() - Date.parse(`${page.updated}T00:00:00Z`)) / DAY_MS);
      if (age > STALE_DAYS) {
        issues.push({
          check: 'stale',
          severity: 'info',
          page: page.id,
          message: `status: ${page.status}, last updated ${page.updated} (${age} days ago)`,
        });
      }
    }
    if (page.kind !== 'nav' && page.bytes > OVERSIZED_BYTES) {
      issues.push({
        check: 'oversized',
        severity: 'info',
        page: page.id,
        message: `${Math.round(page.bytes / 1024)} KB (threshold ${Math.round(OVERSIZED_BYTES / 1024)} KB)`,
      });
    }
  }

  if (hot && hot.bytes > hot.budget * 0.9) {
    issues.push({
      check: 'hot-budget',
      severity: hot.bytes > hot.budget ? 'error' : 'warning',
      page: hot.id,
      message: `${hot.bytes} B of ${hot.budget} B (${Math.round((hot.bytes / hot.budget) * 100)}%)`,
    });
  }

  return issues.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.check.localeCompare(b.check) ||
      (a.page ?? '').localeCompare(b.page ?? ''),
  );
}

function stem(id: string): string {
  const i = id.lastIndexOf('/');
  return i >= 0 ? id.slice(i + 1) : id;
}
