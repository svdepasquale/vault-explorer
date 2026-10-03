import { useMemo, type ReactNode } from 'react';
import { KIND_DESCRIPTIONS, KIND_LABELS, type PageKind } from '../../../shared/model.ts';
import { useDerived } from '../../app/derived.ts';
import { formatDate, formatNumber } from '../../app/format.ts';
import { useStore, type EmphasisField } from '../../app/store.ts';
import { usePalette } from '../../app/theme.ts';
import { SeverityBadge } from '../../components/SeverityBadge.tsx';
import { BarTable, ChartCard, HBarChart, TipBody, type BarDatum } from './BarChart.tsx';
import { HubTables } from './HubTables.tsx';
import { KpiRow } from './KpiRow.tsx';
import { NowCard } from './NowCard.tsx';
import { computeStats, type PredicateStat } from './stats.ts';
import './overview.css';

interface KindRow extends BarDatum {
  kind: PageKind;
}

interface PredicateRow extends BarDatum {
  stat: PredicateStat;
}

const TOP_TAGS = 20;
const EMPHASIS_HINT = 'Click to highlight on the graph';

function emphasize(field: EmphasisField, value: string): void {
  const { updateGraph, setView } = useStore.getState();
  updateGraph({ colorBy: 'emphasis', emphasis: { field, value } });
  setView('graph');
}

function showPredicate(stat: PredicateStat): void {
  const { updateGraph, setView } = useStore.getState();
  // When the predicate has one-sided relations, also paint them, as this chart does.
  updateGraph({ predicate: stat.name, showRelations: true, ...(stat.oneSided > 0 ? { showAsymmetric: true } : {}) });
  setView('graph');
}

const counted = (entries: [string, number][]): BarDatum[] => entries.map(([key, value]) => ({ key, label: key, value }));
const share = (n: number, total: number): string => (total ? `${Math.round((n / total) * 100)}%` : '—');

function PredicateTip({ row }: { row: PredicateRow }) {
  const { stat } = row;
  return (
    <TipBody
      value={stat.total}
      unit={stat.total === 1 ? 'relation' : 'relations'}
      label={stat.known ? stat.label : `${stat.label} (not in the schema)`}
      hint={stat.known ? 'Click to show only this predicate on the graph' : undefined}
    >
      {stat.hasInverse ? (
        <>
          <div className="overview-tip-line">
            <span className="overview-tip-key is-complete" aria-hidden="true" />
            {formatNumber(stat.twoSided)} on both pages
          </div>
          {stat.oneSided > 0 && (
            <div className="overview-tip-line">
              <SeverityBadge severity="warning" compact />
              {formatNumber(stat.oneSided)} one-sided
            </div>
          )}
          {stat.oneSided > 0 && (
            <div className="overview-tip-note">
              {formatNumber(stat.missingOnTarget)} lack the inverse on the target, {formatNumber(stat.missingOnSource)} the forward name on the source
            </div>
          )}
        </>
      ) : (
        <div className="overview-tip-note">{stat.known ? 'No inverse in the schema: one declaration is complete' : 'Unknown predicate: see the Health view'}</div>
      )}
    </TipBody>
  );
}

