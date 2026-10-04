import type { Stats } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  HOT_BUDGET_BYTES,
  TYPED_RELATION_KINDS,
  type Commit,
  type CommitChange,
  type GhostPage,
  type HotSummary,
  type Link,
  type Page,
  type PageKind,
  type Relation,
  type Unresolved,
  type VaultModel,
} from '../shared/model.ts';
import { asString, asStringList, normalizeDate, readFrontmatter } from './frontmatter.ts';
import { readHistory, readLinkHistory, readRepoInfo, type RawCommit } from './git.ts';
import { computeHealth } from './health.ts';
import { countWords, extractWikilinks, readSections, stripCode } from './markdown.ts';
import { canonicalize, readLinkList, readRelations } from './relations.ts';
import { createResolver } from '../shared/resolve.ts';

export const WIKI_DIR = 'wiki';

export class VaultError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const NAV_IDS = new Set(['index', 'hot', 'log', 'overview']);

export function pageKind(id: string, folder: string, type: string | null): PageKind {
  const stem = id.slice(id.lastIndexOf('/') + 1);
  if (stem === '_index' || NAV_IDS.has(id)) return 'nav';
  if (folder === 'meta/profile' || folder.startsWith('meta/profile/') || type === 'feedback' || type === 'user') return 'profile';
  const top = folder.split('/')[0];
  if (top === 'runbooks') return 'runbook';
  if (top === 'folds') return 'fold';
  if (top === 'entities' || type === 'entity') return 'entity';
  if (top === 'sources' || type === 'source') return 'source';
  return 'meta';
}

