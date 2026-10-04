import markdownit from 'markdown-it';
import { parseWikilinkInner } from '../../../shared/wikilink.ts';

type Resolve = (raw: string) => string | null;

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Inline markdown for one-line items (hot.md bullets), with the same wikilink
 * conventions as the page renderer in components/Markdown.tsx: raw HTML
 * disabled, `a.wikilink[data-page]` for resolved links, external links in a new tab.
 */
export function createInlineRenderer(resolve: Resolve): (text: string) => string {
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
      token.meta = { ...parsed, id: parsed.target ? resolve(parsed.target) : null };
    }
    state.pos = close + 2;
    return true;
  });

  md.renderer.rules['wikilink'] = (tokens, idx) => {
    const meta = tokens[idx]?.meta as { target: string; anchor: string | null; alias: string | null; id: string | null };
    const text = escapeHtml(
      meta.alias ?? (meta.anchor && !meta.target ? `#${meta.anchor}` : meta.target + (meta.anchor ? ` › ${meta.anchor}` : '')),
    );
    if (!meta.target) return `<span class="wikilink anchor">${text}</span>`;
    if (!meta.id) return `<span class="wikilink unresolved" title="No page named ${escapeHtml(meta.target)}">${text}</span>`;
    return `<a class="wikilink" href="#" data-page="${escapeHtml(meta.id)}" title="${escapeHtml(meta.id)}">${text}</a>`;
  };

  const defaultLinkOpen = md.renderer.rules['link_open'] ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules['link_open'] = (tokens, idx, options, env, self) => {
    const href = String(tokens[idx]?.attrGet('href') ?? '');
    if (/^https?:\/\//i.test(href)) {
      tokens[idx]?.attrSet('target', '_blank');
      tokens[idx]?.attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return (text) => md.renderInline(text);
}
