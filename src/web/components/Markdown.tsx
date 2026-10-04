import markdownit, { type MarkdownIt } from 'markdown-it';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { createResolver } from '../../shared/resolve.ts';
import { parseWikilinkInner } from '../../shared/wikilink.ts';
import { api } from '../app/api.ts';
import { useDerived } from '../app/derived.ts';
import { useStore } from '../app/store.ts';

type Resolve = (raw: string) => string | null;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * markdown-it with raw HTML disabled (the body is escaped), plus:
 * `[[wikilinks]]` resolved against the vault, `> [!type]` callouts, and
 * external links opening in a new tab.
 */
function createRenderer(resolve: Resolve): MarkdownIt {
  const md = markdownit({ html: false, linkify: true, typographer: false });

  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const start = state.pos;
    const embed = state.src.charCodeAt(start) === 0x21; /* ! */
    const open = embed ? start + 1 : start;
    if (state.src.charCodeAt(open) !== 0x5b || state.src.charCodeAt(open + 1) !== 0x5b) return false;
    const close = state.src.indexOf(']]', open + 2);
    if (close < 0) return false;
    const inner = state.src.slice(open + 2, close);
    if (!inner || inner.includes('\n') || inner.includes('[')) return false;
    const parsed = parseWikilinkInner(inner);
    if (!parsed) return false;
    if (!silent) {
      const token = state.push('wikilink', '', 0);
      token.meta = { ...parsed, embed, id: parsed.target ? resolve(parsed.target) : null };
    }
    state.pos = close + 2;
    return true;
  });

  md.renderer.rules['wikilink'] = (tokens, idx) => {
    const meta = tokens[idx]?.meta as { target: string; anchor: string | null; alias: string | null; id: string | null };
    const text = escapeHtml(meta.alias ?? (meta.anchor && !meta.target ? `#${meta.anchor}` : meta.target + (meta.anchor ? ` › ${meta.anchor}` : '')));
    if (!meta.target) return `<span class="wikilink anchor">${text}</span>`;
    if (!meta.id) return `<span class="wikilink unresolved" title="No page named ${escapeHtml(meta.target)}">${text}</span>`;
    return `<a class="wikilink" href="#" data-page="${escapeHtml(meta.id)}" title="${escapeHtml(meta.id)}">${text}</a>`;
  };

  // Obsidian-style callouts: a blockquote whose first line is `[!type]`.
  md.core.ruler.after('inline', 'callouts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i]?.type !== 'blockquote_open') continue;
      const inline = tokens[i + 2];
      if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
      const m = /^\[!([\w-]+)\][+-]?\s*/.exec(inline.content);
      if (!m?.[1]) continue;
      tokens[i]?.attrJoin('class', `callout callout-${m[1].toLowerCase()}`);
      tokens[i]?.attrSet('data-callout', m[1].toLowerCase());
      const first = inline.children?.[0];
      if (first?.type === 'text') first.content = first.content.replace(/^\[![\w-]+\][+-]?\s*/, '');
    }
  });

  const defaultLinkOpen = md.renderer.rules['link_open'] ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules['link_open'] = (tokens, idx, options, env, self) => {
    const href = String(tokens[idx]?.attrGet('href') ?? '');
    if (/^https?:\/\//i.test(href)) {
      tokens[idx]?.attrSet('target', '_blank');
      tokens[idx]?.attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return md;
}

const contentCache = new Map<string, string>();

/** Rendered body of a page, fetched on demand and refreshed with the model. */
export function PageMarkdown({ id }: { id: string }) {
  const derived = useDerived();
  const select = useStore((s) => s.select);
  const version = derived?.model.version ?? 0;
  const key = `${version}:${id}`;
  const [source, setSource] = useState<string | null>(contentCache.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const cached = contentCache.get(key);
    if (cached !== undefined) {
      setSource(cached);
      return;
    }
    setSource(null);
    setError(null);
    api
      .page(id)
      .then((res) => {
        if (contentCache.size > 200) contentCache.clear();
        contentCache.set(key, res.markdown);
        if (alive) setSource(res.markdown);
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [id, key]);

  const md = useMemo(() => {
    if (!derived) return null;
    const resolver = createResolver(derived.model.pages.map((p) => p.id));
    return createRenderer((raw) => resolver(raw, id).id);
  }, [derived, id]);

  const html = useMemo(() => (md && source !== null ? md.render(source) : ''), [md, source]);

  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const link = (e.target as HTMLElement).closest('a.wikilink[data-page]');
    if (!link) return;
    e.preventDefault();
    const page = link.getAttribute('data-page');
    if (page) select(page);
  };

  if (error) return <p className="panel-error">{error}</p>;
  if (source === null) return <p className="panel-muted">Loading…</p>;
  // Safe: markdown-it runs with html:false, so page text is escaped before it reaches the DOM.
  // The click handler only delegates for the wikilink anchors inside, which are focusable.
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it output with html:false (escaped)
    // biome-ignore lint/a11y/noStaticElementInteractions: delegated clicks for the focusable wikilink anchors inside
    // biome-ignore lint/a11y/useKeyWithClickEvents: the anchors handle Enter themselves; this only routes the click
    <div className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
