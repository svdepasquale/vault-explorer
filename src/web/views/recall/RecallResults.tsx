import { useState, type ReactNode } from 'react';
import { KIND_LABELS, type Page, type RecallCandidate } from '../../../shared/model.ts';
import type { Derived } from '../../app/derived.ts';
import { useDerived } from '../../app/derived.ts';
import { formatNumber, plural } from '../../app/format.ts';
import { useStore, type GraphSettings } from '../../app/store.ts';
import { PageLink } from '../../components/PageLink.tsx';
import {
  bm25Domain,
  cleanSnippet,
  clipSnippet,
  describeDomain,
  formatBm25,
  formatScore,
  graphRanks,
  ranksByPage,
  readStrategy,
  scoreDomain,
  type Domain,
  type StrategyInfo,
} from './reading.ts';
import type { RecallRun } from './recallStore.ts';
import { ScoreCell } from './ScoreCell.tsx';
import { useTip } from './Tip.tsx';

function hiddenOnGraph(page: Page, graph: GraphSettings): boolean {
  return graph.hiddenKinds.includes(page.kind) || (!page.indexed && !graph.showArchived && page.kind !== 'nav');
}

function modelList(strategy: StrategyInfo): string {
  return strategy.models.length ? strategy.models.join(' + ') : 'the embedding models';
}

function rerankName(strategy: StrategyInfo): string {
  return strategy.scoreMode === 'fused' ? 'Rerank z' : 'Cosine';
}

function rerankExplainer(strategy: StrategyInfo, domain: Domain): string {
  const range = describeDomain(domain, strategy.scoreMode);
  if (strategy.scoreMode === 'fused') {
    return `Each embedding model (${modelList(strategy)}) compares the query with every BM25 candidate; its cosine is standardized within those candidates (0 = an average candidate, +1 = one standard deviation better) and the models are averaged. It orders this list, relative to this query: not an absolute relevance. ${range}`;
  }
  return `Cosine similarity between the query and the chunk (${modelList(strategy)}). It orders this list. ${range}`;
}

function bm25Explainer(strategy: StrategyInfo, domain: Domain): string {
  const role =
    strategy.scoreMode === 'none'
      ? 'With no rerank, it orders this list.'
      : 'Here it only shortlists the candidates; the rerank orders them.';
  return `Keyword match (BM25) between the query and the chunk text with its page context. Bars are relative to the strongest match in this list (${formatBm25(domain.max)}). ${role}`;
}

function TipHead({ value, label }: { value?: string; label: string }) {
  return (
    <div className="recall-tip-head">
      {value && <span className="recall-tip-value">{value}</span>}
      <span className="recall-tip-label">{label}</span>
    </div>
  );
}

function StrategyBadge({ strategy, tipKey }: { strategy: StrategyInfo; tipKey: string }) {
  const bind = useTip(tipKey, () => {
    let title: string;
    let body: ReactNode;
    if (strategy.kind === 'hybrid') {
      title = 'Hybrid retrieval';
      body = `BM25 shortlists chunks by keyword, then local embedding models (${modelList(strategy)}) re-rank them by meaning: the normal mode of Claude’s retrieval.`;
    } else if (strategy.kind === 'degraded') {
      title = 'Degraded: the rerank did not run';
      body = `Cause: ${strategy.reason ?? 'unknown'}. These results are in plain keyword (BM25) order, the fallback Claude also gets when no embedder is available.`;
    } else if (strategy.kind === 'bm25') {
      title = 'BM25 only';
      body = 'The rerank was switched off, so the results are in keyword (BM25) order.';
    } else {
      title = 'Unrecognised strategy';
      body = 'retrieve.py reported a strategy this view does not know; scores are shown as received.';
    }
    return (
      <>
        <TipHead label={title} />
        <p>{body}</p>
        {strategy.raw && <p className="recall-tip-raw">{strategy.raw}</p>}
      </>
    );
  });
  const degraded = strategy.kind === 'degraded';
  return (
    <span className={`recall-badge${degraded ? ' is-degraded' : ''}`} {...bind}>
      {degraded ? (
        <span className="recall-badge-icon" aria-hidden="true">
          !
        </span>
      ) : (
        strategy.kind === 'hybrid' && <span className="recall-badge-dot" aria-hidden="true" />
      )}
      {strategy.label}
    </span>
  );
}

