import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import { useEffect, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  type Texture,
  Vector2,
} from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import SpriteText from 'three-spritetext';
import type { Palette } from '../../app/palette.ts';
import { type GraphSettings, useStore } from '../../app/store.ts';
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

/** Galaxy node: an additive glow sprite and an HTML label (out of the bloom's reach). */
interface Star {
  group: Group;
  glow: Sprite;
  label: CSS2DObject;
}

/**
 * Galaxy look. Star cores are drawn past 1.0 (linear HDR), so the bloom pass makes them glow;
 * filaments and the starfield stay under the bloom threshold.
 */
const GALAXY = {
  /** Star core brightness, as a multiple of the palette color (linear). */
  light: 3,
  /** Stars outside the focus or the lens: a faint gray. */
  dimmed: { light: 1, opacity: 0.35 },
  /**
   * Glow sprite diameter per radius of the classic sphere, in viewport heights: sizeAttenuation
   * is off, so stars keep their size on screen and zooming in spreads them apart instead.
   */
  glow: 0.0095,
  /** Camera distance when flying to a page (classic: 110): the neighbourhood stays in view. */
  fly: 220,
  bloom: { strength: 0.8, radius: 0.2, threshold: 0.2 },
  /** OrbitControls.autoRotateSpeed (2 = one turn in 30 s). */
  spin: 0.35,
  stars: 1600,
  starRadius: 2400,
  /** Filament opacity (additive): body links, typed relations, edges of the focus or lens, edges outside it. */
  opacity: { body: 0.16, typed: 0.35, lit: 0.45, dimmed: 0.03 },
};

function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

const endpoint = (end: string | Node3D): string => (typeof end === 'string' ? end : end.id);

/** Put the camera some distance out from a node, looking at it. */
function flyTo(fg: Instance, node: Node3D, distance: number): void {
  if (node.x === undefined || node.y === undefined || node.z === undefined) return;
  const ratio = 1 + distance / Math.max(1, Math.hypot(node.x, node.y, node.z));
  fg.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, { x: node.x, y: node.y, z: node.z }, 900);
}

