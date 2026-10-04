import { useEffect, useMemo, useRef, useState } from 'react';
import type { Page } from '../../shared/model.ts';
import { useDerived } from '../app/derived.ts';
import { shortLabel } from '../app/format.ts';
import { useStore } from '../app/store.ts';
import { KindDot } from './KindBadge.tsx';

function score(page: Page, q: string): number {
  const stem = page.stem.toLowerCase();
  const title = page.title.toLowerCase();
  if (stem === q) return 100;
  if (stem.startsWith(q)) return 80;
  if (title.startsWith(q)) return 70;
  if (stem.includes(q)) return 60;
  if (title.includes(q)) return 50;
  if (page.tags.some((t) => t.toLowerCase() === q)) return 40;
  if (page.id.toLowerCase().includes(q)) return 30;
  if (page.description?.toLowerCase().includes(q)) return 20;
  return 0;
}

/** Search box with a result list; ⌘K / Ctrl-K focuses it. */
export function QuickOpen() {
  const derived = useDerived();
  const select = useStore((s) => s.select);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!derived || !q) return [];
    return derived.model.pages
      .map((p) => ({ p, s: score(p, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id))
      .slice(0, 12)
      .map((r) => r.p);
  }, [derived, query]);

  const choose = (page: Page | undefined): void => {
    if (!page) return;
    select(page.id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="quick-open">
      <input
        ref={inputRef}
        type="search"
        className="quick-open-input"
        placeholder={derived ? `Search ${derived.model.pages.length} pages  ⌘K` : 'Search'}
        aria-label="Search pages"
        value={query}
        disabled={!derived}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            choose(results[active]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setQuery('');
            inputRef.current?.blur();
          }
        }}
      />
      {open && results.length > 0 && (
        <ul className="quick-open-results" aria-label="Matching pages">
          {results.map((page, i) => (
            <li key={page.id}>
              <button
                type="button"
                className={`quick-open-item${i === active ? ' active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(page)}
              >
                <KindDot kind={page.kind} />
                <span className="quick-open-stem">{shortLabel(page.id)}</span>
                <span className="quick-open-title">{page.title !== page.stem ? page.title : page.folder}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
