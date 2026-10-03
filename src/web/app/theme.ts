import { useEffect, useSyncExternalStore } from 'react';
import { PALETTES, type Palette, type ThemeName } from './palette.ts';
import { useStore } from './store.ts';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function subscribe(callback: () => void): () => void {
  media?.addEventListener('change', callback);
  return () => media?.removeEventListener('change', callback);
}

function systemTheme(): ThemeName {
  return media?.matches ? 'dark' : 'light';
}

/** The theme actually rendered: the user's choice, else the OS setting. */
export function useResolvedTheme(): ThemeName {
  const preference = useStore((s) => s.theme);
  const system = useSyncExternalStore(subscribe, systemTheme, () => 'light' as ThemeName);
  return preference === 'system' ? system : preference;
}

export function usePalette(): Palette {
  return PALETTES[useResolvedTheme()];
}

/** Mirror the preference on <html data-theme> so tokens.css follows it. */
export function useThemeAttribute(): void {
  const preference = useStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
  }, [preference]);
}
