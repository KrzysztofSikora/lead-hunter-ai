import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { OpportunityDetail } from '@lead-hunter/contracts';
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
      <p>{data.analysis ? list.analysisComplete : t.noAnalysis}</p>

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
