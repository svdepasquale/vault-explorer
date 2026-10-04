import { useMemo, useState } from 'react';
import { HEALTH_CHECKS, isOneSided, PREDICATES, type Page, type Relation } from '../../shared/model.ts';
import { api } from '../app/api.ts';
import { useDerived, type Derived } from '../app/derived.ts';
import { commitUrl, daysAgo, formatBytes, formatDate, formatNumber, plural, shortLabel } from '../app/format.ts';
import { useStore } from '../app/store.ts';
import { KindBadge } from './KindBadge.tsx';
import { PageMarkdown } from './Markdown.tsx';
import { PageLink } from './PageLink.tsx';
import { SeverityBadge } from './SeverityBadge.tsx';

type Tab = 'details' | 'content' | 'history';
const PREDICATE = new Map(PREDICATES.map((p) => [p.name, p]));

interface RelationRow {
  label: string;
  other: string;
  oneSided: string | null;
}

/** Typed relations read from this page's side, grouped by label. */
function relationRows(page: Page, relations: Relation[]): [string, RelationRow[]][] {
  const groups = new Map<string, RelationRow[]>();
  for (const r of relations) {
    const def = PREDICATE.get(r.predicate);
    const outgoing = r.from === page.id;
    const label = outgoing ? (def?.label ?? r.predicate) : (def?.inverseLabel ?? `← ${r.predicate}`);
    let oneSided: string | null = null;
    if (isOneSided(r)) {
      oneSided = r.declaredOnFrom ? `declared only on ${r.from}` : `declared only on ${r.to}`;
    }
    const row = { label, other: outgoing ? r.to : r.from, oneSided };
    const list = groups.get(label);
    if (list) list.push(row);
    else groups.set(label, [row]);
  }
  return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
}

function LinkList({ ids, derived, limit = 24 }: { ids: [string, number][]; derived: Derived; limit?: number }) {
  const [all, setAll] = useState(false);
  const sorted = [...ids].sort((a, b) => {
    const ka = derived.pageById.get(a[0])?.kind ?? '';
    const kb = derived.pageById.get(b[0])?.kind ?? '';
    return ka.localeCompare(kb) || a[0].localeCompare(b[0]);
  });
  const shown = all ? sorted : sorted.slice(0, limit);
  if (!ids.length) return <p className="panel-muted">None</p>;
  return (
    <div className="link-cloud">
      {shown.map(([id, count]) => (
        <span key={id} className="link-cloud-item">
          <PageLink id={id} />
          {count > 1 && <span className="link-count">×{count}</span>}
        </span>
      ))}
      {sorted.length > limit && (
        <button type="button" className="btn-link" onClick={() => setAll(!all)}>
          {all ? 'show fewer' : `+${sorted.length - limit} more`}
        </button>
      )}
    </div>
  );
}

