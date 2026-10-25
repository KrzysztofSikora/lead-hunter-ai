import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// Layer rules from context/tech-stack.md "Architecture sketch". `no-restricted-imports` replaces
// (does not merge with) the same rule from an earlier block, so each block lists its full set.
const DRIVERS = [
  'better-sqlite3',
  'drizzle-orm',
  'drizzle-orm/*',
  'undici',
  'ipaddr.js',
  '@anthropic-ai/sdk',
  'openai',
  'imapflow',
  'croner',
];
const FASTIFY = ['fastify', 'fastify/*', 'fastify-*', '@fastify/*'];
const INFRASTRUCTURE = '**/infrastructure/**';

const restrict = (message, ...groups) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: groups.flat(), message }] }],
});

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'reports/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.stryker-tmp/**',
      'data/**',
      'apps/api/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  { rules: { 'no-undef': 'off' } },
  {
    files: ['apps/api/src/modules/**/*.ts'],
    rules: restrict(
      'Modules reach drivers and infrastructure only through ports (tech-stack, Architecture sketch).',
      INFRASTRUCTURE,
      DRIVERS,
    ),
  },
  {
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: ['**/routes.ts'],
    rules: restrict(
      'Only routes.ts of a module may import the HTTP framework.',
      INFRASTRUCTURE,
      DRIVERS,
      FASTIFY,
    ),
  },
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: [
      'apps/api/src/modules/**',
      'apps/api/src/infrastructure/**',
      'apps/api/src/cli/**',
      'apps/api/src/server.ts',
    ],
    rules: restrict(
      'Infrastructure is wired only in server.ts and cli/ and injected through deps.',
      INFRASTRUCTURE,
    ),
  },
  {
    files: ['packages/**/*.ts'],
    rules: restrict(
      'Packages must not depend on apps.',
      '@lead-hunter/api',
      '@lead-hunter/api/*',
      '@lead-hunter/web',
      '@lead-hunter/web/*',
      '**/apps/**',
    ),
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: restrict(
      'The web app talks to the API over HTTP and shares only packages/contracts.',
      '@lead-hunter/api',
      '@lead-hunter/api/*',
      '**/apps/api/**',
      'node:*',
      FASTIFY,
    ),
  },
);
