import * as Plot from '@observablehq/plot';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { formatNumber } from '../../app/format.ts';
import type { Palette } from '../../app/palette.ts';
import { usePalette } from '../../app/theme.ts';
import { PlotFigure } from '../../components/PlotFigure.tsx';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Trailing part of `value` in a lint state, drawn in the warning color. */
  flagged?: number;
  /** Identity color of a dot beside the label (page kinds). */
  dot?: string;
}

const FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_VALUE = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
/** Height of one category row; the bar takes 64% of it (≈15px), the rest is air. */
const ROW = 24;
const BAR_SHARE = 0.64;

let measureContext: CanvasRenderingContext2D | null = null;

function textWidth(text: string, font: string): number {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * 7;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

function fitText(text: string, max: number): string {
  if (textWidth(text, FONT) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(`${text.slice(0, mid)}…`, FONT) <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

/** Content width of an element, tracked with a ResizeObserver. */
function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.clientWidth));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function barOptions(rows: BarDatum[], width: number, fill: string, palette: Palette, ariaLabel: string): Plot.PlotOptions {
  const dotSpace = rows.some((r) => r.dot) ? 16 : 0;
  const labelMax = Math.max(40, Math.min(width * 0.4, Math.max(...rows.map((r) => textWidth(r.label, FONT)))));
  const marginLeft = Math.ceil(dotSpace + labelMax + 14);
  const marginRight = Math.ceil(Math.max(...rows.map((r) => textWidth(formatNumber(r.value), FONT_VALUE))) + 14);
  const xMax = Math.max(1, ...rows.map((r) => r.value));
  const air = (ROW * (1 - BAR_SHARE)) / 2;

  const plain = rows.filter((r) => !r.flagged);
  const mixed = rows.filter((r) => r.flagged && r.flagged < r.value);
  const allFlagged = rows.filter((r) => r.flagged && r.flagged >= r.value);
  const okEnd = (r: BarDatum): number => r.value - (r.flagged ?? 0);

  return {
    width,
    height: rows.length * ROW,
    marginTop: 0,
    marginBottom: 0,
    marginLeft,
    marginRight,
    ariaLabel,
    x: { domain: [0, xMax], axis: null },
    // Outer padding = half the inner one, so each row is exactly ROW tall.
    y: { domain: rows.map((r) => r.key), axis: null, paddingInner: 1 - BAR_SHARE, paddingOuter: (1 - BAR_SHARE) / 2, round: false },
    color: { type: 'identity' },
    marks: [
      // Row wash: the pointer target for the tooltip and clicks (the whole row, label included).
      Plot.barX(
        rows,
        Plot.pointerY({
          x1: () => 0,
          x2: () => xMax,
          y: 'key',
          fill: palette.ink,
          fillOpacity: 0.06,
          r: 4,
          insetLeft: -(marginLeft - 4),
          insetRight: -(marginRight - 4),
          insetTop: -air,
          insetBottom: -air,
          maxRadius: 100_000,
        }),
      ),
      Plot.ruleX([0], { stroke: palette.baseline }),
      Plot.barX(plain, { x1: () => 0, x2: 'value', y: 'key', fill, rx2: 4 }),
      Plot.barX(mixed, { x1: () => 0, x2: okEnd, y: 'key', fill }),
      // 2px surface gap between the two segments of a split bar.
      Plot.barX(mixed, { x1: okEnd, x2: 'value', y: 'key', fill: palette.status.warning, rx2: 4, insetLeft: 2 }),
      Plot.barX(allFlagged, { x1: () => 0, x2: 'value', y: 'key', fill: palette.status.warning, rx2: 4 }),
      Plot.text(rows, {
        x: 'value',
        y: 'key',
        text: (r: BarDatum) => formatNumber(r.value),
        dx: 6,
        textAnchor: 'start',
        fill: palette.ink,
        fontWeight: 600,
      }),
      Plot.text(rows, {
        y: 'key',
        frameAnchor: 'left',
        dx: -marginLeft + dotSpace + 2,
        textAnchor: 'start',
        text: (r: BarDatum) => fitText(r.label, labelMax),
        fill: 'currentColor',
      }),
      Plot.dot(
        rows.filter((r) => r.dot),
        { y: 'key', frameAnchor: 'left', dx: -marginLeft + 6, r: 4, fill: (r: BarDatum) => r.dot, stroke: null },
      ),
    ],
  };
}

interface Hover<T> {
  row: T;
  x: number;
  y: number;
}

/**
 * Horizontal bars for one nominal series (one hue), value at the tip, an
 * optional warning segment for a lint share, and a per-row hover tooltip.
 */
export function HBarChart<T extends BarDatum>({
  rows,
  fill,
  ariaLabel,
  tooltip,
  onPick,
}: {
  rows: T[];
  fill: string;
  ariaLabel: string;
  tooltip: (row: T) => ReactNode;
  onPick?: (row: T) => void;
}) {
  const palette = usePalette();
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef);
  const [hover, setHover] = useState<Hover<T> | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let last = { x: 0, y: 0 };
    // Capture phase: runs before Plot's own listeners, so the position is current when its `input` fires.
    const onMove = (e: PointerEvent): void => {
      const box = el.getBoundingClientRect();
      last = { x: e.clientX - box.left, y: e.clientY - box.top };
      setHover((h) => (h ? { ...h, ...last } : h));
    };
    const onInput = (e: Event): void => {
      const value = (e.target as { value?: unknown } | null)?.value;
      const row = rowsRef.current.find((r) => r === value);
      setHover(row ? { row, ...last } : null);
    };
    const onLeave = (): void => setHover(null);
    // Plot pins the pointer on pointerdown ("sticky"); keep hover transient instead.
    const unpin = (e: PointerEvent): void => e.stopPropagation();
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerdown', unpin, true);
    el.addEventListener('input', onInput);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerdown', unpin, true);
      el.removeEventListener('input', onInput);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const options = useMemo(
    () => (width > 0 && rows.length ? barOptions(rows, width, fill, palette, ariaLabel) : null),
    [rows, width, fill, palette, ariaLabel],
  );

  const onSelect = onPick
    ? (datum: unknown): void => {
        const row = rowsRef.current.find((r) => r === datum);
        if (row) onPick(row);
      }
    : undefined;

  const flipX = hover !== null && hover.x > width / 2;
  const flipY = hover !== null && hover.y > (rows.length * ROW) / 2;

  return (
    <div ref={wrapRef} className={`overview-chart${onPick ? ' is-pickable' : ''}`} style={{ minHeight: rows.length * ROW }}>
      {options && <PlotFigure options={options} onSelect={onSelect} />}
      {hover && (
        <div
          className="overview-tip"
          role="tooltip"
          style={{
            left: hover.x + (flipX ? -12 : 12),
            top: hover.y + (flipY ? -12 : 12),
            transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
          }}
        >
          {tooltip(hover.row)}
        </div>
      )}
    </div>
  );
}

