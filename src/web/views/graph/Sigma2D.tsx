import { useEffect, useRef, useState } from 'react';
import Sigma from 'sigma';
import { EdgeArrowProgram, EdgeRectangleProgram } from 'sigma/rendering';
import type { EdgeDisplayData, NodeDisplayData } from 'sigma/types';
import type { Palette } from '../../app/palette.ts';
import { useStore } from '../../app/store.ts';
import type { EdgeAttrs, NodeAttrs, Positions, VaultGraph } from './build.ts';
import { GraphTooltip, type TooltipState } from './GraphTooltip.tsx';
import { edgeColor, edgeVisibility, nodeLook, type StyleContext } from './style.ts';

interface LabelData {
  x: number;
  y: number;
  size: number;
  label: string | null;
  forceLabel?: boolean;
}

/** Labels with a halo in the surface color, so edges never run through the text. */
function drawLabel(context: CanvasRenderingContext2D, data: LabelData, palette: Palette, font: string, size: number): void {
  if (!data.label) return;
  const strong = data.forceLabel === true;
  context.font = `${strong ? 600 : 500} ${size}px ${font}`;
  const x = data.x + data.size + 4;
  const y = data.y + size / 3;
  context.lineJoin = 'round';
  context.lineWidth = 4;
  context.strokeStyle = palette.surface;
  context.strokeText(data.label, x, y);
  context.fillStyle = strong ? palette.ink : palette.ink2;
  context.fillText(data.label, x, y);
}

