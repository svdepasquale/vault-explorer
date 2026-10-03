import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Git used to BUILD test repositories, never the code under test (src/ runs its
// own git with its own environment). Isolated from the developer's global and
// system config, so a global `commit.gpgsign`, signing agent or `core.hooksPath`
// cannot sign, prompt or run hooks on fixture commits; and stripped of the
// variables that point git at another repository (set when tests run from a git
// hook), so a fixture `git commit` can never land in the real checkout.
const REDIRECTS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX'];
const SETUP_ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !REDIRECTS.includes(key))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};

export async function git(cwd: string, args: string[], date?: string): Promise<string> {
  const env = date ? { ...SETUP_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : SETUP_ENV;
  const { stdout } = await run('git', args, { cwd, env, encoding: 'utf8' });
  return stdout;
}

/** `git init` with a local identity and signing off, whatever the global config says. */
export async function initRepo(dir: string): Promise<void> {
  await git(dir, ['init', '--quiet', '--initial-branch=main']);
  await git(dir, ['config', 'user.name', 'Fixture Author']);
  await git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
}

/** Stage everything and commit with a fixed author and committer date. */
export async function commitAll(dir: string, message: string, date: string): Promise<void> {
  await git(dir, ['add', '--all']);
  await git(dir, ['commit', '--quiet', '--no-verify', '-m', message], date);
}
