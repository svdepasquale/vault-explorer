import { useState } from 'react';
import { isOneSided, PREDICATES } from '../../../shared/model.ts';
import { useDerived } from '../../app/derived.ts';
import { formatNumber } from '../../app/format.ts';
import { useStore, type ColorMode, type EmphasisField, type GraphSettings } from '../../app/store.ts';

const COLOR_MODES: { id: ColorMode; label: string; hint: string }[] = [
  { id: 'kind', label: 'Kind', hint: 'Color by page kind' },
  { id: 'freshness', label: 'Freshness', hint: 'Days since the last update' },
  { id: 'emphasis', label: 'Highlight', hint: 'Highlight one domain, tag or status' },
];

const VIEW_MODES: { id: '2d' | '3d' | 'galaxy'; label: string; hint: string; patch: Partial<GraphSettings> }[] = [
  { id: '2d', label: '2D', hint: 'Flat map (sigma.js)', patch: { dimension: '2d' } },
  { id: '3d', label: '3D', hint: 'Rotatable 3D force graph (three.js)', patch: { dimension: '3d', look: 'classic' } },
  {
    id: 'galaxy',
    label: 'Galaxy',
    hint: 'The 3D graph as glowing stars on a dark field, slowly turning',
    patch: { dimension: '3d', look: 'galaxy' },
  },
];

const FIELDS: { id: EmphasisField; label: string }[] = [
  { id: 'domain', label: 'Domain' },
  { id: 'tag', label: 'Tag' },
  { id: 'status', label: 'Status' },
];

export function GraphControls({
  visibleNodes,
  visibleEdges,
  onFit,
  onRelayout,
}: {
  visibleNodes: number;
  visibleEdges: number;
  onFit: () => void;
  onRelayout: () => void;
}) {
  const derived = useDerived();
  const settings = useStore((s) => s.graph);
  const selected = useStore((s) => s.selected);
  const updateGraph = useStore((s) => s.updateGraph);
  const [collapsed, setCollapsed] = useState(false);
  if (!derived) return null;

  const values =
    settings.emphasis.field === 'domain' ? derived.domains : settings.emphasis.field === 'status' ? derived.statuses : derived.tags;
  const viewMode = settings.dimension === '2d' ? '2d' : settings.look === 'galaxy' ? 'galaxy' : '3d';
  const usedPredicates = new Set(derived.model.relations.map((r) => r.predicate));
  const asymmetric = derived.model.relations.filter(isOneSided).length;

  return (
    <div className={`graph-controls card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <span className="card-title">
          {formatNumber(visibleNodes)} pages · {formatNumber(visibleEdges)} edges
        </span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="control-group">
            <span className="control-label">View</span>
            <div className="segmented" role="radiogroup" aria-label="View">
              {VIEW_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={viewMode === m.id}
                  className={viewMode === m.id ? 'active' : ''}
                  title={m.hint}
                  onClick={() => updateGraph(m.patch)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <span className="control-label">Labels</span>
            <div className="segmented" role="radiogroup" aria-label="Node labels">
              {(
                [
                  { id: 'hover', label: 'On hover', hint: 'Names only for the page under the pointer (or selected) and its connections' },
                  { id: 'always', label: 'Always', hint: 'Names on every node there is room for' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.labels === m.id}
                  className={settings.labels === m.id ? 'active' : ''}
                  title={m.hint}
                  onClick={() => updateGraph({ labels: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <span className="control-label">Color</span>
            <div className="segmented" role="radiogroup" aria-label="Color by">
              {COLOR_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.colorBy === m.id}
                  className={settings.colorBy === m.id ? 'active' : ''}
                  title={m.hint}
                  onClick={() => updateGraph({ colorBy: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {settings.colorBy === 'emphasis' && (
            <div className="control-group control-row">
              <select
                className="select"
                aria-label="Highlight field"
                value={settings.emphasis.field}
                onChange={(e) => updateGraph({ emphasis: { field: e.target.value as EmphasisField, value: null } })}
              >
                {FIELDS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                className="select"
                aria-label="Highlight value"
                value={settings.emphasis.value ?? ''}
                onChange={(e) => updateGraph({ emphasis: { field: settings.emphasis.field, value: e.target.value || null } })}
              >
                <option value="">Choose…</option>
                {values.map(([v, n]) => (
                  <option key={v} value={v}>
                    {v} ({n})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="control-group">
            <span className="control-label">Edges</span>
            <label className="check">
              <input type="checkbox" checked={settings.showRelations} onChange={(e) => updateGraph({ showRelations: e.target.checked })} />
              Typed relations
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.showBodyLinks} onChange={(e) => updateGraph({ showBodyLinks: e.target.checked })} />
              Body links
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.showAsymmetric}
                onChange={(e) => updateGraph({ showAsymmetric: e.target.checked })}
              />
              Mark one-sided relations ({asymmetric})
            </label>
            <select
              className="select"
              aria-label="Only this predicate"
              value={settings.predicate ?? ''}
              onChange={(e) => updateGraph({ predicate: e.target.value || null })}
            >
              <option value="">All predicates</option>
              {PREDICATES.filter((p) => usedPredicates.has(p.name)).map((p) => (
                <option key={p.name} value={p.name}>
                  Only “{p.label}”
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <span className="control-label">Pages</span>
            <label className="check">
              <input type="checkbox" checked={settings.showArchived} onChange={(e) => updateGraph({ showArchived: e.target.checked })} />
              Archived (index: false)
            </label>
          </div>

          <div className="control-group">
            <span className="control-label">Focus</span>
            <div className="segmented" role="radiogroup" aria-label="Neighbourhood depth">
              {[0, 1, 2, 3].map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={settings.focusDepth === d}
                  className={settings.focusDepth === d ? 'active' : ''}
                  disabled={d > 0 && !selected}
                  title={d === 0 ? 'Whole graph' : `Pages within ${d} hop${d > 1 ? 's' : ''} of the selected page`}
                  onClick={() => updateGraph({ focusDepth: d })}
                >
                  {d === 0 ? 'All' : `${d} hop${d > 1 ? 's' : ''}`}
                </button>
              ))}
            </div>
          </div>

          <div className="control-row">
            <button type="button" className="btn btn-small" onClick={onFit}>
              Fit
            </button>
            {settings.dimension === '2d' && (
              <button type="button" className="btn btn-small" onClick={onRelayout} title="Recompute the layout from scratch">
                Re-layout
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
