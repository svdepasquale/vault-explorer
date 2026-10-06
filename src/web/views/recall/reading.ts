import type { Page, RecallCandidate } from '../../../shared/model.ts';

/**
 * How to read `RecallCandidate.score` for one response:
 * - fused: several embedding models, each cosine z-scored within the BM25
 *   candidates of the query, then averaged (retrieve.py's default);
 * - cosine: a single model, raw cosine similarity;
 * - none: the rerank did not run, so the score is a placeholder.
 */
export type ScoreMode = 'fused' | 'cosine' | 'none';

export interface StrategyInfo {
  /** hybrid = BM25 + embedding rerank; degraded = the rerank failed, BM25 order. */
  kind: 'hybrid' | 'degraded' | 'bm25' | 'unknown';
  label: string;
  /** Embedding models that reranked, display names. */
  models: string[];
  /** Why the rerank did not run (degraded / bm25). */
  reason: string | null;
  scoreMode: ScoreMode;
  raw: string | null;
}

// rerank.py's rerank_source values for the no-op paths.
const NOOP_REASONS: Record<string, string> = {
  'noop-no-backend':
    'no embedding backend was available (the local llama-embedding binary or its model files are missing, or the configured HTTP backend is down)',
  'noop-no-model': 'the embedding models are not available on the backend',
  'noop-embed-error': 'embedding failed while answering this query',
};

