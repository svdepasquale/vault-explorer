import { Suspense, useEffect } from 'react';
import { PagePanel } from '../components/PagePanel.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { VaultPicker } from '../components/VaultPicker.tsx';
import { VIEW_COMPONENTS } from '../views/registry.ts';
import { subscribeModelVersions } from './api.ts';
import { isViewId, useStore, type ViewId } from './store.ts';
import { useThemeAttribute } from './theme.ts';

function parseHash(hash: string): { view: ViewId; page: string | null } {
  const m = /^#\/([a-z]+)(?:\?(.*))?$/.exec(hash);
  const view = m?.[1] && isViewId(m[1]) ? m[1] : 'graph';
  return { view, page: new URLSearchParams(m?.[2] ?? '').get('page') };
}

function toHash(view: ViewId, page: string | null): string {
  return `#/${view}${page ? `?page=${encodeURIComponent(page)}` : ''}`;
}

/** Keep view + selected page in the URL hash, so back/forward and reloads work. */
function useHashRoute(): void {
  const view = useStore((s) => s.view);
  const selected = useStore((s) => s.selected);

  useEffect(() => {
    const apply = (): void => {
      const { view: v, page } = parseHash(window.location.hash);
      useStore.setState({ view: v, selected: page });
    };
    apply();
    window.addEventListener('hashchange', apply);
    window.addEventListener('popstate', apply);
    return () => {
      window.removeEventListener('hashchange', apply);
      window.removeEventListener('popstate', apply);
    };
  }, []);

  useEffect(() => {
    const next = toHash(view, selected);
    if (window.location.hash !== next) window.history.pushState(null, '', next);
  }, [view, selected]);
}

/** Initial status + live model updates pushed by the server. */
function useLiveModel(): void {
  const refresh = useStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
    return subscribeModelVersions((version) => {
      const { status, model } = useStore.getState();
      if (!model || version !== model.version || version !== status?.modelVersion) void refresh();
    });
  }, [refresh]);
}

export function App() {
  useThemeAttribute();
  useHashRoute();
  useLiveModel();

  const status = useStore((s) => s.status);
  const model = useStore((s) => s.model);
  const view = useStore((s) => s.view);
  const selected = useStore((s) => s.selected);
  const pickerOpen = useStore((s) => s.pickerOpen);
  const loadError = useStore((s) => s.loadError);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const state = useStore.getState();
      if (state.pickerOpen) state.setPickerOpen(false);
      else if (state.selected) state.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const View = VIEW_COMPONENTS[view];
  const noVault = status !== null && !status.vault;

  return (
    <div className="app">
      <TopBar />
      <main className="app-main">
        {status === null && !loadError && <div className="app-empty">Connecting…</div>}
        {loadError && !model && !noVault && (
          <div className="app-empty">
            <p className="app-empty-title">The vault could not be loaded</p>
            <p className="app-empty-detail">{loadError}</p>
            <button type="button" className="btn" onClick={() => useStore.getState().setPickerOpen(true)}>
              Choose another vault
            </button>
          </div>
        )}
        {noVault && <VaultPicker inline />}
        {model && (
          <div className={`app-content${selected ? ' with-panel' : ''}`}>
            <section className="app-view" aria-label={view}>
              <Suspense fallback={<div className="app-empty">Loading view…</div>}>
                <View />
              </Suspense>
            </section>
            {selected && <PagePanel id={selected} />}
          </div>
        )}
      </main>
      {pickerOpen && !noVault && <VaultPicker />}
    </div>
  );
}
