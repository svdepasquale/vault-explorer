import * as Plot from '@observablehq/plot';
import { useMemo } from 'react';
import type { Commit } from '../../../shared/model.ts';
import { plural } from '../../app/format.ts';
import type { Palette } from '../../app/palette.ts';
import { PlotFigure } from '../../components/PlotFigure.tsx';
import { hasField } from './chart.ts';
import { activityBuckets, bucketLabel, bucketOf, formatWeekday, type DayCell, type TimelineData } from './data.ts';
import { useWidth } from './useWidth.ts';

const MARGIN = { top: 22, right: 2, bottom: 2, left: 34 };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS = [0, 1, 2, 3, 4, 5, 6];
const SUBJECTS_IN_TIP = 3;

/**
 * Ramp steps for the non-zero buckets. The two palest steps are skipped so a
 * one-commit day still separates from the neutral no-commit cell; in dark mode
 * the ramp is already flipped, so "palest" means closest to the surface.
 */
function bucketColors(palette: Palette, buckets: number): string[] {
  const steps = palette.sequential;
  const lo = 2;
  const hi = steps.length - 1;
  return Array.from({ length: buckets }, (_, i) => {
    const step = buckets === 1 ? hi : Math.round(lo + (i * (hi - lo)) / (buckets - 1));
    return steps[step] ?? palette.accent;
  });
}

function tipText(cell: DayCell, commits: readonly Commit[]): string {
  const head = formatWeekday(cell.time);
  if (!cell.count) return `${head}\nNo commits`;
  const subjects = cell.commits.slice(0, SUBJECTS_IN_TIP).map((i) => `· ${commits[i]?.subject ?? ''}`);
  const more = cell.count > SUBJECTS_IN_TIP ? [`+ ${cell.count - SUBJECTS_IN_TIP} more`] : [];
  return [head, plural(cell.count, 'commit'), ...subjects, ...more].join('\n');
}

export interface ActivityCalendarProps {
  data: TimelineData;
  commits: readonly Commit[];
  palette: Palette;
  day: string | null;
  onDay: (day: string | null) => void;
}

/** GitHub-style heatmap: one cell per local day, Monday-first weeks as columns. */
export function ActivityCalendar({ data, commits, palette, day, onDay }: ActivityCalendarProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const bounds = useMemo(() => activityBuckets(data.maxPerDay), [data.maxPerDay]);
  const colors = useMemo(() => bucketColors(palette, bounds.length), [palette, bounds.length]);

  // The selected day is part of the options on purpose: the figure is rebuilt
  // after every click, which also resets Plot's sticky-tip state.
  const options = useMemo((): Plot.PlotOptions | null => {
    if (width <= 0) return null;
    const cell = Math.max(11, Math.min(30, Math.floor((width - MARGIN.left - MARGIN.right) / data.weeks)));
    const selected = day ? data.dayIndex.get(day) : undefined;
    const fill = (d: DayCell): string => {
      const bucket = bucketOf(d.count, bounds);
      return bucket < 0 ? palette.grid : (colors[bucket] ?? palette.accent);
    };
    return {
      width: data.weeks * cell + MARGIN.left + MARGIN.right,
      height: 7 * cell + MARGIN.top + MARGIN.bottom,
      marginTop: MARGIN.top,
      marginRight: MARGIN.right,
      marginBottom: MARGIN.bottom,
      marginLeft: MARGIN.left,
      x: { type: 'band', domain: Array.from({ length: data.weeks }, (_, i) => i), padding: 0 },
      y: { type: 'band', domain: DAYS, padding: 0 },
      marks: [
        Plot.axisX({
          anchor: 'top',
          ticks: [...data.monthLabels.keys()],
          tickFormat: (week: number) => data.monthLabels.get(week) ?? '',
          tickSize: 0,
          tickPadding: 7,
          textAnchor: 'start',
          dx: -cell / 2 + 1,
          label: null,
        }),
        Plot.axisY({ ticks: [0, 2, 4], tickFormat: (d: number) => WEEKDAYS[d] ?? '', tickSize: 0, tickPadding: 6, label: null }),
        Plot.cell(data.days, { x: 'week', y: 'dow', fill, inset: 1, r: 3 }),
        selected ? Plot.cell([selected], { x: 'week', y: 'dow', fill: 'none', stroke: palette.ink, strokeWidth: 2, inset: 0, r: 4 }) : null,
        Plot.cell(data.days, Plot.pointer({ x: 'week', y: 'dow', fill: 'none', stroke: palette.ink2, strokeWidth: 1.5, inset: 0.75, r: 3.5 })),
        Plot.tip(
          data.days,
          Plot.pointer({ x: 'week', y: 'dow', title: (d: DayCell) => tipText(d, commits), lineWidth: 30, textOverflow: 'ellipsis-end' }),
        ),
      ],
    };
  }, [width, data, commits, palette, day, bounds, colors]);

  const onSelect = (datum: unknown): void => {
    if (!hasField(datum, 'key') || typeof datum.key !== 'string') return;
    onDay(datum.key === day ? null : datum.key);
  };

  return (
    <div className="timeline-calendar">
      <div ref={ref} className="timeline-calendar-plot timeline-plot">
        {options && <PlotFigure options={options} onSelect={onSelect} />}
      </div>
      <div className="timeline-scale" aria-label="Color scale: commits per day">
        <span className="timeline-scale-title">Commits per day</span>
        <span className="timeline-scale-item">
          <span className="timeline-swatch" style={{ background: palette.grid }} />0
        </span>
        {bounds.map((_, i) => (
          <span key={i} className="timeline-scale-item">
            <span className="timeline-swatch" style={{ background: colors[i] }} />
            {bucketLabel(bounds, i)}
          </span>
        ))}
      </div>
    </div>
  );
}
