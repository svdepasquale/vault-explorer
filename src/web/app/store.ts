import { create } from 'zustand';
import type { PageKind, StatusResponse, VaultModel } from '../../shared/model.ts';
import { api, ApiFailure } from './api.ts';

export const VIEWS = [
  { id: 'graph', label: 'Graph' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'overview', label: 'Overview' },
  { id: 'health', label: 'Health' },
  { id: 'recall', label: 'Recall' },
] as const;
export type ViewId = (typeof VIEWS)[number]['id'];
export const isViewId = (v: string): v is ViewId => VIEWS.some((x) => x.id === v);

export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorMode = 'kind' | 'freshness' | 'emphasis';
export type EmphasisField = 'domain' | 'tag' | 'status';

export interface GraphSettings {
  colorBy: ColorMode;
  emphasis: { field: EmphasisField; value: string | null };
  showBodyLinks: boolean;
  showRelations: boolean;
  /** Pages with `index: false` (archived, superseded). */
  showArchived: boolean;
  /** Paint one-sided typed relations in the warning color. */
  showAsymmetric: boolean;
  /** Kinds toggled off in the legend; navigation pages start hidden. */
  hiddenKinds: PageKind[];
  /** Only typed edges of this predicate (body links hidden), or null for all. */
  predicate: string | null;
  /** 0 = whole graph; 1..3 = neighbourhood of the selected page. */
  focusDepth: number;
}

/** Recall-lens result painted over the graph: page id → rank (1-based). */
export interface Highlight {
  query: string;
  ranks: Record<string, number>;
}

interface AppState {
  status: StatusResponse | null;
  model: VaultModel | null;
  loadError: string | null;
  view: ViewId;
  selected: string | null;
  theme: ThemePreference;
  graph: GraphSettings;
  highlight: Highlight | null;
  /** Time-travel cursor (epoch ms): the graph shows the vault as it was then; null = now. */
  timeCursor: number | null;
  pickerOpen: boolean;

  setView: (view: ViewId) => void;
  select: (id: string | null) => void;
  setTheme: (theme: ThemePreference) => void;
  updateGraph: (patch: Partial<GraphSettings>) => void;
  setHighlight: (highlight: Highlight | null) => void;
  setTimeCursor: (time: number | null) => void;
  setPickerOpen: (open: boolean) => void;
  /** Re-read status and, when the server has a newer model, the model. */
  refresh: () => Promise<void>;
  applyStatus: (status: StatusResponse) => Promise<void>;
}

const THEME_KEY = 'vault-explorer.theme';
const GRAPH_KEY = 'vault-explorer.graph';

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as object) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or blocked storage: settings just do not persist */
  }
}

export const DEFAULT_GRAPH: GraphSettings = {
  colorBy: 'kind',
  emphasis: { field: 'domain', value: null },
  showBodyLinks: true,
  showRelations: true,
  showArchived: true,
  showAsymmetric: false,
  hiddenKinds: ['nav'],
  predicate: null,
  focusDepth: 0,
};

function readTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let loadingVersion = -1;

export const useStore = create<AppState>((set, get) => ({
  status: null,
  model: null,
  loadError: null,
  view: 'graph',
  selected: null,
  theme: readTheme(),
  graph: readLocal(GRAPH_KEY, DEFAULT_GRAPH),
  highlight: null,
  timeCursor: null,
  pickerOpen: false,

  setView: (view) => set({ view }),
  select: (id) => set({ selected: id }),
  setTheme: (theme) => {
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
  updateGraph: (patch) => {
    const graph = { ...get().graph, ...patch };
    // Focus, predicate filter and emphasis value are per-session; persist the rest.
    writeLocal(GRAPH_KEY, { ...graph, focusDepth: 0, predicate: null, emphasis: { field: graph.emphasis.field, value: null } });
    set({ graph });
  },
  setHighlight: (highlight) => set({ highlight }),
  setTimeCursor: (timeCursor) => set({ timeCursor }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),

  refresh: async () => {
    try {
      await get().applyStatus(await api.status());
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : String(err) });
    }
  },

  applyStatus: async (status) => {
    const previousVault = get().status?.vault ?? null;
    set({ status });
    if (status.vault !== previousVault) set({ selected: null, highlight: null, timeCursor: null });
    if (!status.ready) {
      set({ model: null, loadError: status.error });
      return;
    }
    const current = get().model;
    if (current && current.version === status.modelVersion && current.vault.root === status.vault) return;
    if (loadingVersion === status.modelVersion) return;
    loadingVersion = status.modelVersion;
    try {
      const model = await api.model();
      const selected = get().selected;
      set({
        model,
        loadError: status.error,
        selected: selected && model.pages.some((p) => p.id === selected) ? selected : null,
      });
    } catch (err) {
      set({ loadError: err instanceof ApiFailure || err instanceof Error ? err.message : String(err) });
    } finally {
      loadingVersion = -1;
    }
  },
}));
