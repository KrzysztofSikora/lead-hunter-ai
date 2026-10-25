# Plan: repo-skeleton (F-01)

## Goal and end state
A pnpm workspace in which every gate in `CLAUDE.md` exists and passes on a clean checkout:

- `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm e2e && pnpm docker:build`
  are green locally and in `.github/workflows/ci.yml`.
- `GET /api/health` answers with process and database status, nothing else (FR-20 AC5).
- The database is created from checked-in Drizzle migrations, on every server start and by
  `pnpm db:migrate`.
- The OpenAPI document is served outside production, and a test fails when it and the
  registered routes differ (FR-25 AC3).
- Env is parsed by Zod in `packages/config`. Invalid values stop the start with a clear
  message, and `.env.example` lists every variable (FR-23 AC2).
- pino redacts secret paths, and a canary test shows that a configured secret never reaches the
  log output (FR-24 AC2).
- ESLint `no-restricted-imports` enforces the layers from tech-stack *Architecture sketch*, and a
  test shows that a forbidden import fails (TR-23).
- CI fails if `.env`, databases, backups or logs are tracked (FR-24 AC1, TR-12).
- An empty Polish UI shell (strings in `apps/web/src/strings.pl.ts`, shape D-11) is served by
  the same process.
- `docker compose up --build` serves health and the shell. The container runs as non-root,
  applies migrations on start, has a healthcheck on `/api/health`, and refuses to start on
  `0.0.0.0` without a password hash (FR-23 AC4, shape D-14).
- `pnpm discover` prints `brak skonfigurowanych źródeł`.
- The *Gates* and *Commands* tables in `CLAUDE.md` describe the real scripts.

Covers C-01…C-08, FR-20 AC5, FR-23 AC4 (and AC2 for the variables that exist so far),
FR-24 AC1–AC2, FR-25 AC3. TR-12 (F-01 part), TR-20 (file-backed DB, migrations), TR-22, TR-23,
TR-26 (CI image build).

## Scope
- In: workspace layout (`apps/api`, `apps/web`, `packages/contracts`, `packages/config`,
  `deploy/`, `docs/`, `scripts/`, `e2e/`), TS/ESLint/Prettier/Vitest/Playwright/Stryker config,
  the env config package, the logger, the Fastify app with health and OpenAPI, the SQLite
  connection and first migration, the `db:migrate` and `discover` CLIs, the web shell, static
  serving, Dockerfile, compose, CI, and the README/CLAUDE.md/`.env.example` updates.
- Out: login, sessions, `pnpm auth:hash`, the password hash format (S-01). Every domain table,
  LLM variables, sources, the scheduler (later slices). React Router and TanStack Query (added
  by the first slice with a second view). The ARM64 build on the Pi, Tailscale and ollama
  (S-16). Swagger UI.

## Findings
- Repo state: docs and workflow only. There is no `package.json`. `.github/workflows/` is empty.
  `.env.example` (`.env.example:1`) is a one-line placeholder. `.gitignore:1-22` already ignores
  `.workflow/`, `node_modules/`, `dist/`, `reports/`, `.stryker-tmp/`, `playwright-report/`,
  `test-results/`, `.env`, `*.db`, `*.db-*`, `*.sqlite`, `backups/`, `logs/`, `*.log` and
  `config/profile.local.*`. It does **not** ignore a `data/` directory, which this change must
  add. `docs/` holds only `workflow.md`. `README.md` says "Status: specification".
- `context/lessons.md` has no rules yet.
- Environment (checked 2026-10-25): Node v24.22.1, pnpm 12.15.0, corepack 0.36.0, Docker 29.9.2
  with a working daemon and Compose v5.6.1. Playwright browsers are **not** installed:
  `/implement` must run `pnpm exec playwright install chromium`, which is the gate's documented
  need in `CLAUDE.md`.
- Versions are the tech-stack pins (verified 2026-10-24). Added here, checked with `npm view`
  on 2026-10-25: `openapi-types` 12.1.3 (peer of fastify-type-provider-zod), `jsdom` 30.1.3
  (engines `^24.15`), `@types/node` 24.19.2, `@types/better-sqlite3` 9.6.0, `@eslint/js` 10.0.1,
  `eslint-config-prettier` 10.1.8.
- Peer ranges that work together: `fastify-type-provider-zod@7.0.0` (fastify `^5.5`, zod
  `>=4.1.5`, `@fastify/swagger >=9.5.1`, `openapi-types ^12.1.3`), `typescript-eslint@8.72.0`
  (typescript `<6.1.0`, eslint `^10`), `vitest@5.0.5` (vite `^8`, node `^24`),
  `@stryker-mutator/vitest-runner@10.1.1` (vitest `>=2`), `@vitejs/plugin-react@6.1.2` (vite
  `^8`), `drizzle-orm@0.45.4` (better-sqlite3 `>=7`), `fastify@5.12.7` (pino `^10.1`).
- fastify-type-provider-zod 7 API (README): `validatorCompiler` and `serializerCompiler` are
  set on the instance, `withTypeProvider<ZodTypeProvider>()` is used for routes, and
  `@fastify/swagger` takes `transform: jsonSchemaTransform`.
- pnpm 12 does not run dependency install scripts unless the package is listed. So
  `onlyBuiltDependencies: [better-sqlite3]` must be in `pnpm-workspace.yaml` (tech-stack:51).
  esbuild (pulled in by tsx and vite) may also need to be listed. `/implement` checks the
  install warnings.
- Node 24 can load `.env` without a library: `--env-file-if-exists=<path>`.
- Things to verify while implementing, and to log as `[minor]` deviations if they differ:
  - tsx forwards Node's `--conditions` flag; otherwise use `NODE_OPTIONS=--conditions=source`.
  - Vitest node projects resolve custom conditions through `resolve.conditions` /
    `ssr.resolve.conditions`.
  - Stryker's vitest runner accepts the root `projects` config.