/** `llamacpp2/text-embedding-nomic-embed-text-v1.5@f16` → `nomic-embed-text-v1.5`. */
function modelName(id: string): string {
  return id
    .replace(/^[^/]*\//, '')
    .replace(/^text-embedding-/, '')
    .replace(/@[^@]*$/, '');
}

export function readStrategy(raw: string | null, candidates: readonly RecallCandidate[]): StrategyInfo {
  const scores = candidates.flatMap((c) => (c.score === null ? [] : [c.score]));
  const outsideUnit = scores.some((s) => s < 0 || s > 1);
  if (raw?.includes('noop')) {
    const code = /noop[-a-z]*/.exec(raw)?.[0] ?? 'noop';
    return {
      kind: 'degraded',
      label: 'BM25 only',
      models: [],
      reason: NOOP_REASONS[code] ?? 'the rerank stage did not run',
      scoreMode: 'none',
      raw,
    };
  }
  const cosine = raw ? /rerank:cosine:(.+)$/.exec(raw) : null;
  if (cosine?.[1]) {
    const models = cosine[1].split('+').map(modelName).filter(Boolean);
    return { kind: 'hybrid', label: 'Hybrid', models, reason: null, scoreMode: models.length > 1 || outsideUnit ? 'fused' : 'cosine', raw };
  }
  if (raw === 'bm25-only') {
    return { kind: 'bm25', label: 'BM25 only', models: [], reason: 'the rerank was switched off', scoreMode: 'none', raw };
  }
  return {
    kind: 'unknown',
    label: 'Unknown strategy',
    models: [],
    reason: null,
    scoreMode: scores.length === 0 ? 'none' : outsideUnit ? 'fused' : 'cosine',
    raw,
  };
}

export interface Domain {
  min: number;
  max: number;
}

export const UNIT_DOMAIN: Domain = { min: 0, max: 1 };

/**
 * z-scores: the baseline is 0, an average candidate. The positive end stays at
 * +3 (or the next integer above the best hit) so lengths compare across
 * queries; a negative side appears only when a hit is below average.
 */
export function scoreDomain(mode: ScoreMode, candidates: readonly RecallCandidate[]): Domain {
  if (mode !== 'fused') return UNIT_DOMAIN;
  const scores = candidates.flatMap((c) => (c.score === null ? [] : [c.score]));
  return { min: Math.floor(Math.min(0, ...scores)), max: Math.max(3, Math.ceil(Math.max(0, ...scores))) };
}

export function describeDomain(domain: Domain, mode: ScoreMode): string {
  if (mode !== 'fused') return `Bars run from ${domain.min} to ${domain.max}.`;
  const end = `+${domain.max}`;
  return domain.min < 0
    ? `Bars run from ${formatScore(domain.min, mode).replace('.00', '')} to ${end}; the hairline marks 0, an average candidate.`
    : `Bars run from 0, an average candidate, to ${end}.`;
}

/** BM25 depends on the query's terms: bars are relative to the best match in the list. */
export function bm25Domain(candidates: readonly RecallCandidate[]): Domain {
  const max = Math.max(0, ...candidates.map((c) => c.bm25 ?? 0));
  return { min: 0, max: max > 0 ? max : 1 };
}

export interface BarGeometry {
  /** Position of the zero baseline, percent of the track. */
  zero: number;
  start: number;
  width: number;
  negative: boolean;
  /** The value lies outside the domain; the bar is drawn to the edge. */
  clipped: boolean;
}

export function barGeometry(value: number, domain: Domain): BarGeometry {
  const span = domain.max - domain.min || 1;
  const clamped = Math.min(domain.max, Math.max(domain.min, value));
  const zero = ((0 - domain.min) / span) * 100;
  const end = ((clamped - domain.min) / span) * 100;
  return { zero, start: Math.min(zero, end), width: Math.abs(end - zero), negative: clamped < 0, clipped: clamped !== value };
}

const MINUS = '−';

export function formatScore(value: number, mode: ScoreMode): string {
  if (mode !== 'fused') return value.toFixed(3);
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded > 0 ? '+' : rounded < 0 ? MINUS : '';
  return `${sign}${Math.abs(rounded).toFixed(2)}`;
}

export function formatBm25(value: number): string {
  return value.toFixed(2);
}

export const SNIPPET_CHARS = 240;

export function cleanSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** First ~240 characters cut at a word boundary, or null when the text is short enough to show whole. */
export function clipSnippet(text: string, limit = SNIPPET_CHARS): string | null {
  if (text.length <= limit + 40) return null;
  const head = text.slice(0, limit);
  const space = head.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? head.slice(0, space) : head).replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** Page id → chunk ranks (1-based) in the list, to mark pages hit by several chunks. */
export function ranksByPage(candidates: readonly RecallCandidate[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  candidates.forEach((c, i) => {
    if (!c.pageId) return;
    const list = map.get(c.pageId);
    if (list) list.push(i + 1);
    else map.set(c.pageId, [i + 1]);
  });
  return map;
}

/** Recall-lens ranks for the graph: pages in order of their first chunk, unknown pages skipped. */
export function graphRanks(candidates: readonly RecallCandidate[], pageById: ReadonlyMap<string, Page>): Record<string, number> {
  const ranks: Record<string, number> = {};
  let rank = 0;
  for (const c of candidates) {
    if (!c.pageId || !pageById.has(c.pageId) || ranks[c.pageId] !== undefined) continue;
    ranks[c.pageId] = ++rank;
  }
  return ranks;
}

export interface ErrorCopy {
  title: string;
  hint: string;
  /** A command to run in the vault folder, when there is an obvious fix. */
  command?: string;
}

export function errorCopy(code: string): ErrorCopy {
  switch (code) {
    case 'not-provisioned':
      return {
        title: 'The retrieval index is not built',
        hint: 'retrieve.py found no BM25 index or no chunks in this vault. Build them from the vault folder with the index refresh, then run the query again.',
        command: 'python3 scripts/contextual-prefix.py --all && python3 scripts/bm25-index.py build',
      };
    case 'unsupported':
      return {
        title: 'This vault has no retrieval script',
        hint: 'Recall runs scripts/retrieve.py from a vault-engine checkout next to the vault (or VAULT_ENGINE, or the vault’s own scripts/), and none was found. The other views work as usual.',
      };
    case 'timeout':
      return {
        title: 'Retrieval took too long',
        hint: 'retrieve.py did not answer in time. Usually many new chunks were waiting to be embedded; pre-embed them once from the vault folder, then retry.',
        command: 'python3 scripts/rerank.py --embed-all',
      };
    case 'failed':
      return {
        title: 'retrieve.py failed',
        hint: 'The script exited with an error. Its last lines are below; running the same query in a terminal shows the full trace.',
      };
    case 'spawn':
      return {
        title: 'python3 could not be started',
        hint: 'The explorer server could not run python3. Check that python3 is on the PATH of the process that started the explorer.',
      };
    case 'bad-request':
      return {
        title: 'The query was rejected',
        hint: 'A query must be non-empty and at most 500 characters long.',
      };
    case 'bad-output':
      return {
        title: 'retrieve.py answered with something unexpected',
        hint: 'Its output was not JSON: the script may print extra text, or a newer version changed its format.',
      };
    case 'no-vault':
      return { title: 'No vault is open', hint: 'Choose a vault first, then run the query again.' };
    case 'network':
      return {
        title: 'The explorer server did not answer',
        hint: 'It may have stopped. Start it again, reload this page and retry.',
      };
    default:
      return { title: 'Recall failed', hint: 'The server reported an error running the query.' };
  }
}
