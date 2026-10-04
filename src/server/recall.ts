import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { RecallCandidate, RecallResponse } from '../shared/model.ts';

const TIMEOUT_MS = 90_000;

export class RecallError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function pageIdOf(path: string): string | null {
  const m = /^wiki\/(.+)\.md$/i.exec(path.replace(/\\/g, '/'));
  return m?.[1] ?? null;
}

/**
 * Run the vault's own hybrid retrieval (`scripts/retrieve.py`), the same call
 * Claude makes. The query goes over stdin, never argv. Side effects are the
 * script's own: it may embed new chunks into its untracked cache under
 * `.vault-meta/` and take its lock files; nothing under `wiki/` is touched.
 */
export function runRecall(vault: string, query: string, top: number): Promise<RecallResponse> {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    // Chunk mode, as in Claude's own read protocol: ranked chunks, not one hit per page.
    const child = spawn('python3', [join(vault, 'scripts', 'retrieve.py'), '-', '--top', String(top), '--chunks'], {
      cwd: vault,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new RecallError('timeout', `retrieve.py did not answer within ${TIMEOUT_MS / 1000} s`));
    }, TIMEOUT_MS);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new RecallError('spawn', `cannot run python3: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 10) {
        reject(
          new RecallError('not-provisioned', 'The retrieval index is not built (retrieve.py exit 10). Run the index refresh in the vault.'),
        );
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
        reject(new RecallError('failed', `retrieve.py exited with ${code}${detail ? `: ${detail}` : ''}`));
        return;
      }
      try {
        const data = JSON.parse(stdout) as { strategy?: unknown; candidates?: unknown };
        const list = Array.isArray(data.candidates) ? (data.candidates as Record<string, unknown>[]) : [];
        const candidates: RecallCandidate[] = list.map((c) => {
          const path = typeof c['page_path'] === 'string' ? c['page_path'] : '';
          return {
            pageId: pageIdOf(path),
            path,
            chunkId: typeof c['chunk_id'] === 'string' ? c['chunk_id'] : null,
            score: num(c['rerank_score']),
            bm25: num(c['bm25_score']),
            snippet: typeof c['text'] === 'string' ? c['text'] : typeof c['snippet'] === 'string' ? c['snippet'] : '',
          };
        });
        resolvePromise({
          query,
          strategy: typeof data.strategy === 'string' ? data.strategy : null,
          elapsedMs: Date.now() - started,
          candidates,
        });
      } catch {
        reject(new RecallError('bad-output', 'retrieve.py printed something that is not JSON'));
      }
    });
    child.stdin.end(query);
  });
}
