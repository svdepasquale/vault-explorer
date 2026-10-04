import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Read-only: `--no-optional-locks` + GIT_OPTIONAL_LOCKS=0 keep git from
// refreshing the index of a repo another process (the vault's auto-commit
// hook) may be writing to at the same time.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--no-optional-locks', '-c', 'core.quotepath=off', ...args], {
    cwd,
    env: GIT_ENV,
    maxBuffer: 128 * 1024 * 1024,
    encoding: 'utf8',
  });
  return stdout;
}

async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    const out = (await git(cwd, args)).trim();
    return out || null;
  } catch {
    return null;
  }
}

export interface GitRepoInfo {
  toplevel: string;
  gitDir: string;
  branch: string | null;
  head: string | null;
  remote: string | null;
}

/** Strip `user:token@` from an HTTPS remote so it never reaches the UI. */
export function sanitizeRemote(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
}

export async function readRepoInfo(dir: string): Promise<GitRepoInfo | null> {
  const paths = await gitOrNull(dir, ['rev-parse', '--show-toplevel', '--absolute-git-dir']);
  if (!paths) return null;
  const [toplevel, gitDir] = paths.split('\n');
  if (!toplevel || !gitDir) return null;
  const [branch, head, remote] = await Promise.all([
    gitOrNull(dir, ['symbolic-ref', '--short', '-q', 'HEAD']),
    gitOrNull(dir, ['rev-parse', '--short', 'HEAD']),
    gitOrNull(dir, ['remote', 'get-url', 'origin']),
  ]);
  return { toplevel, gitDir, branch, head, remote: remote ? sanitizeRemote(remote) : null };
}

export interface RawChange {
  status: 'A' | 'M' | 'D' | 'R';
  /** Path relative to the directory the log was read from. */
  path: string;
  from?: string;
}

export interface RawCommit {
  hash: string;
  date: string;
  subject: string;
  changes: RawChange[];
}

const RECORD = '\x1e';
const FIELD = '\x1f';

/** Parse `git log --name-status --format=%x1e%H%x1f%aI%x1f%s` output, newest first as git prints it. */
export function parseLog(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const record of output.split(RECORD)) {
    if (!record.trim()) continue;
    const [header = '', ...lines] = record.split('\n');
    const [hash, date, subject] = header.split(FIELD);
    if (!hash || !date) continue;
    const changes: RawChange[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const code = parts[0]?.[0];
      if (code === 'R' && parts[1] && parts[2]) changes.push({ status: 'R', from: parts[1], path: parts[2] });
      else if (code === 'C' && parts[2]) changes.push({ status: 'A', path: parts[2] });
      else if (code === 'A' && parts[1]) changes.push({ status: 'A', path: parts[1] });
      else if (code === 'D' && parts[1]) changes.push({ status: 'D', path: parts[1] });
      else if ((code === 'M' || code === 'T') && parts[1]) changes.push({ status: 'M', path: parts[1] });
    }
    commits.push({ hash, date, subject: subject ?? '', changes });
  }
  return commits;
}

/**
 * History of everything under `dir` (the vault's wiki/), paths relative to it,
 * oldest first. Returns null when `dir` is not inside a git work tree.
 */
export async function readHistory(dir: string): Promise<RawCommit[] | null> {
  try {
    const out = await git(dir, [
      'log',
      '--no-merges',
      '--relative',
      '--name-status',
      '-M',
      `--format=${RECORD}%H${FIELD}%aI${FIELD}%s`,
      '--',
      '.',
    ]);
    return parseLog(out).reverse();
  } catch {
    return null;
  }
}

/** Path from a `+++ b/<path>` header: git appends a tab after names with spaces and C-quotes odd ones. */
export function diffPath(raw: string): string {
  const path = raw.replace(/\t.*$/, '');
  if (!path.startsWith('"') || !path.endsWith('"')) return path;
  return path
    .slice(1, -1)
    .replace(/\\(["\\])/g, '$1')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n');
}

/**
 * When each wikilink target was first written on each page: one
 * `git log -p --unified=0` pass over wiki/, reading added lines only.
 * Returns pageId → (raw target → ISO date of the first commit adding it).
 * Frontmatter `relations:` lines are wikilinks too, so typed edges get dates as well.
 * History follows each file through renames (a path freed by a rename starts a new
 * lineage), and a page deleted then re-created at the same path keeps its earlier dates.
 * Known limit: under `--unified=0` a line inside a fenced block cannot be told apart.
 */
export async function readLinkHistory(dir: string, extract: (line: string) => string[]): Promise<Map<string, Map<string, string>> | null> {
  let out: string;
  try {
    out = await git(dir, [
      'log',
      '--reverse',
      '--no-merges',
      '--relative',
      '-p',
      '-M',
      '--unified=0',
      '--no-color',
      '--no-ext-diff',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      `--format=${RECORD}%H${FIELD}%aI`,
      '--',
      '.',
    ]);
  } catch {
    return null;
  }

  interface Lineage {
    path: string;
    seen: Map<string, string>;
  }
  const lineages: Lineage[] = [];
  const live = new Map<string, Lineage>();
  const lineageAt = (path: string): Lineage => {
    let lineage = live.get(path);
    if (!lineage) {
      lineage = { path, seen: new Map() };
      lineages.push(lineage);
      live.set(path, lineage);
    }
    return lineage;
  };

  for (const record of out.split(RECORD)) {
    if (!record) continue;
    const newline = record.indexOf('\n');
    const header = newline >= 0 ? record.slice(0, newline) : record;
    const date = header.split(FIELD)[1];
    if (!date) continue;
    let page: Lineage | null = null;
    let renameFrom: string | null = null;
    let deleting = false;
    for (const line of record.slice(newline + 1).split('\n')) {
      if (line.startsWith('diff --git ')) {
        page = null;
        renameFrom = null;
        deleting = false;
      } else if (line.startsWith('rename from ')) {
        renameFrom = diffPath(line.slice(12));
      } else if (line.startsWith('rename to ')) {
        const to = diffPath(line.slice(10));
        const lineage = renameFrom ? live.get(renameFrom) : undefined;
        if (renameFrom && lineage) {
          live.delete(renameFrom);
          lineage.path = to;
          live.set(to, lineage);
        }
      } else if (line.startsWith('deleted file mode')) {
        deleting = true;
      } else if (line.startsWith('--- ')) {
        if (deleting) live.delete(diffPath(line.slice(4)).replace(/^a\//, ''));
      } else if (line.startsWith('+++ ')) {
        const raw = diffPath(line.slice(4));
        const path = raw.replace(/^b\//, '');
        page = raw !== '/dev/null' && /\.md$/i.test(path) ? lineageAt(path) : null;
      } else if (page && line.startsWith('+') && line.includes('[[')) {
        for (const target of extract(line.slice(1))) {
          if (!page.seen.has(target)) page.seen.set(target, date);
        }
      }
    }
  }

  const firstSeen = new Map<string, Map<string, string>>();
  for (const lineage of lineages) {
    if (!/\.md$/i.test(lineage.path)) continue;
    const id = lineage.path.replace(/\.md$/i, '');
    let merged = firstSeen.get(id);
    if (!merged) {
      merged = new Map();
      firstSeen.set(id, merged);
    }
    for (const [target, date] of lineage.seen) {
      const known = merged.get(target);
      if (!known || Date.parse(date) < Date.parse(known)) merged.set(target, date);
    }
  }
  return firstSeen;
}
