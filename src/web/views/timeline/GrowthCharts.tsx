import * as Plot from '@observablehq/plot';
import { useMemo } from 'react';
import { formatNumber, plural } from '../../app/format.ts';
import type { Palette } from '../../app/palette.ts';
import { PlotFigure } from '../../components/PlotFigure.tsx';
import { dayMarker, groupColor, TIME_MARGIN } from './chart.ts';
import {
  dayStart,
  formatWeekday,
  GROUP_LABELS,
  GROUPS,
  monthTickLabel,
  monthTicks,
  type GrowthPoint,
  type LinkPoint,
  type TimelineData,
} from './data.ts';
import { useWidth } from './useWidth.ts';

const PAGES_HEIGHT = 230;
const LINKS_HEIGHT = 150;

function growthTip(p: GrowthPoint): string {
  return [formatWeekday(dayStart(p.key)), plural(p.total, 'page'), ...GROUPS.map((g) => `${GROUP_LABELS[g]} ${p[g]}`)].join('\n');
}

function linksTip(p: LinkPoint): string {
  return `${formatWeekday(dayStart(p.key))}\n${plural(p.count, 'link')} written`;
}

interface GrowthChartsProps {
  data: TimelineData;
  palette: Palette;
  day: string | null;
}

/** Shared frame of both growth charts: same domain, margins and month ticks. */
function useTimeFrame(data: TimelineData, width: number) {
  return useMemo(() => {
    const domain = [new Date(data.start), new Date(data.end)];
    const ticks = monthTicks(data.start, data.end, Math.max(1, width - TIME_MARGIN.left - TIME_MARGIN.right));
    return { domain, ticks };
  }, [data, width]);
}

function frameOptions(width: number, height: number, domain: Date[]): Plot.PlotOptions {
  return {
    width,
    height,
    marginTop: TIME_MARGIN.top,
    marginRight: TIME_MARGIN.right,
    marginBottom: TIME_MARGIN.bottom,
    marginLeft: TIME_MARGIN.left,
    x: { type: 'time', domain },
    y: { nice: true, zero: true },
  };
}

export function PagesGrowthChart({ data, palette, day }: GrowthChartsProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { domain, ticks } = useTimeFrame(data, width);
  const long = useMemo(() => data.growth.flatMap((p) => GROUPS.map((group) => ({ time: p.time, group, count: p[group] }))), [data]);

  const options = useMemo((): Plot.PlotOptions | null => {
    if (width <= 0) return null;
    const last = data.growth[data.growth.length - 1];
    const marker = day ? dayMarker(dayStart(day)) : null;
    const order = [...GROUPS];
    return {
      ...frameOptions(width, PAGES_HEIGHT, domain),
      // Fixed domain and order: a kind's color never depends on which kinds have pages yet.
      color: { domain: order, range: order.map((g) => groupColor(palette, g)) },
      marks: [
        Plot.gridY({ ticks: 5, stroke: palette.grid, strokeOpacity: 1 }),
        Plot.axisY({ ticks: 5, tickSize: 0, tickPadding: 8, label: null }),
        Plot.axisX({ ticks, tickFormat: monthTickLabel, tickSize: 0, tickPadding: 8, label: null }),
        Plot.areaY(long, { x: 'time', y: 'count', fill: 'group', order, curve: 'step-after', fillOpacity: 0.18 }),
        Plot.lineY(long, Plot.stackY2({ x: 'time', y: 'count', z: 'group', stroke: 'group', order, curve: 'step-after', strokeWidth: 1.5 })),
        Plot.ruleY([0], { stroke: palette.baseline }),
        marker ? Plot.ruleX([marker], { stroke: palette.ink, strokeWidth: 1 }) : null,
        last ? Plot.text([last], { x: 'time', y: 'total', text: (p: GrowthPoint) => formatNumber(p.total), dx: 6, textAnchor: 'start', fill: palette.ink2, fontWeight: 600 }) : null,
        Plot.ruleX(data.growth, Plot.pointerX({ x: 'time', stroke: palette.ink3, strokeWidth: 1 })),
        Plot.tip(data.growth, Plot.pointerX({ x: 'time', y: 'total', title: growthTip, lineWidth: 24 })),
      ],
    };
  }, [width, data, long, domain, ticks, palette, day]);

  const last = data.growth[data.growth.length - 1];
  return (
    <figure className="timeline-figure">
      <figcaption className="timeline-figure-caption">
        <span className="timeline-figure-title">Pages in the vault, by kind</span>
        <span className="timeline-figure-sub">Stacked at the end of each day; deleted pages leave the count on the day they go.</span>
      </figcaption>
      <ul className="timeline-legend" aria-label="Kinds">
        {GROUPS.map((g) => (
          <li key={g} className="timeline-legend-item" title={g === 'other' ? 'Meta, fold and navigation pages' : undefined}>
            <span className="timeline-legend-swatch" style={{ background: groupColor(palette, g) }} />
            <span className="timeline-legend-label">{g === 'other' ? 'Other (meta, fold, nav)' : GROUP_LABELS[g]}</span>
            <span className="timeline-legend-count">{last ? formatNumber(last[g]) : ''}</span>
          </li>
        ))}
      </ul>
      <div ref={ref} className="timeline-plot">
        {options && <PlotFigure options={options} />}
      </div>
    </figure>
  );
}

export function LinksGrowthChart({ data, palette, day }: GrowthChartsProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { domain, ticks } = useTimeFrame(data, width);

  const options = useMemo((): Plot.PlotOptions | null => {
    if (width <= 0) return null;
    const last = data.links[data.links.length - 1];
    const marker = day ? dayMarker(dayStart(day)) : null;
    return {
      ...frameOptions(width, LINKS_HEIGHT, domain),
      marks: [
        Plot.gridY({ ticks: 3, stroke: palette.grid, strokeOpacity: 1 }),
        Plot.axisY({ ticks: 3, tickSize: 0, tickPadding: 8, label: null }),
        Plot.axisX({ ticks, tickFormat: monthTickLabel, tickSize: 0, tickPadding: 8, label: null }),
        Plot.areaY(data.links, { x: 'time', y: 'count', fill: palette.accent, fillOpacity: 0.1, curve: 'step-after' }),
        Plot.lineY(data.links, { x: 'time', y: 'count', stroke: palette.accent, strokeWidth: 2, curve: 'step-after' }),
        Plot.ruleY([0], { stroke: palette.baseline }),
        marker ? Plot.ruleX([marker], { stroke: palette.ink, strokeWidth: 1 }) : null,
        last ? Plot.text([last], { x: 'time', y: 'count', text: (p: LinkPoint) => formatNumber(p.count), dx: 6, textAnchor: 'start', fill: palette.ink2, fontWeight: 600 }) : null,
        Plot.ruleX(data.links, Plot.pointerX({ x: 'time', stroke: palette.ink3, strokeWidth: 1 })),
        Plot.tip(data.links, Plot.pointerX({ x: 'time', y: 'count', title: linksTip })),
      ],
    };
  }, [width, data, domain, ticks, palette, day]);

  return (
    <figure className="timeline-figure">
      <figcaption className="timeline-figure-caption">
        <span className="timeline-figure-title">Links written, cumulative</span>
        <span className="timeline-figure-sub">
          Today’s wikilinks between pages, counted from the commit that first wrote each one
          {data.linksUndated > 0 ? ` (${plural(data.linksUndated, 'link')} with no date left out)` : ''}.
        </span>
      </figcaption>
      <div ref={ref} className="timeline-plot">
        {options && <PlotFigure options={options} />}
      </div>
    </figure>
  );
}
