import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import { useEffect, useRef, useState } from 'react';
import SpriteText from 'three-spritetext';
import { useStore } from '../../app/store.ts';
import type { EdgeAttrs, Positions, VaultGraph } from './build.ts';
import { GraphTooltip, type TooltipState } from './GraphTooltip.tsx';
import { edgeColor, edgeVisibility, nodeLook, type StyleContext } from './style.ts';

interface Node3D {
  id: string;
  label: string;
  size: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

interface Link3D {
  key: string;
  source: string | Node3D;
  target: string | Node3D;
  attrs: EdgeAttrs;
  typed: boolean;
}

type Instance = ForceGraph3DInstance<Node3D, Link3D>;

function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

const endpoint = (end: string | Node3D): string => (typeof end === 'string' ? end : end.id);

export interface Graph3DProps {
  graph: VaultGraph;
  ctx: Omit<StyleContext, 'hovered'>;
  positions: Positions;
  onReady: (api: { fit: () => void } | null) => void;
}

/** 3D force graph (three.js). Shares filters, colors, focus, recall lens and time travel with the 2D map. */
export default function Graph3D({ graph, ctx, positions, onReady }: Graph3DProps) {
  const select = useStore((s) => s.select);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<Instance | null>(null);
  const nodesRef = useRef(new Map<string, Node3D>());
  const spritesRef = useRef(new Map<string, SpriteText>());
  const pointerRef = useRef({ x: 0, y: 0 });
  const fittedRef = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const styleRef = useRef<StyleContext>({ ...ctx, hovered });
  styleRef.current = { ...ctx, hovered };

  // One instance for the lifetime of the view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fg = new ForceGraph3D(el, { controlType: 'orbit' }) as unknown as Instance;
    // Frame the graph once, early (positions are seeded from the 2D map, so the warm-up
    // is already close to the final shape); later updates keep the user's camera.
    const fitOnce = (): void => {
      if (fittedRef.current || fg.graphData().nodes.length === 0) return;
      fittedRef.current = true;
      fg.zoomToFit(600, 24);
    };
    const fitTimer = setTimeout(fitOnce, 700);
    fg.showNavInfo(false)
      .nodeId('id')
      .nodeRelSize(1.6)
      .nodeResolution(14)
      .nodeOpacity(0.95)
      .nodeLabel(() => '')
      .linkOpacity(0.55)
      .linkDirectionalArrowRelPos(1)
      .enableNodeDrag(true)
      .warmupTicks(40)
      .cooldownTicks(220)
      .onNodeHover((node) => {
        setHovered(node?.id ?? null);
        setTooltip(node ? { node: node.id, x: pointerRef.current.x, y: pointerRef.current.y } : null);
        el.style.cursor = node ? 'pointer' : '';
      })
      .onLinkHover((link) => setTooltip(link ? { edge: link.key, x: pointerRef.current.x, y: pointerRef.current.y } : null))
      .onNodeClick((node) => select(node.id))
      .onEngineStop(() => fitOnce());
    const charge = fg.d3Force('charge') as unknown as { strength?: (v: number) => void } | undefined;
    charge?.strength?.(-70);
    const linkForce = fg.d3Force('link') as unknown as { distance?: (fn: (l: Link3D) => number) => void } | undefined;
    linkForce?.distance?.((l) => (l.typed ? 26 : 42));
    fgRef.current = fg;
    if (import.meta.env.DEV) (window as unknown as { __graph3d?: Instance }).__graph3d = fg;

    const onMove = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    el.addEventListener('pointermove', onMove);
    const observer = new ResizeObserver(() => fg.width(el.clientWidth).height(el.clientHeight));
    observer.observe(el);
    onReady({ fit: () => fg.zoomToFit(600, 40) });
    return () => {
      clearTimeout(fitTimer);
      onReady(null);
      observer.disconnect();
      el.removeEventListener('pointermove', onMove);
      fg._destructor();
      fg.renderer().dispose();
      el.replaceChildren();
      fgRef.current = null;
    };
  }, [select, onReady]);

  // Membership: pages and edges alive under the filters and the time cursor. Node objects are
  // reused, so the simulation keeps its state and newcomers fly in during time travel.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    let radius = 1;
    for (const p of positions.values()) radius = Math.max(radius, Math.hypot(p.x, p.y));
    const scale = 140 / radius;
    const nodes: Node3D[] = [];
    for (const id of ctx.visible) {
      if (!graph.hasNode(id)) continue;
      let node = nodesRef.current.get(id);
      if (!node) {
        const p = positions.get(id);
        node = {
          id,
          label: graph.getNodeAttribute(id, 'label'),
          size: graph.getNodeAttribute(id, 'size'),
          x: (p?.x ?? 0) * scale,
          y: (p?.y ?? 0) * scale,
          z: (hash01(id) - 0.5) * 120,
        };
        nodesRef.current.set(id, node);
      }
      node.size = graph.getNodeAttribute(id, 'size');
      nodes.push(node);
    }
    const links: Link3D[] = [];
    graph.forEachEdge((key, attrs, source, target) => {
      if (!ctx.visible.has(source) || !ctx.visible.has(target)) return;
      const v = edgeVisibility(attrs, ctx.settings, ctx.time);
      if (!v.typed && !v.body) return;
      links.push({ key, source, target, attrs, typed: v.typed });
    });
    fg.graphData({ nodes, links });
  }, [graph, ctx.visible, ctx.settings, ctx.time, positions]);

  // Looks: colors, sizes, labels, arrows. Re-applying the accessors repaints without
  // touching the simulation.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const style = styleRef.current;
    const pageOf = (id: string) => style.derived.pageById.get(id);
    fg.backgroundColor(style.palette.surface)
      .nodeVal((n) => {
        const page = pageOf(n.id);
        const boost = page ? nodeLook(page, style).sizeBoost : 0;
        return (n.size + boost) ** 3 / 60;
      })
      .nodeColor((n) => {
        const page = pageOf(n.id);
        return page ? nodeLook(page, style).color : style.palette.ink3;
      })
      .nodeThreeObjectExtend(true)
      .nodeThreeObject((n) => {
        const page = pageOf(n.id);
        const look = page ? nodeLook(page, style) : null;
        const hub = (style.derived.inbound.get(n.id) ?? 0) >= 6;
        let sprite = spritesRef.current.get(n.id);
        if (!sprite) {
          sprite = new SpriteText(n.label, 4.2);
          sprite.fontFace = 'system-ui, -apple-system, sans-serif';
          sprite.fontWeight = '600';
          sprite.strokeWidth = 0.6;
          sprite.material.depthWrite = false;
          spritesRef.current.set(n.id, sprite);
        }
        sprite.text = `${look?.labelPrefix ?? ''}${n.label}`;
        sprite.color = look?.forceLabel ? style.palette.ink : style.palette.ink2;
        sprite.strokeColor = style.palette.surface;
        sprite.visible = !!look && !look.dimmed && (look.forceLabel || hub);
        sprite.position.set(0, Math.cbrt((n.size + (look?.sizeBoost ?? 0)) ** 3 / 60) * 1.6 + 4, 0);
        return sprite;
      })
      .linkColor((l) => edgeColor(l.attrs, l.typed, endpoint(l.source), endpoint(l.target), style).color)
      .linkWidth((l) => (l.typed ? 0.55 : 0))
      .linkDirectionalArrowLength((l) => (l.typed ? 3.2 : 0))
      .linkDirectionalArrowColor((l) => edgeColor(l.attrs, l.typed, endpoint(l.source), endpoint(l.target), style).color);
  }, [ctx, hovered]);

  // Fly to the selected page.
  useEffect(() => {
    const fg = fgRef.current;
    const node = ctx.selected ? nodesRef.current.get(ctx.selected) : undefined;
    if (!fg || !node || node.x === undefined || node.y === undefined || node.z === undefined) return;
    const distance = 110;
    const ratio = 1 + distance / Math.max(1, Math.hypot(node.x, node.y, node.z));
    fg.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, { x: node.x, y: node.y, z: node.z }, 900);
  }, [ctx.selected]);

  return (
    <>
      <div ref={containerRef} className="graph-canvas graph-canvas-3d" />
      {tooltip && <GraphTooltip tooltip={tooltip} derived={ctx.derived} graph={graph} />}
    </>
  );
}
