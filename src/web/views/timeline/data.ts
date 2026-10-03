import type { Commit, PageKind, VaultModel } from '../../../shared/model.ts';
import type { Derived } from '../../app/derived.ts';
import { shortLabel } from '../../app/format.ts';

// Pure timeline computations over the model: no React, no palette, local dates throughout.

/** Kind groups of the timeline: the four colored kinds plus one gray bucket for meta, fold and nav. */
export const GROUPS = ['entity', 'source', 'runbook', 'profile', 'other'] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABELS: Record<Group, string> = {
  entity: 'Entity',
  source: 'Source',
  runbook: 'Runbook',
  profile: 'Profile',
  other: 'Other',
};

export function isGroup(value: string): value is Group {
  return (GROUPS as readonly string[]).includes(value);
}

export function groupOfKind(kind: PageKind): Group {
  return kind === 'entity' || kind === 'source' || kind === 'runbook' || kind === 'profile' ? kind : 'other';
}

const NAV_IDS = new Set(['index', 'hot', 'log', 'overview']);

/**
 * Folder-only mirror of `pageKind` in src/core/model.ts. Deleted pages have no
 * frontmatter left to read, so `type:` overrides cannot apply to them.
 */
export function groupOfPath(id: string): Group {
  const slash = id.lastIndexOf('/');
  const folder = slash >= 0 ? id.slice(0, slash) : '';
  const stem = id.slice(slash + 1);
  if (stem === '_index' || NAV_IDS.has(id)) return 'other';
  if (folder === 'meta/profile' || folder.startsWith('meta/profile/')) return 'profile';
  const top = folder.split('/')[0];
  if (top === 'runbooks') return 'runbook';
  if (top === 'entities') return 'entity';
  if (top === 'sources') return 'source';
  return 'other';
}

// ── local calendar days ────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of the local calendar day containing `ms`. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a `YYYY-MM-DD` key, or NaN when the key is malformed. */
export function dayStart(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return Number.NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Calendar arithmetic through Date, so DST days of 23 or 25 hours stay whole days. */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Monday 0 … Sunday 6. */
export function weekday(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

/** `27 Sep 2026` for a day key or an epoch. */
export function formatDay(day: string | number): string {
  const ms = typeof day === 'string' ? dayStart(day) : day;
  return Number.isNaN(ms) ? String(day) : DAY_FORMAT.format(ms);
}

/** `Sun, 27 Sep 2026` → `Sun 27 Sep 2026`. */
export function formatWeekday(ms: number): string {
  return WEEKDAY_FORMAT.format(ms).replace(',', '');
}

export function formatTime(ms: number): string {
  return TIME_FORMAT.format(ms);
}

export function formatMonth(ms: number, withYear: boolean): string {
  return (withYear ? MONTH_YEAR_FORMAT : MONTH_FORMAT).format(ms);
}

/**
 * Month starts inside [start, end], thinned so ticks stay at least `minGap`
 * pixels apart for a time axis `width` pixels wide.
 */
export function monthTicks(start: number, end: number, width: number, minGap = 64): Date[] {
  const months: Date[] = [];
  const d = new Date(start);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() < start) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= end) {
    months.push(new Date(d));
    d.setMonth(d.getMonth() + 1);
  }
  const span = Math.max(1, end - start);
  const perMonth = (width * 30.4 * 86_400_000) / span;
  const step = [1, 2, 3, 6, 12].find((s) => s * perMonth >= minGap) ?? 12;
  return months.filter((m) => m.getMonth() % step === 0 || step === 1);
}

/** Month label for a tick: the year rides on January and on the first tick. */
export function monthTickLabel(value: Date | number, index: number): string {
  const ms = typeof value === 'number' ? value : value.getTime();
  return formatMonth(ms, index === 0 || new Date(ms).getMonth() === 0);
}

// ── the timeline model ─────────────────────────────────────────────────────

export interface DayCell {
  key: string;
  /** Local midnight. */
  time: number;
  /** Column: Monday-first weeks since the week of the first commit. */
  week: number;
  /** Row: Monday 0 … Sunday 6. */
  dow: number;
  count: number;
  /** Indices into `model.commits`, oldest first. */
  commits: number[];
}

export type GroupCounts = Record<Group, number>;

/** Pages alive at the end of a day, per kind group (one row per day: every series at one x). */
export interface GrowthPoint extends GroupCounts {
  /** Local midnight of the day; the last point sits at the end of the range. */
  time: number;
  key: string;
  total: number;
}

export interface LinkPoint {
  time: number;
  key: string;
  count: number;
}

