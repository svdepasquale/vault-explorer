import { create } from 'zustand';
import type { RecallResponse } from '../../../shared/model.ts';
import { api, ApiFailure } from '../../app/api.ts';

export const TOP_CHOICES = [3, 5, 8, 12] as const;
export type TopK = (typeof TOP_CHOICES)[number];
export const DEFAULT_TOP: TopK = 5;
/** Claude's own retrieval protocol asks for the top 3 chunks. */
export const CLAUDE_TOP: TopK = 3;
/** The server rejects longer queries. */
export const MAX_QUERY_CHARS = 500;

const HISTORY_KEY = 'vault-explorer.recall.history';
const TOP_KEY = 'vault-explorer.recall.top';
const HISTORY_SIZE = 10;

export const isTopK = (value: unknown): value is TopK => TOP_CHOICES.some((k) => k === value);

export interface HistoryEntry {
  query: string;
  top: TopK;
  at: number;
}

export interface RecallFailure {
  /** Server error code; `network` when the server did not answer, `http` for a bare HTTP error. */
  code: string;
  message: string;
}

export interface RecallRun {
  id: number;
  /** Vault root the run was made against: a run for another vault is stale. */
  vault: string;
  query: string;
  top: TopK;
  startedAt: number;
  status: 'running' | 'done' | 'error';
  response: RecallResponse | null;
  error: RecallFailure | null;
}

interface RecallState {
  draft: string;
  top: TopK;
  /** The latest run, whatever its outcome. */
  current: RecallRun | null;
  /** The latest successful run, kept on screen (dimmed) while the next one runs. */
  lastDone: RecallRun | null;
  history: HistoryEntry[];
  setDraft: (draft: string) => void;
  setTop: (top: TopK) => void;
  run: (vault: string, query: string, top: TopK) => Promise<void>;
  clearHistory: () => void;
}

function readHistory(): HistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((item: unknown): HistoryEntry[] => {
        if (typeof item !== 'object' || item === null) return [];
        const { query, top, at } = item as Record<string, unknown>;
        if (typeof query !== 'string' || !query.trim()) return [];
        return [
          { query: query.trim().slice(0, MAX_QUERY_CHARS), top: isTopK(top) ? top : DEFAULT_TOP, at: typeof at === 'number' ? at : 0 },
        ];
      })
      .slice(0, HISTORY_SIZE);
  } catch {
    return [];
  }
}

function writeHistory(history: HistoryEntry[]): void {
  try {
    if (history.length) localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    else localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* blocked storage: the history lasts for this session only */
  }
}

function readTop(): TopK {
  try {
    const value = Number(localStorage.getItem(TOP_KEY));
    return isTopK(value) ? value : DEFAULT_TOP;
  } catch {
    return DEFAULT_TOP;
  }
}

function writeTop(top: TopK): void {
  try {
    localStorage.setItem(TOP_KEY, String(top));
  } catch {
    /* ignore */
  }
}

function remember(history: HistoryEntry[], query: string, top: TopK): HistoryEntry[] {
  const key = query.toLowerCase();
  return [{ query, top, at: Date.now() }, ...history.filter((h) => h.query.toLowerCase() !== key)].slice(0, HISTORY_SIZE);
}

function toFailure(err: unknown): RecallFailure {
  if (err instanceof ApiFailure) return { code: err.code ?? 'http', message: err.message };
  // fetch() rejects with a TypeError when the server cannot be reached.
  if (err instanceof TypeError) return { code: 'network', message: err.message };
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) };
}

let sequence = 0;

/** Recall state lives at module level so a run survives switching views. */
export const useRecall = create<RecallState>((set, get) => ({
  draft: '',
  top: readTop(),
  current: null,
  lastDone: null,
  history: readHistory(),

  setDraft: (draft) => set({ draft }),
  setTop: (top) => {
    writeTop(top);
    set({ top });
  },
  run: async (vault, rawQuery, top) => {
    const query = rawQuery.trim().slice(0, MAX_QUERY_CHARS);
    if (!query) return;
    const base: RecallRun = { id: ++sequence, vault, query, top, startedAt: Date.now(), status: 'running', response: null, error: null };
    set({ current: base });
    try {
      const response = await api.recall(query, top);
      if (get().current?.id !== base.id) return;
      const done: RecallRun = { ...base, status: 'done', response };
      const history = remember(get().history, query, top);
      writeHistory(history);
      set({ current: done, lastDone: done, history });
    } catch (err) {
      if (get().current?.id !== base.id) return;
      set({ current: { ...base, status: 'error', error: toFailure(err) } });
    }
  },
  clearHistory: () => {
    writeHistory([]);
    set({ history: [] });
  },
}));
