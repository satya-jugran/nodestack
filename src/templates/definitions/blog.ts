import { TemplateDefinition, TemplateSeedContext, SeedRecordResult } from '../types';
import { TemplateImageGenerator } from '../TemplateImageGenerator';

export const blogTemplate: TemplateDefinition = {
  id: 'blog',
  name: 'Blog / Content',
  tagline: 'Modern publishing platform with authors, tags, rich articles & comments',
  description:
    'Complete editorial and publication schema pre-seeded with technical blog posts, author avatars, category tags, cover images, and reader discussions.',
  icon: '📝',
  badge: 'Editorial Engine',
  aliases: ['blog', 'content', 'editorial', 'news'],
  stats: {
    collections: 4,
    records: 28,
    images: 12,
  },
  collections: [
    // 1. Authors
    {
      name: 'authors',
      dto: {
        name: 'authors',
        type: 'base',
        listRule: '',
        viewRule: '',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
        schema: [
          { id: 'f_auth_name', name: 'name', type: 'text', required: true },
          { id: 'f_auth_email', name: 'email', type: 'email', required: true, unique: true },
          { id: 'f_auth_bio', name: 'bio', type: 'text' },
          { id: 'f_auth_role', name: 'role', type: 'text' },
          { id: 'f_auth_avatar', name: 'avatar', type: 'file' },
          { id: 'f_auth_website', name: 'website', type: 'url' },
        ],
      },
      seed: async (_ctx: TemplateSeedContext): Promise<SeedRecordResult[]> => {
        const authorsData = [
          {
            id: 'auth_01',
            name: 'Sarah Jenkins',
            email: 'sarah.jenkins@nodestack.io',
            role: 'Principal Systems Architect',
            bio: 'Distributed systems engineer focused on embedded databases, runtime performance, and TypeScript tooling.',
            website: 'https://sarahjenkins.dev',
          },
          {
            id: 'auth_02',
            name: 'Marcus Vance',
            email: 'marcus.vance@nodestack.io',
            role: 'Head of Developer Experience',
            bio: 'Obsessed with developer workflows, reactive UI ergonomics, and frictionless local-first architectures.',
            website: 'https://marcusvance.tech',
          },
          {
            id: 'auth_03',
            name: 'Elena Rodriguez',
            email: 'elena.rodriguez@nodestack.io',
            role: 'Staff Database Engineer',
            bio: 'Specializing in SQLite query optimization, transactional WAL tuning, and zero-latency SSE pub/sub.',
            website: 'https://elenarodriguez.io',
          },
          {
            id: 'auth_04',
            name: 'David Chen',
            email: 'david.chen@nodestack.io',
            role: 'Lead Fullstack Designer',
            bio: 'Bridging technical architecture and elegant typography. Creator of minimalist software aesthetics.',
            website: 'https://davidchen.design',
          },
        ];

        return authorsData.map((auth, idx) => {
          const buffer = TemplateImageGenerator.generateAvatarSvg(auth.name, auth.role, idx);
          const filename = `${auth.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_avatar.svg`;
          return {
            record: {
              id: auth.id,
              name: auth.name,
              email: auth.email,
              role: auth.role,
              bio: auth.bio,
              avatar: filename,
              website: auth.website,
            },
            files: [
              {
                fieldName: 'avatar',
                filename,
                buffer,
                mimeType: 'image/svg+xml',
              },
            ],
          };
        });
      },
    },

    // 2. Tags
    {
      name: 'tags',
      dto: {
        name: 'tags',
        type: 'base',
        listRule: '',
        viewRule: '',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
        schema: [
          { id: 'f_tag_name', name: 'name', type: 'text', required: true, unique: true },
          { id: 'f_tag_slug', name: 'slug', type: 'text', required: true, unique: true },
          { id: 'f_tag_color', name: 'color', type: 'text' },
          { id: 'f_tag_desc', name: 'description', type: 'text' },
        ],
      },
      seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => {
        return [
          { id: 'tag_architecture', name: 'Architecture', slug: 'architecture', color: '#3b82f6', description: 'System design, single-process patterns & scalability' },
          { id: 'tag_sqlite', name: 'SQLite', slug: 'sqlite', color: '#10b981', description: 'Embedded storage engine, WAL mode & high-speed indexing' },
          { id: 'tag_typescript', name: 'TypeScript', slug: 'typescript', color: '#8b5cf6', description: 'Type-safe contracts, TypeGen & end-to-end DX' },
          { id: 'tag_realtime', name: 'Realtime', slug: 'realtime', color: '#f59e0b', description: 'Server-Sent Events, live reactive sync & WebSocket streams' },
          { id: 'tag_performance', name: 'Performance', slug: 'performance', color: '#ef4444', description: 'Sub-millisecond query optimization & low-latency backends' },
          { id: 'tag_security', name: 'Security', slug: 'security', color: '#06b6d4', description: 'PBKDF2/Bcrypt auth, JWT tokens & granular row-level access rules' },
        ];
      },
    },

    // 3. Posts
    {
      name: 'posts',
      dto: {
        name: 'posts',
        type: 'base',
        listRule: '',
        viewRule: '',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
        schema: [
          { id: 'f_post_title', name: 'title', type: 'text', required: true },
          { id: 'f_post_slug', name: 'slug', type: 'text', required: true, unique: true },
          { id: 'f_post_excerpt', name: 'excerpt', type: 'text' },
          { id: 'f_post_content', name: 'content', type: 'text', required: true },
          { id: 'f_post_author', name: 'author', type: 'relation', options: { collectionId: 'authors' } },
          { id: 'f_post_tag', name: 'tag', type: 'relation', options: { collectionId: 'tags' } },
          { id: 'f_post_cover', name: 'coverImage', type: 'file' },
          { id: 'f_post_status', name: 'status', type: 'select', options: { values: ['draft', 'published', 'archived'] } },
          { id: 'f_post_pub', name: 'publishedAt', type: 'text' },
          { id: 'f_post_views', name: 'viewCount', type: 'number' },
        ],
      },
      seed: async (_ctx: TemplateSeedContext): Promise<SeedRecordResult[]> => {
        const postsData = [
          {
            id: 'post_01',
            title: 'Why Embedded Databases Are Winning the Backend Race',
            slug: 'why-embedded-databases-are-winning-backend-race',
            excerpt: 'How running SQLite inside the application process achieves zero-network-hop queries, effortless backups, and unmatched simplicity.',
            author: 'auth_01',
            tag: 'tag_architecture',
            status: 'published',
            publishedAt: '2026-09-18T10:00:00.000Z',
            viewCount: 4210,
            content: `## The Zero-Network-Hop Advantage\n\nFor over two decades, web architectures have defaulted to multi-tier deployments: your application container talks over a network socket to a database cluster hosted in another rack or availability zone. Even within the same datacenter, a single round-trip query incurs 1-5 milliseconds of latency.\n\nBy embedding SQLite directly in the runtime memory space:\n\n- Queries execute in microseconds rather than milliseconds.\n- Zero external cluster operations or connection pooling connection limits.\n- Instant single-binary deployments with embedded full-text search and realtime events.`,
          },
          {
            id: 'post_02',
            title: 'End-to-End Type Safety Without Build Friction',
            slug: 'end-to-end-type-safety-without-build-friction',
            excerpt: 'Generating TypeScript contracts straight from relational SQLite schemas to eliminate API drift permanently.',
            author: 'auth_02',
            tag: 'tag_typescript',
            status: 'published',
            publishedAt: '2026-09-22T14:30:00.000Z',
            viewCount: 3180,
            content: `## Bridging Schema and TypeScript\n\nManual type synchronization between frontend clients and backend storage is one of the highest sources of runtime bugs in web development.\n\nNodeStack solves this by introspecting table schemas and emitting strict, branded TypeScript definition interfaces at build time or via \`/api/types.d.ts\`:\n\n\`\`\`typescript\nimport { NodeStackClient } from '@nodestack/client';\nimport { ProductsRecord } from './nodestack-types';\n\nconst client = new NodeStackClient('http://localhost:8090');\nconst products = await client.collection<ProductsRecord>('products').getList();\n\`\`\``,
          },
          {
            id: 'post_03',
            title: 'Tuning SQLite WAL Mode for High-Concurrency Production',
            slug: 'tuning-sqlite-wal-mode-for-high-concurrency-production',
            excerpt: 'Practical configuration settings for Write-Ahead Logging, page caching, busy timeouts, and concurrent readers.',
            author: 'auth_03',
            tag: 'tag_sqlite',
            status: 'published',
            publishedAt: '2026-09-25T08:15:00.000Z',
            viewCount: 5490,
            content: `## WAL Mode in Depth\n\nBy default, SQLite uses rollback journals which lock the entire database during writes. Enabling Write-Ahead Logging (WAL) changes the game entirely:\n\n- Multiple readers can read concurrently while a writer writes.\n- Memory mapping (\`PRAGMA mmap_size\`) minimizes user-kernel boundary transitions.\n- Automatic checkpointing keeps the \`-wal\` journal clean and compact.`,
          },
          {
            id: 'post_04',
            title: 'Reactive UI Architecture with Server-Sent Events',
            slug: 'reactive-ui-architecture-with-server-sent-events',
            excerpt: 'How modern web applications leverage lightweight SSE streams instead of heavy WebSockets for real-time state synchronization.',
            author: 'auth_02',
            tag: 'tag_realtime',
            status: 'published',
            publishedAt: '2026-09-28T16:45:00.000Z',
            viewCount: 2840,
            content: `## Why SSE Over WebSockets for CRUD Reactivity\n\nWebSockets require custom heartbeat management, protocol multiplexing, and bidirectional framing. For 90% of reactive web applications, updates flow exclusively server-to-client:\n\n- SSE operates over standard HTTP/2 and HTTP/3 without proxy complications.\n- Built-in automatic browser reconnection and event IDs.\n- Native \`EventSource\` API in all modern browsers without client libraries.`,
          },
          {
            id: 'post_05',
            title: 'Granular Access Rules: PocketBase-Style Syntax Explained',
            slug: 'granular-access-rules-pocketbase-style-syntax-explained',
            excerpt: 'Mastering dynamic authorization rules using declarative expressions like @request.auth.id and field-level filters.',
            author: 'auth_01',
            tag: 'tag_security',
            status: 'published',
            publishedAt: '2026-09-30T11:20:00.000Z',
            viewCount: 3620,
            content: `## Declarative Authorization\n\nInstead of writing procedural imperative middleware checks for every route, declarative access rules evaluate before record access:\n\n\`\`\`sql\n@request.auth.id != "" && author = @request.auth.id\n\`\`\`\n\nThis single rule guarantees that only authenticated users who own the record can view, edit, or delete it.`,
          },
          {
            id: 'post_06',
            title: 'Sub-Millisecond CRUD: Benchmarking NodeStack Against Traditional Stacks',
            slug: 'sub-millisecond-crud-benchmarking-nodestack',
            excerpt: 'Performance analysis comparing embedded Fastify + SQLite architectures against PostgreSQL microservices.',
            author: 'auth_03',
            tag: 'tag_performance',
            status: 'published',
            publishedAt: '2026-10-02T09:00:00.000Z',
            viewCount: 6710,
            content: `## Benchmarks & Latency Numbers\n\nIn our synthetic load tests executing 100,000 read operations under concurrency:\n\n- **NodeStack (Fastify + SQLite WAL):** 0.42ms average response latency.\n- **Traditional Containerized PostgreSQL:** 4.85ms average response latency.\n\nThe single-process embedded model delivers a 10x throughput multiplier with a fraction of RAM utilization.`,
          },
          {
            id: 'post_07',
            title: 'Designing Minimalist Developer Tools that Delight',
            slug: 'designing-minimalist-developer-tools-that-delight',
            excerpt: 'UX principles for building developer dashboards that prioritize speed, contrast, and clean typographic hierarchy.',
            author: 'auth_04',
            tag: 'tag_architecture',
            status: 'published',
            publishedAt: '2026-10-03T15:10:00.000Z',
            viewCount: 2190,
            content: `## Respecting Developer Focus\n\nDeveloper tools should get out of the way. Clear visual contrast, instant search filters, keyboard-accessible modals, and immediate feedback loops are the bedrock of joyful tools.`,
          },
          {
            id: 'post_08',
            title: 'Draft: The Future of Offline-First Local Sync',
            slug: 'draft-the-future-of-offline-first-local-sync',
            excerpt: 'Exploring CRDTs and deterministic clock synchronization across distributed client devices.',
            author: 'auth_01',
            tag: 'tag_realtime',
            status: 'draft',
            publishedAt: '',
            viewCount: 140,
            content: `## Upcoming Architecture Draft\n\nOffline-first state synchronization remains an active frontier. We are exploring Conflict-free Replicated Data Types (CRDTs) to reconcile offline mutations automatically.`,
          },
        ];

        return postsData.map((post, idx) => {
          const buffer = TemplateImageGenerator.generateBlogCoverSvg(post.title, post.tag.replace('tag_', ''), idx);
          const filename = `${post.slug}_cover.svg`;

          return {
            record: {
              id: post.id,
              title: post.title,
              slug: post.slug,
              excerpt: post.excerpt,
              content: post.content,
              author: post.author,
              tag: post.tag,
              coverImage: filename,
              status: post.status,
              publishedAt: post.publishedAt,
              viewCount: post.viewCount,
            },
            files: [
              {
                fieldName: 'coverImage',
                filename,
                buffer,
                mimeType: 'image/svg+xml',
              },
            ],
          };
        });
      },
    },

    // 4. Comments
    {
      name: 'comments',
      dto: {
        name: 'comments',
        type: 'base',
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
        schema: [
          { id: 'f_com_post', name: 'post', type: 'relation', options: { collectionId: 'posts' } },
          { id: 'f_com_author', name: 'authorName', type: 'text', required: true },
          { id: 'f_com_email', name: 'authorEmail', type: 'email', required: true },
          { id: 'f_com_content', name: 'content', type: 'text', required: true },
          { id: 'f_com_status', name: 'status', type: 'select', options: { values: ['approved', 'pending', 'spam'] } },
        ],
      },
      seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => {
        return [
          {
            id: 'com_01',
            post: 'post_01',
            authorName: 'Alex Vance',
            authorEmail: 'alex.vance@tech.co',
            content: 'The zero-hop latency is a breath of fresh air. Running SQLite on a 4GB VPS handles our entire SaaS workload easily.',
            status: 'approved',
          },
          {
            id: 'com_02',
            post: 'post_01',
            authorName: 'Gabriel White',
            authorEmail: 'gabriel.w@cloud.io',
            content: 'How do you recommend handling multi-region write replication? Litestream or Coroutine raft?',
            status: 'approved',
          },
          {
            id: 'com_03',
            post: 'post_02',
            authorName: 'Sophia Kim',
            authorEmail: 'sophia@startup.co',
            content: 'The types.d.ts endpoint in NodeStack has eliminated our entire GraphQL codegen step. Simple and elegant.',
            status: 'approved',
          },
          {
            id: 'com_04',
            post: 'post_03',
            authorName: 'Marcus Miller',
            authorEmail: 'marcus@infra.dev',
            content: 'PRAGMA busy_timeout=5000 is critical when you have bursty bulk imports. Great write-up.',
            status: 'approved',
          },
          {
            id: 'com_05',
            post: 'post_04',
            authorName: 'Emily Harris',
            authorEmail: 'emily.h@frontend.net',
            content: 'SSE with automatic reconnection solved all our dropped WebSocket connection issues on mobile networks.',
            status: 'approved',
          },
          {
            id: 'com_06',
            post: 'post_05',
            authorName: 'Julian Scott',
            authorEmail: 'julian@security.org',
            content: 'The declarative PocketBase-style rules make auditing access permissions so straightforward.',
            status: 'approved',
          },
          {
            id: 'com_07',
            post: 'post_06',
            authorName: 'Nathan Adams',
            authorEmail: 'nathan@fastcode.io',
            content: '0.42ms average response time matches our internal benchmarks. The CPU utilization is almost negligible.',
            status: 'approved',
          },
          {
            id: 'com_08',
            post: 'post_07',
            authorName: 'Chloe Bennett',
            authorEmail: 'chloe@designops.co',
            content: 'Monospace data grids with clean contrast will always beat heavy card animations for technical users.',
            status: 'approved',
          },
          {
            id: 'com_09',
            post: 'post_02',
            authorName: 'Liam Martinez',
            authorEmail: 'liam.m@engineering.dev',
            content: 'Can you export OpenAPI 3.0 specs alongside the TypeScript types? (Update: yes, via /_/docs and CLI!)',
            status: 'approved',
          },
          {
            id: 'com_10',
            post: 'post_03',
            authorName: 'Zoe Taylor',
            authorEmail: 'zoe@dbengineers.com',
            content: 'Don\'t forget PRAGMA synchronous = NORMAL in WAL mode — completely safe against power loss while doubling write throughput.',
            status: 'approved',
          },
        ];
      },
    },
  ],
};