/** Throws VaultError unless `root` looks like a vault (a directory with a wiki/ folder). */
export async function assertVault(root: string): Promise<void> {
  let info: Stats;
  try {
    info = await stat(root);
  } catch {
    throw new VaultError('not-found', `${root} does not exist`);
  }
  if (!info.isDirectory()) throw new VaultError('not-a-directory', `${root} is not a directory`);
  try {
    const wiki = await stat(join(root, WIKI_DIR));
    if (!wiki.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new VaultError('no-wiki', `${root} has no ${WIKI_DIR}/ folder — pick the vault repository root`);
  }
}

/** Every `.md` under `dir`, as paths relative to it. Skips dot-folders and symlinks. */
export async function listMarkdown(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(join(dir, rel), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listMarkdown(dir, path)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(path);
  }
  return out;
}

const toId = (relPath: string): string => relPath.replace(/\.md$/i, '');
const isMarkdown = (relPath: string): boolean => /\.md$/i.test(relPath) && !relPath.split('/').some((s) => s.startsWith('.'));

export interface BuildOptions {
  now?: Date;
  version?: number;
}

export async function buildVaultModel(root: string, options: BuildOptions = {}): Promise<VaultModel> {
  const started = performance.now();
  const now = options.now ?? new Date();
  await assertVault(root);
  const wikiRoot = join(root, WIKI_DIR);

  const files = await listMarkdown(wikiRoot);
  const ids = files.map(toId);
  const resolve = createResolver(ids);

  const pages: Page[] = [];
  const bodies = new Map<string, string>();
  const missingFrontmatter: string[] = [];

  await Promise.all(
    files.map(async (file, i) => {
      const id = ids[i] ?? toId(file);
      const text = await readFile(join(wikiRoot, file), 'utf8');
      const fm = readFrontmatter(text);
      if (!fm.present) missingFrontmatter.push(id);
      const data = fm.data;
      const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
      const type = asString(data['type']);
      bodies.set(id, fm.body);
      pages[i] = {
        id,
        path: `${WIKI_DIR}/${file}`,
        stem: basename(id),
        folder,
        title: asString(data['name']) ?? asString(data['title']) ?? basename(id),
        description: asString(data['description']),
        type,
        kind: pageKind(id, folder, type),
        status: asString(data['status']),
        domain: asString(data['domain']),
        tags: asStringList(data['tags']),
        created: normalizeDate(data['created']),
        updated: normalizeDate(data['updated']),
        address: asString(data['address']),
        indexed: data['index'] !== false && id !== 'hot' && id !== 'log',
        bytes: Buffer.byteLength(text, 'utf8'),
        words: countWords(stripCode(fm.body)),
        frontmatter: data,
        frontmatterError: fm.error,
        frontmatterCuts: fm.cuts,
        git: { first: null, last: null, commits: [] },
      };
    }),
  );

  // ── links: body wikilinks + frontmatter related: ─────────────────────────
  const linkMap = new Map<string, Link>();
  const unresolved: Unresolved[] = [];
  const ambiguous: { source: string; raw: string; picked: string }[] = [];
  const linkFor = (source: string, target: string): Link => {
    const key = `${source}\u0000${target}`;
    let link = linkMap.get(key);
    if (!link) {
      link = { source, target, body: 0, related: false, since: null };
      linkMap.set(key, link);
    }
    return link;
  };

  for (const page of pages) {
    for (const ref of extractWikilinks(stripCode(bodies.get(page.id) ?? ''))) {
      if (!ref.target) continue;
      const res = resolve(ref.target, page.id);
      if (res.attachment) continue;
      if (!res.id) {
        unresolved.push({ source: page.id, raw: ref.target, where: 'body' });
        continue;
      }
      if (res.ambiguous) ambiguous.push({ source: page.id, raw: ref.target, picked: res.id });
      if (res.id !== page.id) linkFor(page.id, res.id).body++;
    }
    for (const raw of readLinkList(page.frontmatter['related'] ?? [])) {
      const res = resolve(raw, page.id);
      if (res.attachment) continue;
      if (!res.id) {
        unresolved.push({ source: page.id, raw, where: 'related' });
        continue;
      }
      if (res.ambiguous) ambiguous.push({ source: page.id, raw, picked: res.id });
      if (res.id !== page.id) linkFor(page.id, res.id).related = true;
    }
  }

  // ── typed relations, merged in canonical direction ───────────────────────
  const relationMap = new Map<string, Relation>();
  for (const page of pages) {
    for (const decl of readRelations(page.frontmatter['relations'])) {
      const res = resolve(decl.raw, page.id);
      if (!res.id) {
        unresolved.push({ source: page.id, raw: decl.raw, where: 'relations', predicate: decl.predicate });
        continue;
      }
      if (res.ambiguous) ambiguous.push({ source: page.id, raw: decl.raw, picked: res.id });
      if (res.id === page.id) continue;
      const c = canonicalize(page.id, decl.predicate, res.id);
      const key = `${c.from}\u0000${c.predicate}\u0000${c.to}`;
      let rel = relationMap.get(key);
      if (!rel) {
        rel = {
          from: c.from,
          predicate: c.predicate,
          to: c.to,
          declaredOnFrom: false,
          declaredOnTo: false,
          hasInverse: c.hasInverse,
          known: c.known,
          expectedOnFrom: false,
          expectedOnTo: false,
          since: null,
        };
        relationMap.set(key, rel);
      }
      if (c.forward) rel.declaredOnFrom = true;
      else rel.declaredOnTo = true;
    }
  }

  // Only entity/source pages carry typed relations, so only they owe an inverse.
  const kindOf = new Map(pages.map((p) => [p.id, p.kind]));
  const typed = (id: string): boolean => {
    const kind = kindOf.get(id);
    return kind !== undefined && TYPED_RELATION_KINDS.includes(kind);
  };
  for (const rel of relationMap.values()) {
    rel.expectedOnFrom = rel.hasInverse && typed(rel.from);
    rel.expectedOnTo = rel.hasInverse && typed(rel.to);
  }

  // ── git history ──────────────────────────────────────────────────────────
  const repo = await readRepoInfo(wikiRoot);
  const [history, linkHistory] = repo
    ? await Promise.all([
        readHistory(wikiRoot),
        // Same rule as the current-state pass: wikilinks inside inline code are not links.
        readLinkHistory(wikiRoot, (line) =>
          extractWikilinks(stripCode(line))
            .map((ref) => ref.target)
            .filter(Boolean),
        ),
      ])
    : [null, null];
  const { commits, ghosts } = foldHistory(history ?? [], new Set(ids), pages);
  if (linkHistory) datePairs(linkHistory, resolve, linkMap, relationMap);

  // ── hot cache ────────────────────────────────────────────────────────────
  let hot: HotSummary | null = null;
  const hotPage = pages.find((p) => p.id === 'hot');
  if (hotPage) {
    hot = {
      id: hotPage.id,
      bytes: hotPage.bytes,
      budget: HOT_BUDGET_BYTES,
      updated: hotPage.updated,
      sections: readSections(bodies.get('hot') ?? '').map((s) => ({
        title: s.title,
        items: s.items.map((item) => ({
          text: item.text,
          links: [
            ...new Set(
              extractWikilinks(item.text)
                .map((ref) => resolve(ref.target, 'hot').id)
                .filter((id): id is string => id !== null),
            ),
          ],
        })),
      })),
    };
  }

  const links = [...linkMap.values()];
  const relations = [...relationMap.values()];
  const health = computeHealth({ pages, links, relations, unresolved, ambiguous, hot, missingFrontmatter, now });

  let recall = false;
  try {
    await access(join(root, 'scripts', 'retrieve.py'));
    recall = true;
  } catch {
    recall = false;
  }

  return {
    schema: 1,
    version: options.version ?? 0,
    generatedAt: now.toISOString(),
    buildMs: Math.round(performance.now() - started),
    vault: {
      root,
      name: basename(root),
      remote: repo?.remote ?? null,
      branch: repo?.branch ?? null,
      head: repo?.head ?? null,
      capabilities: { git: history !== null, recall },
    },
    pages,
    links,
    relations,
    unresolved,
    commits,
    ghosts,
    hot,
    health,
  };
}

/**
 * Date every link and relation with the first commit that wrote one of its
 * raw targets on the declaring page (resolved with today's resolver).
 */
function datePairs(
  linkHistory: Map<string, Map<string, string>>,
  resolve: (raw: string, fromId: string) => { id: string | null },
  links: Map<string, Link>,
  relations: Map<string, Relation>,
): void {
  const firstWritten = new Map<string, string>();
  for (const [source, seen] of linkHistory) {
    for (const [raw, date] of seen) {
      const target = resolve(raw, source).id;
      if (!target || target === source) continue;
      const key = `${source}\u0000${target}`;
      const known = firstWritten.get(key);
      if (!known || Date.parse(date) < Date.parse(known)) firstWritten.set(key, date);
    }
  }
  for (const link of links.values()) link.since = firstWritten.get(`${link.source}\u0000${link.target}`) ?? null;
  for (const rel of relations.values()) {
    const dates = [firstWritten.get(`${rel.from}\u0000${rel.to}`), firstWritten.get(`${rel.to}\u0000${rel.from}`)].filter(
      (d): d is string => d !== undefined,
    );
    rel.since = dates.length ? dates.reduce((a, b) => (Date.parse(a) < Date.parse(b) ? a : b)) : null;
  }
}

/**
 * Turn raw commits (oldest first, paths relative to wiki/) into page-level
 * history. Renames are followed so a page keeps the history of its old names;
 * pages deleted and never re-created become ghosts.
 */
export function foldHistory(raw: RawCommit[], current: Set<string>, pages: Page[]): { commits: Commit[]; ghosts: GhostPage[] } {
  interface Lineage {
    commits: number[];
  }
  const commits: Commit[] = [];
  const live = new Map<string, Lineage>();
  const dead: { id: string; lineage: Lineage; deleted: string }[] = [];
  const touch = (lineage: Lineage, index: number): void => {
    if (lineage.commits[lineage.commits.length - 1] !== index) lineage.commits.push(index);
  };

  for (const rc of raw) {
    const changes: CommitChange[] = [];
    for (const ch of rc.changes) {
      if (ch.status === 'R' && ch.from) {
        const fromMd = isMarkdown(ch.from);
        const toMd = isMarkdown(ch.path);
        if (fromMd && toMd) changes.push({ status: 'R', id: toId(ch.path), from: toId(ch.from) });
        else if (fromMd) changes.push({ status: 'D', id: toId(ch.from) });
        else if (toMd) changes.push({ status: 'A', id: toId(ch.path) });
      } else if (isMarkdown(ch.path)) {
        changes.push({ status: ch.status, id: toId(ch.path) });
      }
    }
    if (!changes.length) continue;

    const index = commits.length;
    commits.push({ hash: rc.hash, date: rc.date, subject: rc.subject, changes });
    for (const ch of changes) {
      if (ch.status === 'R' && ch.from) {
        const lineage = live.get(ch.from) ?? { commits: [] };
        live.delete(ch.from);
        live.set(ch.id, lineage);
        touch(lineage, index);
      } else if (ch.status === 'D') {
        const lineage = live.get(ch.id) ?? { commits: [] };
        live.delete(ch.id);
        touch(lineage, index);
        dead.push({ id: ch.id, lineage, deleted: rc.date });
      } else {
        let lineage = live.get(ch.id);
        if (!lineage) {
          lineage = { commits: [] };
          live.set(ch.id, lineage);
        }
        touch(lineage, index);
      }
    }
  }

  // A page deleted and later re-created at the same path keeps its earlier history.
  const earlier = new Map<string, number[]>();
  const ghostsById = new Map<string, GhostPage>();
  for (const d of dead) {
    if (current.has(d.id)) {
      earlier.set(d.id, [...(earlier.get(d.id) ?? []), ...d.lineage.commits]);
      continue;
    }
    const ghost = ghostsById.get(d.id);
    if (ghost) {
      ghost.commits = [...new Set([...ghost.commits, ...d.lineage.commits])].sort((a, b) => a - b);
      if (Date.parse(d.deleted) > Date.parse(ghost.deleted)) ghost.deleted = d.deleted;
    } else {
      ghostsById.set(d.id, { id: d.id, created: null, deleted: d.deleted, commits: [...d.lineage.commits] });
    }
  }

  const dateOf = (index: number | undefined): string | null => (index === undefined ? null : (commits[index]?.date ?? null));

  for (const page of pages) {
    const list = [...new Set([...(earlier.get(page.id) ?? []), ...(live.get(page.id)?.commits ?? [])])].sort((a, b) => a - b);
    page.git = { commits: list, first: dateOf(list[0]), last: dateOf(list[list.length - 1]) };
  }

  const ghosts = [...ghostsById.values()];
  for (const ghost of ghosts) ghost.created = dateOf(ghost.commits[0]);
  ghosts.sort((a, b) => Date.parse(a.deleted) - Date.parse(b.deleted));
  return { commits, ghosts };
}