function Elapsed({ ms, tipKey }: { ms: number; tipKey: string }) {
  const bind = useTip(tipKey, () => (
    <>
      <TipHead value={`${formatNumber(ms)} ms`} label="Elapsed" />
      <p>Wall time of retrieve.py on the server, including the embedding of any chunk not cached yet.</p>
    </>
  ));
  return (
    <span className="recall-elapsed" {...bind}>
      {formatNumber(ms)} ms
    </span>
  );
}

function ColumnHead({ label, tipKey, explain }: { label: string; tipKey: string; explain: string }) {
  const bind = useTip(tipKey, () => (
    <>
      <TipHead label={label} />
      <p>{explain}</p>
    </>
  ));
  return (
    <span className="recall-colhead-score" {...bind}>
      <span className="recall-colhead-term">{label}</span>
    </span>
  );
}

interface RowContext {
  run: RecallRun;
  strategy: StrategyInfo;
  scoreDomain: Domain;
  bm25Domain: Domain;
  byPage: Map<string, number[]>;
  derived: Derived;
  selected: string | null;
}

function ResultRow({ candidate, rank, ctx }: { candidate: RecallCandidate; rank: number; ctx: RowContext }) {
  const [expanded, setExpanded] = useState(false);
  const { strategy } = ctx;
  const page = candidate.pageId ? ctx.derived.pageById.get(candidate.pageId) : undefined;
  const others = candidate.pageId ? (ctx.byPage.get(candidate.pageId) ?? []).filter((r) => r !== rank) : [];
  const text = cleanSnippet(candidate.snippet);
  const clipped = clipSnippet(text);
  const hasScore = strategy.scoreMode !== 'none';
  const scoreText = candidate.score === null ? '—' : formatScore(candidate.score, strategy.scoreMode);
  const bm25Text = candidate.bm25 === null ? '—' : formatBm25(candidate.bm25);
  const selected = candidate.pageId !== null && candidate.pageId === ctx.selected;

  return (
    <li className={`recall-row${selected ? ' is-selected' : ''}`}>
      <span className="recall-rank">
        <span className="recall-sr">Rank </span>
        {rank}
      </span>
      <div className="recall-page-cell">
        {candidate.pageId ? (
          <PageLink id={candidate.pageId} />
        ) : (
          <span className="recall-path">{candidate.path || 'unknown page'}</span>
        )}
        {page && page.title !== page.stem && <span className="recall-page-title">{page.title}</span>}
        {candidate.chunkId && (
          <span className="recall-chunk" title="Chunk id: page address and chunk index">
            {candidate.chunkId}
          </span>
        )}
        {others.length > 0 && (
          <span className="recall-mark" title={`Another chunk of this page ranks #${others.join(', #')}`}>
            also #{others.join(', #')}
          </span>
        )}
        {candidate.pageId && !page && (
          <span
            className="recall-mark is-warning"
            title="This page is not in the vault any more: the retrieval index predates a rename or a deletion. Refresh the index."
          >
            <span className="recall-mark-icon" aria-hidden="true">
              !
            </span>
            not in the vault
          </span>
        )}
      </div>
      {hasScore && (
        <ScoreCell
          label={rerankName(strategy)}
          value={candidate.score}
          text={scoreText}
          domain={ctx.scoreDomain}
          ranking
          tipKey={`score:${ctx.run.id}:${rank}`}
          tip={() => (
            <>
              <TipHead value={scoreText} label={strategy.scoreMode === 'fused' ? 'Rerank score (fused z)' : 'Rerank score (cosine)'} />
              <p>{rerankExplainer(strategy, ctx.scoreDomain)}</p>
            </>
          )}
        />
      )}
      <ScoreCell
        label="BM25"
        value={candidate.bm25}
        text={bm25Text}
        domain={ctx.bm25Domain}
        ranking={!hasScore}
        tipKey={`bm25:${ctx.run.id}:${rank}`}
        tip={() => (
          <>
            <TipHead value={bm25Text} label="BM25 keyword score" />
            <p>{bm25Explainer(strategy, ctx.bm25Domain)}</p>
          </>
        )}
      />
      {text && (
        <p className="recall-snippet">
          {expanded || !clipped ? text : clipped}
          {clipped && (
            <>
              {' '}
              <button type="button" className="btn-link recall-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                {expanded ? 'show less' : 'show all'}
              </button>
            </>
          )}
        </p>
      )}
    </li>
  );
}

