import { useEffect, useMemo, useRef, useState } from 'react';
import { useDerived } from '../../app/derived.ts';
import { formatDate, formatNumber } from '../../app/format.ts';
import { useStore } from '../../app/store.ts';

const WEEK = 7 * 86_400_000;
const SPEEDS = [
  { ms: 12_000, label: '12 s' },
  { ms: 25_000, label: '25 s' },
  { ms: 60_000, label: '1 min' },
];

/**
 * Time travel: replay the vault growing. Pages appear when they were first
 * committed, links when git first saw them written.
 */
export function TimeBar({ visibleNodes, visibleEdges }: { visibleNodes: number; visibleEdges: number }) {
  const derived = useDerived();
  const time = useStore((s) => s.timeCursor);
  const setTime = useStore((s) => s.setTimeCursor);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(25_000);
  const range = derived?.timeRange ?? null;
  const rangeRef = useRef(range);
  rangeRef.current = range;

  // Weekly commit counts drawn behind the slider, so bursts of work are visible.
  const weeks = useMemo(() => {
    if (!derived || !range) return [];
    const counts = new Array<number>(Math.max(1, Math.ceil((range[1] - range[0]) / WEEK))).fill(0);
    for (const c of derived.model.commits) {
      const i = Math.min(counts.length - 1, Math.floor((Date.parse(c.date) - range[0]) / WEEK));
      if (i >= 0) counts[i] = (counts[i] ?? 0) + 1;
    }
    return counts;
  }, [derived, range]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let lastEmit = 0;
    let cursor = useStore.getState().timeCursor ?? rangeRef.current?.[0] ?? 0;
    const tick = (now: number): void => {
      // Something else (Focus in graph, a vault switch) cleared the cursor: stop, do not overwrite it.
      if (useStore.getState().timeCursor === null) {
        setPlaying(false);
        return;
      }
      const r = rangeRef.current;
      if (!r) return;
      const dt = now - last;
      last = now;
      cursor = Math.max(cursor, r[0]) + ((r[1] - r[0]) * dt) / duration;
      if (cursor >= r[1]) {
        setTime(r[1]);
        setPlaying(false);
        return;
      }
      // ~25 store updates per second are plenty for the eye and cheap for the graph.
      if (now - lastEmit > 40) {
        lastEmit = now;
        setTime(cursor);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, setTime]);

  if (!derived || !range) return null;
  const active = time !== null || playing;

  if (!active) {
    return (
      <button
        type="button"
        className="btn timebar-launch"
        onClick={() => {
          setTime(range[0]);
          setPlaying(true);
        }}
        title="Replay how the vault grew, from the first commit to today"
      >
        ▶ Time travel
      </button>
    );
  }

  const cursor = time ?? range[0];
  const max = Math.max(1, ...weeks);
  const progress = (cursor - range[0]) / (range[1] - range[0]);

  return (
    <div className="timebar card" role="group" aria-label="Time travel">
      <button
        type="button"
        className="btn btn-small timebar-play"
        onClick={() => {
          if (!playing && cursor >= range[1]) setTime(range[0]);
          setPlaying(!playing);
        }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="timebar-date">{formatDate(new Date(cursor).toISOString())}</div>
      <div className="timebar-track">
        <svg className="timebar-hist" viewBox={`0 0 ${weeks.length} 20`} preserveAspectRatio="none" aria-hidden="true">
          {weeks.map((n, i) => (
            <rect
              key={i}
              x={i + 0.12}
              width={0.76}
              y={20 - (n / max) * 20}
              height={(n / max) * 20}
              className={i / weeks.length <= progress ? 'past' : 'future'}
            />
          ))}
        </svg>
        <input
          type="range"
          className="timebar-range"
          min={range[0]}
          max={range[1]}
          step={3_600_000}
          value={cursor}
          aria-label="Date"
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
        />
      </div>
      <div className="timebar-counts">
        {formatNumber(visibleNodes)} pages · {formatNumber(visibleEdges)} edges
      </div>
      <select className="select timebar-speed" value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Replay duration">
        {SPEEDS.map((s) => (
          <option key={s.ms} value={s.ms}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-ghost btn-small"
        onClick={() => {
          setPlaying(false);
          setTime(null);
        }}
        aria-label="Back to today"
        title="Back to today"
      >
        ×
      </button>
    </div>
  );
}
