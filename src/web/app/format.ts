const DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const NUMBER = new Intl.NumberFormat('en-US');

/** `2026-09-27` or an ISO date-time → `27 Sep 2026`. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? value : DATE.format(d);
}

export function formatNumber(n: number): string {
  return NUMBER.format(n);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function daysAgo(days: number | null): string {
  if (days === null) return 'unknown';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** Label for a page node: the stem, or `folder/_index` for index pages. */
export function shortLabel(id: string): string {
  const i = id.lastIndexOf('/');
  const stem = i >= 0 ? id.slice(i + 1) : id;
  if (stem === '_index' && i >= 0) return `${id.slice(0, i)}/_index`;
  return stem;
}

/** GitHub web URL for a commit, when the remote is on github.com. */
export function commitUrl(remote: string | null, hash: string): string | null {
  if (!remote) return null;
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
  return m ? `https://github.com/${m[1]}/${m[2]}/commit/${hash}` : null;
}
