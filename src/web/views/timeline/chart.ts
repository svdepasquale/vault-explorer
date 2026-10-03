import type { Palette } from '../../app/palette.ts';
import type { Group } from './data.ts';

/** Chart margins shared by the growth charts so their time axes line up. */
export const TIME_MARGIN = { top: 14, right: 52, bottom: 26, left: 40 } as const;

/** The four colored kinds keep their hue; the gray "other" slot is the meta gray. */
export function groupColor(palette: Palette, group: Group): string {
  return group === 'other' ? palette.kind.meta : palette.kind[group];
}

/** Narrows a datum handed back by PlotFigure's `onSelect`. */
export function hasField<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === 'object' && value !== null && key in value;
}

/** Noon of a local day: a marker there sits inside that day's step on a daily step curve. */
export function dayMarker(dayStartMs: number): Date {
  return new Date(dayStartMs + 12 * 3_600_000);
}
