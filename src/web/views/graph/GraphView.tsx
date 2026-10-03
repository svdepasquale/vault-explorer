import { useEffect, useMemo, useRef, useState } from 'react';
import Sigma from 'sigma';
import { EdgeArrowProgram, EdgeRectangleProgram } from 'sigma/rendering';
import type { NodeDisplayData, EdgeDisplayData } from 'sigma/types';
import { KIND_LABELS, PREDICATES, type Page } from '../../../shared/model.ts';
import { useDerived, type Derived } from '../../app/derived.ts';
import { daysAgo, plural, shortLabel } from '../../app/format.ts';
import { freshnessBucket, type Palette } from '../../app/palette.ts';
import { useStore, type GraphSettings, type Highlight } from '../../app/store.ts';
import { usePalette } from '../../app/theme.ts';
import { buildGraph, layoutGraph, type EdgeAttrs, type NodeAttrs, type Positions, type VaultGraph } from './build.ts';
import { GraphControls } from './GraphControls.tsx';
import { GraphLegend } from './GraphLegend.tsx';

// Positions survive view switches and live reloads (per vault root).
const positionCache = new Map<string, Positions>();
const PREDICATE = new Map(PREDICATES.map((p) => [p.name, p]));

interface RenderState {
  derived: Derived;
  settings: GraphSettings;
  selected: string | null;
  highlight: Highlight | null;
  palette: Palette;
  hovered: string | null;
  visible: Set<string>;
}

function matchesEmphasis(page: Page, settings: GraphSettings): boolean {
  const { field, value } = settings.emphasis;
  if (!value) return false;
  if (field === 'domain') return page.domain === value;
  if (field === 'status') return page.status === value;
  return page.tags.includes(value);
}

function baseColor(page: Page, state: RenderState): string {
  const { settings, palette, derived } = state;
  if (settings.colorBy === 'freshness') {
    const age = derived.ageDays(page);
    return age === null ? palette.ink3 : (palette.freshness[freshnessBucket(age)] ?? palette.ink3);
  }
  if (settings.colorBy === 'emphasis') return matchesEmphasis(page, settings) ? palette.accent : palette.dim;
  return palette.kind[page.kind];
}

function edgeVisibility(attrs: EdgeAttrs, settings: GraphSettings): { typed: boolean; body: boolean } {
  const typed = settings.showRelations && attrs.relations.length > 0 && (!settings.predicate || attrs.predicates.includes(settings.predicate));
  const body = settings.showBodyLinks && !settings.predicate && (attrs.body > 0 || attrs.related);
  return { typed, body };
}

/** Pages shown under the current filters, narrowed to the focus neighbourhood when set. */
function computeVisible(graph: VaultGraph, derived: Derived, settings: GraphSettings, selected: string | null): Set<string> {
  const visible = new Set<string>();
  for (const page of derived.model.pages) {
    if (settings.hiddenKinds.includes(page.kind)) continue;
    if (!page.indexed && !settings.showArchived && page.kind !== 'nav') continue;
    visible.add(page.id);
  }
  if (!selected || settings.focusDepth <= 0 || !graph.hasNode(selected)) return visible;
  const reached = new Set<string>([selected]);
  let frontier = [selected];
  for (let depth = 0; depth < settings.focusDepth; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      graph.forEachEdge(node, (_edge, attrs, source, target) => {
        const v = edgeVisibility(attrs, settings);
        if (!v.typed && !v.body) return;
        const other = source === node ? target : source;
        if (!reached.has(other) && visible.has(other)) {
          reached.add(other);
          next.push(other);
        }
      });
    }
    frontier = next;
  }
  for (const id of [...visible]) if (!reached.has(id)) visible.delete(id);
  return visible;
}

