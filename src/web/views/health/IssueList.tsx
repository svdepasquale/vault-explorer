import { useEffect, useMemo, useRef, useState, type MouseEvent, type Ref } from 'react';
import type { HealthCheck, Severity } from '../../../shared/model.ts';
import { useDerived } from '../../app/derived.ts';
import { formatNumber, plural } from '../../app/format.ts';
import { useStore } from '../../app/store.ts';
import { PageLink } from '../../components/PageLink.tsx';
import { SeverityBadge } from '../../components/SeverityBadge.tsx';
import { useHealthFilters } from './filters.ts';
import { checkInfo, hasFilters, matches, SEVERITIES, toChecklist, type CheckGroup } from './issues.ts';
import { PassBadge } from './Summary.tsx';

/** How the second page of an issue relates to the first. */
const OTHER_LABEL: Partial<Record<HealthCheck, string>> = {
  'relation-asymmetric': 'declared on',
  'link-ambiguous': 'resolved to',
  'relation-unknown-predicate': 'target',
};

// Links and buttons inside a row act on their own; the row click must not follow.
const stop = (e: MouseEvent): void => e.stopPropagation();

function IssueGroup({
  group,
  selected,
  exists,
  onSelect,
  onGraph,
}: {
  group: CheckGroup;
  selected: string | null;
  exists: (id: string) => boolean;
  onSelect: (id: string) => void;
  onGraph: (id: string) => void;
}) {
  const info = checkInfo(group.check);
  const showOther = group.issues.some((i) => i.other);
  const showGraph = group.check === 'relation-asymmetric';
  const columns = ['max-content', 'fit-content(16rem)', 'minmax(0, 1fr)'];
  if (showOther) columns.push('fit-content(19rem)');
  if (showGraph) columns.push('max-content');
  const titleId = `health-group-${group.check}`;

  return (
    <section className="health-group" aria-labelledby={titleId}>
      <header className="health-group-header">
        <h3 id={titleId} className="health-group-title">
          {info.label}
        </h3>
        <span className="count">{formatNumber(group.issues.length)}</span>
        <span className="health-group-desc">{info.description}</span>
      </header>
      <ul className="health-rows" style={{ gridTemplateColumns: columns.join(' ') }}>
        {group.issues.map((issue, i) => {
          const page = issue.page;
          const current = page !== null && page === selected;
          const open = page !== null && exists(page) ? () => onSelect(page) : undefined;
          return (
            <li
              key={`${i}:${page ?? ''}:${issue.other ?? ''}`}
              className={`health-row${open ? ' health-clickable' : ''}${current ? ' health-current' : ''}`}
              aria-current={current ? 'true' : undefined}
              onClick={open}
            >
              <span className="health-cell">
                <SeverityBadge severity={issue.severity} />
              </span>
              <span className="health-cell health-cell-page" onClick={stop}>
                {page ? <PageLink id={page} /> : <span className="health-muted">no page</span>}
              </span>
              <span className="health-cell health-row-msg">{issue.message}</span>
              {showOther && (
                <span className="health-cell health-cell-other" onClick={stop}>
                  {issue.other && (
                    <>
                      <span className="health-other-label">{OTHER_LABEL[group.check] ?? 'with'}</span>
                      <PageLink id={issue.other} />
                    </>
                  )}
                </span>
              )}
              {showGraph && (
                <span className="health-cell health-cell-action">
                  {page && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small health-graph-btn"
                      title="Open the graph focused on this page, with one-sided relations marked"
                      onClick={(e) => {
                        e.stopPropagation();
                        onGraph(page);
                      }}
                    >
                      Show on graph
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Filterable issue list grouped by check, with the checklist hand-off to Claude. */
export function IssueList({
  groups,
  vaultName,
  sectionRef,
}: {
  groups: readonly CheckGroup[];
  vaultName: string;
  sectionRef: Ref<HTMLElement>;
}) {
  const derived = useDerived();
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const updateGraph = useStore((s) => s.updateGraph);
  const isMac = useStore((s) => s.status?.platform === 'darwin');
  const severity = useHealthFilters((s) => s.severity);
  const check = useHealthFilters((s) => s.check);
  const query = useHealthFilters((s) => s.query);
  const update = useHealthFilters((s) => s.update);
  const clear = useHealthFilters((s) => s.clear);

  const filters = useMemo(() => ({ severity, check, query }), [severity, check, query]);
  const all = useMemo(() => groups.flatMap((g) => g.issues), [groups]);
  const visible = useMemo(
    () => groups.map((g) => ({ ...g, issues: g.issues.filter((i) => matches(i, filters)) })).filter((g) => g.issues.length > 0),
    [groups, filters],
  );
  const shown = useMemo(() => visible.flatMap((g) => g.issues), [visible]);
  const text = useMemo(() => toChecklist(shown, vaultName, filters), [shown, vaultName, filters]);

  // Facet counts: what each choice would show under the other two filters.
  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const issue of all) if (matches(issue, { ...filters, severity: null })) counts[issue.severity]++;
    return counts;
  }, [all, filters]);
  const checkCounts = useMemo(() => {
    const counts = new Map<HealthCheck, number>();
    for (const issue of all) if (matches(issue, { ...filters, check: null })) counts.set(issue.check, (counts.get(issue.check) ?? 0) + 1);
    return counts;
  }, [all, filters]);
  const checkOptions = groups.map((g) => g.check);
  if (check && !checkOptions.includes(check)) checkOptions.push(check);

  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!manual) return;
    area.current?.focus();
    area.current?.select();
  }, [manual]);

  const copy = async (): Promise<void> => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      setManual(false);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Denied or unavailable (insecure context, unfocused document): hand over a selected textarea instead.
      setCopied(false);
      setManual(true);
    }
  };

  const showOnGraph = (id: string): void => {
    updateGraph({ showAsymmetric: true, focusDepth: 1 });
    select(id);
    setView('graph');
  };
  const exists = (id: string): boolean => derived?.pageById.has(id) ?? false;
  const total = all.length;
  const filtered = hasFilters(filters);

  return (
    <section ref={sectionRef} className="health-list card" aria-labelledby="health-list-title">
      <div className="health-toolbar">
        <h2 id="health-list-title" className="health-section-title health-toolbar-title">
          Issues
        </h2>
        <div className="segmented" role="radiogroup" aria-label="Severity">
          <button type="button" role="radio" aria-checked={severity === null} className={severity === null ? 'active' : ''} onClick={() => update({ severity: null })}>
            All <span className="health-seg-count">{formatNumber(severityCounts.error + severityCounts.warning + severityCounts.info)}</span>
          </button>
          {SEVERITIES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={severity === s} className={severity === s ? 'active' : ''} onClick={() => update({ severity: s })}>
              <SeverityBadge severity={s} />
              <span className="health-seg-count">{formatNumber(severityCounts[s])}</span>
            </button>
          ))}
        </div>
        <select className="select health-check-select" aria-label="Check" value={check ?? ''} onChange={(e) => update({ check: (e.target.value || null) as HealthCheck | null })}>
          <option value="">All checks</option>
          {checkOptions.map((c) => (
            <option key={c} value={c}>
              {checkInfo(c).label} ({formatNumber(checkCounts.get(c) ?? 0)})
            </option>
          ))}
        </select>
        <input
          type="search"
          className="input health-search"
          placeholder="Search pages, messages, checks"
          aria-label="Search issues"
          value={query}
          onChange={(e) => update({ query: e.target.value })}
        />
        <div className="health-toolbar-end">
          <span className="health-toolbar-count" aria-live="polite">
            {filtered ? `${formatNumber(shown.length)} of ${plural(total, 'issue')}` : plural(total, 'issue')}
          </span>
          {filtered && (
            <button type="button" className="btn btn-ghost btn-small" onClick={clear}>
              Clear filters
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-small health-copy"
            disabled={!shown.length}
            title="Copy the issues shown as a Markdown checklist, to paste to Claude"
            onClick={() => void copy()}
          >
            {copied ? 'Copied ✓' : `Copy ${formatNumber(shown.length)} for Claude`}
          </button>
          <span className="health-sr-only" aria-live="polite">
            {copied ? `Copied ${plural(shown.length, 'issue')} to the clipboard` : ''}
          </span>
        </div>
      </div>

      {manual && (
        <div className="health-copy-fallback">
          <p className="health-note">
            The clipboard is not available here. The checklist below is selected: press {isMac ? '⌘C' : 'Ctrl+C'} to copy it.
          </p>
          <textarea
            ref={area}
            className="health-copy-text"
            readOnly
            value={text}
            rows={Math.min(14, shown.length + 3)}
            aria-label="Checklist for Claude"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div>
            <button type="button" className="btn btn-small" onClick={() => setManual(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {total === 0 ? (
        <div className="health-empty">
          <PassBadge />
          <p>No issues: every check passes.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="health-empty">
          <p>No issues match these filters.</p>
          <button type="button" className="btn btn-small" onClick={clear}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="health-groups">
          {visible.map((group) => (
            <IssueGroup key={group.check} group={group} selected={selected} exists={exists} onSelect={select} onGraph={showOnGraph} />
          ))}
        </div>
      )}
    </section>
  );
}
