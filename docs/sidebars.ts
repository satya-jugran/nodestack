import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/overview',
        'getting-started/quick-start',
        'getting-started/configuration',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: false,
      items: [
        'core-concepts/collections',
        'core-concepts/database-sqlite',
        'core-concepts/crud-and-querying',
        'core-concepts/fts5-search',
        'core-concepts/access-rules',
        'core-concepts/multi-application',
        'core-concepts/snapshots',
      ],
    },
    {
      type: 'category',
      label: 'Auth & Security',
      collapsed: true,
      items: [
        'auth-and-security/authentication',
        'auth-and-security/session-revocation',
        'auth-and-security/audit-logging',
      ],
    },
    {
      type: 'category',
      label: 'Realtime & SSE',
      collapsed: true,
      items: [
        'realtime/realtime-sse',
      ],
    },
    {
      type: 'category',
      label: 'File Storage',
      collapsed: true,
      items: [
        'file-storage/file-uploads',
      ],
    },
    {
      type: 'category',
      label: 'Webhooks',
      collapsed: false,
      items: [
        'webhooks/outbound-webhooks',
      ],
    },
    {
      type: 'category',
      label: 'Serverless Functions',
      collapsed: false,
      items: [
        'functions/overview',
        'functions/context-api',
        'functions/lifecycle-hooks',
        'functions/security',
      ],
    },
    {
      type: 'category',
      label: 'TypeScript Server SDK',
      collapsed: true,
      items: [
        'typescript-sdk/programmatic-usage',
        'typescript-sdk/lifecycle-hooks',
        'typescript-sdk/custom-routes',
        'typescript-sdk/plugins',
      ],
    },
    {
      type: 'category',
      label: 'Client SDK',
      collapsed: false,
      items: [
        'client-sdk/overview',
        'client-sdk/querying-records',
        'client-sdk/realtime-client',
        'client-sdk/webhooks-client',
        'client-sdk/type-safety',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      collapsed: true,
      items: [
        'api-reference/rest-api',
      ],
    },
    {
      type: 'category',
      label: 'Deployment & Operations',
      collapsed: true,
      items: [
        'deployment/docker',
        'deployment/vps-and-systemd',
        'deployment/backup-and-recovery',
      ],
    },
  ],
};

export default sidebars;
