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

/** Put the camera 110 units out from a node, looking at it. */
function flyTo(fg: Instance, node: Node3D): void {
  if (node.x === undefined || node.y === undefined || node.z === undefined) return;
  const ratio = 1 + 110 / Math.max(1, Math.hypot(node.x, node.y, node.z));
  fg.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, { x: node.x, y: node.y, z: node.z }, 900);
}

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
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const fittedRef = useRef(false);
  const membershipRef = useRef<{ graph: VaultGraph | null; key: string }>({ graph: null, key: '' });
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const styleRef = useRef<StyleContext>({ ...ctx, hovered });
  styleRef.current = { ...ctx, hovered };

  // Update a label in place from the current look; SpriteText redraws its canvas on every
  // assignment, so only changed fields are written.
  const styleSprite = (sprite: SpriteText, n: Node3D): void => {
    const style = styleRef.current;
    const page = style.derived.pageById.get(n.id);
    const look = page ? nodeLook(page, style) : null;
    const hub = (style.derived.inbound.get(n.id) ?? 0) >= 6;
    const text = `${look?.labelPrefix ?? ''}${n.label}`;
    const color = look?.forceLabel ? style.palette.ink : style.palette.ink2;
    if (sprite.text !== text) sprite.text = text;
    if (sprite.color !== color) sprite.color = color;
    if (sprite.strokeColor !== style.palette.surface) sprite.strokeColor = style.palette.surface;
    sprite.visible = !!look && !look.dimmed && (look.forceLabel || (hub && style.settings.labels === 'always'));
    sprite.position.set(0, Math.cbrt((n.size + (look?.sizeBoost ?? 0)) ** 3 / 60) * 1.6 + 4, 0);
  };

  // One instance for the lifetime of the view; per-node objects are built once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fg = new ForceGraph3D(el, { controlType: 'orbit' }) as unknown as Instance;
    // Frame once, early (positions are seeded from the 2D map, so the warm-up is already
    // close to the final shape): on the selected page if there is one, else the whole graph.
    const fitOnce = (): void => {
      if (fittedRef.current || fg.graphData().nodes.length === 0) return;
      fittedRef.current = true;
      const id = styleRef.current.selected;
      const node = id ? nodesRef.current.get(id) : undefined;
      if (node) flyTo(fg, node);
      else fg.zoomToFit(600, 24);
    };
    const fitTimer = setTimeout(fitOnce, 700);
    fg.showNavInfo(false)
      .nodeId('id')
      .nodeRelSize(1.6)
      .nodeResolution(14)
      .nodeOpacity(0.95)
      .nodeLabel(() => '')
      .nodeThreeObjectExtend(true)
      .nodeThreeObject((n) => {
        let sprite = spritesRef.current.get(n.id);
        if (!sprite) {
          sprite = new SpriteText(n.label, 6);
          sprite.fontFace = 'system-ui, -apple-system, sans-serif';
          sprite.fontWeight = '600';
          sprite.strokeWidth = 0.6;
          sprite.material.depthWrite = false;
          // Labels are decoration: never a hover, click or drag target (hidden ones included).
          sprite.raycast = () => {};
          spritesRef.current.set(n.id, sprite);
        }
        styleSprite(sprite, n);
        return sprite;
      })
      .linkOpacity(0.55)
      .linkWidth((l) => (l.typed ? 0.55 : 0))
      .linkDirectionalArrowLength((l) => (l.typed ? 3.2 : 0))
      .linkDirectionalArrowRelPos(1)
      .enableNodeDrag(true)
      .warmupTicks(40)
      .cooldownTicks(220)
      .onNodeHover((node) => {
        const p = pointerRef.current;
        setHovered(node && p.inside ? node.id : null);
        setTooltip(node && p.inside ? { node: node.id, x: p.x, y: p.y } : null);
        el.style.cursor = node ? 'pointer' : '';
      })
      .onLinkHover((link) => {
        const p = pointerRef.current;
        setTooltip(link && p.inside ? { edge: link.key, x: p.x, y: p.y } : null);
      })
      .onNodeClick((node) => select(node.id))
      .onEngineStop(() => fitOnce());
    const charge = fg.d3Force('charge') as unknown as { strength?: (v: number) => void } | undefined;
    charge?.strength?.(-70);
    const linkForce = fg.d3Force('link') as unknown as { distance?: (fn: (l: Link3D) => number) => void } | undefined;
    linkForce?.distance?.((l) => (l.typed ? 26 : 42));
    fgRef.current = fg;
    if (import.meta.env.DEV) (window as unknown as { __graph3d?: Instance }).__graph3d = fg;

    // Tooltips need a real pointer position: none before the first move, none after leaving.
    const onMove = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, inside: true };
    };
    const onLeave = (): void => {
      pointerRef.current = { ...pointerRef.current, inside: false };
      setTooltip(null);
      setHovered(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    const observer = new ResizeObserver(() => fg.width(el.clientWidth).height(el.clientHeight));
    observer.observe(el);
    onReady({ fit: () => fg.zoomToFit(600, 40) });
    return () => {
      clearTimeout(fitTimer);
      onReady(null);
      observer.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      fg._destructor();
      fg.renderer().dispose();
      el.replaceChildren();
      fgRef.current = null;
    };
    // styleSprite only reads refs, so it is safe to leave out of the deps.
  }, [select, onReady]);

  // Membership: pages and edges alive under the filters and the time cursor. Node objects are
  // reused, so the simulation keeps its state and newcomers fly in during time travel. The
  // simulation is only re-fed when membership really changed: graphData() always reheats it.
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
    const key = `${nodes.map((n) => n.id).join('\n')}\u0000${links.map((l) => `${l.key}:${l.typed ? 1 : 0}`).join('\n')}`;
    if (membershipRef.current.graph === graph && membershipRef.current.key === key) return;
    membershipRef.current = { graph, key };
    fg.graphData({ nodes, links });
  }, [graph, ctx.visible, ctx.settings, ctx.time, positions]);

  // Looks: colors, sizes, edge colors, labels. Accessor updates repaint existing objects;
  // labels are updated in place.
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
      .linkColor((l) => edgeColor(l.attrs, l.typed, endpoint(l.source), endpoint(l.target), style).color)
      .linkDirectionalArrowColor((l) => edgeColor(l.attrs, l.typed, endpoint(l.source), endpoint(l.target), style).color);
    for (const n of fg.graphData().nodes) {
      const sprite = spritesRef.current.get(n.id);
      if (sprite) styleSprite(sprite, n);
    }
  }, [ctx, hovered]);

  // Fly to a page selected after the opening frame (the opening frame handles the first one).
  useEffect(() => {
    const fg = fgRef.current;
    const node = ctx.selected ? nodesRef.current.get(ctx.selected) : undefined;
    if (!fg || !node || !fittedRef.current) return;
    flyTo(fg, node);
  }, [ctx.selected]);

  return (
    <>
      <div ref={containerRef} className="graph-canvas graph-canvas-3d" />
      {tooltip && <GraphTooltip tooltip={tooltip} derived={ctx.derived} graph={graph} />}
    </>
  );
}
