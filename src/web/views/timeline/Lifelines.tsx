import * as Plot from '@observablehq/plot';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KIND_LABELS } from '../../../shared/model.ts';
import { plural } from '../../app/format.ts';
import type { Palette } from '../../app/palette.ts';
import { useStore } from '../../app/store.ts';
import { PlotFigure } from '../../components/PlotFigure.tsx';
import { dayMarker, groupColor } from './chart.ts';
import { dayStart, formatDay, GROUP_LABELS, GROUPS, monthTickLabel, monthTicks, type Lifeline, type TimelineData } from './data.ts';
import { useWidth } from './useWidth.ts';

const ROW = 14;
const PAD = 4;
const RIGHT = 16;
const LABEL_SIZE = 11;
const TOOLTIP_WIDTH = 300;

interface Hover {
  row: Lifeline;
  index: number;
  /** Open the tooltip below the row (the row sits in the upper half of the scroll box). */
  below: boolean;
}

interface LifelinesProps {
  data: TimelineData;
  palette: Palette;
  day: string | null;
}

/** One row per page, sorted by birth: a bar from the first commit to the last change. */
export function Lifelines({ data, palette, day }: LifelinesProps) {
  const selected = useStore((s) => s.selected);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Measured inside the scroll box, so a classic scrollbar does not shift the time scale.
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const gutter = width >= 640 ? 200 : 136;
  const domain = useMemo(() => [new Date(data.start), new Date(data.end)], [data]);
  const ticks = useMemo(() => monthTicks(data.start, data.end, Math.max(1, width - gutter - RIGHT)), [data, width, gutter]);
  const rowIndex = useMemo(() => new Map(data.lifelines.map((row, i) => [row, i])), [data]);

  const axisOptions = useMemo(
    (): Plot.PlotOptions | null =>
      width <= 0
        ? null
        : {
            width,
            height: 26,
            marginTop: 24,
            marginRight: RIGHT,
            marginBottom: 2,
            marginLeft: gutter,
            x: { type: 'time', domain },
            marks: [Plot.axisX({ anchor: 'top', ticks, tickFormat: monthTickLabel, tickSize: 0, tickPadding: 8, label: null })],
          },
    [width, gutter, domain, ticks],
  );

  // `selected` is in the deps so a click rebuilds the figure (resetting Plot's sticky pointer).
  const options = useMemo((): Plot.PlotOptions | null => {
    if (width <= 0) return null;
    const rows = data.lifelines;
    const live = rows.filter((r) => !r.deleted);
    const gone = rows.filter((r) => r.deleted);
    const current = rows.filter((r) => r.id === selected);
    const marker = day ? dayMarker(dayStart(day)) : null;
    const [from, to] = domain;
    // Row bands reach into the label gutter, so the whole row reads as one target.
    const fullRow = { y: 'id', x1: () => from, x2: () => to, insetTop: -3, insetBottom: -3, insetLeft: -(gutter - 4) };
    const label = {
      y: 'id',
      text: 'label',
      frameAnchor: 'left',
      textAnchor: 'end',
      dx: -10,
      fontSize: LABEL_SIZE,
      lineWidth: (gutter - 16) / LABEL_SIZE,
      textOverflow: 'ellipsis-end',
    } as const;
    return {
      width,
      height: rows.length * ROW + 2 * PAD,
      marginTop: PAD,
      marginRight: RIGHT,
      marginBottom: PAD,
      marginLeft: gutter,
      x: { type: 'time', domain, axis: null },
      y: { type: 'band', domain: rows.map((r) => r.id), padding: 0.3, axis: null },
      marks: [
        Plot.gridX({ ticks, stroke: palette.grid, strokeOpacity: 1 }),
        current.length ? Plot.barX(current, { ...fullRow, fill: palette.ink, fillOpacity: 0.08 }) : null,
        // The only pointer mark: its datum drives both the HTML tooltip and click-to-select.
        // All rows share one anchor x, so an unbounded radius picks the nearest row by y anywhere.
        Plot.barX(rows, Plot.pointerY({ ...fullRow, fill: palette.ink, fillOpacity: 0.05, maxRadius: Infinity })),
        marker ? Plot.ruleX([marker], { stroke: palette.ink, strokeWidth: 1 }) : null,
        // Negative insets give same-day lifelines a visible 3px sliver without moving their dates.
        Plot.barX(live, { y: 'id', x1: 'born', x2: 'end', fill: (d: Lifeline) => groupColor(palette, d.group), insetLeft: -1.5, insetRight: -1.5, r: 2 }),
        Plot.barX(gone, {
          y: 'id',
          x1: 'born',
          x2: 'end',
          fill: palette.surface,
          stroke: (d: Lifeline) => groupColor(palette, d.group),
          strokeWidth: 1.25,
          insetLeft: -1.5,
          insetRight: -1.5,
          r: 2,
        }),
        Plot.dot(gone, { y: 'id', x: 'end', symbol: 'times', r: 3.5, stroke: palette.ink2, strokeWidth: 1.5 }),
        Plot.text(
          rows.filter((r) => r.id !== selected),
          { ...label, fill: (d: Lifeline) => (d.deleted ? palette.ink3 : palette.ink2) },
        ),
        current.length ? Plot.text(current, { ...label, fill: palette.ink, fontWeight: 700 }) : null,
      ],
    };
  }, [width, gutter, data, domain, ticks, palette, day, selected]);

  // Plot announces the pointed row with a bubbling `input` event on the figure.
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const onInput = (event: Event): void => {
      const value = (event.target as { value?: unknown }).value as Lifeline | null | undefined;
      const index = value ? rowIndex.get(value) : undefined;
      if (!value || index === undefined) {
        setHover(null);
        return;
      }
      const box = scrollRef.current;
      const center = PAD + index * ROW + ROW / 2;
      const below = !box || center < box.scrollTop + box.clientHeight / 2;
      setHover({ row: value, index, below });
    };
    host.addEventListener('input', onInput);
    return () => host.removeEventListener('input', onInput);
  }, [ref, rowIndex]);

  // Bring a page selected elsewhere (feed, search) into the scroll box.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || !selected) return;
    const index = data.lifelines.findIndex((r) => r.id === selected);
    if (index < 0) return;
    const top = PAD + index * ROW;
    if (top < box.scrollTop + ROW || top > box.scrollTop + box.clientHeight - 2 * ROW) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2), behavior: 'smooth' });
    }
  }, [selected, data]);

  const onSelect = (datum: unknown): void => {
    const row = rowIndex.has(datum as Lifeline) ? (datum as Lifeline) : null;
    if (row && !row.deleted) useStore.getState().select(row.id);
  };

  return (
    <div className="timeline-lifelines">
      <ul className="timeline-legend" aria-label="Legend">
        {GROUPS.map((g) => (
          <li key={g} className="timeline-legend-item">
            <span className="timeline-legend-swatch" style={{ background: groupColor(palette, g) }} />
            <span className="timeline-legend-label">{g === 'other' ? 'Other (meta, fold, nav)' : GROUP_LABELS[g]}</span>
          </li>
        ))}
        <li className="timeline-legend-item">
          <svg className="timeline-legend-ghost" width="30" height="12" viewBox="0 0 30 12" aria-hidden="true">
            <rect x="1" y="2.5" width="19" height="7" rx="2" fill="none" stroke={palette.ink3} strokeWidth="1.25" />
            <path d="M23 3 L29 9 M29 3 L23 9" stroke={palette.ink2} strokeWidth="1.5" />
          </svg>
          <span className="timeline-legend-label">Deleted page</span>
        </li>
      </ul>
      <div className="timeline-plot timeline-lifelines-axis">{axisOptions && <PlotFigure options={axisOptions} />}</div>
      <div ref={scrollRef} className="timeline-lifelines-scroll">
        <div ref={ref} className="timeline-plot timeline-lifelines-chart">
          {options && <PlotFigure options={options} onSelect={onSelect} />}
          {hover && width > 0 && <LifelineTooltip hover={hover} data={data} palette={palette} width={width} gutter={gutter} />}
        </div>
      </div>
    </div>
  );
}