## Decisions
Plan-local IDs. `shape D-nn` means a decision in `context/shape-notes.md`.

| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Workspace package names | `@lead-hunter/api`, `@lead-hunter/web`, `@lead-hunter/contracts`, `@lead-hunter/config`; all `private: true` | B: unscoped `api`, `web` (shorter filters, but they collide with npm names in tooling); C: `@lead-hunter-ai/*` (the exact repo name, but longer) | A scope keeps `--filter` and imports readable. Nothing is published. | cheap | agent |
| D-2 | How api/web resolve workspace TS packages in dev, tests and production | Custom export condition `source`: `exports["."] = { source: "./src/index.ts", types: "./dist/index.d.ts", default: "./dist/index.js" }`. Dev, typecheck, Vite, Vitest and tsx use `source`; plain `node` in production uses `dist` | B: always build packages first (one resolution path, but `pnpm dev`/`test` need a prior build); C: bundle the api with esbuild (single file, but a new tool and a less transparent image); D: Node type stripping (no build, but it requires `erasableSyntaxOnly` and `.ts` import specifiers everywhere) | No build step in the dev loop, and production runs plain compiled JS. This is the common "live types" monorepo pattern. | cheap | agent |
| D-3 | Env variables in F-01 and their names | `NODE_ENV` (`development`\|`test`\|`production`, default `development`), `HOST` (default `127.0.0.1`), `PORT` (int 1–65535, default `8080`), `DATA_DIR` (default `./data`), `LOG_LEVEL` (pino levels, default `info`), `OPERATOR_PASSWORD_HASH` (optional string). Variables that are not in the schema are ignored. Empty strings count as unset | B: add `LLM_*` now (`.env.example` closer to its final form, but it documents behaviour that does not exist yet); C: prefix everything `LH_` (no clashes, but it breaks the `LLM_*` names fixed in the roadmap) | Only what the code reads, as FR-23 AC2 requires. Later slices add their own variables. | costly (operator-facing config names) | agent |
| D-4 | FR-23 AC4 / FR-20 AC2 refusal before login exists | `loadConfig` fails when `HOST` is not a loopback address (`127.0.0.1`, `::1`, `localhost`) and `OPERATOR_PASSWORD_HASH` is unset. F-01 checks only that the value is present. S-01 adds the hash format and `pnpm auth:hash`. Until S-01 the human check uses a placeholder value | B: ship `pnpm auth:hash` and the scrypt format now (a real hash from day one, but it fixes S-01's contract early); C: defer the refusal to S-01 (simpler, but the container would listen on `0.0.0.0` unprotected and FR-23 AC4 would not hold) | It meets AC4 without taking S-01's design. One function in `packages/config` decides. | costly (security) | agent |
| D-5 | Loading `.env` | Node `--env-file-if-exists=<repo>/.env` in the api scripts. The container gets env from compose `env_file`. The app never reads `.env` itself | B: `dotenv` (works on any Node, but it adds a dependency) | Built into Node 24, and one source of env per environment. | cheap | agent |
| D-6 | Database location | `${DATA_DIR}/lead-hunter.db`. `DATA_DIR` is resolved against the process cwd. Dev scripts run in `apps/api`, so the dev DB is `apps/api/data/lead-hunter.db`; the container uses `DATA_DIR=/data`. `data/` is added to `.gitignore` | B: `./data/dev.db` at the repo root, as written in tech-stack (needs the root path passed in or resolved); C: a `DATABASE_FILE` variable (more flexible, but one more knob) | One fixed file name in every environment, so backup and restore (S-15) and the Pi docs have one name. Tech-stack's `dev.db` was a sketch; logged as a `[REVIEW]`-level choice here. | costly (persisted file location) | agent |
| D-7 | First migration (Drizzle needs a schema to generate from) | `0000_init`: table `app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`. Nothing writes to it yet. Migrations live in `apps/api/migrations/` (drizzle-kit `out`), outside `src` | B: a hand-written SQL file with an empty journal (no schema file, but Drizzle tooling then needs manual journal edits); C: create a domain table now, e.g. `job_runs` (useful, but it takes S-12's shape early) | Additive, inert and real. It proves the migration pipeline and costs later slices nothing. | costly (persisted schema; additive) | agent |
| D-8 | When migrations run | On every server start (before `listen`) and through `pnpm db:migrate`. Both call the same `runMigrations()` | B: only the CLI, with the container entrypoint running `db:migrate && start` (explicit, but two code paths into the DB) | FR-23 AC4 needs it in the container, and doing the same everywhere is simplest. | cheap | agent |
| D-9 | Health contract | `GET /api/health` returns `200 {status:"ok", version, uptimeSeconds, db:{status:"ok", migrations:<applied count>}}`. If the DB check fails it returns `503` with `status:"degraded"`, `db.status:"error"` and no error text. Schema: `HealthResponse` in `packages/contracts/src/health.ts` | B: always 200 with a flag in the body (simpler, but the Docker healthcheck would need to parse JSON); C: also report data-dir free space (useful on the Pi, but it is configuration-adjacent and belongs to S-16) | The status code drives the compose healthcheck. The body carries no config values and no secrets (FR-20 AC5). | costly (public API) | agent |
| D-10 | Where OpenAPI is served | `GET /api/openapi.json` (hidden from the document itself), registered only when `NODE_ENV !== 'production'`. No Swagger UI | B: always served (handy on the Pi, but S-01 would then have to protect it); C: Swagger UI too (a browsable UI, but one more dependency and static assets) | The roadmap asks for "served in dev". It has the smallest surface. | cheap | agent |
| D-11 | Log redaction method | pino `redact` with `censor: '[REDACTED]'` over one exported path list: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `*.password`, `*.passwordHash`, `*.operatorPasswordHash`, `*.apiKey`, `*.token`, `*.secret`. Config objects are never logged | B: also scrub configured secret **values** in a destination stream (it catches secrets inside error messages, but adds ~30 lines and runs on every log line) | Path redaction is pino's supported mechanism. Value scrubbing can be added in S-05 when real keys exist. | costly (security) | agent |
| D-12 | Routing between API and SPA | `/api/*` with no route returns a JSON 404 `{error:"not_found"}`. Any other `GET` serves the file from `apps/web/dist`, or falls back to `index.html`. Static serving is registered only when the web dist directory exists (passed to `buildApp`) | B: serve the SPA under `/app/` (no fallback needed, but uglier URLs) | Clean URLs for later views, and API errors stay JSON. | cheap | agent |
| D-13 | UI shell content | One page: heading "Lead Hunter AI", one sentence on what the app does, and a server status line from `/api/health` ("Serwer działa · baza danych: OK" / error text). Strings live in `strings.pl.ts`. No router or query library yet | B: a nav with the seven views as disabled links (it previews the IA, but promises views that do not exist) | An honest empty state, and it gives the e2e smoke test a real UI↔API round trip. | cheap | agent |
| D-14 | Permissions on the `./data:/data` bind mount | The image runs as `node` (uid 1000). The README says `mkdir -p data` before the first `up`. At start, the app checks that `DATA_DIR` is writable and otherwise exits with a clear message | B: an entrypoint that starts as root, `chown`s and drops privileges (works with any host dir, but it means root at start and more code); C: a named volume instead of a bind mount (no permission issue, but the roadmap fixes `./data:/data`) | Non-root from the first instruction. On the Pi the first user is uid 1000. | cheap | agent |
| D-15 | Language of operator-facing CLI and start errors | Polish, naming the variable, e.g. `Błąd konfiguracji: PORT — oczekiwano liczby 1–65535`. Logs stay structured JSON with English keys | B: English (the usual for logs, but it is inconsistent with the Polish `discover` text the roadmap fixes) | The operator reads these on the Pi, and the roadmap already fixes one Polish CLI message. | cheap | agent |
| D-16 | Layer rules (ESLint `no-restricted-imports`) | (1) `apps/api/src/modules/**` may not import `**/infrastructure/**`, `better-sqlite3`, `drizzle-orm*`, `undici`, `@anthropic-ai/sdk`, `openai`, `imapflow`, `croner`. (2) Files in `modules/**` other than `routes.ts` may not import `fastify*` either. (3) `apps/api/src/**` except `server.ts`, `cli/**` and `infrastructure/**` may not import `**/infrastructure/**`. (4) `packages/**` may not import `@lead-hunter/api`, `@lead-hunter/web` or `apps/**`. (5) `apps/web/**` may not import `@lead-hunter/api`, `apps/api/**`, `node:*` or `fastify*` | B: `eslint-plugin-boundaries` (richer rules, but one more plugin); C: dependency-cruiser (a full graph, but a separate tool) | Tech-stack names `no-restricted-imports`, which needs no plugin. | cheap | agent |
| D-17 | Prettier scope | TS/TSX/JS/JSON/YAML/CSS. Markdown and `context/`, `docs/`, `.claude/` and the brief are ignored. `pnpm lint` = `eslint . && prettier --check .` | B: format Markdown too (consistent, but it reflows the approved artifacts) | It does not churn the approved docs. | cheap | agent |
| D-18 | e2e server start | `pnpm e2e` = `pnpm build && playwright test`. Playwright `webServer` starts `node apps/api/dist/server.js` with `NODE_ENV=production`, `PORT=${E2E_PORT:-4317}`, a temp `DATA_DIR` created in the config and `LLM_PROVIDER=mock` (ignored until S-04) | B: a wrapper script that finds a free port (no fixed port, but more code); C: run against `pnpm dev` (no build, but it does not test the shipped artifact) | Playwright's built-in server management, and it tests the production build. | cheap | agent |
| D-19 | Repo hygiene check | `scripts/check-tracked.ts`: a pure `findForbidden(paths: string[]): string[]` plus a CLI over `git ls-files`, run by the CI job `repo-hygiene`. A test also asserts that `git check-ignore` covers sample private paths | B: an inline shell `grep` in the workflow (fewer files, but untested) | FR-24 AC1 is a security rule, so the check gets a unit test. | cheap | agent |
| D-20 | CI mutation job in F-01 | Job `mutation-report` runs `scripts/mutation-changed.sh`: Stryker on changed files listed in test-plan *Mutation targets*, score written to the job summary, `continue-on-error: true`. With no target changed it prints "no target files changed" | B: add the job with the first target module (S-03/S-04) (less dead config now) | The test plan says CI is created in F-01 with this job. Report-only, so it cannot block. | cheap | agent |
| D-21 | `pnpm discover` behaviour in F-01 | Loads config, prints `brak skonfigurowanych źródeł` to stdout and exits 0. Does not open the DB | B: exit 1 (louder, but "no sources configured" is a valid state, not an error) | Matches the roadmap text. S-10/S-12 replace the body. | cheap | agent |

## Design

### Layout (new files)
```
package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js  .prettierrc.json
.prettierignore  vitest.config.ts  playwright.config.ts  stryker.config.mjs  .dockerignore
Dockerfile  docker-compose.yml  .github/workflows/ci.yml
scripts/check-tracked.ts (+ .test.ts)  scripts/mutation-changed.sh
deploy/README.md            # points to the root Dockerfile/compose; S-16 adds Pi notes
e2e/smoke.spec.ts
packages/contracts/  src/index.ts, src/health.ts (+ test)
packages/config/     src/index.ts, src/env.ts (+ test)
apps/api/  drizzle.config.ts, migrations/, src/{server.ts, app.ts}, src/modules/health/
           {routes.ts, ports.ts}, src/infrastructure/db/{client.ts, schema.ts, migrate.ts,
           health-probe.ts}, src/infrastructure/logging/logger.ts, src/cli/{migrate.ts,
           discover.ts}, test/{setup.ts, helpers/app.ts, *.int.test.ts}
apps/web/  index.html, vite.config.ts, src/{main.tsx, App.tsx, App.module.css,
           strings.pl.ts, api/health.ts, App.test.tsx}
```

### TypeScript
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `target ES2024`, `skipLibCheck`, `customConditions: ["source"]`.
- api and packages use `module`/`moduleResolution` `nodenext` (relative imports end in `.js`).
  The web uses `bundler` plus `jsx: react-jsx`.
- Every package has a `tsconfig.json` (typecheck, `noEmit`, includes tests) and, for
  api/contracts/config, a `tsconfig.build.json` (emits `dist`, excludes tests, sets
  `customConditions: []` so it resolves `types` → `dist`). `pnpm build` is `pnpm -r build`, run
  in topological order: contracts → config → api; the web is built by Vite.

### Config (`packages/config/src/env.ts`)
- `EnvSchema` (Zod object, D-3).
- `loadConfig(env: Record<string, string | undefined>): Config`. It throws `ConfigError`
  (`issues: {variable, message}[]`, with a multi-line Polish `message` per D-15).
- `Config = { nodeEnv, host, port, dataDir, logLevel, operatorPasswordHash?: string }`
  (camelCase).
- The D-4 rule is a `superRefine` on the object.
- `ENV_VARIABLES` exports the key list. A test checks that each one appears in `.env.example`.

### API
- `server.ts` `main()`:
  1. `loadConfig(process.env)`; on `ConfigError`, write `message` to stderr and exit 1.
  2. Ensure `dataDir` exists and is writable (D-14).
  3. `openDb(join(dataDir,'lead-hunter.db'))`: WAL, `busy_timeout = 5000`, foreign keys on.
  4. `runMigrations(db)`.
  5. `buildApp({ config, healthProbe, webDistDir })`, then `listen({host, port})`.
  6. On SIGTERM/SIGINT, close the app and then the DB.
- `app.ts` `buildApp(deps): Promise<FastifyInstance>` sets the Zod compilers, registers
  swagger (+ the `/api/openapi.json` route outside production), the health routes, the JSON 404
  for `/api/*` and static serving (D-12). The logger options come in through `deps`, from
  `createLoggerOptions(config)`. `app.ts` must not import infrastructure (D-16 rule 3): only
  `server.ts` and the test helper wire it.
- `modules/health/ports.ts`: `interface HealthProbe { check(): { ok: boolean; migrations: number } }`.
  `infrastructure/db/health-probe.ts` implements it with `select 1` plus a count of
  `__drizzle_migrations`. It catches errors and returns `ok:false`.
- `infrastructure/logging/logger.ts` exports `REDACT_PATHS` and
  `createLoggerOptions(config, destination?)`. The destination parameter lets tests capture
  output.
- CLI `cli/migrate.ts` (`pnpm db:migrate`): config → open → migrate → print the applied count.
  `cli/discover.ts`: D-21.

### Error model
- A config error stops the start (exit 1, Polish message naming the variable).
- A data dir that is not writable stops the start (exit 1).
- A migration failure stops the start (exit 1, logged).
- The health DB check fails → 503.
- An unknown `/api/*` route → JSON 404.

### Web
- `main.tsx` mounts `<App/>`.
- `App` calls `fetchHealth()` once (plain `fetch`, response parsed with
  `HealthResponse.safeParse`) and renders the D-13 text from `strings.pl.ts`.
- Vite dev server proxies `/api` to `http://127.0.0.1:8080`.

### Docker
Multi-stage on `node:24-bookworm-slim`, with `corepack enable` and `packageManager:
pnpm@12.15.0` in the root `package.json`.
- `build` stage: `python3 make g++` as a fallback for the better-sqlite3 build. Copy manifests
  and the lockfile, `pnpm install --frozen-lockfile`, copy sources, `pnpm build`.
- `prod-deps` stage: manifests only, `pnpm install --frozen-lockfile --prod`.
- `runtime` stage: copy `node_modules` (root and per package) from `prod-deps`; copy `dist`,
  `package.json` and `migrations/` from `build`; set `ENV NODE_ENV=production DATA_DIR=/data
  HOST=0.0.0.0 PORT=8080`; `USER node`; `CMD ["node","apps/api/dist/server.js"]`.
- Compose service `app`:
  - `build: .`, `init: true`, `restart: unless-stopped`
  - `env_file: .env`, `volumes: ["./data:/data"]`, `ports: ["127.0.0.1:8080:8080"]`
  - healthcheck `node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`
    (no curl in slim), with interval 30s and start_period 20s.

## Phases

### Phase 1: Workspace, tooling and layer rules
- Files:
  - `package.json`: root, `private`, `type: module`, `packageManager: pnpm@12.15.0`,
    `engines.node: ^24`. Scripts `typecheck` (`pnpm -r typecheck`), `lint` (D-17), `test`
    (`vitest run`). Exact-pinned devDeps: typescript, eslint, @eslint/js, typescript-eslint,
    eslint-config-prettier, prettier, vitest, tsx, @types/node. Contract: the gate script names
    in `CLAUDE.md`.
  - `pnpm-workspace.yaml`: `packages: [apps/*, packages/*]`; `onlyBuiltDependencies:
    [better-sqlite3]` (plus esbuild if pnpm asks for it).
  - `tsconfig.base.json`: see *Design › TypeScript*.
  - `eslint.config.js`: flat config with `@eslint/js` recommended, typescript-eslint
    recommended (no type info), prettier and the D-16 rules. Ignores `dist`, `reports`,
    `coverage`, `apps/api/migrations`.
  - `.prettierrc.json`, `.prettierignore`: D-17.
  - `vitest.config.ts`: `test.projects: ['apps/*', 'packages/*', 'scripts']`.
  - `packages/contracts/{package.json, tsconfig*.json, vitest.config.ts, src/index.ts,
    src/health.ts, src/health.test.ts}`: the `HealthResponse` schema (D-9) and a test that it
    rejects extra keys (`.strict()`). Contract: `exports` with the `source` condition (D-2).
  - `packages/config/{package.json, tsconfig*.json, vitest.config.ts, src/index.ts}`: exports a
    placeholder `ENV_VARIABLES = [] as const`, filled in by Phase 2, plus one trivial test.
  - `apps/api/{package.json, tsconfig.json, vitest.config.ts, src/app.ts, test/setup.ts}`:
    - `app.ts` is a minimal `buildApp()` returning a bare Fastify instance, so the package
      typechecks.
    - `setup.ts` installs undici `MockAgent` with `disableNetConnect()` (test-plan *Test data
      and isolation*); undici is a devDep pinned to 8.12.3.
    - `apps/api/test/lint-layers.int.test.ts` runs `ESLint.lintText` over fixture snippets
      with virtual `filePath`s: a module file importing `../../infrastructure/db/client.js`, a
      domain file importing `fastify`, and a web file importing `@lead-hunter/api`. Each must
      report `no-restricted-imports`. An allowed import (`routes.ts` importing `fastify`) must
      pass.
  - `apps/web/{package.json, tsconfig.json, vitest.config.ts (jsdom), src/strings.pl.ts,
    src/strings.pl.test.ts}`: the strings module (D-13 texts) and a trivial test.
  - `scripts/check-tracked.ts`, `scripts/check-tracked.test.ts`, `scripts/vitest.config.ts`:
    - `findForbidden(paths)` per D-19. Patterns: `(^|/)\.env$` and `(^|/)\.env\.(?!example$)`,
      `\.(db|sqlite)$`, `\.db-`, `(^|/)backups/`, `(^|/)logs/`, `\.log$`,
      `(^|/)config/profile\.local\.`, `(^|/)data/`.
    - A table test covers each pattern and the allowed `.env.example`.
    - A second test runs `git check-ignore` on sample paths (`.env`, `data/x.db`,
      `backups/a.db`, `logs/a.log`, `x.log`, `config/profile.local.json`) and expects them
      all ignored.
  - `.gitignore`: add `data/`.
- Proves: C-05 (Vitest with projects), C-07 (layout), FR-24 AC1 (unit + git check-ignore
  test), TR-23 (lint fixture test).
- Agent checks: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Env config and logger with redaction
- Files:
  - `packages/config/src/env.ts`: `EnvSchema`, `loadConfig`, `ConfigError`, `ENV_VARIABLES`
    (D-3, D-4, D-15). Contract: `loadConfig(env) → Config`, throws `ConfigError`.
  - `packages/config/src/env.test.ts`, table-driven:
    - the defaults;
    - each invalid value fails with a message that names the variable: `PORT=abc`,
      `PORT=70000`, `NODE_ENV=prod`, `LOG_LEVEL=loud`;
    - `HOST=0.0.0.0` without a hash fails;
    - `HOST=0.0.0.0` with a hash passes; `HOST=::1` and `HOST=localhost` without a hash pass;
    - an empty string counts as unset;
    - every name in `ENV_VARIABLES` appears in `../../.env.example` (FR-23 AC2).
  - `.env.example`: every D-3 variable with its meaning and default, comments in English, no
    real values. `OPERATOR_PASSWORD_HASH=` is empty, with a note that S-01 adds `pnpm auth:hash`.
  - `apps/api/package.json`: add runtime deps fastify, pino, zod, `@lead-hunter/config`,
    `@lead-hunter/contracts`.
  - `apps/api/src/infrastructure/logging/logger.ts`: `REDACT_PATHS` and `createLoggerOptions`
    (D-11).
  - `apps/api/test/logging.int.test.ts`:
    - builds a Fastify instance with the logger options and a captured destination;
    - the config holds `operatorPasswordHash: 'hash-LEAK-CANARY'`;
    - logs objects shaped like `{ operatorPasswordHash }`, `{ apiKey }` and
      `{ req: { headers: { cookie, authorization } } }`, each with a `*-LEAK-CANARY` value;
    - sends one `inject` request with `cookie: session=cookie-LEAK-CANARY` and an
      `authorization` header;
    - asserts that no captured line contains `LEAK-CANARY`, that `[REDACTED]` appears, and
      that the lines are valid JSON.
- Proves: FR-24 AC2 (integration), FR-23 AC2 for the F-01 variables (unit), FR-23 AC4 refusal
  rule (unit), TR-12 (F-01 part).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: API server, database, health, OpenAPI and CLIs
- Files:
  - `apps/api/package.json`: add better-sqlite3, drizzle-orm, @fastify/swagger,
    fastify-type-provider-zod, openapi-types; devDeps drizzle-kit, @types/better-sqlite3.
    Scripts:
    - `dev`: `node --env-file-if-exists=../../.env --conditions=source --import tsx --watch src/server.ts`
    - `build`: `tsc -p tsconfig.build.json`
    - `start`: `node --env-file-if-exists=../../.env dist/server.js`
    - `db:migrate`, `db:generate` (drizzle-kit), `discover`
  - `apps/api/drizzle.config.ts`, `src/infrastructure/db/schema.ts` (`app_meta`, D-7),
    `migrations/0000_*.sql` plus `meta/`, generated by `pnpm --filter @lead-hunter/api db:generate`.
  - `src/infrastructure/db/client.ts`: `openDb(file): { sqlite, db }` with WAL, busy_timeout
    and foreign_keys.
  - `src/infrastructure/db/migrate.ts`: `runMigrations(db, folder = <package>/migrations)`.
    The folder is resolved from `import.meta.url`, so it works from both `src` and `dist`.
  - `src/infrastructure/db/health-probe.ts`: implements `HealthProbe` (D-9).
  - `src/modules/health/ports.ts`, `src/modules/health/routes.ts`: `GET /api/health` with
    `schema.response` `{200: HealthResponse, 503: HealthResponse}`.
  - `src/app.ts`: full `buildApp(deps)` (*Design › API*, D-10, D-12 without static yet).
  - `src/server.ts`: `main()` (*Design › API*, D-8, D-14).
  - `src/cli/migrate.ts`, `src/cli/discover.ts` (D-21).
  - Root `package.json` scripts: `dev` (`pnpm --parallel --filter @lead-hunter/api --filter
    @lead-hunter/web dev`; until Phase 4 only the api has `dev`), `build` (`pnpm -r build`),
    `start` (`pnpm --filter @lead-hunter/api start`), `db:migrate`, `discover`.
  - `packages/contracts`, `packages/config`: `build` scripts and `tsconfig.build.json`.
  - `apps/api/test/helpers/app.ts`: `buildTestApp({ env? })` creates a temp `DATA_DIR`, opens
    a file-backed DB, runs migrations, builds the app with the real probe, and cleans up after
    the test. `openTestDb()` does the same without the app (test-plan cookbook).
  - `apps/api/test/health.int.test.ts`:
    - 200 with exactly the D-9 keys and `migrations ≥ 1`;
    - the body contains no canary (env has `OPERATOR_PASSWORD_HASH=hash-LEAK-CANARY`,
      `HOST=0.0.0.0`) and none of the config values `dataDir` or `host` (FR-20 AC5);
    - a probe returning `ok:false` gives 503 `degraded`;
    - an unknown `/api/nope` gives a JSON 404.
  - `apps/api/test/openapi.int.test.ts`: collects routes with an `onRoute` hook (minus routes
    with `schema.hide` and HEAD) and compares the set of `METHOD path` with `app.swagger().paths`
    (FR-25 AC3). It also checks that `/api/openapi.json` is absent when `NODE_ENV=production`.
  - `apps/api/test/db.int.test.ts`:
    - migrations on a fresh file create `app_meta` and `__drizzle_migrations`;
    - running them twice is a no-op;
    - data survives a close and reopen (TR-20).
  - `apps/api/test/cli.int.test.ts`: spawns the tsx entry points with a temp `DATA_DIR` and
    checks that:
    - `discover` prints `brak skonfigurowanych źródeł` and exits 0;
    - `server.ts` with `PORT=abc` exits 1 with a stderr message naming `PORT`;
    - `server.ts` with `HOST=0.0.0.0` and no hash exits 1 with a message naming
      `OPERATOR_PASSWORD_HASH`;
    - `cli/migrate.ts` creates `lead-hunter.db` in the temp dir.
- Proves: FR-20 AC5, FR-25 AC3, FR-23 AC4 (migrations on start, refusal), C-03, C-08
  (`db:migrate`, `discover`), TR-20, TR-22. All at integration level.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`; `pnpm build`; then in one shell,
  `pnpm start` against a temp `DATA_DIR`, `curl -s 127.0.0.1:8080/api/health`, stop the server.
  Save the output to `context/changes/repo-skeleton/evidence/health.txt`.
- Human checks: none.

### Phase 4: Web shell, static serving and e2e smoke
- Files:
  - `apps/web/package.json`: deps react and react-dom; devDeps vite, @vitejs/plugin-react,
    @testing-library/react, jsdom, @types/react, @types/react-dom. Scripts `dev` (`vite`),
    `build` (`vite build`), `typecheck`.
  - `apps/web/index.html` (`lang="pl"`, viewport meta), `vite.config.ts` (`source` condition,
    `/api` proxy), `src/main.tsx`, `src/App.tsx`, `src/App.module.css` (fluid down to 360 px),
    `src/api/health.ts` (`fetchHealth(): Promise<HealthResponse>`), `src/strings.pl.ts`
    (final D-13 texts).
  - `apps/web/src/App.test.tsx`: stubs `fetch`, then checks that the heading renders, the OK
    status text renders for a healthy response, and the error text renders for 503 or a
    network error (strings come from `strings.pl.ts`).
  - `apps/api/src/app.ts`: register `@fastify/static` for `webDistDir` with the SPA fallback
    (D-12). `server.ts` passes `<api package>/../web/dist` when it exists. Add the
    `@fastify/static` dep.
  - `apps/api/test/static.int.test.ts`: with a temp dir holding an `index.html`, `GET /`
    returns it, `GET /some/view` returns it too, and `GET /api/nope` is still a JSON 404.
  - `playwright.config.ts`, `e2e/smoke.spec.ts`:
    - D-18 setup;
    - at a 360×740 viewport, the heading "Lead Hunter AI" and the status text "Serwer działa"
      are visible, and the page has no horizontal scroll;
    - `request.get('/api/health')` returns 200.
  - Root `package.json`: `e2e` (`pnpm build && playwright test`), devDep `@playwright/test`.
- Proves: C-02 (SPA served by the same process; component test plus e2e), FR-23 AC4 (UI half
  of "serves health and the UI shell", e2e on the production build).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`; `pnpm exec playwright install
  chromium` (once), then `pnpm e2e`. Save a 360 px screenshot under 300 KB to
  `evidence/shell-360.png`.
- Human checks:
  - Open `pnpm build && pnpm start`, then http://127.0.0.1:8080 on a laptop and a phone-width
    window. Judge the Polish wording and whether the shell reads as an honest "nothing here
    yet" (compare with `evidence/shell-360.png`).

### Phase 5: Docker image, compose, CI and docs
- Files:
  - `Dockerfile`, `.dockerignore` (`node_modules`, `**/dist`, `.git`, `.workflow`, `data`,
    `.env*` except `.env.example`, `reports`, `context`): see *Design › Docker*.
  - `docker-compose.yml`: see *Design › Docker*. Contract: port `127.0.0.1:8080:8080` and
    volume `./data:/data`.
  - Root `package.json`: `docker:build` (`docker build -t lead-hunter-ai:local .`) and
    `mutation` (`stryker run`); devDeps @stryker-mutator/core and vitest-runner 10.1.1.
  - `stryker.config.mjs`: exactly as in test-plan *Mutation targets › Tool setup*.
  - `scripts/mutation-changed.sh`: D-20.
  - `.github/workflows/ci.yml`. Every job runs on `pull_request` and `push`, with Node 24 via
    `actions/setup-node` and pnpm via `pnpm/action-setup` (version from `packageManager`).
    Jobs:
    - `check`: install `--frozen-lockfile`, typecheck, lint, test.
    - `e2e`: install, `pnpm exec playwright install --with-deps chromium`, `pnpm e2e`, upload
      `playwright-report` on failure.
    - `image`: `pnpm docker:build`.
    - `repo-hygiene`: `pnpm exec tsx scripts/check-tracked.ts`.
    - `mutation-report`: PRs only, `continue-on-error`.
  - `deploy/README.md`: two paragraphs. The deployment files are the root `Dockerfile` and
    `docker-compose.yml`; S-16 adds the Pi and Tailscale notes here.
  - `README.md`, in Polish for the operator:
    - *Uruchomienie*: `mkdir -p data`, `cp .env.example .env`, set `OPERATOR_PASSWORD_HASH`
      (placeholder until S-01), `docker compose up --build`, check
      http://127.0.0.1:8080/api/health.
    - *Rozwój*: `pnpm install`, `pnpm dev`, the gates.
    - "Co działa / Co wymaga kluczy / Co wymaga ręcznej weryfikacji" with the initial entries
      (FR-26 AC1).
    - The status line is updated.
  - `CLAUDE.md`: *Gates* and *Commands* updated to the real scripts, including `pnpm build`,
    `pnpm start`, `pnpm db:migrate`, `pnpm discover` and the dev DB path (D-6). Remove "Until
    then the gates fail".
- Proves: FR-23 AC4 in the image (non-root, migrations on start, healthcheck, refusal), TR-26
  (image builds in CI), FR-24 AC1 (CI job).
- Agent checks:
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm docker:build`;
  - `docker compose config -q` (with a throwaway env file passed through `--env-file` to a
    copy, never touching `.env`). If compose insists on `.env`, validate with `docker compose
    -f docker-compose.yml config --no-interpolate`;
  - container smoke with `docker run`, no `.env` involved. With a temp dir chowned to 1000 and
    `-e OPERATOR_PASSWORD_HASH=placeholder -p 127.0.0.1:18080:8080`, check that:
    - `curl /api/health` returns 200 with `migrations ≥ 1`;
    - `curl /` returns the shell HTML;
    - `docker exec … id -u` prints 1000;
    - the same run without the hash exits non-zero with the Polish message.
    Save all output to `evidence/docker-smoke.txt`;
  - `pnpm exec tsx scripts/check-tracked.ts` exits 0;
  - `pnpm mutation --mutate packages/config/src/env.ts` runs and produces a score (not a gate).
- Human checks:
  - On a machine with Docker (ideally the Pi): `mkdir -p data && cp .env.example .env`, set
    `OPERATOR_PASSWORD_HASH=placeholder`, run `docker compose up -d --build`. After about 30 s,
    `docker compose ps` shows `healthy` and `curl 127.0.0.1:8080/api/health` returns 200. Then
    `docker compose restart` and check that `data/lead-hunter.db` still exists. On the Pi, note
    the build time; this is the better-sqlite3 ARM64 build that tech-stack:68 flags.
  - After the PR is pushed, the GitHub Actions run shows all five jobs (the `mutation-report`
    summary reads "no target files changed" or a score).

## Risks and unknowns
- **Docker build network in the sandbox.** The daemon may not reach the npm registry or the
  better-sqlite3 prebuild host through the agent proxy. If `pnpm docker:build` cannot fetch
  dependencies for that reason, `/implement` records a `[REVIEW]` deviation with the log and
  leaves the build to CI. It does not change the Dockerfile to work around the proxy.
- **Playwright Chromium download** may be blocked in the same way. The fallback is the same:
  record it and rely on the CI `e2e` job.
- **`source` condition plumbing** (tsx, Vitest, Vite). It is the main technical unknown (see
  *Findings*). If a tool cannot honour it, the fallback is D-2 option B: build the packages
  before dev and tests. That is a `[REVIEW]` deviation.
- **pnpm 12 build-script approval.** Esbuild, or Stryker's dependencies, may need entries in
  `onlyBuiltDependencies`. Each entry needed is logged as a `[minor]` deviation.
- **The placeholder hash (D-4)** is accepted until S-01. S-01 must tighten the format check, or
  the placeholder keeps working; S-01's planner gets this from this plan.
- **Phase 3 size** may exceed ~400 lines with tests. If it does, `/implement` may split the
  CLIs into their own commit (`[minor]`).

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Workspace, tooling and layer rules
- [x] Phase 2: Env config and logger with redaction
- [x] Phase 3: API server, database, health, OpenAPI and CLIs
- [x] Phase 4: Web shell, static serving and e2e smoke
- [x] Phase 5: Docker image, compose, CI and docs

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 4) Judge the Polish wording of the shell and whether it reads as an honest "nothing here yet" on a laptop and a phone-width window — run: `pnpm build && pnpm start`, open http://127.0.0.1:8080 — evidence: `context/changes/repo-skeleton/evidence/shell-360.png`

- [ ] (Phase 5) On a machine with Docker (ideally the Pi): `mkdir -p data && cp .env.example .env`, set `OPERATOR_PASSWORD_HASH=placeholder`, run `docker compose up -d --build`; after ~30 s `docker compose ps` shows `healthy` and `curl 127.0.0.1:8080/api/health` returns 200; `docker compose restart` keeps `data/lead-hunter.db`; also `docker run --rm --entrypoint id -u`-style check that the user is 1000 and that running without the hash exits non-zero. Note the Pi build time (better-sqlite3 ARM64) — run: commands above — evidence: none (sandbox build blocked, see Deviations)
- [ ] (Phase 5) After the PR is pushed, the GitHub Actions run shows all five jobs green (`mutation-report` summary reads "no target files changed" or a score) — run: open the PR checks — evidence: none

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [REVIEW] (Phase 5) `pnpm docker:build` fails in the sandbox: the build stage's `apt-get update` cannot resolve `deb.debian.org` (no DNS inside the build; base image pull works). Per *Risks*, the Dockerfile was not changed to work around it, so the image, the container smoke (non-root, migrations on start, healthcheck, refusal) and `docker-smoke.txt` are unverified here and left to the CI `image` job and the human check. Evidence file records this. Reviewer: the Dockerfile has never been built; check the CI `image` job first. `docker compose config -q` passes.
- [minor] (Phase 5) `stryker.config.mjs` adds `plugins: ['@stryker-mutator/vitest-runner']`: with pnpm's isolated `node_modules`, Stryker's default plugin glob does not find the runner ("Cannot find TestRunner plugin vitest"). `pnpm mutation --mutate packages/config/src/env.ts` then runs: score 75.00 % (51 killed, 16 survived, 1 no coverage); report only.
- [minor] (Phase 1) pnpm 12.15.0 does not honour `onlyBuiltDependencies`: `pnpm install` failed with `ERR_PNPM_IGNORED_BUILDS` for esbuild. `pnpm approve-builds` wrote `allowBuilds` instead, so `pnpm-workspace.yaml` uses `allowBuilds: {esbuild: true, better-sqlite3: true}`. Same intent as the plan and roadmap (better-sqlite3 stays approved).
- [minor] (Phase 1) Plan-review finding 5 applied: fastify (api), zod (contracts) and jsdom (web) are added in Phase 1 so the phase is green. Finding 10 applied: `apps/api/test/network-isolation.test.ts` asserts that an unmocked `fetch` rejects.
- [minor] (Phase 1) Root `typecheck` is `pnpm -r typecheck && tsc -p scripts/tsconfig.json`, so `scripts/` is typechecked too (it is not a workspace package).
- [minor] (Phase 2) Plan-review finding 3 applied: `REDACT_PATHS` lists both `key` and `*.key` forms. D-11 is `costly` per finding 2 (it decides which secrets may reach logs). The canary test also logs `req.headers` directly, since Fastify's default `req` serializer logs no headers.
- [minor] (Phase 2) The `source` condition now works for api → config/contracts under tsc and Vitest (api test imports `@lead-hunter/config`). tsx and plain node resolution are still unverified until Phase 3.
- [minor] (Phase 2) `.env.example` keeps `NODE_ENV`, `HOST`, `PORT`, `DATA_DIR` and `LOG_LEVEL` commented out (plan-review finding 1), so a copied `.env` cannot override the container's values; `OPERATOR_PASSWORD_HASH=` is live and empty. The `ENV_VARIABLES` test accepts commented lines. Unknown variables such as a typo `LOG_LEVL` are ignored (finding 9 reading: invalid value of a known variable fails).
- [minor] (Phase 1) The `source` export condition is wired in tsconfig (`customConditions`) and in the package Vitest configs, but no cross-package import exists yet, so tsx and Vitest resolution through `source` is still unverified. Phase 2 (api imports config/contracts) is the first real test of it.
- [minor] (Phase 3) The `source` condition works for tsx (`node --conditions=source --import tsx`, exercised by `cli.int.test.ts`) and plain `node` runs the built `dist` of config/contracts (evidence/health.txt). The Phase 1/2 open question is closed.
- [minor] (Phase 3) Plan-review finding 6 applied: `buildApp` takes `deps.onRoute`; the OpenAPI test normalises `:param` to `{param}`. `buildApp` is async and calls `app.ready()`.
- [REVIEW] (Phase 3) D-6 moves the dev DB to `apps/api/data/lead-hunter.db` while tech-stack *Local development* says `./data/dev.db`; tech-stack needs updating at the PR.
- [minor] (Phase 3) Added `src/version.ts` (reads the package version for health) and `src/cli/config.ts` (shared Polish exit-on-ConfigError helper) beyond the plan's file list.
- [REVIEW] (Phase 4) `pnpm exec playwright install chromium` failed in the sandbox (download blocked; Chrome for Testing 156 / build 1248). An older Chromium (1243) exists in `/opt/pw-browsers`. `playwright.config.ts` reads an optional `E2E_CHROMIUM_PATH` (empty by default, so CI uses the pinned download); the local e2e run and `shell-360.png` used the 1243 headless shell. The CI `e2e` job (Phase 5) must confirm the pinned browser.
- [minor] (Phase 4) Added `e2e/tsconfig.json` and put `tsc -p e2e/tsconfig.json` in the root `typecheck`, so `playwright.config.ts` and the specs are typechecked. Added `apps/web/src/css.d.ts` for CSS module typings and `@lead-hunter/contracts` as a web dependency. D-18 differs from the test plan (fixed port 4317, no password hash on loopback) as plan-review finding 13 noted.
- [minor] (review round 1) R1–R4 fixed: compose now sets `environment:` (NODE_ENV, HOST, PORT, DATA_DIR) so a copied `.env` cannot override the container; the Dockerfile toolchain from plan-review finding 4 is removed; `apps/api/package.json` has `version` 0.1.0; the SPA fallback skips `/api`, `/assets/` and paths with an extension. The image build is still unverified (see the Phase 5 REVIEW entry).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
