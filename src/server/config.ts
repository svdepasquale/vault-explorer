import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AppConfig {
  lastVault: string | null;
  recent: string[];
}

const MAX_RECENT = 8;

export function configPath(): string {
  const base = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
  return join(base, 'vault-explorer', 'config.json');
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const data: unknown = JSON.parse(await readFile(configPath(), 'utf8'));
    if (!data || typeof data !== 'object') return { lastVault: null, recent: [] };
    const record = data as Record<string, unknown>;
    const recent = Array.isArray(record['recent']) ? record['recent'].filter((p): p is string => typeof p === 'string') : [];
    const lastVault = typeof record['lastVault'] === 'string' ? record['lastVault'] : null;
    return { lastVault, recent: recent.slice(0, MAX_RECENT) };
  } catch {
    return { lastVault: null, recent: [] };
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export function remember(config: AppConfig, vault: string): AppConfig {
  return { lastVault: vault, recent: [vault, ...config.recent.filter((p) => p !== vault)].slice(0, MAX_RECENT) };
}