/** The ranked chunks of one run, with the strategy badge and the graph hand-off. */
export function RecallResults({ run, stale }: { run: RecallRun; stale: boolean }) {
  const derived = useDerived();
  const selected = useStore((s) => s.selected);
  const graph = useStore((s) => s.graph);
  const response = run.response;
  if (!derived || !response) return null;

  const candidates = response.candidates;
  const strategy = readStrategy(response.strategy, candidates);
  const hasScore = strategy.scoreMode !== 'none';
  const ranks = graphRanks(candidates, derived.pageById);
  const rankedIds = Object.keys(ranks);
  const distinctPages = new Set(candidates.map((c) => c.pageId ?? c.path)).size;
  const hidden = rankedIds.flatMap((id) => {
    const page = derived.pageById.get(id);
    return page && hiddenOnGraph(page, graph) ? [page] : [];
  });
  const hiddenWhy = [...new Set(hidden.map((p) => (graph.hiddenKinds.includes(p.kind) ? KIND_LABELS[p.kind] : 'archived')))];
  const ctx: RowContext = {
    run,
    strategy,
    scoreDomain: scoreDomain(strategy.scoreMode, candidates),
    bm25Domain: bm25Domain(candidates),
    byPage: ranksByPage(candidates),
    derived,
    selected,
  };

  const showOnGraph = (): void => {
    const state = useStore.getState();
    state.setHighlight({ query: run.query, ranks });
    // A focused neighbourhood would hide hits outside it.
    if (state.graph.focusDepth > 0) state.updateGraph({ focusDepth: 0 });
    // Time travel would hide hits born after the cursor.
    if (state.timeCursor !== null) state.setTimeCursor(null);
    state.setView('graph');
  };

  return (
    <section className={`recall-results card${stale ? ' is-stale' : ''}`} aria-busy={stale || undefined} aria-label="Recall results">
      <header className="recall-results-head">
        <div className="recall-results-title">
          <span className="recall-results-query" title={run.query}>
            “{run.query}”
          </span>
          <span className="recall-results-count">
            {plural(candidates.length, 'chunk')} from {plural(distinctPages, 'page')} · top {run.top}
          </span>
        </div>
        <div className="recall-results-meta">
          {candidates.length > 0 && <StrategyBadge strategy={strategy} tipKey={`strategy:${run.id}`} />}
          <Elapsed ms={response.elapsedMs} tipKey={`elapsed:${run.id}`} />
          <button
            type="button"
            className="btn btn-small"
            onClick={showOnGraph}
            disabled={rankedIds.length === 0}
            title={rankedIds.length ? `Light up these ${plural(rankedIds.length, 'page')} on the graph, numbered by their best chunk` : 'No hit is a page of this vault'}
          >
            Show on graph
          </button>
        </div>
      </header>

      {hidden.length > 0 && (
        <p className="recall-results-note">
          {hidden.length === 1 ? '1 of these pages is' : `${hidden.length} of these pages are`} hidden on the graph by its filters (
          {hiddenWhy.join(', ')}); turn them back on in the graph legend or controls.
        </p>
      )}

      {candidates.length === 0 ? (
        <p className="recall-results-empty">No chunk matched: BM25 found no candidate for these words. Try other terms, in English.</p>
      ) : (
        <>
          <div className={`recall-colhead${hasScore ? '' : ' is-single'}`}>
            <span className="recall-colhead-rank">#</span>
            <span className="recall-colhead-page">Page · title · chunk</span>
            {hasScore && (
              <ColumnHead label={rerankName(strategy)} tipKey={`head:score:${run.id}`} explain={rerankExplainer(strategy, ctx.scoreDomain)} />
            )}
            <ColumnHead label="BM25" tipKey={`head:bm25:${run.id}`} explain={bm25Explainer(strategy, ctx.bm25Domain)} />
          </div>
          <ol className={`recall-list${hasScore ? '' : ' is-single'}`}>
            {candidates.map((c, i) => (
              <ResultRow key={`${run.id}:${c.chunkId ?? c.path}`} candidate={c} rank={i + 1} ctx={ctx} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
