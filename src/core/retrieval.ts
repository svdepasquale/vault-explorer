import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Where the vault's hybrid retrieval script lives. Since 2026-10-06 the knowledge
 * vault keeps only data and its code is a separate checkout, vault-engine, whose
 * scripts find the vault through WIKI_VAULT. First match wins: `VAULT_ENGINE`,
 * a `vault-engine` checkout next to the vault, then the vault's own `scripts/`
 * (vaults that still carry their code).
 */
export function retrieveCandidates(vault: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  if (env['VAULT_ENGINE']) candidates.push(join(env['VAULT_ENGINE'], 'scripts', 'retrieve.py'));
  candidates.push(join(dirname(vault), 'vault-engine', 'scripts', 'retrieve.py'));
  candidates.push(join(vault, 'scripts', 'retrieve.py'));
  return candidates;
}

export async function findRetrieve(vault: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  for (const candidate of retrieveCandidates(vault, env)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // not here; try the next place
    }
  }
  return null;
}
