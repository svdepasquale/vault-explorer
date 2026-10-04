import { useState, type FormEvent } from 'react';
import type { StatusResponse } from '../../shared/model.ts';
import { api } from '../app/api.ts';
import { useStore } from '../app/store.ts';

/** Choose the vault repository: recent list, typed path, or the native macOS chooser. */
export function VaultPicker({ inline = false }: { inline?: boolean }) {
  const status = useStore((s) => s.status);
  const applyStatus = useStore((s) => s.applyStatus);
  const setPickerOpen = useStore((s) => s.setPickerOpen);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<{ cancelled?: boolean; status: StatusResponse } | null>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result && !result.cancelled) {
        await applyStatus(result.status);
        setPickerOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const open = (p: string) => run(async () => ({ status: await api.selectVault(p) }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (path.trim()) void open(path.trim());
  };
  const recent = status?.recent ?? [];
  const isMac = status?.platform === 'darwin';

  const body = (
    <div className={`picker${inline ? ' picker-inline' : ''}`} {...(inline ? { role: 'region', 'aria-labelledby': 'picker-title' } : { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'picker-title' })}>
      <h2 id="picker-title">{inline ? 'Open a vault' : 'Switch vault'}</h2>
      <p className="picker-hint">
        Pick the root of a knowledge-vault repository — the folder that contains <code>wiki/</code>. Nothing is written to it.
      </p>

      {recent.length > 0 && (
        <ul className="picker-recent">
          {recent.map((p) => (
            <li key={p}>
              <button type="button" className={`picker-recent-item${p === status?.vault ? ' current' : ''}`} disabled={busy} onClick={() => void open(p)}>
                <span className="picker-recent-name">{p.split('/').filter(Boolean).pop()}</span>
                <span className="picker-recent-path">{p}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="picker-form" onSubmit={submit}>
        <input
          type="text"
          className="input"
          placeholder="~/projects/knowledge-vault"
          aria-label="Vault path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          disabled={busy}
          // biome-ignore lint/a11y/noAutofocus: the user just opened this dialog; focus belongs in its input
          autoFocus={!inline}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !path.trim()}>
          Open
        </button>
        {isMac && (
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => api.pickVault())}>
            Browse…
          </button>
        )}
      </form>
      {error && (
        <p className="picker-error" role="alert">
          {error}
        </p>
      )}
      {!inline && (
        <div className="picker-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setPickerOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  if (inline) return <div className="app-empty">{body}</div>;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: click outside to close; Escape closes it from the keyboard (App)
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPickerOpen(false)}>
      {body}
    </div>
  );
}