/** Background stars on a far shell around the graph: decoration, never a pointer target. */
function starfield(color: string): Points<BufferGeometry, PointsMaterial> {
  // mulberry32 with a fixed seed: the same sky at every launch.
  let seed = 0x2f6b4e1d;
  const random = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const position = new Float32Array(GALAXY.stars * 3);
  const shade = new Float32Array(GALAXY.stars * 3);
  for (let i = 0; i < GALAXY.stars; i++) {
    const u = 2 * random() - 1;
    const phi = 2 * Math.PI * random();
    const r = GALAXY.starRadius * (0.55 + 0.45 * random());
    const s = Math.sqrt(1 - u * u);
    position.set([r * s * Math.cos(phi), r * u, r * s * Math.sin(phi)], i * 3);
    const b = 0.25 + 0.75 * random() ** 2;
    shade.set([b, b, b], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(shade, 3));
  const material = new PointsMaterial({
    color,
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const stars = new Points(geometry, material);
  stars.raycast = () => {};
  return stars;
}

/** Soft round glow, white with a hot core: the sprite color tints it. */
function glowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.12, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(0.28, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.06)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

function makeStar(texture: Texture): Star {
  const glow = new Sprite(
    new SpriteMaterial({ map: texture, blending: AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false }),
  );
  const element = document.createElement('div');
  element.className = 'graph-label-3d';
  const label = new CSS2DObject(element);
  // Anchored by its bottom edge on the star; the padding (set per star) lifts it above the core.
  label.center.set(0.5, 1);
  // Labels are decoration: never a hover, click or drag target (hidden ones included).
  label.raycast = () => {};
  const group = new Group();
  group.add(glow, label);
  return { group, glow, label };
}

/** Bloom, the dark background, the starfield and the rotation speed; returns the teardown. */
function setUpGalaxy(fg: Instance, palette: Palette): () => void {
  const composer = fg.postProcessingComposer();
  // With passes after the scene, it renders into the composer's targets, not the antialiased canvas.
  composer.renderTarget1.samples = 4;
  composer.renderTarget2.samples = 4;
  const { strength, radius, threshold } = GALAXY.bloom;
  const bloom = new UnrealBloomPass(new Vector2(1, 1), strength, radius, threshold);
  // The last pass to the screen does not convert to sRGB by itself.
  const output = new OutputPass();
  composer.addPass(bloom);
  composer.addPass(output);
  // A scene background, not just the clear color: the render pass clears its target with the
  // clear color left converted for the screen by the last pass, which reads as gray once linear.
  fg.scene().background = new Color(palette.plane);
  const stars = starfield(palette.ink3);
  fg.scene().add(stars);
  (fg.controls() as OrbitControls).autoRotateSpeed = GALAXY.spin;
  return () => {
    fg.scene().background = null;
    fg.scene().remove(stars);
    stars.geometry.dispose();
    stars.material.dispose();
    bloom.dispose();
    output.dispose();
  };
}

/** Galaxy filament of a link: faint by default, bright on the focus or lens, nearly gone outside it. */
function filamentLook(l: Link3D, style: StyleContext): { color: string; opacity: number } {
  const { palette } = style;
  const { color, dimmed } = edgeColor(l.attrs, l.typed, endpoint(l.source), endpoint(l.target), style);
  if (dimmed) return { color: palette.ink3, opacity: GALAXY.opacity.dimmed };
  // With a focus or a lens on, every edge still lit belongs to it.
  const focus = style.hovered ?? style.selected;
  const lit = style.highlight !== null || (focus !== null && style.visible.has(focus));
  const opacity = lit ? GALAXY.opacity.lit : l.typed ? GALAXY.opacity.typed : GALAXY.opacity.body;
  // bodyEdge is tuned as an opaque line on the surface: at filament opacity it would vanish.
  if (!l.typed) return { color: palette.ink3, opacity };
  return { color: color === palette.status.warning ? color : lit ? palette.ink2 : palette.typedEdge, opacity };
}

export interface Graph3DProps {
  /** Fixed for the component's lifetime: the parent remounts it (key) to switch. */
  look: GraphSettings['look'];
  graph: VaultGraph;
  ctx: Omit<StyleContext, 'hovered'>;
  positions: Positions;
  onReady: (api: { fit: () => void } | null) => void;
}

/** 3D force graph (three.js). Shares filters, colors, focus, recall lens and time travel with the 2D map. */
export default function Graph3D({ look, graph, ctx, positions, onReady }: Graph3DProps) {
  const select = useStore((s) => s.select);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<Instance | null>(null);
  const nodesRef = useRef(new Map<string, Node3D>());
  const labelsRef = useRef(new Map<string, SpriteText>());
  const starsRef = useRef(new Map<string, Star>());
  const filamentsRef = useRef(new Map<string, LineBasicMaterial>());
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const fittedRef = useRef(false);
  const membershipRef = useRef<{ graph: VaultGraph | null; key: string }>({ graph: null, key: '' });
  const hoveredRef = useRef<string | null>(null);
  const flightRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const styleRef = useRef<StyleContext>({ ...ctx, hovered });
  styleRef.current = { ...ctx, hovered };
  const galaxy = look === 'galaxy';

  // A node's current look and label, shared by both renderings.
  const lookOf = (n: Node3D) => {
    const style = styleRef.current;
    const page = style.derived.pageById.get(n.id);
    const look = page ? nodeLook(page, style) : null;
    const hub = (style.derived.inbound.get(n.id) ?? 0) >= 6;
    const strong = !!look?.forceLabel;
    return {
      look,
      text: `${look?.labelPrefix ?? ''}${n.label}`,
      strong,
      showLabel: !!look && !look.dimmed && (strong || (hub && style.settings.labels === 'always')),
      // Radius of the classic sphere (nodeVal = size³ / 60 at nodeRelSize 1.6).
      radius: Math.cbrt((n.size + (look?.sizeBoost ?? 0)) ** 3 / 60) * 1.6,
    };
  };

  // Update a label in place from the current look; SpriteText redraws its canvas on every
  // assignment, so only changed fields are written.
  const styleSprite = (sprite: SpriteText, n: Node3D): void => {
    const { palette } = styleRef.current;
    const { text, strong, showLabel, radius } = lookOf(n);
    const color = strong ? palette.ink : palette.ink2;
    if (sprite.text !== text) sprite.text = text;
    if (sprite.color !== color) sprite.color = color;
    if (sprite.strokeColor !== palette.surface) sprite.strokeColor = palette.surface;
    sprite.visible = showLabel;
    sprite.position.set(0, radius + 4, 0);
  };

  const styleStar = (star: Star, n: Node3D): void => {
    const { palette } = styleRef.current;
    const { look, text, strong, showLabel, radius } = lookOf(n);
    const material = star.glow.material;
    if (look && !look.dimmed) {
      material.color.set(look.color).multiplyScalar(GALAXY.light);
      material.opacity = 1;
    } else {
      material.color.set(palette.ink3).multiplyScalar(GALAXY.dimmed.light);
      material.opacity = GALAXY.dimmed.opacity;
    }
    star.glow.scale.setScalar(radius * GALAXY.glow);
    star.label.visible = showLabel;
    if (star.label.element.textContent !== text) star.label.element.textContent = text;
    star.label.element.classList.toggle('strong', strong);
    star.label.element.style.paddingBottom = `${Math.round(3 + radius * 1.4)}px`;
  };

  // Galaxy only: turn slowly, but hold still under a hovered node and during camera flights.
  const applySpin = (): void => {
    const fg = fgRef.current;
    if (!fg || !galaxy) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    (fg.controls() as OrbitControls).autoRotate = !reduced && hoveredRef.current === null && flightRef.current === null;
  };
  const holdSpin = (ms: number): void => {
    if (flightRef.current) clearTimeout(flightRef.current);
    flightRef.current = setTimeout(() => {
      flightRef.current = null;
      applySpin();
    }, ms);
    applySpin();
  };

  const filament = (color: string, opacity: number): LineBasicMaterial => {
    const key = `${color} ${opacity}`;
    let material = filamentsRef.current.get(key);
    if (!material) {
      material = new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending });
      filamentsRef.current.set(key, material);
    }
    return material;
  };

  // One instance for the lifetime of the view; per-node objects are built once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one instance per mount; the helpers only read refs, and look is fixed per mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const css2d = galaxy ? new CSS2DRenderer() : null;
    if (css2d) {
      // Galaxy labels sit on the dark field in both themes: dark-palette inks, plane-colored halo.
      const { palette } = styleRef.current;
      css2d.domElement.style.setProperty('--label-ink', palette.ink);
      css2d.domElement.style.setProperty('--label-ink-2', palette.ink2);
      css2d.domElement.style.setProperty('--label-halo', palette.plane);
    }
    const fg = new ForceGraph3D(el, { controlType: 'orbit', extraRenderers: css2d ? [css2d] : [] }) as unknown as Instance;
    fgRef.current = fg;
    const tearDownGalaxy = galaxy ? setUpGalaxy(fg, styleRef.current.palette) : () => {};
    const glow = galaxy ? glowTexture() : null;
    // Frame once, early (positions are seeded from the 2D map, so the warm-up is already
    // close to the final shape): on the selected page if there is one, else the whole graph.
    const fitOnce = (): void => {
      if (fittedRef.current || fg.graphData().nodes.length === 0) return;
      fittedRef.current = true;
      const id = styleRef.current.selected;
      const node = id ? nodesRef.current.get(id) : undefined;
      holdSpin(node ? 1000 : 700);
      if (node) flyTo(fg, node, galaxy ? GALAXY.fly : 110);
      else fg.zoomToFit(600, 24);
    };
    const fitTimer = setTimeout(fitOnce, 700);
    holdSpin(800);
    fg.showNavInfo(false)
      .nodeId('id')
      .nodeRelSize(1.6)
      .nodeResolution(14)
      .nodeOpacity(0.95)
      .nodeLabel(() => '')
      // Classic: the default sphere plus a label sprite. Galaxy: a star replaces the sphere.
      .nodeThreeObjectExtend(!galaxy)
      .nodeThreeObject((n) => {
        if (glow) {
          let star = starsRef.current.get(n.id);
          if (!star) {
            star = makeStar(glow);
            starsRef.current.set(n.id, star);
          }
          styleStar(star, n);
          return star.group;
        }
        let sprite = labelsRef.current.get(n.id);
        if (!sprite) {
          sprite = new SpriteText(n.label, 6);
          sprite.fontFace = 'system-ui, -apple-system, sans-serif';
          sprite.fontWeight = '600';
          sprite.strokeWidth = 0.6;
          sprite.material.depthWrite = false;
          // Labels are decoration: never a hover, click or drag target (hidden ones included).
          sprite.raycast = () => {};
          labelsRef.current.set(n.id, sprite);
        }
        styleSprite(sprite, n);
        return sprite;
      })
      .linkOpacity(0.55)
      // Galaxy filaments are plain additive lines: no cylinders, no arrow cones.
      .linkWidth((l) => (!galaxy && l.typed ? 0.55 : 0))
      .linkDirectionalArrowLength((l) => (!galaxy && l.typed ? 3.2 : 0))
      .linkDirectionalArrowRelPos(1)
      .linkCurvature(galaxy ? 0.25 : 0)
      .enableNodeDrag(true)
      .warmupTicks(40)
      .cooldownTicks(220)
      .onNodeHover((node) => {
        const p = pointerRef.current;
        hoveredRef.current = node && p.inside ? node.id : null;
        applySpin();
        setHovered(hoveredRef.current);
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
    if (import.meta.env.DEV) (window as unknown as { __graph3d?: Instance }).__graph3d = fg;

    // Tooltips need a real pointer position: none before the first move, none after leaving.
    const onMove = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, inside: true };
    };
    const onLeave = (): void => {
      pointerRef.current = { ...pointerRef.current, inside: false };
      hoveredRef.current = null;
      applySpin();
      setTooltip(null);
      setHovered(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    const observer = new ResizeObserver(() => fg.width(el.clientWidth).height(el.clientHeight));
    observer.observe(el);
    onReady({
      fit: () => {
        holdSpin(700);
        fg.zoomToFit(600, 40);
      },
    });
    return () => {
      clearTimeout(fitTimer);
      if (flightRef.current) clearTimeout(flightRef.current);
      flightRef.current = null;
      onReady(null);
      observer.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      tearDownGalaxy();
      fg._destructor();
      fg.renderer().dispose();
      for (const material of filamentsRef.current.values()) material.dispose();
      filamentsRef.current.clear();
      for (const star of starsRef.current.values()) star.glow.material.dispose();
      starsRef.current.clear();
      glow?.dispose();
      el.replaceChildren();
      fgRef.current = null;
      // A new instance starts empty: let the membership effect feed it even if nothing changed.
      membershipRef.current = { graph: null, key: '' };
    };
    // styleSprite and styleStar only read refs, so it is safe to leave them out of the deps.
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: styles are read from styleRef; ctx and hovered are the repaint triggers
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const style = styleRef.current;
    const pageOf = (id: string) => style.derived.pageById.get(id);
    if (galaxy) {
      fg.backgroundColor(style.palette.plane).linkMaterial((l) => {
        const f = filamentLook(l, style);
        return filament(f.color, f.opacity);
      });
      for (const n of fg.graphData().nodes) {
        const star = starsRef.current.get(n.id);
        if (star) styleStar(star, n);
      }
      return;
    }
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
      const sprite = labelsRef.current.get(n.id);
      if (sprite) styleSprite(sprite, n);
    }
  }, [ctx, hovered]);

  // Fly to a page selected after the opening frame (the opening frame handles the first one).
  // biome-ignore lint/correctness/useExhaustiveDependencies: holdSpin only reads refs
  useEffect(() => {
    const fg = fgRef.current;
    const node = ctx.selected ? nodesRef.current.get(ctx.selected) : undefined;
    if (!fg || !node || !fittedRef.current) return;
    holdSpin(1000);
    flyTo(fg, node, galaxy ? GALAXY.fly : 110);
  }, [ctx.selected]);

  return (
    <>
      <div ref={containerRef} className="graph-canvas graph-canvas-3d" />
      {tooltip && <GraphTooltip tooltip={tooltip} derived={ctx.derived} graph={graph} />}
    </>
  );
}
