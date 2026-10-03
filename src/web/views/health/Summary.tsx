import type { HealthIssue } from '../../../shared/model.ts';
import { formatNumber, plural } from '../../app/format.ts';
import { SeverityBadge } from '../../components/SeverityBadge.tsx';
import { useHealthFilters } from './filters.ts';
import { ALL_CHECKS, checkInfo, countPages, SEVERITIES, type CheckGroup } from './issues.ts';

/** The "good" end of the status scale: icon + label, like SeverityBadge. */
export function PassBadge({ label = 'Passing' }: { label?: string }) {
  return (
    <span className="severity health-pass" title={label}>
      <span className="severity-icon" aria-hidden="true">
        ✓
      </span>
      <span className="severity-label">{label}</span>
    </span>
  );
}

/** Totals per severity; each tile toggles the severity filter. */
export function SeverityTiles({ issues, onFilter }: { issues: readonly HealthIssue[]; onFilter: () => void }) {
  const active = useHealthFilters((s) => s.severity);
  const update = useHealthFilters((s) => s.update);
  return (
    <div className="health-tiles" role="group" aria-label="Issues by severity">
      {SEVERITIES.map((severity) => {
        const list = issues.filter((i) => i.severity === severity);
        const pressed = active === severity;
        return (
          <button
            key={severity}
            type="button"
            className="health-tile"
            aria-pressed={pressed}
            disabled={!list.length && !pressed}
            title={pressed ? 'Show every severity' : `Only ${severity} issues`}
            onClick={() => {
              update({ severity: pressed ? null : severity });
              if (!pressed) onFilter();
            }}
          >
            <SeverityBadge severity={severity} />
            <span className="health-tile-value">{formatNumber(list.length)}</span>
            <span className="health-tile-meta">{list.length ? `on ${plural(countPages(list), 'page')}` : 'none'}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One card per check that flagged something (a filter toggle), then the checks that pass. */
export function CheckCards({ groups, onFilter }: { groups: readonly CheckGroup[]; onFilter: () => void }) {
  const active = useHealthFilters((s) => s.check);
  const update = useHealthFilters((s) => s.update);
  const flagged = new Set(groups.map((g) => g.check));
  const passing = ALL_CHECKS.filter((c) => !flagged.has(c));

  return (
    <section aria-labelledby="health-checks-title">
      <h2 id="health-checks-title" className="health-section-title">
        Checks
      </h2>
      {groups.length > 0 && (
        <div className="health-cards">
          {groups.map((group) => {
            const info = checkInfo(group.check);
            const pressed = active === group.check;
            return (
              <button
                key={group.check}
                type="button"
                className="health-card"
                aria-pressed={pressed}
                title={pressed ? 'Show every check' : `Only “${info.label}” issues`}
                onClick={() => {
                  update({ check: pressed ? null : group.check });
                  if (!pressed) onFilter();
                }}
              >
                <span className="health-card-head">
                  <SeverityBadge severity={group.severity} />
                  <span className="health-card-count">{formatNumber(group.issues.length)}</span>
                </span>
                <span className="health-card-label">{info.label}</span>
                <span className="health-card-desc">{info.description}</span>
              </button>
            );
          })}
        </div>
      )}
      {passing.length > 0 && (
        <div className="health-passing">
          <PassBadge label={`${passing.length} passing`} />
          <ul className="health-passing-list" aria-label="Passing checks">
            {passing.map((check) => {
              const info = checkInfo(check);
              return (
                <li key={check} className="health-chip" title={info.description}>
                  {info.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