function Details({ page, derived }: { page: Page; derived: Derived }) {
  const updateGraph = useStore((s) => s.updateGraph);
  const setView = useStore((s) => s.setView);
  const relations = derived.relationsOf.get(page.id) ?? [];
  const rows = relationRows(page, relations);
  const outLinks = (derived.linksFrom.get(page.id) ?? []).map((l): [string, number] => [l.target, Math.max(1, l.body)]);
  const inLinks = (derived.linksTo.get(page.id) ?? []).map((l): [string, number] => [l.source, Math.max(1, l.body)]);
  const issues = derived.healthOf.get(page.id) ?? [];
  const age = derived.ageDays(page);

  return (
    <div className="panel-body">
      {page.description && <p className="panel-description">{page.description}</p>}

      <dl className="facts">
        <div>
          <dt>Created</dt>
          <dd>{formatDate(page.created ?? page.git.first)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>
            {formatDate(page.updated ?? page.git.last)} <span className="panel-muted">({daysAgo(age)})</span>
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{page.status ?? '—'}</dd>
        </div>
        <div>
          <dt>Domain</dt>
          <dd>
            {page.domain ? (
              <button type="button" className="btn-link" onClick={() => { updateGraph({ colorBy: 'emphasis', emphasis: { field: 'domain', value: page.domain } }); setView('graph'); }}>
                {page.domain}
              </button>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>Commits</dt>
          <dd>{formatNumber(page.git.commits.length)}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>
            {formatBytes(page.bytes)} · {formatNumber(page.words)} words
          </dd>
        </div>
        {page.address && (
          <div>
            <dt>Address</dt>
            <dd className="mono">{page.address}</dd>
          </div>
        )}
        {!page.indexed && (
          <div>
            <dt>Retrieval</dt>
            <dd>not indexed</dd>
          </div>
        )}
      </dl>

      {page.tags.length > 0 && (
        <div className="tag-row">
          {page.tags.map((t) => (
            <button
              key={t}
              type="button"
              className="tag"
              title="Highlight this tag on the graph"
              onClick={() => { updateGraph({ colorBy: 'emphasis', emphasis: { field: 'tag', value: t } }); setView('graph'); }}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <section className="panel-section">
          <h3>Health</h3>
          <ul className="issue-list">
            {issues.map((issue) => (
              <li key={`${issue.check}:${issue.other ?? ''}:${issue.message}`}>
                <SeverityBadge severity={issue.severity} />
                <span className="issue-check">{HEALTH_CHECKS[issue.check].label}</span>
                <span className="issue-message">{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel-section">
        <h3>Typed relations {relations.length > 0 && <span className="count">{relations.length}</span>}</h3>
        {rows.length === 0 ? (
          <p className="panel-muted">None declared</p>
        ) : (
          <dl className="relation-list">
            {rows.map(([label, items]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {items.map((row) => (
                    <span key={row.other} className="relation-item">
                      <PageLink id={row.other} />
                      {row.oneSided && (
                        <span className="one-sided" title={row.oneSided}>
                          <SeverityBadge severity="warning" compact /> one-sided
                        </span>
                      )}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="panel-section">
        <h3>
          Links here <span className="count">{inLinks.length}</span>
        </h3>
        <LinkList ids={inLinks} derived={derived} />
      </section>

      <section className="panel-section">
        <h3>
          Links out <span className="count">{outLinks.length}</span>
        </h3>
        <LinkList ids={outLinks} derived={derived} />
      </section>
    </div>
  );
}

function History({ page, derived }: { page: Page; derived: Derived }) {
  const [all, setAll] = useState(false);
  const commits = useMemo(() => derived.commitsOf(page).reverse(), [derived, page]);
  const shown = all ? commits : commits.slice(0, 40);
  if (!commits.length) return <p className="panel-muted panel-body">No git history for this page.</p>;
  const remote = derived.model.vault.remote;
  return (
    <div className="panel-body">
      <ol className="history">
        {shown.map((c) => {
          const change = c.changes.find((ch) => ch.id === page.id || ch.from === page.id) ?? c.changes[0];
          const url = commitUrl(remote, c.hash);
          return (
            <li key={c.hash}>
              <span className={`change change-${change?.status ?? 'M'}`} title={{ A: 'added', M: 'modified', D: 'deleted', R: 'renamed' }[change?.status ?? 'M']}>
                {change?.status ?? 'M'}
              </span>
              <span className="history-date">{formatDate(c.date)}</span>
              <span className="history-subject">{c.subject}</span>
              {url ? (
                <a className="mono history-hash" href={url} target="_blank" rel="noopener noreferrer">
                  {c.hash.slice(0, 7)}
                </a>
              ) : (
                <span className="mono history-hash">{c.hash.slice(0, 7)}</span>
              )}
            </li>
          );
        })}
      </ol>
      {commits.length > 40 && (
        <button type="button" className="btn-link" onClick={() => setAll(!all)}>
          {all ? 'show fewer' : `show all ${commits.length}`}
        </button>
      )}
    </div>
  );
}

export function PagePanel({ id }: { id: string }) {
  const derived = useDerived();
  const select = useStore((s) => s.select);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const updateGraph = useStore((s) => s.updateGraph);
  const [tab, setTab] = useState<Tab>('details');
  const page = derived?.pageById.get(id);
  const isMac = useStore((s) => s.status?.platform === 'darwin');

  if (!derived || !page) {
    return (
      <aside className="panel">
        <div className="panel-header">
          <p className="panel-muted">Page {id} is not in this vault.</p>
          <button type="button" className="btn btn-ghost panel-close" onClick={() => select(null)} aria-label="Close">
            ×
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel" aria-label={`Page ${page.title}`}>
      <div className="panel-header">
        <div className="panel-heading">
          <div className="panel-kicker">
            <KindBadge kind={page.kind} />
            <span className="panel-path mono">{page.path}</span>
          </div>
          <h2 className="panel-title">{page.title}</h2>
          {page.title !== shortLabel(page.id) && <div className="panel-stem mono">[[{shortLabel(page.id)}]]</div>}
        </div>
        <button type="button" className="btn btn-ghost panel-close" onClick={() => select(null)} aria-label="Close page panel" title="Close (Esc)">
          ×
        </button>
      </div>

      <div className="panel-actions">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            updateGraph({ focusDepth: 1 });
            useStore.getState().setTimeCursor(null);
            if (view !== 'graph') setView('graph');
          }}
        >
          Focus in graph
        </button>
        {isMac && (
          <>
            <button type="button" className="btn btn-small" onClick={() => void api.open(page.id)}>
              Open file
            </button>
            <button type="button" className="btn btn-small" onClick={() => void api.open(page.id, true)}>
              Reveal in Finder
            </button>
          </>
        )}
      </div>

      <div className="panel-tabs" role="tablist">
        {(['details', 'content', 'history'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`panel-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'details' ? 'Details' : t === 'content' ? 'Content' : `History (${page.git.commits.length})`}
          </button>
        ))}
      </div>

      <div className="panel-scroll">
        {tab === 'details' && <Details page={page} derived={derived} />}
        {tab === 'content' && (
          <div className="panel-body">
            <PageMarkdown id={page.id} />
          </div>
        )}
        {tab === 'history' && <History page={page} derived={derived} />}
      </div>
      <div className="panel-footer panel-muted">{plural(derived.neighbors.get(page.id)?.size ?? 0, 'neighbour')}</div>
    </aside>
  );
}