export interface Lifeline {
  /** Page id, or the deleted page's former id. */
  id: string;
  label: string;
  title: string | null;
  group: Group;
  kind: PageKind | null;
  born: number;
  /** Last change for live pages, deletion for ghosts. */
  end: number;
  deleted: boolean;
  commits: number;
}

export interface TimelineStats {
  firstCommit: string;
  lastCommit: string;
  commits: number;
  activeDays: number;
  totalDays: number;
  /** Every page that ever existed: the live ones plus the deleted ones. */
  pagesCreated: number;
  pagesDeleted: number;
  pagesNow: number;
}

export interface TimelineData {
  /** Local midnight of the first commit's day. */
  start: number;
  /** End of today (local). */
  end: number;
  todayKey: string;
  days: DayCell[];
  dayIndex: Map<string, DayCell>;
  weeks: number;
  /** Week column → month label, for the calendar's top axis. */
  monthLabels: Map<number, string>;
  maxPerDay: number;
  growth: GrowthPoint[];
  links: LinkPoint[];
  linksUndated: number;
  lifelines: Lifeline[];
  /** Per commit index: its local day key. */
  commitDay: string[];
  /** Per commit index: the kind groups of the pages it changed. */
  commitGroups: Set<Group>[];
  stats: TimelineStats;
}

function emptyCounts(): GroupCounts {
  return { entity: 0, source: 0, runbook: 0, profile: 0, other: 0 };
}

function commitTime(model: VaultModel, index: number | undefined): number | null {
  const commit = index === undefined ? undefined : model.commits[index];
  return commit ? Date.parse(commit.date) : null;
}

/** Group of any id a commit touched: live pages by kind, deleted ones by folder. */
export function groupOfId(derived: Derived, id: string): Group {
  const page = derived.pageById.get(id);
  return page ? groupOfKind(page.kind) : groupOfPath(id);
}

