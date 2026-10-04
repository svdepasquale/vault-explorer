// Calendar-day arithmetic in the viewer's local time zone, shared by the views.

/** Local midnight of the day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight of a `YYYY-MM-DD` calendar date. */
export function localDayOf(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : Number.NaN;
}

/** Whole calendar days between a date (`YYYY-MM-DD` or ISO date-time) and today; Math.round absorbs DST days. */
export function calendarDaysSince(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const day = value.length === 10 ? localDayOf(value) : startOfLocalDay(Date.parse(value));
  if (Number.isNaN(day)) return null;
  return Math.max(0, Math.round((startOfLocalDay(now) - day) / 86_400_000));
}
