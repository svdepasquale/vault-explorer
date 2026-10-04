import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore } from '../../app/store.ts';
import { usePalette } from '../../app/theme.ts';
import { QueryBar } from './QueryBar.tsx';
import { errorCopy } from './reading.ts';
import { RecallResults } from './RecallResults.tsx';
import { useRecall, type RecallRun } from './recallStore.ts';
import { TipLayer } from './Tip.tsx';
import './recall.css';

const NOT_RETRYABLE = new Set(['unsupported', 'bad-request', 'no-vault']);

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function RunningLine({ run }: { run: RecallRun }) {
  const seconds = Math.max(0, (useNow(100) - run.startedAt) / 1000);
  return (
    <div className="recall-running">
      <span className="recall-spinner" aria-hidden="true" />
      <span role="status">Running retrieve.py for “{run.query}”</span>
      <span className="recall-running-time" aria-hidden="true">
        {seconds.toFixed(1)} s
      </span>
      {seconds > 2.5 && (
        <span className="recall-running-hint">The first query after vault edits embeds the new chunks, which can take a few seconds.</span>
      )}
    </div>
  );
}

function ErrorBox({ run, onRetry }: { run: RecallRun; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);
  const failure = run.error;
  if (!failure) return null;
  const copy = errorCopy(failure.code);
  const command = copy.command;
  const copyCommand = (): void => {
    if (!command) return;
    try {
      void navigator.clipboard?.writeText(command).then(
        () => setCopied(true),
        () => setCopied(false),
      );
    } catch {
      /* clipboard unavailable: the command stays selectable */
    }
  };
  return (
    <div className="recall-error" role="alert">
      <span className="recall-error-icon" aria-hidden="true">
        !
      </span>
      <div className="recall-error-body">
        <p className="recall-error-title">{copy.title}</p>
        <p className="recall-error-hint">{copy.hint}</p>
        {command && (
          <div className="recall-cmd">
            <code>{command}</code>
            <button type="button" className="btn btn-small" onClick={copyCommand}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
        <p className="recall-error-detail">
          {failure.message} <span className="recall-error-code">({failure.code})</span>
        </p>
        {!NOT_RETRYABLE.has(failure.code) && (
          <div>
            <button type="button" className="btn btn-small" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Intro() {
  return (
    <div className="recall-intro">
      <p className="recall-intro-title">Ask what Claude would recall</p>
      <p>
        Type a question the way you would ask Claude. The vault’s retrieval returns the chunks Claude would read for it, best first, with
        the scores that ranked them. Click a page to open it beside the list; <em>Show on graph</em> lights the hits up on the link graph.
      </p>
    </div>
  );
}

/** Recall: run the vault's own retrieval for a question and show what comes back. */
export default function RecallView() {
  const model = useStore((s) => s.model);
  const palette = usePalette();
  const current = useRecall((s) => s.current);
  const lastDone = useRecall((s) => s.lastDone);
  if (!model) return null;

  const vault = model.vault.root;
  const enabled = model.vault.capabilities.recall;
  const run = current?.vault === vault ? current : null;
  const previous = lastDone?.vault === vault && lastDone !== run ? lastDone : null;
  // Marks take the validated palette: accent for the score that ordered the list, muted ink for context.
  const marks = { '--recall-rank-bar': palette.accent, '--recall-context-bar': palette.ink3 } as CSSProperties;

  let body: ReactNode;
  if (!run) {
    body = <Intro />;
  } else if (run.status === 'running') {
    body = (
      <>
        <RunningLine run={run} />
        {previous && <RecallResults run={previous} stale />}
      </>
    );
  } else if (run.status === 'error') {
    body = <ErrorBox run={run} onRetry={() => void useRecall.getState().run(vault, run.query, run.top)} />;
  } else {
    body = <RecallResults run={run} stale={false} />;
  }

  return (
    <TipLayer>
      <div className="recall-view" style={marks}>
        <div className="recall-page">
          <header className="recall-header">
            <h1 className="recall-h1">Recall</h1>
            <p className="recall-lede">What would Claude remember for this question?</p>
          </header>

          {!enabled && (
            <div className="recall-callout" role="note">
              <span className="recall-callout-icon" aria-hidden="true">
                i
              </span>
              <div>
                <p className="recall-callout-title">Recall is not available for this vault</p>
                <p>
                  It runs the vault’s own <code>scripts/retrieve.py</code>, and this vault has none, so there is nothing to run. The other
                  views work as usual.
                </p>
              </div>
            </div>
          )}

          <QueryBar vault={vault} enabled={enabled} />
          {enabled && body}

          <footer className="recall-foot">
            <p>
              <strong>How this works.</strong> Recall runs the vault’s own <code>scripts/retrieve.py</code>, the same script Claude calls,
              locally on this machine, with the question passed over stdin. BM25 shortlists chunks by keyword, then local embedding models
              re-rank them by meaning. Like any Claude query, a run may update the vault’s untracked embedding cache under{' '}
              <code>.vault-meta/</code>; nothing under <code>wiki/</code> is written.
            </p>
          </footer>
        </div>
      </div>
    </TipLayer>
  );
}
