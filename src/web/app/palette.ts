import type { PageKind, Severity } from '../../shared/model.ts';

/** Concrete colors for canvas/WebGL (sigma) and Plot; mirrors styles/tokens.css. */
export type ThemeName = 'light' | 'dark';

export interface Palette {
  plane: string;
  surface: string;
  ink: string;
  ink2: string;
  ink3: string;
  grid: string;
  baseline: string;
  /** De-emphasis fill for nodes/edges outside the current focus. */
  dim: string;
  // Edge colors are opaque, pre-blended over the surface: sigma's WebGL blending
  // treats colors as premultiplied, so rgba() edges add up to near-white.
  dimEdge: string;
  bodyEdge: string;
  typedEdge: string;
  kind: Record<PageKind, string>;
  /** Single-series emphasis hue (categorical slot 1). */
  accent: string;
  /** Blue sequential ramp for continuous magnitude (heatmaps), index 0 = near zero. */
  sequential: string[];
  /** Ordinal blue ramp for freshness buckets, stale → fresh (validated with --ordinal). */
  freshness: string[];
  status: { good: string; warning: string; serious: string; critical: string };
}

const SEQUENTIAL = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };

export const PALETTES: Record<ThemeName, Palette> = {
  light: {
    plane: '#f9f9f7',
    surface: '#fcfcfb',
    ink: '#0b0b0b',
    ink2: '#52514e',
    ink3: '#898781',
    grid: '#e1e0d9',
    baseline: '#c3c2b7',
    dim: '#e1e0d9',
    dimEdge: '#f2f2f1',
    bodyEdge: '#d7d6d5',
    typedEdge: '#7d7c79',
    kind: {
      entity: '#2a78d6',
      source: '#eda100',
      runbook: '#e87ba4',
      profile: '#008300',
      meta: '#898781',
      fold: '#898781',
      nav: '#898781',
    },
    accent: '#2a78d6',
    sequential: SEQUENTIAL,
    freshness: ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
    status: STATUS,
  },
  dark: {
    plane: '#0d0d0d',
    surface: '#1a1a19',
    ink: '#ffffff',
    ink2: '#c3c2b7',
    ink3: '#898781',
    grid: '#2c2c2a',
    baseline: '#383835',
    dim: '#2c2c2a',
    dimEdge: '#222221',
    bodyEdge: '#353532',
    typedEdge: '#83827b',
    kind: {
      entity: '#3987e5',
      source: '#c98500',
      runbook: '#d55181',
      profile: '#008300',
      meta: '#898781',
      fold: '#898781',
      nav: '#898781',
    },
    accent: '#3987e5',
    // Dark mode flips the sequential anchor: near-zero recedes into the dark surface.
    sequential: [...SEQUENTIAL].reverse(),
    freshness: ['#184f95', '#2a78d6', '#6da7ec', '#cde2fb'],
    status: STATUS,
  },
};

/** Kinds that carry their own hue; the rest share the gray "other" slot. */
export const COLORED_KINDS: readonly PageKind[] = ['entity', 'source', 'runbook', 'profile'];

export function severityColor(p: Palette, severity: Severity): string {
  return severity === 'error' ? p.status.critical : severity === 'warning' ? p.status.warning : p.ink3;
}

/** t in [0, 1] → step of the sequential ramp (0 = near zero, 1 = most). */
export function sequentialColor(p: Palette, t: number): string {
  const steps = p.sequential;
  const i = Math.round(Math.min(1, Math.max(0, t)) * (steps.length - 1));
  return steps[i] ?? steps[0] ?? '#888888';
}

/** Freshness buckets by days since the last update, stale → fresh, matching `Palette.freshness`. */
export const FRESHNESS_BUCKETS: readonly { label: string; maxDays: number }[] = [
  { label: 'older than 90 days', maxDays: Number.POSITIVE_INFINITY },
  { label: '31–90 days', maxDays: 90 },
  { label: '8–30 days', maxDays: 30 },
  { label: 'last 7 days', maxDays: 7 },
];

export function freshnessBucket(days: number): number {
  if (days <= 7) return 3;
  if (days <= 30) return 2;
  if (days <= 90) return 1;
  return 0;
}
