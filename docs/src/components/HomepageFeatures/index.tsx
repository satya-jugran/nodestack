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
    title: 'Zero-Compilation SQLite',
    description: (
      <>
        Powered natively by Node.js (<code>node:sqlite</code>). Boots instantly with zero C++ compilation, Python, or external database daemon dependencies.
      </>
    ),
  },
  {
    title: 'Instant CRUD & Realtime SSE',
    description: (
      <>
        Automatic REST endpoints, visual schema designer, and live Server-Sent Events (SSE) change streams for every collection.
      </>
    ),
  },
  {
    title: 'FTS5, Webhooks & Auditing',
    badge: 'v1.3',
    description: (
      <>
        Embedded BM25 full-text search with highlights, outbound webhooks with HMAC-SHA256 signatures, and field-level audit change history.
      </>
    ),
  },
  {
    title: 'Built-in Auth & File Storage',
    description: (
      <>
        JWT authentication, bcrypt password hashing, session revocation, and multipart binary file uploads with MIME validation.
      </>
    ),
  },
  {
    title: '100% Type-Safe TypeScript SDK',
    description: (
      <>
        One-command type generation (<code>nodestack typegen</code>) and lightweight (<code>&lt;10KB</code>) client SDK for React, Next.js, and Node.js.
      </>
    ),
  },
  {
    title: 'Embedded Web Admin Dashboard',
    description: (
      <>
        Sleek, reactive dashboard served directly from <code>/_/</code> with data grid, visual access rule builder, and analytics charts.
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