function LifelineTooltip({ hover, data, palette, width, gutter }: { hover: Hover; data: TimelineData; palette: Palette; width: number; gutter: number }) {
  const { row, index, below } = hover;
  const span = Math.max(1, data.end - data.start);
  const x = gutter + ((row.end - data.start) / span) * (width - gutter - RIGHT);
  const rowTop = PAD + index * ROW;
  const toRight = x + 12 + TOOLTIP_WIDTH <= width;
  const style = {
    top: below ? rowTop + ROW + 4 : undefined,
    bottom: below ? undefined : data.lifelines.length * ROW + 2 * PAD - rowTop + 4,
    left: toRight ? Math.max(8, x + 12) : undefined,
    right: toRight ? undefined : Math.max(8, width - x + 12),
  };
  return (
    <div className="timeline-tooltip" style={style} role="tooltip">
      <div className="timeline-tooltip-title">
        {row.label}
        {row.deleted && <span className="timeline-tooltip-tag">deleted</span>}
      </div>
      {row.title && <div className="timeline-tooltip-sub">{row.title}</div>}
      {row.deleted && row.id !== row.label && <div className="timeline-tooltip-sub mono">{row.id}</div>}
      <div className="timeline-tooltip-meta">
        <span className="timeline-tooltip-swatch" style={{ background: groupColor(palette, row.group) }} />
        {row.kind ? KIND_LABELS[row.kind] : GROUP_LABELS[row.group]} · {plural(row.commits, 'commit')}
      </div>
      <div className="timeline-tooltip-meta">
        {formatDay(row.born)} → {row.deleted ? `deleted ${formatDay(row.end)}` : `last change ${formatDay(row.end)}`}
      </div>
      {!row.deleted && <div className="timeline-tooltip-hint">Click to open the page</div>}
    </div>
  );
}