export default function OverviewView() {
  const derived = useDerived();
  const palette = usePalette();
  const stats = useMemo(() => (derived ? computeStats(derived) : null), [derived]);

  const kindRows = useMemo<KindRow[]>(
    () =>
      (stats?.kinds ?? [])
        .map(({ kind, count }) => ({ key: kind, label: KIND_LABELS[kind], value: count, kind, dot: palette.kind[kind] }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    [stats, palette],
  );
  const domainRows = useMemo(() => counted(derived?.domains ?? []), [derived]);
  const statusRows = useMemo(() => counted(derived?.statuses ?? []), [derived]);
  const tagRows = useMemo(() => counted((derived?.tags ?? []).slice(0, TOP_TAGS)), [derived]);
  const predicateRows = useMemo<PredicateRow[]>(
    () => (stats?.predicates ?? []).map((stat) => ({ key: stat.name, label: stat.label, value: stat.total, flagged: stat.oneSided, stat })),
    [stats],
  );

  if (!derived || !stats) return null;
  const { model } = derived;
  const pages = stats.pages;

  const pagesTip =
    (field: string) =>
    (row: BarDatum): ReactNode => (
      <TipBody value={row.value} unit={row.value === 1 ? 'page' : 'pages'} label={`${field}: ${row.label}`} hint={EMPHASIS_HINT}>
        <div className="overview-tip-note">{share(row.value, pages)} of all pages</div>
      </TipBody>
    );

  return (
    <div className="overview">
      <div className="overview-inner">
        <header className="overview-header">
          <h1 className="overview-title">{model.vault.name}</h1>
          <p className="overview-meta">
            The vault at a glance
            {model.vault.branch ? ` · ${model.vault.branch}` : ''}
            {model.vault.head ? ` @ ${model.vault.head}` : ''} · model built {formatDate(model.generatedAt)} in {formatNumber(model.buildMs)} ms
          </p>
        </header>

        <KpiRow stats={stats} hot={model.hot} />

        <section className="overview-section" aria-labelledby="overview-now">
          <h2 id="overview-now" className="overview-section-title">
            Now
          </h2>
          <NowCard hot={model.hot} />
        </section>

        <section className="overview-section" aria-labelledby="overview-composition">
          <h2 id="overview-composition" className="overview-section-title">
            Composition
          </h2>
          <div className="overview-grid overview-grid-3">
            <ChartCard
              title="Pages by kind"
              subtitle="Folder and frontmatter type; the dot is the kind's color on the graph"
              chart={
                <HBarChart
                  rows={kindRows}
                  fill={palette.accent}
                  ariaLabel="Pages by kind"
                  tooltip={(row) => (
                    <TipBody value={row.value} unit={row.value === 1 ? 'page' : 'pages'} label={row.label}>
                      <div className="overview-tip-note">
                        {share(row.value, pages)} of all pages · {KIND_DESCRIPTIONS[row.kind]}
                      </div>
                    </TipBody>
                  )}
                />
              }
              table={<BarTable rows={kindRows} labelHeader="Kind" valueHeader="Pages" columns={[{ header: 'Share', cell: (r) => share(r.value, pages) }]} />}
            />
            <ChartCard
              title="Pages by domain"
              subtitle={stats.noDomain ? `${formatNumber(stats.noDomain)} of ${formatNumber(pages)} pages have no domain` : undefined}
              chart={
                domainRows.length ? (
                  <HBarChart rows={domainRows} fill={palette.accent} ariaLabel="Pages by domain" tooltip={pagesTip('domain')} onPick={(r) => emphasize('domain', r.key)} />
                ) : (
                  <p className="overview-empty">No page sets a domain.</p>
                )
              }
              table={<BarTable rows={domainRows} labelHeader="Domain" valueHeader="Pages" onPick={(r) => emphasize('domain', r.key)} pickTitle={EMPHASIS_HINT} />}
            />
            <ChartCard
              title="Pages by status"
              subtitle={stats.noStatus ? `${formatNumber(stats.noStatus)} of ${formatNumber(pages)} pages have no status` : undefined}
              chart={
                statusRows.length ? (
                  <HBarChart rows={statusRows} fill={palette.accent} ariaLabel="Pages by status" tooltip={pagesTip('status')} onPick={(r) => emphasize('status', r.key)} />
                ) : (
                  <p className="overview-empty">No page sets a status.</p>
                )
              }
              table={<BarTable rows={statusRows} labelHeader="Status" valueHeader="Pages" onPick={(r) => emphasize('status', r.key)} pickTitle={EMPHASIS_HINT} />}
            />
          </div>
        </section>

        <div className="overview-grid overview-grid-2 overview-split">
          <section className="overview-section" aria-labelledby="overview-tags">
            <h2 id="overview-tags" className="overview-section-title">
              Tags
            </h2>
            <ChartCard
              title={`Top ${Math.min(TOP_TAGS, derived.tags.length)} tags`}
              subtitle={`Of ${formatNumber(stats.tagsDistinct)} distinct tags · ${formatNumber(stats.tagsOnce)} are used on one page only`}
              chart={
                tagRows.length ? (
                  <HBarChart rows={tagRows} fill={palette.accent} ariaLabel="Top tags by pages" tooltip={pagesTip('tag')} onPick={(r) => emphasize('tag', r.key)} />
                ) : (
                  <p className="overview-empty">No page has tags.</p>
                )
              }
              table={<BarTable rows={tagRows} labelHeader="Tag" valueHeader="Pages" onPick={(r) => emphasize('tag', r.key)} pickTitle={EMPHASIS_HINT} />}
            />
          </section>
          <section className="overview-section" aria-labelledby="overview-relations">
            <h2 id="overview-relations" className="overview-section-title">
              Typed relations
            </h2>
            <ChartCard
              title="By predicate"
              subtitle={`${formatNumber(stats.relations)} relations · ${formatNumber(stats.noInverse)} use a predicate without inverse, complete with one declaration`}
              legend={
                predicateRows.length > 0 && (
                  <ul className="overview-legend" aria-label="Legend">
                    <li>
                      <span className="overview-swatch" style={{ background: palette.typedEdge }} aria-hidden="true" />
                      Complete: on both pages, or no inverse needed
                    </li>
                    <li>
                      <span className="overview-swatch" style={{ background: palette.status.warning }} aria-hidden="true" />
                      <SeverityBadge severity="warning" compact />
                      One-sided: the inverse is missing
                    </li>
                  </ul>
                )
              }
              chart={
                predicateRows.length ? (
                  <HBarChart
                    rows={predicateRows}
                    fill={palette.typedEdge}
                    ariaLabel="Typed relations by predicate, one-sided share in the warning color"
                    tooltip={(row) => <PredicateTip row={row} />}
                    onPick={(row) => { if (row.stat.known) showPredicate(row.stat); }}
                  />
                ) : (
                  <p className="overview-empty">No typed relations yet.</p>
                )
              }
              table={
                <BarTable
                  rows={predicateRows}
                  labelHeader="Predicate"
                  valueHeader="Relations"
                  columns={[
                    { header: 'Both pages', cell: (r) => (r.stat.hasInverse ? formatNumber(r.stat.twoSided) : '—') },
                    { header: 'One-sided', cell: (r) => (r.stat.hasInverse ? formatNumber(r.stat.oneSided) : '—') },
                  ]}
                  onPick={(row) => { if (row.stat.known) showPredicate(row.stat); }}
                  pickTitle="Show only this predicate on the graph"
                />
              }
            />
          </section>
        </div>

        <section className="overview-section" aria-labelledby="overview-hubs">
          <h2 id="overview-hubs" className="overview-section-title">
            Hubs and outliers
          </h2>
          <HubTables stats={stats} />
        </section>
      </div>
    </div>
  );
}
