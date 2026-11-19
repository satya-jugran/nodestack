import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  badge?: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Multi-Database & Multi-Tenant',
    description: (
      <>
        Host multiple isolated application tenants with native support for SQLite, PostgreSQL, and Microsoft SQL Server, seamless live migrations, and dedicated schemas.
      </>
    ),
  },
  {
    title: 'Access Management with API Keys',
    badge: 'v2.6.0',
    description: (
      <>
        Unified cross-subsystem RBAC authorization engine, scoped M2M API keys with auto role-downgrade stripping, and real-time permission simulation testing.
      </>
    ),
  },
  {
    title: 'Serverless Functions & Flows',
    description: (
      <>
        Sandboxed QuickJS-Wasm serverless execution with Anti-SSRF firewalls, structured observability logging, and visual state machine workflow orchestration.
      </>
    ),
  },
  {
    title: 'Transactional Background Queues',
    description: (
      <>
        Durable multi-database message queues with atomic claiming, worker leases, heartbeats, strict partition FIFO ordering, exponential retries, and dead-letter queues.
      </>
    ),
  },
  {
    title: 'Outbound Webhooks Engine',
    description: (
      <>
        Event-driven HTTP dispatch engine with HMAC-SHA256 signature verification, delivery logs, automated retry backoff, and Anti-SSRF network firewalls.
      </>
    ),
  },
  {
    title: 'Instant CRUD & Realtime SSE',
    description: (
      <>
        Automatic REST endpoints, visual schema designer, and live Server-Sent Events (SSE) change streams for every collection with row-level security.
      </>
    ),
  },
  {
    title: 'Snapshots & Time-Travel',
    description: (
      <>
        Atomic SQLite state checkpoints with non-destructive rollbacks, file storage preservation, live schema drift tracking, and FIFO capacity limits.
      </>
    ),
  },
  {
    title: 'FTS5 Search & Audit Logs',
    description: (
      <>
        Embedded BM25 relevance ranking with highlighted snippets, multi-engine language drift detection, and immutable field-level change history diffs.
      </>
    ),
  },
  {
    title: 'Themed Web Admin Dashboard',
    description: (
      <>
        Sleek, reactive dashboard served directly from <code>/_/</code> with System, Light, and Dark modes, data grid, and visual rule builder.
      </>
    ),
  },
];

function Feature({title, badge, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4', styles.featureCol)}>
      <div className="card" style={{
        height: '100%',
        padding: '1.75rem',
        borderRadius: '8px',
        border: '1px solid var(--ifm-color-emphasis-200)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem'}}>
          <Heading as="h3" style={{fontSize: '1.15rem', fontWeight: 600, margin: 0}}>
            {title}
          </Heading>
          {badge && (
            <span className="badge badge--primary" style={{fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '4px'}}>
              {badge}
            </span>
          )}
        </div>
        <p style={{color: 'var(--ifm-color-emphasis-700)', lineHeight: '1.6', fontSize: '0.92rem', margin: 0}}>
          {description}
        </p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features} style={{padding: '3.5rem 0'}}>
      <div className="container">
        <div className="row" style={{rowGap: '1.5rem'}}>
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
