import type { ReactNode } from 'react';
import { OVERSIZED_BYTES, STALE_DAYS } from '../../../shared/model.ts';
import { formatBytes, formatNumber } from '../../app/format.ts';
import { PageLink } from '../../components/PageLink.tsx';
import { SeverityBadge } from '../../components/SeverityBadge.tsx';
import type { OverviewStats, PageMetric } from './stats.ts';

function MetricList({
  title,
  subtitle,
  rows,
  metric,
  extra,
  empty,
  wide = false,
}: {
  title: string;
  subtitle: ReactNode;
  rows: PageMetric[];
  metric: (m: PageMetric) => ReactNode;
  extra?: (m: PageMetric) => ReactNode;
  empty: string;
  wide?: boolean;
}) {
  return (
    <section className="card overview-card" aria-label={title}>
      <header className="overview-card-head">
        <div className="overview-card-heading">
          <h3 className="overview-card-title">{title}</h3>
          <p className="overview-card-sub">{subtitle}</p>
        </div>
      </header>
      {rows.length ? (
        <ol className={`overview-hub-list${wide ? ' has-extra' : ''}`}>
          {rows.map((m, i) => (
            <li key={m.page.id} className="overview-hub-row">
              <span className="overview-hub-rank">{i + 1}</span>
              <span className="overview-hub-page">
                <PageLink id={m.page.id} />
              </span>
              {extra && <span className="overview-hub-extra">{extra(m)}</span>}
              <span className="overview-hub-metric">{metric(m)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="overview-empty">{empty}</p>
      )}
    </section>
  );
}

export function HubTables({ stats }: { stats: OverviewStats }) {
  return (
    <div className="overview-grid overview-grid-3">
      <MetricList
        title="Most linked"
        subtitle="Distinct pages linking in; links from navigation pages do not count"
        rows={stats.mostLinked}
        metric={(m) => (
          <>
            {formatNumber(m.value)}
            <span className="overview-hub-unit">{m.value === 1 ? 'page' : 'pages'}</span>
          </>
        )}
        empty="No page is linked yet."
      />
      <MetricList
        title="Largest pages"
        subtitle={`Navigation pages excluded · ${formatNumber(stats.oversized)} above the ${Math.round(OVERSIZED_BYTES / 1024)} KB size check`}
        rows={stats.largest}
        metric={(m) => formatBytes(m.value)}
        empty="No content pages."
      />
      <MetricList
        title="Longest untouched"
        subtitle={`${formatNumber(stats.activeLike)} pages with an active-like status · stale after ${STALE_DAYS} days`}
        rows={stats.untouched}
        wide
        extra={(m) => <span className="overview-hub-status">{m.page.status}</span>}
        metric={(m) => (
          <span className="overview-hub-age" title={m.flagged ? `Stale: no update for more than ${STALE_DAYS} days` : undefined}>
            {m.flagged && <SeverityBadge severity="info" compact />}
            {formatNumber(m.value)}
            <span className="overview-hub-unit">{m.value === 1 ? 'day' : 'days'}</span>
            {m.flagged && <span className="overview-hub-stale">stale</span>}
          </span>
        )}
        empty="No page has an active-like status."
      />
    </div>
  );
}
