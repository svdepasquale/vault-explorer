import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { isOneSided, type PageKind, type Relation } from '../../../shared/model.ts';
import type { Derived } from '../../app/derived.ts';
import { shortLabel } from '../../app/format.ts';

export interface NodeAttrs {
  x: number;
  y: number;
  size: number;
  label: string;
  kind: PageKind;
  color: string;
}

export interface EdgeAttrs {
  /** Typed relations between the two pages (canonical direction), possibly several. */
  relations: Relation[];
  predicates: string[];
  /** Body wikilinks in both directions. */
  body: number;
  related: boolean;
  /** Any relation of the pair declared on one page only. */
  asymmetric: boolean;
  /** Epoch ms when the pair first got connected (git), else when its younger page was born. */
  since: number | null;
  weight: number;
  size: number;
  color: string;
  type: 'arrow' | 'line';
}

export type VaultGraph = Graph<NodeAttrs, EdgeAttrs>;
export type Positions = Map<string, { x: number; y: number }>;

/** FNV-1a → [0, 1): deterministic seed so the same vault lays out the same way. */
function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

export function nodeSize(inbound: number): number {
  return Math.min(19, 3.2 + 2.1 * Math.sqrt(inbound));
}

/** One edge per unordered page pair; typed relations win the styling, body links ride along. */
export function buildGraph(derived: Derived): VaultGraph {
  const graph: VaultGraph = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const page of derived.model.pages) {
    graph.addNode(page.id, {
      x: 0,
      y: 0,
      size: page.kind === 'nav' ? 3.5 : nodeSize(derived.inbound.get(page.id) ?? 0),
      label: shortLabel(page.id),
      kind: page.kind,
      color: '#888888',
    });
  }

  interface Pair {
    a: string;
    b: string;
    relations: Relation[];
    body: number;
    related: boolean;
    since: number | null;
  }
  const pairs = new Map<string, Pair>();
  const pairOf = (x: string, y: string): Pair => {
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}\u0000${b}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { a, b, relations: [], body: 0, related: false, since: null };
      pairs.set(key, pair);
    }
    return pair;
  };
  const earliest = (pair: Pair, iso: string | null): void => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (!Number.isNaN(t) && (pair.since === null || t < pair.since)) pair.since = t;
  };
  for (const l of derived.model.links) {
    const pair = pairOf(l.source, l.target);
    pair.body += l.body;
    pair.related ||= l.related;
    earliest(pair, l.since);
  }
  for (const r of derived.model.relations) {
    const pair = pairOf(r.from, r.to);
    pair.relations.push(r);
    earliest(pair, r.since);
  }

  for (const pair of pairs.values()) {
    if (!graph.hasNode(pair.a) || !graph.hasNode(pair.b)) continue;
    const first = pair.relations[0];
    const [source, target] = first ? [first.from, first.to] : [pair.a, pair.b];
    const typed = pair.relations.length > 0;
    let since = pair.since;
    if (since === null) {
      const pa = derived.pageById.get(pair.a);
      const pb = derived.pageById.get(pair.b);
      const born = [pa && derived.bornAt(pa), pb && derived.bornAt(pb)].filter((t): t is number => typeof t === 'number');
      since = born.length ? Math.max(...born) : null;
    }
    graph.addEdgeWithKey(`${pair.a}\u0000${pair.b}`, source, target, {
      relations: pair.relations,
      predicates: [...new Set(pair.relations.map((r) => r.predicate))],
      body: pair.body,
      related: pair.related,
      asymmetric: pair.relations.some(isOneSided),
      since,
      weight: (typed ? 2 : 0) + Math.log2(1 + pair.body) + (pair.related ? 0.5 : 0),
      size: typed ? 1.6 : 0.6 + 0.25 * Math.log2(1 + pair.body),
      color: '#888888',
      type: typed ? 'arrow' : 'line',
    });
  }
  return graph;
}

