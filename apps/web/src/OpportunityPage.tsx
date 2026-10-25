import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ActivityEvent, OpportunityDetail } from '@lead-hunter/contracts';
import styles from './OpportunityPage.module.css';
import { getOpportunity } from './api/opportunities.js';
import { buildCard, type CardItem, type CardSection } from './opportunityCard.js';
import { strings } from './strings.pl.js';
import { formatWarsaw } from './warsawTime.js';

const t = strings.opportunity;

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'missing' }
  | { state: 'ready'; data: OpportunityDetail };

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

const TAG_CLASS = {
  source: styles.tagSource,
  inference: styles.tagInference,
  estimate: styles.tagEstimate,
  rules: styles.tagRules,
  unknown: styles.tagUnknown,
} as const;

function Detail({ data }: { data: OpportunityDetail }) {
  const analysis = data.latestAnalysis;
  return (
    <>
      <h2>{data.source.title}</h2>
      {analysis?.demo && !data.prefilter?.rule && (
        <p role="note" className={styles.demo}>
          <strong>{t.demoBanner}</strong>
        </p>
      )}
      {analysis && !data.prefilter?.rule && (
        <p className={styles.meta}>
          {t.provider}: {analysis.provider} ({analysis.model}) · {t.analysedAt}{' '}
          {formatWarsaw(analysis.createdAt)}
        </p>
      )}
      <div className={styles.card}>
        {buildCard(data).map((section, index) => (
          <Section key={section.key} section={section} number={index + 1} />
        ))}
      </div>
      {data.evidence.length > 0 && (
        <>
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
      )}
    </>
  );
}

function Section({ section, number }: { section: CardSection; number: number }) {
  return (
    <section className={`${styles.element} ${styles[`el_${section.key}`] ?? ''}`}>
      <h3>
        {number}. {section.title}
      </h3>
      {section.emptyReason && <p className={styles.emptyReason}>{section.emptyReason}</p>}
      {section.key === 'actions' && <ActionButtons />}
      {section.items.length > 0 && (
        <dl className={styles.facts}>
          {section.items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </dl>
      )}
      {section.events && <History events={section.events} />}
    </section>
  );
}

function Row({ item }: { item: CardItem }) {
  return (
    <>
      <dt>
        {item.label}
        {item.tag && (
          <>
            {' '}
            <span className={`${styles.tag} ${TAG_CLASS[item.tag]}`}>{t.tags[item.tag]}</span>
          </>
        )}
      </dt>
      <dd>
        <Value item={item} />
      </dd>
    </>
  );
}

function Value({ item }: { item: CardItem }) {
  const { value } = item;
  if (value === null) return <span className={styles.none}>{t.tags.unknown}</span>;
  if (Array.isArray(value)) {
    return (
      <ul className={styles.plain}>
        {value.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    );
  }
  if (item.href) {
    return (
      <a href={item.href} rel="noopener noreferrer nofollow" target="_blank" className={styles.url}>
        {value}
      </a>
    );
  }
  if (item.more) {
    return (
      <>
        <pre className={styles.text}>{value}</pre>
        <details>
          <summary>{t.items.showAll}</summary>
          <pre className={styles.text}>{item.more}</pre>
        </details>
      </>
    );
  }
  return <>{value}</>;
}

/** Phase 4 enables Zapisz / Odrzuć / Dodaj notatkę; until then no button looks live. */
function ActionButtons() {
  const a = t.actions;
  return (
    <div className={styles.actions}>
      {[a.save, a.reject, a.note, a.offer, a.contact].map((label) => (
        <button key={label} type="button" disabled>
          {label}
        </button>
      ))}
      <p className={styles.meta}>
        {a.offer}, {a.contact}: {a.later}
      </p>
    </div>
  );
}

function History({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return <p className={styles.meta}>{t.historyEmpty}</p>;
  return (
    <ul className={styles.plain}>
      {events.map((event) => (
        <li key={event.id}>
          {formatWarsaw(event.occurredAt)} · {event.type}
          {event.note ? ` — ${event.note}` : ''}
        </li>
      ))}
    </ul>
  );
}
