import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { useDerived } from '../../app/derived.ts';
import { formatDate, plural, shortLabel } from '../../app/format.ts';
import { useStore } from '../../app/store.ts';
import { usePalette } from '../../app/theme.ts';
import { buildGraph, layoutGraph, loadPositions, savePositions, type Positions } from './build.ts';
import { GraphControls } from './GraphControls.tsx';
import { GraphLegend } from './GraphLegend.tsx';
import { Sigma2D } from './Sigma2D.tsx';
import { computeVisible, edgeVisibility, type StyleContext } from './style.ts';
import { TimeBar } from './TimeBar.tsx';

// three.js is only fetched when the 3D mode is opened.
const Graph3D = lazy(() => import('./Graph3D.tsx'));

// Layout positions per vault root: shared by view switches, persisted across launches.
const positionCache = new Map<string, Positions>();

function positionsFor(root: string): Positions {
  let positions = positionCache.get(root);
  if (!positions) {
    positions = loadPositions(root);
    positionCache.set(root, positions);
  }
  return positions;
}

export default function GraphView() {
  const derived = useDerived();
  const settings = useStore((s) => s.graph);
  const selected = useStore((s) => s.selected);
  const highlight = useStore((s) => s.highlight);
  const time = useStore((s) => s.timeCursor);
  const setHighlight = useStore((s) => s.setHighlight);
  const updateGraph = useStore((s) => s.updateGraph);
  const palette = usePalette();
  const [layoutTick, setLayoutTick] = useState(0);
  const cameraRef = useRef<{ fit: () => void } | null>(null);
  const onReady = useCallback((api: { fit: () => void } | null) => {
    cameraRef.current = api;
  }, []);

  const root = derived?.model.vault.root ?? '';
  const positions = useMemo(() => positionsFor(root), [root]);
  const graph = useMemo(() => {
    if (!derived) return null;
    const g = buildGraph(derived);
    layoutGraph(g, positions);
    savePositions(root, positions);
    return g;
  }, [derived, positions, root]);

  const visible = useMemo(
    () => (graph && derived ? computeVisible(graph, derived, settings, selected, time) : new Set<string>()),
    [graph, derived, settings, selected, time],
  );

  const ctx = useMemo<Omit<StyleContext, 'hovered'> | null>(
    () => (derived ? { derived, settings, selected, highlight, palette, time, visible } : null),
    [derived, settings, selected, highlight, palette, time, visible],
  );

  // Focus only applies when the selected page is on the graph (not before its birth in time travel).
  const focusApplied = settings.focusDepth > 0 && !!selected && visible.has(selected);

  const visibleEdges = useMemo(() => {
    if (!graph) return 0;
    return graph.filterEdges((_e, attrs, s, t) => {
      if (!visible.has(s) || !visible.has(t)) return false;
      const v = edgeVisibility(attrs, settings, time);
      return v.typed || v.body;
    }).length;
  }, [graph, visible, settings, time]);

  const relayout = (): void => {
    if (!graph) return;
    positions.clear();
    layoutGraph(graph, positions, { fresh: true });
    savePositions(root, positions);
    setLayoutTick((t) => t + 1);
  };

  if (!derived || !graph || !ctx) return null;

  return (
    <div className="graph-view">
      {settings.dimension === '3d' ? (
        <Suspense fallback={<div className="app-empty">Loading 3D…</div>}>
          <Graph3D graph={graph} ctx={ctx} positions={positions} onReady={onReady} />
        </Suspense>
      ) : (
        <Sigma2D
          graph={graph}
          ctx={ctx}
          positions={positions}
          onPositionsChange={() => savePositions(root, positions)}
          layoutTick={layoutTick}
          onReady={onReady}
        />
      )}
      <GraphControls visibleNodes={visible.size} visibleEdges={visibleEdges} onFit={() => cameraRef.current?.fit()} onRelayout={relayout} />
      <GraphLegend visible={visible} />
      {highlight && (
        <div className="graph-banner" role="status">
          <span>
            Recall lens: <strong>“{highlight.query}”</strong> — {plural(Object.keys(highlight.ranks).length, 'page')}
          </span>
          <button type="button" className="btn btn-small" onClick={() => setHighlight(null)}>
            Clear
          </button>
        </div>
      )}
      {focusApplied && selected && !highlight && (
        <div className="graph-banner" role="status">
          <span>
            Focus: {settings.focusDepth}-hop neighbourhood of <strong>{shortLabel(selected)}</strong>
          </span>
          <button type="button" className="btn btn-small" onClick={() => updateGraph({ focusDepth: 0 })}>
            Show all
          </button>
        </div>
      )}
      {time !== null && !highlight && !focusApplied && (
        <div className="graph-banner" role="status">
          <span>
            The vault as of <strong>{formatDate(new Date(time).toISOString())}</strong> — new pages are labelled
          </span>
        </div>
      )}
      <TimeBar visibleNodes={visible.size} visibleEdges={visibleEdges} />
    </div>
  );
}
