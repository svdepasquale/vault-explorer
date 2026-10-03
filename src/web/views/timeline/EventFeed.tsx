import { useMemo, useState } from 'react';
import type { ChangeStatus, Commit, CommitChange } from '../../../shared/model.ts';
import type { Derived } from '../../app/derived.ts';
import { commitUrl, formatNumber, plural, shortLabel } from '../../app/format.ts';
import { PageLink } from '../../components/PageLink.tsx';
import { formatDay, formatTime, GROUP_LABELS, GROUPS, isGroup, type Group, type TimelineData } from './data.ts';

const PAGE_SIZE = 50;
const CHIPS_SHOWN = 10;
const STATUS_LABEL: Record<ChangeStatus, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };

function ChangeChip({ change, derived }: { change: CommitChange; derived: Derived }) {
  const live = derived.pageById.has(change.id);
  return (
    <span className="timeline-chip">
      <span className={`change change-${change.status}`} title={STATUS_LABEL[change.status]}>
        {change.status}
      </span>
      {live ? (
        <PageLink id={change.id} />
      ) : (
        <span className="timeline-chip-gone" title={`${change.id}: no longer in the vault`}>
          {shortLabel(change.id)}
        </span>
      )}
      {change.status === 'R' && change.from && <span className="timeline-chip-from">from {shortLabel(change.from)}</span>}
    </span>
  );
}

function EventRow({ commit, derived, remote }: { commit: Commit; derived: Derived; remote: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const time = Date.parse(commit.date);
  const url = commitUrl(remote, commit.hash);
  const shown = expanded ? commit.changes : commit.changes.slice(0, CHIPS_SHOWN);
  const hidden = commit.changes.length - shown.length;
  return (
    <li className="timeline-event">
      <div className="timeline-event-when">
        <span className="timeline-event-date">{formatDay(time)}</span>
        <span className="timeline-event-time">{formatTime(time)}</span>
      </div>
      <div className="timeline-event-body">
        <div className="timeline-event-subject">
          {commit.subject}{' '}
          {url ? (
            <a className="mono timeline-event-hash" href={url} target="_blank" rel="noopener noreferrer" title="Open the commit">
              {commit.hash.slice(0, 7)}
            </a>
          ) : (
            <span className="mono timeline-event-hash">{commit.hash.slice(0, 7)}</span>
          )}
        </div>
        <div className="timeline-event-changes">
          {shown.map((change) => (
            <ChangeChip key={`${change.status}:${change.id}:${change.from ?? ''}`} change={change} derived={derived} />
          ))}
          {(hidden > 0 || expanded) && commit.changes.length > CHIPS_SHOWN && (
            <button type="button" className="btn-link timeline-event-more" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'show fewer' : `+${hidden} more`}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function matches(commit: Commit, query: string): boolean {
  if (commit.subject.toLowerCase().includes(query) || commit.hash.startsWith(query)) return true;
  return commit.changes.some((ch) => ch.id.toLowerCase().includes(query) || (ch.from?.toLowerCase().includes(query) ?? false));
}

interface EventFeedProps {
  data: TimelineData;
  derived: Derived;
  day: string | null;
  onDay: (day: string | null) => void;
}

/** Newest-first commit list with text, kind and day filters. */
export function EventFeed({ data, derived, day, onDay }: EventFeedProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<Group | 'all'>('all');
  const filterKey = `${day ?? ''}|${group}|${query}`;
  // Paging restarts whenever the filters change, without an effect round-trip.
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE_SIZE });
  const limit = paging.key === filterKey ? paging.limit : PAGE_SIZE;
  const commits = derived.model.commits;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: number[] = [];
    for (let i = commits.length - 1; i >= 0; i--) {
      const commit = commits[i];
      if (!commit) continue;
      if (day && data.commitDay[i] !== day) continue;
      if (group !== 'all' && !data.commitGroups[i]?.has(group)) continue;
      if (q && !matches(commit, q)) continue;
      out.push(i);
    }
    return out;
  }, [commits, data, day, group, query]);

  const shown = filtered.slice(0, limit);
  const remote = derived.model.vault.remote;
  const filteredOut = filtered.length !== commits.length;

  return (
    <div className="card timeline-card timeline-feed">
      <header className="timeline-card-header">
        <div>
          <h2 className="timeline-card-title">Events</h2>
          <p className="timeline-card-sub">
            {filteredOut ? `${formatNumber(filtered.length)} of ${plural(commits.length, 'commit')}` : `${plural(commits.length, 'commit')}, newest first`}
          </p>
        </div>
      </header>
      <div className="timeline-feed-filters">
        <input
          type="search"
          className="input timeline-feed-search"
          placeholder="Subject, page or hash"
          aria-label="Filter commits by subject, page or hash"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="select timeline-feed-kind"
          aria-label="Only commits touching this kind"
          value={group}
          onChange={(e) => setGroup(isGroup(e.target.value) ? e.target.value : 'all')}
        >
          <option value="all">All kinds</option>
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {g === 'other' ? 'Meta, fold, nav' : GROUP_LABELS[g]}
            </option>
          ))}
        </select>
      </div>
      {day && (
        <div className="timeline-feed-active">
          <span className="timeline-filter-chip">
            {formatDay(day)}
            <button type="button" className="timeline-filter-clear" onClick={() => onDay(null)} aria-label="Clear the day filter" title="Clear the day filter">
              ×
            </button>
          </span>
        </div>
      )}
      <div className="timeline-feed-scroll">
        {shown.length === 0 ? (
          <p className="timeline-empty">{day && !query && group === 'all' ? 'No commits on this day.' : 'No commits match these filters.'}</p>
        ) : (
          <ol className="timeline-events">
            {shown.map((i) => {
              const commit = commits[i];
              return commit ? <EventRow key={commit.hash} commit={commit} derived={derived} remote={remote} /> : null;
            })}
          </ol>
        )}
        {filtered.length > shown.length && (
          <div className="timeline-feed-more">
            <button type="button" className="btn btn-small" onClick={() => setPaging({ key: filterKey, limit: limit + PAGE_SIZE })}>
              Show {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
            </button>
            <span className="timeline-feed-remaining">{formatNumber(filtered.length - shown.length)} left</span>
          </div>
        )}
      </div>
    </div>
  );
}