export function buildTimeline(derived: Derived, now = Date.now()): TimelineData | null {
  const { model } = derived;
  const first = model.commits[0];
  const last = model.commits[model.commits.length - 1];
  if (!first || !last) return null;

  const start = startOfDay(Date.parse(first.date));
  const today = startOfDay(Math.max(now, Date.parse(last.date)));
  const end = endOfDay(today);

  // Calendar: one cell per local day from the first commit's day to today.
  const days: DayCell[] = [];
  const dayIndex = new Map<string, DayCell>();
  const monthLabels = new Map<number, string>();
  const firstWeek = addDays(start, -weekday(start));
  for (let t = start; t <= today; t = addDays(t, 1)) {
    const week = Math.round((addDays(t, -weekday(t)) - firstWeek) / (7 * 86_400_000));
    const cell: DayCell = { key: dayKey(t), time: t, week, dow: weekday(t), count: 0, commits: [] };
    days.push(cell);
    dayIndex.set(cell.key, cell);
    const date = new Date(t);
    if (date.getDate() === 1) monthLabels.set(week, formatMonth(t, date.getMonth() === 0));
  }
  // The first column names its month unless a month boundary label sits right next to it.
  if (!monthLabels.has(0) && !monthLabels.has(1) && !monthLabels.has(2)) monthLabels.set(0, formatMonth(start, true));
  const weeks = (days[days.length - 1]?.week ?? 0) + 1;

  const commitDay: string[] = [];
  const commitGroups: Set<Group>[] = [];
  model.commits.forEach((c: Commit, i) => {
    const key = dayKey(Date.parse(c.date));
    commitDay.push(key);
    const cell = dayIndex.get(key);
    if (cell) {
      cell.count += 1;
      cell.commits.push(i);
    }
    commitGroups.push(new Set(c.changes.map((ch) => groupOfId(derived, ch.id))));
  });
  let maxPerDay = 0;
  let activeDays = 0;
  for (const cell of days) {
    maxPerDay = Math.max(maxPerDay, cell.count);
    if (cell.count > 0) activeDays += 1;
  }

  // Growth: +1 when a page is born, −1 when a deleted page goes; sampled at the end of each day.
  const events: { time: number; group: Group; delta: number }[] = [];
  const lifelines: Lifeline[] = [];
  for (const page of model.pages) {
    const born = derived.bornAt(page);
    if (born === null) continue;
    const group = groupOfKind(page.kind);
    events.push({ time: born, group, delta: 1 });
    const lastChange = page.git.last ? Date.parse(page.git.last) : born;
    lifelines.push({
      id: page.id,
      label: shortLabel(page.id),
      title: page.title !== shortLabel(page.id) ? page.title : null,
      group,
      kind: page.kind,
      born,
      end: Math.max(born, lastChange),
      deleted: false,
      commits: page.git.commits.length,
    });
  }
  for (const ghost of model.ghosts) {
    const deleted = Date.parse(ghost.deleted);
    const created = ghost.created ? Date.parse(ghost.created) : commitTime(model, ghost.commits[0]);
    if (Number.isNaN(deleted)) continue;
    const born = created === null || Number.isNaN(created) ? deleted : Math.min(created, deleted);
    const group = groupOfPath(ghost.id);
    events.push({ time: born, group, delta: 1 }, { time: deleted, group, delta: -1 });
    lifelines.push({
      id: ghost.id,
      label: shortLabel(ghost.id),
      title: null,
      group,
      kind: null,
      born,
      end: deleted,
      deleted: true,
      commits: ghost.commits.length,
    });
  }
  events.sort((a, b) => a.time - b.time);
  lifelines.sort((a, b) => a.born - b.born || a.id.localeCompare(b.id));

  const growth: GrowthPoint[] = [];
  const counts = emptyCounts();
  let e = 0;
  for (const cell of days) {
    const until = endOfDay(cell.time);
    for (; e < events.length && (events[e]?.time ?? Infinity) <= until; e++) {
      const ev = events[e];
      if (ev) counts[ev.group] += ev.delta;
    }
    growth.push({ ...counts, time: cell.time, key: cell.key, total: sumCounts(counts) });
  }

  const linkTimes = model.links.flatMap((l) => (l.since ? [Date.parse(l.since)] : [])).filter((t) => !Number.isNaN(t));
  linkTimes.sort((a, b) => a - b);
  const links: LinkPoint[] = [];
  let written = 0;
  let li = 0;
  for (const cell of days) {
    const until = endOfDay(cell.time);
    while (li < linkTimes.length && (linkTimes[li] ?? Infinity) <= until) {
      written += 1;
      li += 1;
    }
    links.push({ time: cell.time, key: cell.key, count: written });
  }
  // A closing sample at the end of today, so step curves reach the right edge.
  const lastGrowth = growth[growth.length - 1];
  if (lastGrowth) growth.push({ ...lastGrowth, time: end });
  const lastLinks = links[links.length - 1];
  if (lastLinks) links.push({ ...lastLinks, time: end });

  return {
    start,
    end,
    todayKey: dayKey(today),
    days,
    dayIndex,
    weeks,
    monthLabels,
    maxPerDay,
    growth,
    links,
    linksUndated: model.links.length - linkTimes.length,
    lifelines,
    commitDay,
    commitGroups,
    stats: {
      firstCommit: first.date,
      lastCommit: last.date,
      commits: model.commits.length,
      activeDays,
      totalDays: days.length,
      pagesCreated: model.pages.length + model.ghosts.length,
      pagesDeleted: model.ghosts.length,
      pagesNow: model.pages.length,
    },
  };
}

function sumCounts(counts: GroupCounts): number {
  return GROUPS.reduce((sum, g) => sum + counts[g], 0);
}

// ── activity buckets ───────────────────────────────────────────────────────

function niceCount(v: number): number {
  if (v < 10) return Math.round(v);
  const step = v < 50 ? 5 : v < 100 ? 10 : v < 500 ? 50 : 100;
  return Math.round(v / step) * step;
}

/**
 * Lower bounds of the non-zero activity buckets, log-spaced from 1 to the
 * busiest day: commit counts are heavy-tailed, so a linear ramp would leave
 * almost every day in the palest step.
 */
export function activityBuckets(max: number, steps = 5): number[] {
  const bounds = [1];
  const n = Math.min(steps, Math.max(1, max));
  for (let i = 1; i < n; i++) {
    const v = niceCount(max ** (i / n));
    if (v > (bounds[bounds.length - 1] ?? 0)) bounds.push(v);
  }
  return bounds;
}

/** Bucket of a day's count: -1 for no commits, else an index into the bounds. */
export function bucketOf(count: number, bounds: readonly number[]): number {
  if (count <= 0) return -1;
  let index = 0;
  bounds.forEach((b, i) => {
    if (count >= b) index = i;
  });
  return index;
}

export function bucketLabel(bounds: readonly number[], index: number): string {
  const lo = bounds[index] ?? 1;
  const next = bounds[index + 1];
  if (next === undefined) return `${lo}+`;
  return next - 1 === lo ? String(lo) : `${lo}–${next - 1}`;
}