function drawHover(context: CanvasRenderingContext2D, data: { x: number; y: number; size: number; label: string | null; color: string }, palette: Palette): void {
  if (!data.label) return;
  const size = 13;
  context.font = `500 ${size}px system-ui, -apple-system, sans-serif`;
  const width = context.measureText(data.label).width;
  const x = data.x + data.size + 4;
  const y = data.y - size / 2 - 5;
  context.fillStyle = palette.surface;
  context.strokeStyle = palette.baseline;
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(x - 4, y, width + 12, size + 10, 5);
  context.fill();
  context.stroke();
  context.beginPath();
  context.arc(data.x, data.y, data.size + 2.5, 0, Math.PI * 2);
  context.strokeStyle = palette.ink;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = palette.ink;
  context.fillText(data.label, x + 2, y + size + 1);
}

interface Tooltip {
  x: number;
  y: number;
  node?: string;
  edge?: string;
}

export default function GraphView() {
  const derived = useDerived();
  const settings = useStore((s) => s.graph);
  const selected = useStore((s) => s.selected);
  const highlight = useStore((s) => s.highlight);
  const setHighlight = useStore((s) => s.setHighlight);
  const select = useStore((s) => s.select);
  const updateGraph = useStore((s) => s.updateGraph);
  const palette = usePalette();

  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null);
  const graphRef = useRef<VaultGraph | null>(null);
  const stateRef = useRef<RenderState | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const root = derived?.model.vault.root ?? '';
  const graph = useMemo(() => {
    if (!derived) return null;
    const g = buildGraph(derived);
    let positions = positionCache.get(root);
    if (!positions) {
      positions = new Map();
      positionCache.set(root, positions);
    }
    layoutGraph(g, positions);
    return g;
  }, [derived, root]);

  const visible = useMemo(
    () => (graph && derived ? computeVisible(graph, derived, settings, selected) : new Set<string>()),
    [graph, derived, settings, selected],
  );

  if (derived) {
    stateRef.current = { derived, settings, selected, highlight, palette, hovered, visible };
  }

  // Create sigma once; swap graphs on model reloads.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !graph) return;
    if (sigmaRef.current) {
      sigmaRef.current.setGraph(graph);
      graphRef.current = graph;
      return;
    }
    graphRef.current = graph;
    const sigma = new Sigma<NodeAttrs, EdgeAttrs>(graph, container, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      enableEdgeEvents: true,
      zIndex: true,
      defaultEdgeType: 'line',
      edgeProgramClasses: { line: EdgeRectangleProgram, arrow: EdgeArrowProgram },
      labelFont: 'system-ui, -apple-system, sans-serif',
      labelSize: 12,
      labelWeight: '500',
      labelDensity: 0.9,
      labelGridCellSize: 70,
      labelRenderedSizeThreshold: 7,
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
      stagePadding: 40,
      defaultDrawNodeHover: (context, data) => {
        const p = stateRef.current?.palette;
        if (p) drawHover(context, data, p);
      },
      nodeReducer: (node, data) => {
        const state = stateRef.current;
        const out: Partial<NodeDisplayData> = { ...data };
        if (!state) return out;
        if (!state.visible.has(node)) return { ...out, hidden: true };
        const page = state.derived.pageById.get(node);
        if (!page) return { ...out, hidden: true };
        out.color = baseColor(page, state);
        out.zIndex = 1;
        const focus = state.hovered ?? state.selected;
        if (state.highlight) {
          const rank = state.highlight.ranks[node];
          if (rank !== undefined) {
            out.label = `${rank}. ${data.label}`;
            out.forceLabel = true;
            out.size = data.size + 3;
            out.zIndex = 3;
          } else {
            out.color = state.palette.dim;
            out.label = null;
            out.zIndex = 0;
          }
        } else if (focus && state.visible.has(focus)) {
          const near = node === focus || state.derived.neighbors.get(focus)?.has(node);
          if (!near) {
            out.color = state.palette.dim;
            out.label = null;
            out.zIndex = 0;
          } else {
            out.forceLabel = true;
            out.zIndex = 2;
          }
        } else if (state.settings.colorBy === 'emphasis' && state.settings.emphasis.value && !matchesEmphasis(page, state.settings)) {
          out.label = null;
          out.zIndex = 0;
        }
        if (node === state.selected) {
          out.highlighted = true;
          out.size = data.size + 2;
          out.zIndex = 4;
        }
        return out;
      },
      edgeReducer: (edge, data) => {
        const state = stateRef.current;
        const out: Partial<EdgeDisplayData> = { ...data };
        if (!state) return out;
        const v = edgeVisibility(data, state.settings);
        if (!v.typed && !v.body) return { ...out, hidden: true };
        out.type = v.typed ? 'arrow' : 'line';
        out.size = v.typed ? data.size : 0.6 + 0.25 * Math.log2(1 + data.body);
        out.color = v.typed
          ? state.settings.showAsymmetric && data.asymmetric
            ? state.palette.status.warning
            : state.palette.typedEdge
          : state.palette.bodyEdge;
        const g = graphRef.current;
        const [source, target] = g ? g.extremities(edge) : ['', ''];
        if (state.highlight) {
          if (state.highlight.ranks[source] === undefined || state.highlight.ranks[target] === undefined) {
            out.color = state.palette.dimEdge;
          }
        } else {
          const focus = state.hovered ?? state.selected;
          if (focus && state.visible.has(focus)) {
            if (source !== focus && target !== focus) out.color = state.palette.dimEdge;
            else out.zIndex = 2;
          }
        }
        return out;
      },
    });
    sigmaRef.current = sigma;

    // Drag a node to pin it somewhere else; positions are remembered.
    let dragged: string | null = null;
    sigma.on('downNode', (e) => {
      dragged = e.node;
      if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
    });
    sigma.getMouseCaptor().on('mousemovebody', (e) => {
      const g = graphRef.current;
      if (!dragged || !g) return;
      const pos = sigma.viewportToGraph(e);
      g.mergeNodeAttributes(dragged, { x: pos.x, y: pos.y });
      positionCache.get(stateRef.current?.derived.model.vault.root ?? '')?.set(dragged, { x: pos.x, y: pos.y });
      e.preventSigmaDefault();
      e.original.preventDefault();
      e.original.stopPropagation();
    });
    sigma.getMouseCaptor().on('mouseup', () => {
      dragged = null;
    });

    sigma.on('enterNode', (e) => {
      setHovered(e.node);
      setTooltip({ node: e.node, x: e.event.x, y: e.event.y });
    });
    sigma.on('leaveNode', () => {
      setHovered(null);
      setTooltip(null);
    });
    sigma.on('enterEdge', (e) => setTooltip({ edge: e.edge, x: e.event.x, y: e.event.y }));
    sigma.on('leaveEdge', () => setTooltip(null));
    sigma.on('clickNode', (e) => select(e.node));
    sigma.on('doubleClickNode', (e) => {
      e.preventSigmaDefault();
      select(e.node);
      updateGraph({ focusDepth: 1 });
    });

    return undefined;
  }, [graph, select, updateGraph]);

  // Tear sigma down only when the view unmounts.
  useEffect(
    () => () => {
      sigmaRef.current?.kill();
      sigmaRef.current = null;
    },
    [],
  );

  // The page panel changes the canvas width without a window resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      sigmaRef.current?.resize();
      sigmaRef.current?.refresh();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Cosmetic state → refresh through the reducers.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setSetting('labelColor', { color: palette.ink2 });
    sigma.refresh();
  }, [settings, selected, highlight, palette, hovered, visible, graph]);

  // Frame the focus neighbourhood or the recall hits; reset once when leaving that mode.
  const framedRef = useRef(false);
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !graphRef.current) return;
    const ids = highlight
      ? Object.keys(highlight.ranks).filter((id) => visible.has(id))
      : settings.focusDepth > 0 && selected
        ? [...visible]
        : null;
    if (!ids) {
      if (framedRef.current) {
        framedRef.current = false;
        void sigma.getCamera().animatedReset({ duration: 350 });
      }
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const d = sigma.getNodeDisplayData(id);
      if (!d) continue;
      minX = Math.min(minX, d.x);
      maxX = Math.max(maxX, d.x);
      minY = Math.min(minY, d.y);
      maxY = Math.max(maxY, d.y);
    }
    if (!Number.isFinite(minX)) return;
    framedRef.current = true;
    const ratio = Math.min(1.2, Math.max(0.12, Math.max(maxX - minX, maxY - minY) * 1.35));
    void sigma.getCamera().animate({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio }, { duration: 400 });
  }, [highlight, settings.focusDepth, selected, visible, layoutTick]);

  // A page selected elsewhere (search, panel links) is brought into view if it is off-screen.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !selected || highlight || settings.focusDepth > 0) return;
    const d = sigma.getNodeDisplayData(selected);
    if (!d) return;
    const vp = sigma.framedGraphToViewport(d);
    const { width, height } = sigma.getDimensions();
    const margin = 60;
    if (vp.x < margin || vp.y < margin || vp.x > width - margin || vp.y > height - margin) {
      const camera = sigma.getCamera();
      void camera.animate({ x: d.x, y: d.y, ratio: Math.min(camera.getState().ratio, 0.8) }, { duration: 400 });
    }
  }, [selected, highlight, settings.focusDepth]);

  const relayout = (): void => {
    const g = graphRef.current;
    if (!g || !derived) return;
    const positions = positionCache.get(root) ?? new Map();
    positions.clear();
    positionCache.set(root, positions);
    layoutGraph(g, positions, { fresh: true });
    sigmaRef.current?.setCustomBBox(null);
    sigmaRef.current?.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    sigmaRef.current?.refresh();
    setLayoutTick((t) => t + 1);
  };

  if (!derived || !graph) return null;

  const visibleEdges = graph.filterEdges((_e, attrs, s, t) => {
    if (!visible.has(s) || !visible.has(t)) return false;
    const v = edgeVisibility(attrs, settings);
    return v.typed || v.body;
  }).length;

  return (
    <div className="graph-view">
      <div ref={containerRef} className="graph-canvas" />
      <GraphControls
        visibleNodes={visible.size}
        visibleEdges={visibleEdges}
        onFit={() => void sigmaRef.current?.getCamera().animatedReset({ duration: 350 })}
        onRelayout={relayout}
      />
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
      {settings.focusDepth > 0 && selected && !highlight && (
        <div className="graph-banner" role="status">
          <span>
            Focus: {settings.focusDepth}-hop neighbourhood of <strong>{shortLabel(selected)}</strong>
          </span>
          <button type="button" className="btn btn-small" onClick={() => updateGraph({ focusDepth: 0 })}>
            Show all
          </button>
        </div>
      )}
      {tooltip && <GraphTooltip tooltip={tooltip} derived={derived} graph={graph} />}
    </div>
  );
}

function GraphTooltip({ tooltip, derived, graph }: { tooltip: Tooltip; derived: Derived; graph: VaultGraph }) {
  const style = { left: tooltip.x + 14, top: tooltip.y + 14 };
  if (tooltip.node) {
    const page = derived.pageById.get(tooltip.node);
    if (!page) return null;
    const inbound = derived.inbound.get(page.id) ?? 0;
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
          {plural(inbound, 'page')} link here · updated {daysAgo(derived.ageDays(page))}
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
            {r.hasInverse && !(r.declaredOnFrom && r.declaredOnTo) && <span className="graph-tooltip-warn"> · one-sided</span>}
          </div>
        ))}
        {(attrs.body > 0 || attrs.related) && (
          <div className="graph-tooltip-meta">
            {attrs.body > 0 ? `${plural(attrs.body, 'body link')}` : ''}
            {attrs.related ? `${attrs.body > 0 ? ' · ' : ''}related:` : ''} between <span className="mono">{shortLabel(source)}</span> and{' '}
            <span className="mono">{shortLabel(target)}</span>
          </div>
        )}
      </div>
    );
  }
  return null;
}
