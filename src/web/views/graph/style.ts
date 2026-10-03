import type { Page } from '../../../shared/model.ts';
import type { Derived } from '../../app/derived.ts';
import { freshnessBucket, type Palette } from '../../app/palette.ts';
import type { GraphSettings, Highlight } from '../../app/store.ts';
import type { EdgeAttrs, VaultGraph } from './build.ts';

// Styling and visibility rules shared by the 2D (sigma) and 3D renderers.

export interface StyleContext {
  derived: Derived;
  settings: GraphSettings;
  selected: string | null;
  highlight: Highlight | null;
  palette: Palette;
  hovered: string | null;
  /** Epoch ms of the time-travel cursor, or null for "now". */
  time: number | null;
  visible: Set<string>;
}

/** Pages born within this window before the cursor are drawn as "new" during time travel. */
export function newbornWindow(range: [number, number] | null): number {
  if (!range) return 0;
  return Math.max(4 * 86_400_000, (range[1] - range[0]) / 30);
}

export function matchesEmphasis(page: Page, settings: GraphSettings): boolean {
  const { field, value } = settings.emphasis;
  if (!value) return false;
  if (field === 'domain') return page.domain === value;
  if (field === 'status') return page.status === value;
  return page.tags.includes(value);
}

export function baseColor(page: Page, ctx: StyleContext): string {
  const { settings, palette, derived } = ctx;
  if (settings.colorBy === 'freshness') {
    const age = derived.ageDays(page);
    return age === null ? palette.ink3 : (palette.freshness[freshnessBucket(age)] ?? palette.ink3);
  }
  if (settings.colorBy === 'emphasis') return matchesEmphasis(page, settings) ? palette.accent : palette.dim;
  return palette.kind[page.kind];
}

export function edgeVisibility(attrs: EdgeAttrs, settings: GraphSettings, time: number | null): { typed: boolean; body: boolean } {
  if (time !== null && attrs.since !== null && attrs.since > time) return { typed: false, body: false };
  const typed = settings.showRelations && attrs.relations.length > 0 && (!settings.predicate || attrs.predicates.includes(settings.predicate));
  const body = settings.showBodyLinks && !settings.predicate && (attrs.body > 0 || attrs.related);
  return { typed, body };
}

/** Pages shown under the filters and the time cursor, narrowed to the focus neighbourhood when set. */
export function computeVisible(
  graph: VaultGraph,
  derived: Derived,
  settings: GraphSettings,
  selected: string | null,
  time: number | null,
): Set<string> {
  const visible = new Set<string>();
  for (const page of derived.model.pages) {
    if (settings.hiddenKinds.includes(page.kind)) continue;
    if (!page.indexed && !settings.showArchived && page.kind !== 'nav') continue;
    if (time !== null) {
      const born = derived.bornAt(page);
      if (born !== null && born > time) continue;
    }
    visible.add(page.id);
  }
  if (!selected || settings.focusDepth <= 0 || !visible.has(selected)) return visible;
  const reached = new Set<string>([selected]);
  let frontier = [selected];
  for (let depth = 0; depth < settings.focusDepth; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      graph.forEachEdge(node, (_edge, attrs, source, target) => {
        const v = edgeVisibility(attrs, settings, time);
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

export interface NodeLook {
  color: string;
  /** Show the label regardless of zoom. */
  forceLabel: boolean;
  /** Drawn faded, label hidden. */
  dimmed: boolean;
  sizeBoost: number;
  labelPrefix: string;
  z: number;
}

/** Final look of a visible node: base color, then recall lens, focus or time-travel emphasis. */
export function nodeLook(page: Page, ctx: StyleContext): NodeLook {
  const look: NodeLook = { color: baseColor(page, ctx), forceLabel: false, dimmed: false, sizeBoost: 0, labelPrefix: '', z: 1 };
  const focus = ctx.hovered ?? ctx.selected;
  if (ctx.highlight) {
    const rank = ctx.highlight.ranks[page.id];
    if (rank !== undefined) {
      look.labelPrefix = `${rank}. `;
      look.forceLabel = true;
      look.sizeBoost = 3;
      look.z = 3;
    } else {
      look.color = ctx.palette.dim;
      look.dimmed = true;
      look.z = 0;
    }
  } else if (focus && ctx.visible.has(focus)) {
    const near = page.id === focus || ctx.derived.neighbors.get(focus)?.has(page.id);
    if (near) {
      look.forceLabel = true;
      look.z = 2;
    } else {
      look.color = ctx.palette.dim;
      look.dimmed = true;
      look.z = 0;
    }
  } else if (ctx.settings.colorBy === 'emphasis' && ctx.settings.emphasis.value && !matchesEmphasis(page, ctx.settings)) {
    look.dimmed = true;
    look.z = 0;
  }
  if (ctx.time !== null && !look.dimmed) {
    const born = ctx.derived.bornAt(page);
    if (born !== null && ctx.time - born <= newbornWindow(ctx.derived.timeRange)) {
      look.forceLabel = true;
      look.sizeBoost = Math.max(look.sizeBoost, 3);
      look.z = Math.max(look.z, 3);
    }
  }
  if (page.id === ctx.selected) {
    look.sizeBoost = Math.max(look.sizeBoost, 2);
    look.z = 4;
  }
  return look;
}

/** Color of a visible edge given the current focus / lens. */
export function edgeColor(attrs: EdgeAttrs, typed: boolean, source: string, target: string, ctx: StyleContext): { color: string; dimmed: boolean } {
  let color = typed ? (ctx.settings.showAsymmetric && attrs.asymmetric ? ctx.palette.status.warning : ctx.palette.typedEdge) : ctx.palette.bodyEdge;
  let dimmed = false;
  if (ctx.highlight) {
    if (ctx.highlight.ranks[source] === undefined || ctx.highlight.ranks[target] === undefined) dimmed = true;
  } else {
    const focus = ctx.hovered ?? ctx.selected;
    if (focus && ctx.visible.has(focus) && source !== focus && target !== focus) dimmed = true;
  }
  if (dimmed) color = ctx.palette.dimEdge;
  return { color, dimmed };
}
