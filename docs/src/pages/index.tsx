import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <div style={{display: 'flex', justifyContent: 'center', marginBottom: '1.5rem'}}>
          <img src="img/logo.svg" alt="NodeStack Logo" width="96" height="96" />
        </div>
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle" style={{maxWidth: '720px', margin: '0 auto 1.5rem'}}>
          {siteConfig.tagline}
        </p>

        <div style={{
          display: 'inline-block',
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '8px',
          padding: '0.6rem 1.4rem',
          fontFamily: 'monospace',
          fontSize: '1.05rem',
          marginBottom: '2rem',
          color: '#e2e8f0',
        }}>
          $ npx @nodestackapp/server start
        </div>

        <div className={styles.buttons} style={{display: 'flex', gap: '1rem', justifyContent: 'center'}}>
          <Link
            className="button button--secondary button--lg"
            to="/getting-started/quick-start">
            Quick Start
          </Link>
          <Link
            className="button button--outline button--lg"
            style={{color: '#fff', borderColor: '#fff'}}
            to="/getting-started/overview">
            Documentation
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — ${siteConfig.tagline}`}
      description="The TypeScript-Native Multi-Application Backend Platform with embedded SQLite, instant CRUD, Auth, Realtime SSE, Snapshots, and Themed Admin UI.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
