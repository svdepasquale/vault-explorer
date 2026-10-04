import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  HEALTH_CHECKS,
  HOT_BUDGET_BYTES,
  KIND_DESCRIPTIONS,
  OVERSIZED_BYTES,
  PREDICATES,
  STALE_DAYS,
  STALE_STATUSES,
} from '../../../shared/model.ts';
import { useDerived } from '../../app/derived.ts';
import { formatNumber, plural } from '../../app/format.ts';
import { useHealthFilters } from './filters.ts';
import { HotMeter } from './HotMeter.tsx';
import { IssueList } from './IssueList.tsx';
import { ALL_CHECKS, countPages, groupByCheck } from './issues.ts';
import { CheckCards, SeverityTiles } from './Summary.tsx';
import { SymmetryCard } from './SymmetryCard.tsx';
import './health.css';

const ONE_WAY = PREDICATES.filter((p) => !p.inverse).map((p) => p.name);

function Thresholds() {
  return (
    <section className="health-footnote" aria-labelledby="health-thresholds-title">
      <h2 id="health-thresholds-title" className="health-section-title">
        Thresholds
      </h2>
      <ul>
        <li>
          <strong>{HEALTH_CHECKS.stale.label}</strong>: status {STALE_STATUSES.join(', ')} and a frontmatter <code>updated</code> date more than{' '}
          {STALE_DAYS} days old; archived pages (<code>index: false</code>) are exempt.
        </li>
        <li>
          <strong>{HEALTH_CHECKS.oversized.label}</strong>: files over {formatNumber(OVERSIZED_BYTES / 1024)} KB ({formatNumber(OVERSIZED_BYTES)} B); navigation
          pages are exempt.
        </li>
        <li>
          <strong>{HEALTH_CHECKS['hot-budget'].label}</strong>: {formatNumber(HOT_BUDGET_BYTES)} B, the same threshold as the SessionStart hook that injects
          hot.md; warning above 90%, error above 100%.
        </li>
        <li>
          <strong>{HEALTH_CHECKS.orphan.label}</strong>: no body link, <code>related:</code> entry or typed relation reaches the page except from navigation
          pages ({KIND_DESCRIPTIONS.nav.replace(/^Indexes and caches: /, '')}). Navigation pages, folds (log rollups, reached through folds/_index by design)
          and archived pages (<code>index: false</code>) are never flagged.
        </li>
        <li>
          <strong>{HEALTH_CHECKS['relation-asymmetric'].label}</strong>: a predicate with an inverse belongs on both pages; {ONE_WAY.join(', ')} have no
          inverse, so one side is enough.
        </li>
      </ul>
    </section>
  );
}

/** A visual lint of the vault: what each check found, the hot.md budget and the fixes to hand to Claude. */
export default function HealthView() {
  const derived = useDerived();
  const model = derived?.model ?? null;
  const groups = useMemo(() => groupByCheck(model?.health ?? []), [model]);
  const scopeTo = useHealthFilters((s) => s.scopeTo);
  const update = useHealthFilters((s) => s.update);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const root = model?.vault.root ?? null;

  useEffect(() => scopeTo(root), [root, scopeTo]);

  // A filter applied from the summary brings the list into view when it is below the fold.
  const revealList = useCallback(() => {
    requestAnimationFrame(() => {
      const view = scroller.current;
      const target = list.current;
      if (!view || !target) return;
      const top = target.getBoundingClientRect().top - view.getBoundingClientRect().top;
      if (top > view.clientHeight - 160) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const pickPredicate = useCallback(
    (predicate: string) => {
      update({ severity: null, check: 'relation-asymmetric', query: predicate });
      revealList();
    },
    [update, revealList],
  );

  if (!model) return null;
  const issues = model.health;

  return (
    <div ref={scroller} className="health-view">
      <div className="health-inner">
        <header className="health-header">
          <h1 className="health-title">Health</h1>
          <p className="health-subtitle">
            {issues.length ? `${plural(issues.length, 'issue')} on ${plural(countPages(issues), 'page')}` : 'No issues'} ·{' '}
            {formatNumber(groups.length)} of {formatNumber(ALL_CHECKS.length)} checks flag something
          </p>
        </header>

        <div className="health-top">
          <div className="health-column">
            <section aria-labelledby="health-severity-title">
              <h2 id="health-severity-title" className="health-section-title">
                Severity
              </h2>
              <SeverityTiles issues={issues} onFilter={revealList} />
            </section>
            <CheckCards groups={groups} onFilter={revealList} />
          </div>
          <div className="health-column">
            <HotMeter hot={model.hot} />
            <SymmetryCard relations={model.relations} onPick={pickPredicate} />
          </div>
        </div>

        <IssueList groups={groups} vaultName={model.vault.name} sectionRef={list} />
        <Thresholds />
      </div>
    </div>
  );
}
