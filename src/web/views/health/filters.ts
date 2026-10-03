import { create } from 'zustand';
import { NO_FILTERS, type Filters } from './issues.ts';

interface FilterState extends Filters {
  /** Vault root the filters belong to; switching vaults clears them. */
  root: string | null;
  update: (patch: Partial<Filters>) => void;
  clear: () => void;
  scopeTo: (root: string | null) => void;
}

// Module-level, so the filters survive view switches (a trip to the graph and back).
export const useHealthFilters = create<FilterState>((set, get) => ({
  ...NO_FILTERS,
  root: null,
  update: (patch) => set(patch),
  clear: () => set(NO_FILTERS),
  scopeTo: (root) => {
    if (get().root !== root) set({ ...NO_FILTERS, root });
  },
}));
