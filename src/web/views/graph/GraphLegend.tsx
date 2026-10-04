import type { ReactNode } from 'react';
import { KIND_DESCRIPTIONS, KIND_LABELS, PAGE_KINDS, type PageKind } from '../../../shared/model.ts';
import { useDerived } from '../../app/derived.ts';
import { FRESHNESS_BUCKETS, freshnessBucket } from '../../app/palette.ts';
import { useStore } from '../../app/store.ts';
import { usePalette } from '../../app/theme.ts';

/** Legend for the active color mode; kind rows double as visibility toggles. */
export function GraphLegend({ visible }: { visible: Set<string> }) {
  const derived = useDerived();
  const settings = useStore((s) => s.graph);
  const updateGraph = useStore((s) => s.updateGraph);
  const palette = usePalette();
  if (!derived) return null;
  const pages = derived.model.pages;

  const toggleKind = (kind: PageKind): void => {
    const hidden = settings.hiddenKinds.includes(kind) ? settings.hiddenKinds.filter((k) => k !== kind) : [...settings.hiddenKinds, kind];
    updateGraph({ hiddenKinds: hidden });
  };

  let rows: ReactNode;
  if (settings.colorBy === 'freshness') {
    const counts = [0, 0, 0, 0];
    for (const p of pages) {
      if (!visible.has(p.id)) continue;
      const age = derived.ageDays(p);
      if (age !== null) counts[freshnessBucket(age)] = (counts[freshnessBucket(age)] ?? 0) + 1;
    }
    rows = [...FRESHNESS_BUCKETS.keys()].reverse().map((i) => (
      <li key={i} className="legend-row">
        <span className="legend-swatch" style={{ background: palette.freshness[i] }} />
        <span className="legend-label">{FRESHNESS_BUCKETS[i]?.label}</span>
        <span className="legend-count">{counts[i]}</span>
      </li>
    ));
  } else if (settings.colorBy === 'emphasis') {
    const { field, value } = settings.emphasis;
    const matching = pages.filter(
      (p) =>
        visible.has(p.id) &&
        value &&
        (field === 'domain' ? p.domain === value : field === 'status' ? p.status === value : p.tags.includes(value)),
    ).length;
    rows = (
      <>
        <li className="legend-row">
          <span className="legend-swatch" style={{ background: palette.accent }} />
          <span className="legend-label">{value ? `${field}: ${value}` : `Pick a ${field}`}</span>
          <span className="legend-count">{value ? matching : ''}</span>
        </li>
        <li className="legend-row">
          <span className="legend-swatch" style={{ background: palette.dim }} />
          <span className="legend-label">Other pages</span>
          <span className="legend-count">{value ? visible.size - matching : ''}</span>
        </li>
      </>
    );
  } else {
    rows = PAGE_KINDS.map((kind) => {
      const total = pages.filter((p) => p.kind === kind).length;
      if (!total) return null;
      const hidden = settings.hiddenKinds.includes(kind);
      return (
        <li key={kind}>
          <button
            type="button"
            className={`legend-row legend-toggle${hidden ? ' off' : ''}`}
            aria-pressed={!hidden}
            title={`${KIND_DESCRIPTIONS[kind]} — click to ${hidden ? 'show' : 'hide'}`}
            onClick={() => toggleKind(kind)}
          >
            <span className="legend-swatch" style={{ background: palette.kind[kind] }} />
            <span className="legend-label">{KIND_LABELS[kind]}</span>
            <span className="legend-count">{total}</span>
          </button>
        </li>
      );
    });
  }

  return (
    <div className="graph-legend card" role="group" aria-label="Legend">
      <ul className="legend-list">{rows}</ul>
      <ul className="legend-list legend-edges">
        <li className="legend-row">
          <svg width="26" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="19" y2="5" stroke={palette.typedEdge} strokeWidth="2" />
            <path d="M18 1 L25 5 L18 9 Z" fill={palette.typedEdge} />
          </svg>
          <span className="legend-label">Typed relation</span>
        </li>
        <li className="legend-row">
          <svg width="26" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="25" y2="5" stroke={palette.bodyEdge} strokeWidth="1.5" />
          </svg>
          <span className="legend-label">Body link</span>
        </li>
        {settings.showAsymmetric && (
          <li className="legend-row">
            <svg width="26" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="25" y2="5" stroke={palette.status.warning} strokeWidth="2" />
            </svg>
            <span className="legend-label">One-sided relation</span>
          </li>
        )}
      </ul>
      {settings.colorBy === 'kind' && <p className="legend-note">Size = pages linking here. Gray kinds share one hue; labels name them.</p>}
    </div>
  );
}
