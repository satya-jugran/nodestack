import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'NodeStack',
  tagline: 'The TypeScript-Native Embedded Backend Stack',
  favicon: 'img/favicon.svg',

  // GitHub Pages hosting config
  url: 'https://satya-jugran.github.io',
  baseUrl: process.env.DOCS_BASE_URL || '/documentation/',
  organizationName: 'satya-jugran',
  projectName: 'nodestack',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
  },
  themes: ['@docusaurus/theme-mermaid'],

  plugins: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexDocs: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/satya-jugran/nodestack/tree/master/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logo.svg',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'NodeStack',
      logo: {
        alt: 'NodeStack Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          to: '/client-sdk/overview',
          label: 'Client SDK',
          position: 'left',
        },
        {
          to: '/api-reference/rest-api',
          label: 'REST API',
          position: 'left',
        },
        {
          type: 'html',
          position: 'right',
          value: '<span class="badge badge--info" style="font-size: 0.8rem; padding: 0.25rem 0.6rem; border-radius: 9999px;">v2.1</span>',
        },
        {
          href: 'https://github.com/satya-jugran/nodestack',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Overview & Architecture',
              to: '/getting-started/overview',
            },
            {
              label: 'Quick Start',
              to: '/getting-started/quick-start',
            },
            {
              label: 'Serverless Functions (v2.1)',
              to: '/functions/overview',
            },
            {
              label: 'Multi-Application Platform',
              to: '/core-concepts/multi-application',
            },
            {
              label: 'Application Snapshots',
              to: '/core-concepts/snapshots',
            },
            {
              label: 'SQLite FTS5 Search',
              to: '/core-concepts/fts5-search',
            },
            {
              label: 'Outbound Webhooks',
              to: '/webhooks/outbound-webhooks',
            },
          ],
        },
        {
          title: 'Developers',
          items: [
            {
              label: 'Programmatic TypeScript SDK',
              to: '/typescript-sdk/programmatic-usage',
            },
            {
              label: 'Client SDK (nodestack-client)',
              to: '/client-sdk/overview',
            },
            {
              label: 'REST API & OpenAPI',
              to: '/api-reference/rest-api',
            },
          ],
        },
        {
          title: 'Community & Repository',
          items: [
            {
              label: 'GitHub Repository',
              href: 'https://github.com/satya-jugran/nodestack',
            },
            {
              label: 'Report an Issue',
              href: 'https://github.com/satya-jugran/nodestack/issues',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} NodeStack. Released under the MIT License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'sql', 'yaml', 'diff'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
