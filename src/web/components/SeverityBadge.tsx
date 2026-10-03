import type { Severity } from '../../shared/model.ts';

const ICON: Record<Severity, string> = { error: '✕', warning: '!', info: 'i' };
const LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };

/** Status color always paired with an icon and a label. */
export function SeverityBadge({ severity, compact = false }: { severity: Severity; compact?: boolean }) {
  return (
    <span className={`severity severity-${severity}`} title={LABEL[severity]}>
      <span className="severity-icon" aria-hidden="true">
        {ICON[severity]}
      </span>
      {!compact && <span className="severity-label">{LABEL[severity]}</span>}
    </span>
  );
}
