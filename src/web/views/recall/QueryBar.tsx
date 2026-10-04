import { useEffect, useRef, type FormEvent } from 'react';
import { CLAUDE_TOP, MAX_QUERY_CHARS, TOP_CHOICES, useRecall, type TopK } from './recallStore.ts';

/** Question input, top-k choice, Run, and the recent queries. */
export function QueryBar({ vault, enabled }: { vault: string; enabled: boolean }) {
  const draft = useRecall((s) => s.draft);
  const top = useRecall((s) => s.top);
  const history = useRecall((s) => s.history);
  const running = useRecall((s) => s.current?.status === 'running');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (enabled) inputRef.current?.focus();
  }, [enabled]);

  const start = (query: string, k: TopK): void => {
    if (!enabled || running || !query.trim()) return;
    void useRecall.getState().run(vault, query, k);
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    start(draft, top);
  };

  const chooseTop = (k: TopK): void => {
    const state = useRecall.getState();
    state.setTop(k);
    // Same question at another depth: run it straight away.
    const shown = state.current;
    if (shown?.status === 'done' && shown.vault === vault && shown.query === draft.trim() && shown.top !== k) start(draft, k);
  };

  const rerun = (query: string, k: TopK): void => {
    if (!enabled || running) return;
    const state = useRecall.getState();
    state.setDraft(query);
    state.setTop(k);
    start(query, k);
  };

  return (
    <form className="recall-form card" role="search" aria-label="Recall query" onSubmit={onSubmit}>
      <div className="recall-form-row">
        <label className="recall-sr" htmlFor="recall-query">
          Question
        </label>
        <input
          id="recall-query"
          ref={inputRef}
          className="input recall-input"
          type="text"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Ask in English, as you would ask Claude: “how is the app deployed?”"
          maxLength={MAX_QUERY_CHARS}
          value={draft}
          disabled={!enabled}
          onChange={(e) => useRecall.getState().setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Explicit Enter (not implicit form submission); an IME composition keeps its Enter.
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            start(draft, top);
          }}
        />
        <div className="recall-top">
          <span className="recall-top-label" id="recall-top-label">
            Top
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="recall-top-label">
            {TOP_CHOICES.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={top === k}
                className={top === k ? 'active' : ''}
                disabled={!enabled}
                title={k === CLAUDE_TOP ? 'Top 3: what Claude’s own retrieval protocol asks for' : `Return the ${k} best chunks`}
                onClick={() => chooseTop(k)}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" className="btn btn-primary recall-run" disabled={!enabled || running || !draft.trim()}>
          {running ? (
            <>
              <span className="recall-spinner" aria-hidden="true" />
              Running
            </>
          ) : (
            'Run'
          )}
        </button>
      </div>
      <p className="recall-form-hint">
        English queries recall better: the vault is written in English. Claude’s own protocol retrieves the top {CLAUDE_TOP}; Enter runs the
        query.
      </p>
      {history.length > 0 && (
        <div className="recall-history" role="group" aria-label="Recent queries">
          <span className="recall-history-label">Recent</span>
          {history.map((h) => (
            <button
              key={h.query}
              type="button"
              className="recall-chip"
              title={`Run again: “${h.query}” (top ${h.top})`}
              disabled={!enabled || running}
              onClick={() => rerun(h.query, h.top)}
            >
              {h.query}
            </button>
          ))}
          <button type="button" className="btn-link recall-history-clear" onClick={() => useRecall.getState().clearHistory()}>
            Clear
          </button>
        </div>
      )}
    </form>
  );
}