/** Tooltip body: the value leads, the category follows. */
export function TipBody({ value, unit, label, children, hint }: { value: number; unit: string; label: ReactNode; children?: ReactNode; hint?: string }) {
  return (
    <>
      <div className="overview-tip-value">
        {formatNumber(value)} <span className="overview-tip-unit">{unit}</span>
      </div>
      <div className="overview-tip-label">{label}</div>
      {children}
      {hint && <div className="overview-tip-hint">{hint}</div>}
    </>
  );
}

export interface TableColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
}

/** The chart's table twin: every value readable without hovering, every action reachable by keyboard. */
export function BarTable<T extends BarDatum>({
  rows,
  labelHeader,
  valueHeader,
  columns = [],
  onPick,
  pickTitle,
}: {
  rows: T[];
  labelHeader: string;
  valueHeader: string;
  columns?: TableColumn<T>[];
  onPick?: (row: T) => void;
  pickTitle?: string;
}) {
  return (
    <div className="overview-table-wrap">
      <table className="overview-table">
        <thead>
          <tr>
            <th scope="col">{labelHeader}</th>
            <th scope="col" className="num">
              {valueHeader}
            </th>
            {columns.map((c) => (
              <th key={c.header} scope="col" className="num">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                <span className="overview-table-label">
                  {row.dot && <span className="overview-dot" style={{ background: row.dot }} aria-hidden="true" />}
                  {onPick ? (
                    <button type="button" className="overview-table-pick" title={pickTitle} onClick={() => onPick(row)}>
                      {row.label}
                    </button>
                  ) : (
                    row.label
                  )}
                </span>
              </th>
              <td className="num">{formatNumber(row.value)}</td>
              {columns.map((c) => (
                <td key={c.header} className="num">
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A chart card with a title, an optional legend and a chart ↔ table toggle. */
export function ChartCard({
  title,
  subtitle,
  legend,
  chart,
  table,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  className?: string;
}) {
  const [mode, setMode] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`card overview-card${className ? ` ${className}` : ''}`} aria-label={title}>
      <header className="overview-card-head">
        <div className="overview-card-heading">
          <h3 className="overview-card-title">{title}</h3>
          {subtitle && <p className="overview-card-sub">{subtitle}</p>}
        </div>
        <div className="segmented overview-toggle" role="radiogroup" aria-label={`Show ${title.toLowerCase()} as`}>
          {(['chart', 'table'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m === 'chart' ? 'Chart' : 'Table'}
            </button>
          ))}
        </div>
      </header>
      {legend}
      {mode === 'chart' ? chart : table}
    </section>
  );
}