function drawHover(context: CanvasRenderingContext2D, data: LabelData & { color: string }, palette: Palette, font: string): void {
  if (!data.label) return;
  const size = 13;
  context.font = `600 ${size}px ${font}`;
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

const FONT = 'system-ui, -apple-system, sans-serif';
/** Sigma's double-click window, and how long a single click waits before opening the panel. */
const DOUBLE_CLICK_MS = 300;

export interface Sigma2DProps {
  graph: VaultGraph;
  ctx: Omit<StyleContext, 'hovered'>;
  positions: Positions;
  onPositionsChange: () => void;
  layoutTick: number;
  /** Registers camera actions with the parent (fit button). */
  onReady: (api: { fit: () => void } | null) => void;
}

export function Sigma2D({ graph, ctx, positions, onPositionsChange, layoutTick, onReady }: Sigma2DProps) {
  const select = useStore((s) => s.select);
  const updateGraph = useStore((s) => s.updateGraph);
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null);
  const graphRef = useRef<VaultGraph>(graph);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const styleRef = useRef<StyleContext>({ ...ctx, hovered });
  styleRef.current = { ...ctx, hovered };
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionsRef = useRef({ positions, onPositionsChange });
  positionsRef.current = { positions, onPositionsChange };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    graphRef.current = graph;
    if (sigmaRef.current) {
      sigmaRef.current.setGraph(graph);
      return;
    }
    const sigma = new Sigma<NodeAttrs, EdgeAttrs>(graph, container, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      enableEdgeEvents: true,
      zIndex: true,
      defaultEdgeType: 'line',
      edgeProgramClasses: { line: EdgeRectangleProgram, arrow: EdgeArrowProgram },
      labelFont: FONT,
      labelSize: 12,
      labelWeight: '500',
      labelDensity: 0.55,
      labelGridCellSize: 110,
      labelRenderedSizeThreshold: 8,
      doubleClickTimeout: DOUBLE_CLICK_MS,
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
      stagePadding: 48,
      defaultDrawNodeLabel: (context, data, settings) => drawLabel(context, data, styleRef.current.palette, FONT, settings.labelSize),
      defaultDrawNodeHover: (context, data) => drawHover(context, data, styleRef.current.palette, FONT),
      nodeReducer: (node, data) => {
        const style = styleRef.current;
        if (!style.visible.has(node)) return { ...data, hidden: true };
        const page = style.derived.pageById.get(node);
        if (!page) return { ...data, hidden: true };
        const look = nodeLook(page, style);
        const out: Partial<NodeDisplayData> = {
          ...data,
          color: look.color,
          zIndex: look.z,
          size: data.size + look.sizeBoost,
          forceLabel: look.forceLabel,
          label: look.dimmed ? null : `${look.labelPrefix}${data.label}`,
          highlighted: node === style.selected,
        };
        return out;
      },
      edgeReducer: (edge, data) => {
        const style = styleRef.current;
        const v = edgeVisibility(data, style.settings, style.time);
        if (!v.typed && !v.body) return { ...data, hidden: true };
        const [source, target] = graphRef.current.extremities(edge);
        const { color, dimmed } = edgeColor(data, v.typed, source, target, style);
        const out: Partial<EdgeDisplayData> = {
          ...data,
          type: v.typed ? 'arrow' : 'line',
          size: v.typed ? data.size : 0.6 + 0.25 * Math.log2(1 + data.body),
          color,
          zIndex: dimmed ? 0 : 1,
        };
        return out;
      },
    });
    sigmaRef.current = sigma;
    onReady({ fit: () => void sigma.getCamera().animatedReset({ duration: 350 }) });

    // Drag a node to move it; the new spot is remembered with the layout. A real drag
    // (past a few pixels of trackpad jitter) does not count as a click on the node.
    let dragged: string | null = null;
    let dragMoved = false;
    let downAt = { x: 0, y: 0 };
    sigma.on('downNode', (e) => {
      dragged = e.node;
      dragMoved = false;
      downAt = { x: e.event.x, y: e.event.y };
      if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
    });
    sigma.getMouseCaptor().on('mousemovebody', (e) => {
      if (!dragged) return;
      if (!dragMoved && Math.hypot(e.x - downAt.x, e.y - downAt.y) > 4) dragMoved = true;
      const pos = sigma.viewportToGraph(e);
      graphRef.current.mergeNodeAttributes(dragged, { x: pos.x, y: pos.y });
      positionsRef.current.positions.set(dragged, { x: pos.x, y: pos.y });
      e.preventSigmaDefault();
      e.original.preventDefault();
      e.original.stopPropagation();
    });
    sigma.getMouseCaptor().on('mouseup', () => {
      if (dragged) positionsRef.current.onPositionsChange();
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
    // A click opens the page panel only once the double-click window has passed: opening it
    // at once narrows the canvas, and the second click of a double-click would miss the node.
    sigma.on('clickNode', (e) => {
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      const node = e.node;
      clickTimerRef.current = setTimeout(() => select(node), DOUBLE_CLICK_MS);
    });
    sigma.on('doubleClickNode', (e) => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      e.preventSigmaDefault();
      select(e.node);
      updateGraph({ focusDepth: 1 });
    });
  }, [graph, select, updateGraph, onReady]);

  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      onReady(null);
      sigmaRef.current?.kill();
      sigmaRef.current = null;
    },
    [onReady],
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

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    // 'hover' draws only forced labels: the hovered or selected page and its neighbours,
    // recall hits, pages new in time travel.
    sigma.setSetting('labelRenderedSizeThreshold', ctx.settings.labels === 'hover' ? Number.POSITIVE_INFINITY : 8);
    sigma.refresh();
  }, [ctx, hovered, layoutTick]);

  useEffect(() => {
    if (layoutTick === 0) return;
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setCustomBBox(null);
    sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    sigma.refresh();
  }, [layoutTick]);

  // Frame the focus neighbourhood or the recall hits; reset once when leaving that mode.
  // Keyed on the framed ids, so display-only setting changes keep the user's zoom.
  const framedRef = useRef(false);
  const { highlight, selected, visible } = ctx;
  const focusDepth = ctx.settings.focusDepth;
  const framedIds = highlight
    ? Object.keys(highlight.ranks).filter((id) => visible.has(id))
    : focusDepth > 0 && selected && visible.has(selected)
      ? [...visible]
      : null;
  const framedKey = framedIds ? [...framedIds].sort().join('\n') : null;
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const ids = framedIds;
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
    // framedIds is read from the render that changed framedKey.
  }, [framedKey]);

  // A page selected elsewhere (search, panel links) is brought into view if it is off-screen.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !selected || highlight || focusDepth > 0) return;
    const d = sigma.getNodeDisplayData(selected);
    if (!d) return;
    const vp = sigma.framedGraphToViewport(d);
    const { width, height } = sigma.getDimensions();
    const margin = 60;
    if (vp.x < margin || vp.y < margin || vp.x > width - margin || vp.y > height - margin) {
      const camera = sigma.getCamera();
      void camera.animate({ x: d.x, y: d.y, ratio: Math.min(camera.getState().ratio, 0.8) }, { duration: 400 });
    }
  }, [selected, highlight, focusDepth]);

  return (
    <>
      <div ref={containerRef} className="graph-canvas" />
      {tooltip && <GraphTooltip tooltip={tooltip} derived={ctx.derived} graph={graph} />}
    </>
  );
}
