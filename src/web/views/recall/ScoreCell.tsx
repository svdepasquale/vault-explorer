import type { CSSProperties, ReactNode } from 'react';
import { barGeometry, type Domain } from './reading.ts';
import { useTip } from './Tip.tsx';

export interface ScoreCellProps {
  /** Column name, shown inline when the list is too narrow for column headers. */
  label: string;
  value: number | null;
  text: string;
  domain: Domain;
  /** This score ordered the list: accent bar; otherwise a muted context bar. */
  ranking: boolean;
  tipKey: string;
  tip: () => ReactNode;
}

/** One score as a compact bar on a fixed domain, with its value always printed beside it. */
export function ScoreCell({ label, value, text, domain, ranking, tipKey, tip }: ScoreCellProps) {
  const bind = useTip(tipKey, tip);
  const geometry = value === null ? null : barGeometry(value, domain);
  const cls = ['recall-score', ranking ? 'is-ranking' : 'is-context'];
  return (
    <span className={cls.join(' ')} {...bind}>
      <span className="recall-score-label">{label}</span>
      <span className="recall-track" aria-hidden="true" style={{ '--recall-zero': `${geometry?.zero ?? 0}%` } as CSSProperties}>
        {geometry && geometry.width > 0 && (
          <span
            className={`recall-bar${geometry.negative ? ' is-negative' : ''}${geometry.clipped ? ' is-clipped' : ''}`}
            style={{ left: `${geometry.start}%`, width: `${geometry.width}%` }}
          />
        )}
      </span>
      <span className="recall-score-value">{value === null ? '—' : text}</span>
    </span>
  );
}
