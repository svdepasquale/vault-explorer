import { useMemo } from 'react';
import type { Relation } from '../../../shared/model.ts';
import { formatNumber } from '../../app/format.ts';
import { SeverityBadge } from '../../components/SeverityBadge.tsx';
import { oneSided, relationSymmetry, type SymmetryRow } from './issues.ts';

function describe(row: SymmetryRow): string {
  const parts = [`${row.both} on both pages`];
  if (row.forwardOnly) parts.push(`${row.forwardOnly} missing ${row.inverse}: on the target`);
  if (row.inverseOnly) parts.push(`${row.inverseOnly} missing ${row.predicate}: on the source`);
  return `${row.predicate} ⇄ ${row.inverse}: ${row.total} relations, ${parts.join(', ')}`;
}

/**
 * Typed relations per predicate with an inverse: how many are declared on one page only.
 * The one-sided segment sits on the baseline so rows compare on a common edge.
 */
export function SymmetryCard({ relations, onPick }: { relations: readonly Relation[]; onPick: (predicate: string) => void }) {
  const { rows, oneWay, unknown } = useMemo(() => relationSymmetry(relations), [relations]);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.total));
  const flagged = rows.reduce((n, r) => n + oneSided(r), 0);
  const total = rows.reduce((n, r) => n + r.total, 0);

  return (
    <section className="health-panel card" aria-labelledby="health-sym-title">
      <div className="health-panel-header">
        <h2 id="health-sym-title" className="health-section-title">
          Relation symmetry
        </h2>
        <ul className="health-legend" aria-label="Legend">
          <li>
            <span className="health-swatch health-one-sided" aria-hidden="true" />
            <SeverityBadge severity="warning" compact />
            One-sided
          </li>
          <li>
            <span className="health-swatch health-both" aria-hidden="true" />
            Both pages
          </li>
        </ul>
      </div>
      <p className="health-note">
        {formatNumber(flagged)} of {formatNumber(total)} relations whose predicate has an inverse are declared on one page only.
      </p>
      <table className="health-sym-table">
        <caption className="health-sr-only">One-sided relations per predicate</caption>
        <tbody>
          {rows.map((row) => {
            const missing = oneSided(row);
            const detail = describe(row);
            const pick = missing ? () => onPick(row.predicate) : undefined;
            return (
              <tr key={row.predicate} className={`health-sym-row${pick ? ' health-clickable' : ''}`} title={detail} onClick={pick}>
                <th scope="row">
                  {pick ? (
                    <button
                      type="button"
                      className="health-sym-name"
                      aria-label={`List the ${missing} one-sided ${row.predicate} relations`}
                      onClick={(e) => {
                        e.stopPropagation();
                        pick();
                      }}
                    >
                      {row.predicate}
                    </button>
                  ) : (
                    <span className="health-sym-name">{row.predicate}</span>
                  )}
                </th>
                <td className="health-sym-bar-cell">
                  <div className="health-sym-bar" style={{ width: `${(row.total / max) * 100}%` }} role="img" aria-label={detail}>
                    {missing > 0 && <span className="health-sym-seg health-one-sided" style={{ flexGrow: missing }} />}
                    {row.both > 0 && <span className="health-sym-seg health-both" style={{ flexGrow: row.both }} />}
                  </div>
                </td>
                <td className="health-sym-num">
                  {formatNumber(missing)} of {formatNumber(row.total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(oneWay.length > 0 || unknown > 0) && (
        <p className="health-note health-muted">
          {oneWay.length > 0 && (
            <>
              No inverse in the schema, so one side is enough:{' '}
              {oneWay.map((p, i) => (
                <span key={p.predicate}>
                  {i > 0 && ' · '}
                  <span className="mono">{p.predicate}</span> {formatNumber(p.count)}
                </span>
              ))}
              .
            </>
          )}
          {unknown > 0 && ` ${formatNumber(unknown)} with a predicate outside the schema.`}
        </p>
      )}
    </section>
  );
}
