import { watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readRepoInfo } from '../core/git.ts';
import { assertVault, buildVaultModel, WIKI_DIR } from '../core/model.ts';
import type { VaultModel } from '../shared/model.ts';
import { remember, saveConfig, type AppConfig } from './config.ts';

const DEBOUNCE_MS = 400;

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith(`~${sep}`) || path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

type Listener = (version: number) => void;

/**
 * Holds the selected vault and its model, rebuilds on file-system changes
 * (debounced) and notifies subscribers. Never writes inside the vault.
 */
export class VaultService {
  vault: string | null = null;
  model: VaultModel | null = null;
  error: string | null = null;
  building = false;
  version = 0;
  config: AppConfig;

  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private listeners = new Set<Listener>();

  constructor(config: AppConfig) {
    this.config = config;
  }

  /** Validate and switch to `path`; throws VaultError without touching the current vault. */
  async select(path: string): Promise<void> {
    const root = resolve(expandHome(path.trim()));
    await assertVault(root);
    this.stopWatching();
    this.vault = root;
    this.model = null;
    this.error = null;
    this.config = remember(this.config, root);
    saveConfig(this.config).catch((err: unknown) => console.warn(`[vault-explorer] could not save config: ${String(err)}`));
    await this.rebuild();
    await this.startWatching(root);
  }

  async rebuild(): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    if (this.building) {
      this.dirty = true;
      return;
    }
    this.building = true;
    try {
      const model = await buildVaultModel(vault, { version: this.version + 1 });
      if (vault === this.vault) {
        this.version = model.version;
        this.model = model;
        this.error = null;
      }
    } catch (err) {
      if (vault === this.vault) {
        this.error = err instanceof Error ? err.message : String(err);
        this.version += 1;
      }
    } finally {
      this.building = false;
    }
    this.emit();
    if (this.dirty) {
      this.dirty = false;
      await this.rebuild();
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.stopWatching();
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.version);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.rebuild();
    }, DEBOUNCE_MS);
  }

  private async startWatching(root: string): Promise<void> {
    const ignoreDotPaths = (name: string | null): boolean => !!name && name.split(/[\\/]/).some((s) => s.startsWith('.'));
    try {
      this.watchers.push(
        watch(join(root, WIKI_DIR), { recursive: true }, (_event, name) => {
          if (!ignoreDotPaths(name ? String(name) : null)) this.schedule();
        }),
      );
    } catch (err) {
      console.warn(`[vault-explorer] cannot watch ${WIKI_DIR}/: ${String(err)}`);
    }
    // A commit of already-saved files changes history without touching wiki/:
    // follow HEAD, refs and the reflog too.
    const repo = await readRepoInfo(join(root, WIKI_DIR));
    if (!repo || this.vault !== root) return;
    try {
      this.watchers.push(
        watch(repo.gitDir, { recursive: true }, (_event, name) => {
          const n = name ? String(name).replace(/\\/g, '/') : '';
          if (n === 'HEAD' || n === 'packed-refs' || n.startsWith('refs/') || n.startsWith('logs/')) this.schedule();
        }),
      );
    } catch (err) {
      console.warn(`[vault-explorer] cannot watch the git directory: ${String(err)}`);
    }
  }

  private stopWatching(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
