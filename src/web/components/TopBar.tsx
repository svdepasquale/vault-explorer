import { useEffect, useState } from 'react';
import { formatDate } from '../app/format.ts';
import { useStore, VIEWS, type ThemePreference } from '../app/store.ts';
import { QuickOpen } from './QuickOpen.tsx';

const THEME_CYCLE: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemePreference, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };

/** "updated 2 min ago" for the live indicator; re-renders every 30 s. */
function useSince(iso: string | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return formatDate(iso);
}

export function TopBar() {
  const status = useStore((s) => s.status);
  const model = useStore((s) => s.model);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setPickerOpen = useStore((s) => s.setPickerOpen);
  const since = useSince(model?.generatedAt ?? null);
  const errorCount = model?.health.filter((h) => h.severity === 'error').length ?? 0;
  const warningCount = model?.health.filter((h) => h.severity === 'warning').length ?? 0;

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <img src="./favicon.svg" alt="" width={22} height={22} />
        <span>Vault Explorer</span>
      </div>

      <button
        type="button"
        className="vault-switch"
        onClick={() => setPickerOpen(true)}
        title={status?.vault ?? 'Choose a vault'}
        disabled={!status?.vault}
      >
        <span className="vault-switch-name">{model?.vault.name ?? (status?.vault ? '…' : 'No vault')}</span>
        {model && (
          <span className="vault-switch-meta">
            <span className={`live-dot${status?.building ? ' building' : ''}`} aria-hidden="true" />
            {model.vault.head ? `${model.vault.branch ?? 'HEAD'}@${model.vault.head} · ` : ''}
            {since}
          </span>
        )}
      </button>

      <nav className="tabs" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`tab${view === v.id ? ' active' : ''}`}
            aria-current={view === v.id ? 'page' : undefined}
            onClick={() => setView(v.id)}
            disabled={!model}
          >
            {v.label}
            {v.id === 'health' && model && errorCount + warningCount > 0 && (
              <span className={`tab-count ${errorCount ? 'error' : 'warning'}`} title={`${errorCount} errors, ${warningCount} warnings`}>
                {errorCount + warningCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="topbar-right">
        <QuickOpen />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setTheme(THEME_CYCLE[theme])}
          title="Theme: auto follows the system setting"
        >
          {THEME_LABEL[theme]}
        </button>
      </div>
    </header>
  );
}
