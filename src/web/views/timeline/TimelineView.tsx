import { useMemo, useState } from 'react';
import { useDerived } from '../../app/derived.ts';
import { daysAgo, formatNumber, plural } from '../../app/format.ts';
import { useStore } from '../../app/store.ts';
import { usePalette } from '../../app/theme.ts';
import { ActivityCalendar } from './ActivityCalendar.tsx';
import { buildTimeline, dayKey, dayStart, endOfDay, formatDay, startOfDay, type TimelineData, type TimelineStats } from './data.ts';
import { EventFeed } from './EventFeed.tsx';
import { LinksGrowthChart, PagesGrowthChart } from './GrowthCharts.tsx';
import { Lifelines } from './Lifelines.tsx';
import './timeline.css';

function StatStrip({ stats }: { stats: TimelineStats }) {
  const last = Date.parse(stats.lastCommit);
  const lastAgo = Math.round((startOfDay(Date.now()) - startOfDay(last)) / 86_400_000);
  const items: { label: string; value: string; note?: string }[] = [
    { label: 'First commit', value: formatDay(Date.parse(stats.firstCommit)) },
    { label: 'Last commit', value: formatDay(last), note: daysAgo(Math.max(0, lastAgo)) },
    { label: 'Commits', value: formatNumber(stats.commits) },
    { label: 'Active days', value: formatNumber(stats.activeDays), note: `of ${plural(stats.totalDays, 'day')}` },
    { label: 'Pages created', value: formatNumber(stats.pagesCreated), note: `${formatNumber(stats.pagesNow)} still in the vault` },
    { label: 'Pages deleted', value: formatNumber(stats.pagesDeleted) },
  ];
  return (
    <dl className="timeline-stats">
      {items.map((item) => (
        <div key={item.label} className="timeline-stat">
          <dt className="timeline-stat-label">{item.label}</dt>
          <dd className="timeline-stat-value">{item.value}</dd>
          {item.note && <dd className="timeline-stat-note">{item.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function TimeTravel({ data, day, onDay }: { data: TimelineData; day: string | null; onDay: (day: string | null) => void }) {
  const timeCursor = useStore((s) => s.timeCursor);
  const startKey = dayKey(data.start);

  const travel = (): void => {
    if (!day) return;
    const { setTimeCursor, setView } = useStore.getState();
    // End of the local day, so that day's own commits are part of the snapshot; today is just "now".
    setTimeCursor(day >= data.todayKey ? null : endOfDay(dayStart(day)));
    setView('graph');
  };

  return (
    <div className="timeline-travel">
      <label className="timeline-travel-label" htmlFor="timeline-travel-day">
        Time travel
      </label>
      <input
        id="timeline-travel-day"
        type="date"
        className="input timeline-date"
        min={startKey}
        max={data.todayKey}
        value={day ?? ''}
        onChange={(e) => {
          const value = e.target.value;
          if (!value) onDay(null);
          else if (value >= startKey && value <= data.todayKey) onDay(value);
        }}
      />
      <button type="button" className="btn btn-primary btn-small" disabled={!day} onClick={travel} title={day ? undefined : 'Pick a day in the calendar or in the date field'}>
        {day ? `Show graph as of ${formatDay(day)}` : 'Show graph as of…'}
      </button>
      {timeCursor !== null && (
        <span className="timeline-travel-state" role="status">
          Graph set to {formatDay(timeCursor)} ·{' '}
          <button type="button" className="btn-link" onClick={() => useStore.getState().setTimeCursor(null)}>
            back to now
          </button>
        </span>
      )}
    </div>
  );
}

export default function TimelineView() {
  const derived = useDerived();
  const palette = usePalette();
  const [pickedDay, setDay] = useState<string | null>(null);
  const data = useMemo(() => (derived ? buildTimeline(derived) : null), [derived]);

  if (!derived) return null;
  if (!data) {
    return (
      <div className="app-empty">
        <p className="app-empty-title">No history to show</p>
        <p className="app-empty-detail">The timeline is built from git commits that touch wiki/, and this vault has none{derived.model.vault.capabilities.git ? '' : ' (it is not a git repository)'}.</p>
      </div>
    );
  }

  // A day picked before a reload (or in another vault) may not exist any more.
  const day = pickedDay && data.dayIndex.has(pickedDay) ? pickedDay : null;
  const dayCell = day ? data.dayIndex.get(day) : undefined;

  return (
    <div className="timeline-root">
      <div className="timeline-page">
        <header className="timeline-header">
          <h1 className="timeline-title">How the memory evolved</h1>
          <p className="timeline-subtitle">Every commit that touched wiki/, from the first one to today. Dates are local.</p>
        </header>

        <StatStrip stats={data.stats} />

        <div className="timeline-grid">
          <section className="card timeline-card timeline-area-activity" aria-labelledby="timeline-activity-title">
            <header className="timeline-card-header">
              <div>
                <h2 className="timeline-card-title" id="timeline-activity-title">
                  Activity
                </h2>
                <p className="timeline-card-sub">Commits per day. Click a day to filter the events and set the time-travel date.</p>
              </div>
              {dayCell && (
                <div className="timeline-day-pick">
                  <span>
                    <strong>{formatDay(dayCell.time)}</strong> · {plural(dayCell.count, 'commit')}
                  </span>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setDay(null)}>
                    Clear
                  </button>
                </div>
              )}
            </header>
            <ActivityCalendar data={data} commits={derived.model.commits} palette={palette} day={day} onDay={setDay} />
            <TimeTravel data={data} day={day} onDay={setDay} />
          </section>

          <div className="timeline-area-feed">
            <EventFeed data={data} derived={derived} day={day} onDay={setDay} />
          </div>

          <section className="card timeline-card timeline-area-growth" aria-labelledby="timeline-growth-title">
            <header className="timeline-card-header">
              <div>
                <h2 className="timeline-card-title" id="timeline-growth-title">
                  Growth
                </h2>
                <p className="timeline-card-sub">How many pages and links the vault held, day by day. Two charts on one time axis, each with its own scale.</p>
              </div>
            </header>
            <PagesGrowthChart data={data} palette={palette} day={day} />
            <LinksGrowthChart data={data} palette={palette} day={day} />
          </section>

          <section className="card timeline-card timeline-area-lifelines" aria-labelledby="timeline-lifelines-title">
            <header className="timeline-card-header">
              <div>
                <h2 className="timeline-card-title" id="timeline-lifelines-title">
                  Page lifelines
                </h2>
                <p className="timeline-card-sub">
                  One row per page, oldest first: from its first commit to its last change. Deleted pages are hollow and end at their deletion.
                  Click a row to open the page.
                </p>
              </div>
            </header>
            <Lifelines data={data} palette={palette} day={day} />
          </section>
        </div>
      </div>
    </div>
  );
}