/**
 * ForceAtlas2 on the content pages; navigation pages (which link to everything
 * and would collapse the layout onto themselves) are placed afterwards at the
 * centroid of their neighbours. Known positions are reused so live reloads only
 * nudge the picture.
 */
export function layoutGraph(graph: VaultGraph, previous: Positions, options: { fresh?: boolean } = {}): void {
  const reuse = !options.fresh && previous.size > 0;
  const content = graph.copy() as VaultGraph;
  graph.forEachNode((node, attrs) => {
    if (attrs.kind === 'nav') content.dropNode(node);
  });

  content.forEachNode((node) => {
    const known = reuse ? previous.get(node) : undefined;
    if (known) {
      content.mergeNodeAttributes(node, known);
      return;
    }
    // New page next to its already placed neighbours, else a seeded spot.
    let sx = 0;
    let sy = 0;
    let n = 0;
    if (reuse) {
      content.forEachNeighbor(node, (nb) => {
        const p = previous.get(nb);
        if (p) {
          sx += p.x;
          sy += p.y;
          n++;
        }
      });
    }
    const angle = 2 * Math.PI * hash01(node);
    const radius = n ? 4 : 100 * Math.sqrt(hash01(`${node}#r`));
    content.mergeNodeAttributes(node, {
      x: (n ? sx / n : 0) + radius * Math.cos(angle),
      y: (n ? sy / n : 0) + radius * Math.sin(angle),
    });
  });

  if (content.order > 0) {
    const settings = forceAtlas2.inferSettings(content);
    forceAtlas2.assign(content, {
      iterations: reuse ? 80 : 900,
      settings: {
        ...settings,
        linLogMode: true,
        gravity: 0.6,
        scalingRatio: 4,
        slowDown: reuse ? 6 : 1.5,
        outboundAttractionDistribution: true,
        barnesHutOptimize: content.order > 600,
      },
      getEdgeWeight: 'weight',
    });
  }

  content.forEachNode((node, attrs) => {
    graph.mergeNodeAttributes(node, { x: attrs.x, y: attrs.y });
    previous.set(node, { x: attrs.x, y: attrs.y });
  });

  graph.forEachNode((node, attrs) => {
    if (attrs.kind !== 'nav') return;
    let sx = 0;
    let sy = 0;
    let n = 0;
    graph.forEachNeighbor(node, (_nb, nbAttrs) => {
      if (nbAttrs.kind === 'nav') return;
      sx += nbAttrs.x;
      sy += nbAttrs.y;
      n++;
    });
    const angle = 2 * Math.PI * hash01(node);
    const x = (n ? sx / n : 0) + 6 * Math.cos(angle);
    const y = (n ? sy / n : 0) + 6 * Math.sin(angle);
    graph.mergeNodeAttributes(node, { x, y });
    previous.set(node, { x, y });
  });
}

const POSITIONS_KEY = 'vault-explorer.positions:';

/** Layout positions remembered per vault in localStorage, so the map is stable across launches. */
export function loadPositions(root: string): Positions {
  const positions: Positions = new Map();
  try {
    const raw = localStorage.getItem(POSITIONS_KEY + root);
    if (!raw) return positions;
    const data = JSON.parse(raw) as Record<string, [number, number]>;
    for (const [id, xy] of Object.entries(data)) {
      if (Array.isArray(xy) && Number.isFinite(xy[0]) && Number.isFinite(xy[1])) positions.set(id, { x: xy[0], y: xy[1] });
    }
  } catch {
    /* storage blocked or corrupt: fall back to a fresh layout */
  }
  return positions;
}

export function savePositions(root: string, positions: Positions): void {
  try {
    const data: Record<string, [number, number]> = {};
    for (const [id, p] of positions) data[id] = [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100];
    localStorage.setItem(POSITIONS_KEY + root, JSON.stringify(data));
  } catch {
    /* ignore: positions just do not persist */
  }
}
