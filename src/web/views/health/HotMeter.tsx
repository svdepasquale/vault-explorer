import { HEALTH_CHECKS, type HotSummary } from '../../../shared/model.ts';
import { formatDate, formatNumber } from '../../app/format.ts';
import { usePalette } from '../../app/theme.ts';
import { PageLink } from '../../components/PageLink.tsx';
import { SeverityBadge } from '../../components/SeverityBadge.tsx';

/** Same thresholds as the hot-budget check in core/health.ts: warning above 90%, error above 100%. */
const WARN_RATIO = 0.9;

type BudgetState = 'ok' | 'near' | 'over';

export function budgetState(bytes: number, budget: number): BudgetState {
  if (bytes > budget) return 'over';
  return bytes > budget * WARN_RATIO ? 'near' : 'ok';
}

/** hot.md size against its byte budget: accent fill below 90%, then the warning / critical status. */
export function HotMeter({ hot }: { hot: HotSummary | null }) {
  const palette = usePalette();
  const info = HEALTH_CHECKS['hot-budget'];

  if (!hot) {
    return (
      <section className="health-panel card" aria-labelledby="health-hot-title">
        <h2 id="health-hot-title" className="health-section-title">
          {info.label}
        </h2>
        <p className="health-note">This vault has no hot.md, so there is no budget to measure.</p>
      </section>
    );
  }

  const { bytes, budget } = hot;
  const state = budgetState(bytes, budget);
  const percent = budget > 0 ? Math.round((bytes / budget) * 100) : 0;
  // Over budget the scale grows to the actual size, so the budget line moves inside the bar.
  const max = Math.max(budget, bytes, 1);
  const at = (value: number): string => `${Math.min(100, (value / max) * 100)}%`;
  const fill = state === 'over' ? palette.status.critical : state === 'near' ? palette.status.warning : palette.accent;
  // The track is a near-zero step of the fill's ramp; status fills cover 90%+ of the bar, so neutral there.
  const track = state === 'ok' ? (palette.sequential[0] ?? palette.grid) : palette.grid;
  const gap = Math.abs(budget - bytes);

  return (
    <section className="health-panel card" aria-labelledby="health-hot-title">
      <div className="health-panel-header">
        <h2 id="health-hot-title" className="health-section-title">
          {info.label}
        </h2>
        {state !== 'ok' && <SeverityBadge severity={state === 'over' ? 'error' : 'warning'} />}
      </div>
      <div className="health-hot-figure">
        <span className="health-hot-value">{formatNumber(bytes)} B</span>
        <span className="health-hot-of">
          of {formatNumber(budget)} B · {percent}%
        </span>
      </div>
      <div
        className="health-meter"
        role="meter"
        aria-label="hot.md size against its budget"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={bytes}
        aria-valuetext={`${formatNumber(bytes)} of ${formatNumber(budget)} bytes, ${percent}%`}
      >
        <div className="health-meter-track" style={{ background: track }}>
          <div className="health-meter-fill" style={{ width: at(bytes), background: fill }} />
          {state !== 'over' && <span className="health-meter-mark" style={{ left: at(budget * WARN_RATIO) }} />}
          <span className="health-meter-mark health-meter-budget" style={{ left: at(budget) }} />
        </div>
        <div className="health-meter-scale" aria-hidden="true">
          <span className="health-meter-zero">0</span>
          {state !== 'over' && <span style={{ left: at(budget * WARN_RATIO) }}>90%</span>}
          <span style={{ left: at(budget) }}>{state === 'over' ? 'budget' : '100%'}</span>
        </div>
      </div>
      <p className="health-hot-status">
        {state === 'ok' && `Within budget, ${formatNumber(gap)} B of headroom.`}
        {state === 'near' && `Above 90% of the budget, ${formatNumber(gap)} B of headroom left.`}
        {state === 'over' && `Over budget by ${formatNumber(gap)} B.`}
      </p>
      <p className="health-note">
        {info.description}{' '}
        <span className="health-hot-page">
          <PageLink id={hot.id} />
          {hot.updated && <span className="health-muted">updated {formatDate(hot.updated)}</span>}
        </span>
      </p>
    </section>
  );
}
