import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { LatestAnalysis, OpportunityDetail } from '@lead-hunter/contracts';
import styles from './OpportunityPage.module.css';
import { getOpportunity } from './api/opportunities.js';
import { strings } from './strings.pl.js';
import { formatWarsaw } from './warsawTime.js';

const t = strings.opportunity;
const list = strings.opportunities;

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'missing' }
  | { state: 'ready'; data: OpportunityDetail };

const when = (iso: string | null, empty: string) => (iso ? formatWarsaw(iso) : empty);

/** Source text is always rendered as text (React escaping), never as HTML. */
export function OpportunityPage() {
  const { id } = useParams();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let active = true;
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric < 1) {
      setLoad({ state: 'missing' });
      return;
    }
    setLoad({ state: 'loading' });
    getOpportunity(numeric).then(
      (data) => active && setLoad(data ? { state: 'ready', data } : { state: 'missing' }),
      () => active && setLoad({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <section>
      <p>
        <Link to="/okazje">{t.back}</Link>
      </p>
      {load.state === 'loading' && <p role="status">{t.loading}</p>}
      {load.state === 'missing' && <p role="alert">{t.notFound}</p>}
      {load.state === 'error' && (
        <p role="alert" className={styles.error}>
          {t.loadFailed}
        </p>
      )}
      {load.state === 'ready' && <Detail data={load.data} />}
    </section>
  );
}

function Detail({ data }: { data: OpportunityDetail }) {
  const { source } = data;
  return (
    <>
      <h2>{source.title}</h2>
      <p>
        {list.businessStatus[data.businessStatus]} · {list.detected} {formatWarsaw(data.createdAt)}
      </p>

      <h3>{t.sourceSection}</h3>
      <dl className={styles.facts}>
        <dt>{t.sourceType}</dt>
        <dd>{list.sourceTypes[source.type]}</dd>
        <dt>{t.sourceUrl}</dt>
        <dd>
          {source.url ? (
            <a href={source.url} rel="noopener noreferrer nofollow" target="_blank">
              {source.url}
            </a>
          ) : (
            t.pastedText
          )}
        </dd>
        <dt>{t.text}</dt>
        <dd>{source.snippet ? <pre className={styles.text}>{source.snippet}</pre> : t.noText}</dd>
        <dt>{t.publishedAt}</dt>
        <dd>{when(source.publishedAt, t.unknown)}</dd>
        <dt>{t.fetchedAt}</dt>
        <dd>{formatWarsaw(source.fetchedAt)}</dd>
        <dt>{t.availability}</dt>
        <dd>{t.availabilityValues[source.availability]}</dd>
        <dt>{t.lastVerifiedAt}</dt>
        <dd>{when(source.lastVerifiedAt, t.never)}</dd>
      </dl>

      <h3>{t.analysisSection}</h3>
      <AnalysisSection data={data} />

      <h3>{t.evidenceSection}</h3>
      <ul className={styles.evidence}>
        {data.evidence.map((item) => (
          <li key={item.id}>
            <strong>{t.evidenceTypes[item.type]}</strong> · {formatWarsaw(item.extractedAt)}
            {item.url && (
              <div>
                <a href={item.url} rel="noopener noreferrer nofollow" target="_blank">
                  {item.url}
                </a>
              </div>
            )}
            <pre className={styles.text}>{item.sourceFact}</pre>
          </li>
        ))}
      </ul>
    </>
  );
}

const labelled = (label: string, text: string) => (
  <>
    {text} <span className={styles.tag}>({label})</span>
  </>
);

function money(minMinor: number, maxMinor: number, currency: string) {
  const fmt = (minor: number) => (minor / 100).toLocaleString('pl-PL');
  return `${fmt(minMinor)}–${fmt(maxMinor)} ${currency}`;
}

function AnalysisSection({ data }: { data: OpportunityDetail }) {
  const latest = data.latestAnalysis;
  if (data.prefilter?.rule && data.analysisStatus === 'SKIPPED') {
    return <p>{list.skippedBecause(strings.prefilterRules[data.prefilter.rule])}</p>;
  }
  if (data.prefilter?.rule) {
    return <p>{strings.prefilterRules[data.prefilter.rule]}</p>;
  }
  if (!latest) {
    return <p>{data.analysisStatus === 'PENDING' ? t.noAnalysis : list.analysisFailed}</p>;
  }
  return <Analysis analysis={latest} score={data.analysis?.score ?? null} />;
}

function Analysis({ analysis, score }: { analysis: LatestAnalysis; score: number | null }) {
  const { result, breakdown } = analysis;
  return (
    <div>
      {analysis.demo && (
        <p role="note" className={styles.demo}>
          <strong>{t.demoBanner}</strong>
        </p>
      )}
      <p className={styles.meta}>
        {t.provider}: {analysis.provider} ({analysis.model}) · {t.analysedAt}{' '}
        {formatWarsaw(analysis.createdAt)}
      </p>
      {analysis.status === 'FAILED' && (
        <p role="alert" className={styles.error}>
          {t.failedReason}: {analysis.error}
        </p>
      )}
      {result?.verdict === 'INSUFFICIENT_DATA' && (
        <>
          <p>{t.insufficientData}</p>
          <p>{labelled(t.modelInference, result.reason)}</p>
          <StringList title={t.unknownsTitle} items={result.unknowns} />
          <StringList title={t.sourceFactsTitle} items={result.sourceFacts} tag={t.fromSource} />
        </>
      )}
      {result?.verdict === 'ANALYSED' && (
        <>
          <p>
            <strong>
              {t.score}: {score ?? t.noScore}
            </strong>
            {breakdown && ` · ${t.confidence}: ${t.confidences[breakdown.confidence]}`}
          </p>
          {breakdown && (
            <ul className={styles.components}>
              {breakdown.components.map((component) => (
                <li key={component.key}>
                  <strong>{t.components[component.key]}</strong>{' '}
                  {t.scoreOf(component.points, component.max)}
                  <div>{component.justification}</div>
                </li>
              ))}
            </ul>
          )}
          <dl className={styles.facts}>
            <dt>{t.evidenceLevel}</dt>
            <dd>{labelled(t.modelInference, t.evidenceLevels[result.evidenceLevel])}</dd>
            <dt>{t.category}</dt>
            <dd>{labelled(t.modelInference, list.categories[result.category])}</dd>
            <dt>{t.problem}</dt>
            <dd>{labelled(t.modelInference, result.problem)}</dd>
            <dt>{t.buyer}</dt>
            <dd>
              {result.buyerOrAudience
                ? labelled(t.modelInference, result.buyerOrAudience)
                : t.unknown}
            </dd>
            <dt>{t.nextAction}</dt>
            <dd>{labelled(t.modelInference, result.nextAction)}</dd>
            <dt>{t.sourceBudgetTitle}</dt>
            <dd>
              {result.sourceBudget
                ? `${money(
                    result.sourceBudget.minMinor,
                    result.sourceBudget.maxMinor,
                    result.sourceBudget.currency,
                  )} — ${t.sourceBudget(result.sourceBudget.quote)}`
                : t.noBudget}
            </dd>
            <dt>{t.estimatedPrice}</dt>
            <dd>
              {result.proposedPrice
                ? `${money(
                    result.proposedPrice.minMinor,
                    result.proposedPrice.maxMinor,
                    result.proposedPrice.currency,
                  )} — ${t.hypothesis}`
                : `${t.unknown} — ${t.hypothesis}`}
            </dd>
            <dt>{t.estimatedHours}</dt>
            <dd>
              {result.estimatedHours
                ? labelled(
                    t.hypothesis,
                    t.hours(result.estimatedHours.min, result.estimatedHours.max),
                  )
                : t.unknown}
            </dd>
          </dl>
          <StringList title={t.sourceFactsTitle} items={result.sourceFacts} tag={t.fromSource} />
          <StringList title={t.unknownsTitle} items={result.unknowns} />
        </>
      )}
      <StringList title={t.guardNotesTitle} items={analysis.guardNotes} />
    </div>
  );
}

function StringList({ title, items, tag }: { title: string; items: string[]; tag?: string }) {
  if (items.length === 0) return null;
  return (
    <>
      <h4>{title}</h4>
      <ul className={styles.plain}>
        {items.map((item, index) => (
          <li key={index}>{tag ? labelled(tag, item) : item}</li>
        ))}
      </ul>
    </>
  );
}
