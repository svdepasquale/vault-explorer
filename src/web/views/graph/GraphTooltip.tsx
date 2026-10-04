import { isOneSided, KIND_LABELS, PREDICATES } from '../../../shared/model.ts';
import type { Derived } from '../../app/derived.ts';
import { daysAgo, formatDate, plural, shortLabel } from '../../app/format.ts';
import type { VaultGraph } from './build.ts';

const PREDICATE = new Map(PREDICATES.map((p) => [p.name, p]));

export interface TooltipState {
  x: number;
  y: number;
  node?: string;
  edge?: string;
}

export function GraphTooltip({ tooltip, derived, graph }: { tooltip: TooltipState; derived: Derived; graph: VaultGraph }) {
  const style = { left: tooltip.x + 14, top: tooltip.y + 14 };
  if (tooltip.node) {
    const page = derived.pageById.get(tooltip.node);
    if (!page) return null;
    const inbound = derived.inbound.get(page.id) ?? 0;
    const born = derived.bornAt(page);
    return (
      <div className="graph-tooltip" style={style}>
        <div className="graph-tooltip-kicker">
          {KIND_LABELS[page.kind]}
          {page.status ? ` · ${page.status}` : ''}
          {page.domain ? ` · ${page.domain}` : ''}
        </div>
        <div className="graph-tooltip-title">{page.title}</div>
        {page.description && <div className="graph-tooltip-desc">{page.description}</div>}
        <div className="graph-tooltip-meta">
          {plural(inbound, 'page')} link here · born {born ? formatDate(new Date(born).toISOString()) : '—'} · updated {daysAgo(derived.ageDays(page))}
        </div>
      </div>
    );
  }
  if (tooltip.edge && graph.hasEdge(tooltip.edge)) {
    const attrs = graph.getEdgeAttributes(tooltip.edge);
    const [source, target] = graph.extremities(tooltip.edge);
    return (
      <div className="graph-tooltip" style={style}>
        {attrs.relations.map((r) => (
          <div key={`${r.from}${r.predicate}${r.to}`} className="graph-tooltip-relation">
            <span className="mono">{shortLabel(r.from)}</span> {PREDICATE.get(r.predicate)?.label ?? r.predicate}{' '}
            <span className="mono">{shortLabel(r.to)}</span>
            {isOneSided(r) && <span className="graph-tooltip-warn"> · one-sided</span>}
          </div>
        ))}
        {(attrs.body > 0 || attrs.related) && (
          <div className="graph-tooltip-meta">
            {attrs.body > 0 ? plural(attrs.body, 'body link') : ''}
            {attrs.related ? `${attrs.body > 0 ? ' · ' : ''}related:` : ''} between <span className="mono">{shortLabel(source)}</span> and{' '}
            <span className="mono">{shortLabel(target)}</span>
          </div>
        )}
        {attrs.since !== null && <div className="graph-tooltip-meta">connected since {formatDate(new Date(attrs.since).toISOString())}</div>}
      </div>
    );
  }
  return null;
}
