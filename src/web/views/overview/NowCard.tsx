import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { HotSection, HotSummary } from '../../../shared/model.ts';
import { createResolver } from '../../../shared/resolve.ts';
import { useDerived } from '../../app/derived.ts';
import { daysAgo, formatBytes, formatDate } from '../../app/format.ts';
import { useStore } from '../../app/store.ts';
import { PageLink } from '../../components/PageLink.tsx';
import { createInlineRenderer } from './inline.ts';

/** "What is going on" first; other sections keep their order in hot.md. */
const PRIORITY = ['open threads', 'active projects', 'recent'];

function priority(title: string): number {
  const t = title.toLowerCase();
  const i = PRIORITY.findIndex((p) => t.startsWith(p));
  return i < 0 ? PRIORITY.length : i;
}

/** One bullet, clamped to two lines; the toggle appears only when the text really overflows. */
function HotItemView({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: html is the trigger to re-measure the clamped text
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = (): void => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [html, open]);

  return (
    <li className="overview-hot-item">
      {/* Safe: markdown-it runs with html:false, so item text is escaped before it reaches the DOM. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it output with html:false (escaped) */}
      <div ref={ref} className={`markdown overview-hot-text${open ? '' : ' is-clamped'}`} dangerouslySetInnerHTML={{ __html: html }} />
      {(overflows || open) && (
        <button
          type="button"
          className={`overview-hot-more${open ? '' : ' is-overlay'}`}
          aria-expanded={open}
          aria-label={open ? 'Show less' : 'Show the whole item'}
          onClick={() => setOpen(!open)}
        >
          {open ? 'less' : '… more'}
        </button>
      )}
    </li>
  );
}

function HotSectionView({ section, render }: { section: HotSection; render: (text: string) => string }) {
  return (
    <section className="overview-hot-section" aria-label={section.title}>
      <h4 className="overview-hot-title">
        {section.title}
        <span className="count">{section.items.length}</span>
      </h4>
      <ul className="overview-hot-list">
        {section.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: hot.md items in file order; the text alone may repeat
          <HotItemView key={`${i}:${item.text}`} html={render(item.text)} />
        ))}
      </ul>
    </section>
  );
}

export function NowCard({ hot }: { hot: HotSummary | null }) {
  const derived = useDerived();
  const hotId = hot?.id ?? 'hot';

  const render = useMemo(() => {
    if (!derived) return null;
    const resolver = createResolver(derived.model.pages.map((p) => p.id));
    // Resolve from hot.md, as the server does, so ambiguous stems pick the same page.
    return createInlineRenderer((raw) => resolver(raw, hotId).id);
  }, [derived, hotId]);

  const sections = useMemo(
    () =>
      (hot?.sections ?? [])
        .map((section, index) => ({ section, index }))
        .filter(({ section }) => section.items.length > 0)
        .sort((a, b) => priority(a.section.title) - priority(b.section.title) || a.index - b.index)
        .map(({ section }) => section),
    [hot],
  );

  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const link = (e.target as HTMLElement).closest('a.wikilink[data-page]');
    if (!link) return;
    e.preventDefault();
    const id = link.getAttribute('data-page');
    if (id) useStore.getState().select(id);
  };

  const page = derived?.pageById.get(hotId);
  const age = page && derived ? derived.ageDays(page) : null;
  const [primary, ...rest] = sections;

  return (
    <section className="card overview-card overview-now" aria-label="Now: hot.md digest">
      <header className="overview-card-head">
        <div className="overview-card-heading">
          <h3 className="overview-card-title">What is going on</h3>
          <p className="overview-card-sub">
            {hot
              ? `From hot.md, the session cache injected at every start · ${formatBytes(hot.bytes)} · updated ${formatDate(hot.updated)}${age !== null ? ` (${daysAgo(age)})` : ''}`
              : 'This vault has no hot.md.'}
          </p>
        </div>
        {hot && page && (
          <PageLink id={hot.id} showKind={false}>
            Open hot.md
          </PageLink>
        )}
      </header>
      {hot && !primary && <p className="overview-empty">hot.md has no list items under its ## sections.</p>}
      {primary && render && (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegated clicks for the focusable wikilink anchors inside
        <div className={`overview-now-grid${rest.length ? ' has-aside' : ''}`} onClick={onClick}>
          <HotSectionView section={primary} render={render} />
          {rest.length > 0 && (
            <div className="overview-now-aside">
              {rest.map((section) => (
                <HotSectionView key={section.title} section={section} render={render} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
