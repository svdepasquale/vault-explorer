import type { ReactNode } from 'react';
import { calendarDaysSince } from '../../app/dates.ts';
import { KIND_LABELS, type HotSummary } from '../../../shared/model.ts';
import { daysAgo, formatBytes, formatDate, formatNumber } from '../../app/format.ts';
import { KindDot } from '../../components/KindBadge.tsx';
import { PageLink } from '../../components/PageLink.tsx';
import { SeverityBadge } from '../../components/SeverityBadge.tsx';
import type { OverviewStats } from './stats.ts';

/** Same thresholds as the hot-budget health check: warning above 90%, error above 100%. */
const HOT_WARNING_SHARE = 0.9;

function Tile({ label, value, unit, children, className }: { label: ReactNode; value: ReactNode; unit?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`card overview-kpi${className ? ` ${className}` : ''}`}>
      <div className="overview-kpi-label">{label}</div>
      <div className="overview-kpi-value">
        {value}
        {unit && <span className="overview-kpi-unit">{unit}</span>}
      </div>
      {children && <div className="overview-kpi-detail">{children}</div>}
    </div>
  );
}


function HotTile({ hot }: { hot: HotSummary | null }) {
  if (!hot) {
    return (
      <Tile label="hot.md budget" value="—">
        <p>This vault has no hot.md</p>
      </Tile>
    );
  }
  const share = hot.budget > 0 ? hot.bytes / hot.budget : 0;
  const state = hot.bytes > hot.budget ? 'error' : hot.bytes > hot.budget * HOT_WARNING_SHARE ? 'warning' : null;
  return (
    <Tile label="hot.md budget" value={`${Math.round(share * 100)}%`} className="overview-kpi-hot">
      <div
        className={`overview-meter${state ? ` is-${state}` : ''}`}
        role="meter"
        aria-label="hot.md size against its budget"
        aria-valuemin={0}
        aria-valuemax={hot.budget}
        aria-valuenow={hot.bytes}
        aria-valuetext={`${formatNumber(hot.bytes)} of ${formatNumber(hot.budget)} bytes`}
      >
        <span className="overview-meter-fill" style={{ width: `${Math.min(100, share * 100)}%` }} />
        <span className="overview-meter-tick" style={{ left: `${HOT_WARNING_SHARE * 100}%` }} title="Warning threshold: 90% of the budget" />
      </div>
      <p>
        {formatNumber(hot.bytes)} of {formatNumber(hot.budget)} B
      </p>
      {state ? (
        <p className="overview-status">
          <SeverityBadge severity={state} compact />
          <span>{state === 'error' ? 'Over budget' : 'Near budget'}</span>
        </p>
      ) : (
        <p className="overview-kpi-muted">{formatNumber(hot.budget - hot.bytes)} B left</p>
      )}
      <p>
        <PageLink id={hot.id} showKind={false}>
          Open hot.md
        </PageLink>
      </p>
    </Tile>
  );
}

export function KpiRow({ stats, hot }: { stats: OverviewStats; hot: HotSummary | null }) {
  const lastAge = calendarDaysSince(stats.lastCommit);
  const twoSidedShare = stats.withInverse ? Math.round((stats.twoSided / stats.withInverse) * 100) : null;
  const perPage = stats.pages ? stats.tagUses / stats.pages : 0;

  return (
    <div className="overview-kpis" role="group" aria-label="Key figures">
      <Tile label="Pages" value={formatNumber(stats.pages)} className="overview-kpi-pages">
        <ul className="overview-kinds" aria-label="Pages by kind">
          {stats.kinds.map(({ kind, count }) => (
            <li key={kind}>
              <KindDot kind={kind} />
              <span className="overview-kinds-n">{formatNumber(count)}</span>
              <span className="overview-kinds-label">{KIND_LABELS[kind]}</span>
            </li>
          ))}
        </ul>
        {stats.notIndexed > 0 && <p className="overview-kpi-muted">{formatNumber(stats.notIndexed)} not indexed for retrieval</p>}
      </Tile>

      <Tile label="Wikilinks" value={formatNumber(stats.linkPairs)} unit="one-way links">
        <p>{formatNumber(stats.bodyRefs)} body references</p>
        {stats.relatedPairs > 0 && <p className="overview-kpi-muted">{formatNumber(stats.relatedPairs)} links in related:</p>}
      </Tile>

      <Tile label="Typed relations" value={formatNumber(stats.relations)}>
        {twoSidedShare !== null && (
          <p>
            <strong>{twoSidedShare}%</strong> on both pages
          </p>
        )}
        <p className="overview-kpi-muted" title="Relations whose predicate has an inverse, so both pages should declare them">
          {formatNumber(stats.twoSided)} of {formatNumber(stats.withInverse)} with inverse
        </p>
        {stats.oneSided > 0 && (
          <p className="overview-status">
            <SeverityBadge severity="warning" compact />
            <span>{formatNumber(stats.oneSided)} one-sided</span>
          </p>
        )}
      </Tile>

      <Tile label="Tags" value={formatNumber(stats.tagsDistinct)} unit="distinct">
        <p title={`${formatNumber(stats.tagUses)} tag uses`}>{perPage.toFixed(1)} per page</p>
        <p className="overview-kpi-muted">{formatNumber(stats.tagsOnce)} used once</p>
      </Tile>

      <Tile label="Commits" value={formatNumber(stats.commits)}>
        <p title={formatDate(stats.lastCommit)}>Last {lastAge !== null ? daysAgo(lastAge) : formatDate(stats.lastCommit)}</p>
        <p className="overview-kpi-muted">Since {formatDate(stats.firstCommit)}</p>
      </Tile>

      <Tile label="Total size" value={formatBytes(stats.bytes)}>
        <p>{formatNumber(stats.words)} words</p>
        <p className="overview-kpi-muted">Median page {formatBytes(Math.round(stats.medianBytes))}</p>
      </Tile>

      <HotTile hot={hot} />
    </div>
  );
}
