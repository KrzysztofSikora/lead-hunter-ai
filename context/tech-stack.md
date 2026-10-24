# Tech stack

Versions verified on 2026-10-24 with `npm view` against the npm registry. Pin exact versions in
`package.json`; upgrade deliberately.

## Summary
| Area | Choice | Version | Why (one line) |
|------|--------|---------|----------------|
| Runtime | Node.js LTS | 24.x | Mandated Node LTS (C-01); Vitest 5 needs `^22.12 \|\| ^24`; official ARM64 builds |
| Package manager / monorepo | pnpm workspaces | 12.15.0 | Brief's layout (C-07) and command names (C-08); `--filter` for per-package gates |
| Language | TypeScript, `strict`, ESM | 6.0.3 | typescript-eslint 8.72 supports `<6.1`; TS 7 not yet supported by the linter |
| HTTP server | Fastify | 5.12.7 | Mandated (C-01) |
| Schemas / validation | Zod | 4.6.7 | Mandated; one schema per contract in `packages/contracts` |
| Route typing + OpenAPI | fastify-type-provider-zod + @fastify/swagger | 7.0.0 / 9.9.2 | Zod schemas drive validation, types and the OpenAPI document (FR-25 AC3) |
| Static UI serving | @fastify/static | 10.1.7 | One process serves API and built SPA (C-02) |
| Sessions / login throttle | @fastify/cookie + sessions table; @fastify/rate-limit | 11.1.3 / 11.2.1 | FR-20; no session-store dependency |
| Password hashing | `node:crypto` scrypt | (Node) | Built in; no native addon on ARM64 |
| Database driver | better-sqlite3 | 13.0.3 | Synchronous, fast, Drizzle-supported; WAL mode |
| ORM / migrations | drizzle-orm + drizzle-kit | 0.45.4 / 0.31.11 | Brief's preference (C-03); SQL migrations checked into the repo |
| Scheduler | croner | 10.0.1 | Cron with IANA time zones, correct across DST (FR-17 AC1) |
| Outbound HTTP | undici (custom `connect.lookup`) + ipaddr.js | 8.12.3 / 2.5.0 | Timeouts, size limits and SSRF guard incl. DNS rebinding (FR-03) |
| Feed parsing | fast-xml-parser + own RSS 2.0/Atom mapping | 5.11.2 | Maintained parser; fetching stays in our guarded client |
| Page extraction | @mozilla/readability + linkedom; robots-parser | 0.6.0 / 0.18.14 / 3.0.1 | Main text of a manually imported page; robots.txt check |
| IMAP / e-mail | imapflow + mailparser | 2.9.1 / 3.12.4 | Maintained, read-only `EXAMINE` + UID fetch (FR-05) |
| LLM (Anthropic) | @anthropic-ai/sdk | 1.3.0 | Official SDK: retries, typed usage (FR-08, FR-09) |
| LLM (OpenAI-compatible) | openai with `baseURL` | 7.43.0 | One client for Ollama, Groq, OpenRouter, Gemini compatibility endpoint (D-07) |
| Default models | `claude-haiku-5-5` (analysis), `claude-sonnet-5-5` (offer drafts) | – | Cheaper model for extraction, stronger on demand (§6.2); `.env` overrides |
| Logging | pino (Fastify's logger) with redaction | 10.4.0 | Structured JSON logs (NFR-05), redact paths for secrets (FR-24) |
| UI | React + React DOM | 19.3.1 | Mandated (C-02) |
| UI build | Vite + @vitejs/plugin-react | 8.3.5 / 6.1.2 | Mandated (C-02) |
| Routing | react-router | 8.5.0 | Seven views (§11); declarative mode |
| Server state | @tanstack/react-query | 5.104.5 | Caching, retries, loading/error states for API calls |
| Styling | CSS Modules (Vite built-in) | – | No extra dependency; responsive layout by hand |
| Unit / integration tests | Vitest (projects per package) + @testing-library/react | 5.0.5 / 16.3.3 | Mandated (C-05); API tests via `fastify.inject` |
| Outbound HTTP mocks | undici `MockAgent` | (undici) | Feeds, pages and LLM APIs mocked without another library |
| E2E | @playwright/test (Chromium, CI on x86) | 1.64.1 | One main-path test (C-05); mock LLM provider |
| Mutation testing | @stryker-mutator/core + vitest-runner | 10.1.1 | Per-module gate (configured in `/test-plan`) |
| Lint / format | ESLint + typescript-eslint; Prettier | 10.13.0 / 8.72.0 / 3.9.10 | Layer rules via `no-restricted-imports` |
| Dev runner | tsx | 4.23.15 | `pnpm dev` without a build step |
| Deployment | Docker Compose on the Pi; multi-stage image from `node:24-bookworm-slim` (linux/arm64) | – | C-06, D-14; native better-sqlite3 built inside the image |

## Decisions

### Runtime and package manager
- Options considered: Node 24 LTS; Node 22 LTS; Node 26 (LTS from late October 2026).
- Chosen: Node 24 LTS, because Vitest 5 supports it, official linux-arm64 binaries exist and it is
  supported until April 2028.
- Strongest case against: Node 26 becomes Active LTS within days and lasts longer. We accept 24
  because native addons (better-sqlite3 prebuilds) and tooling lag a new major by weeks.
- Revisit if: Node 26 has better-sqlite3 prebuilds for linux-arm64; then bump in one item.
- pnpm 12 blocks dependency install scripts by default: `better-sqlite3` must be listed in
  `onlyBuiltDependencies` (`pnpm-workspace.yaml`).

### API layer and schemas
- Options considered: Fastify + Zod type provider; Fastify + TypeBox; Express + Zod.
- Chosen: Fastify (mandated) with `fastify-type-provider-zod`, because the same Zod schemas in
  `packages/contracts` validate requests, type handlers, validate LLM output and generate OpenAPI.
- Strongest case against: TypeBox is Fastify's native schema format and faster. We accept Zod
  because the brief mandates Zod for LLM output and the UI, and one schema language is simpler.
- Revisit if: the type provider lags a Fastify or Zod major.

### Persistence
- Options considered: better-sqlite3 + Drizzle; `node:sqlite` + Drizzle; Prisma.
- Chosen: better-sqlite3 with Drizzle, because Drizzle (preferred by the brief) supports it
  directly, it is synchronous (simple transactions, simple locks) and well proven.
- Strongest case against: `node:sqlite` needs no native addon, so no ARM64 build risk. We accept
  better-sqlite3 because Drizzle 0.45 has no `node:sqlite` driver; prebuilt linux-arm64 binaries
  exist, and the first install on the Pi is a human check in the scaffold item.
- Revisit if: Drizzle adds a `node:sqlite` driver. (Inside the Docker image the native build is
  done in the build stage, so the host needs no compiler — D-14.)
- Database file outside the code directory (`DATA_DIR`), WAL mode, `busy_timeout`; backups via
  the SQLite online backup API (`db.backup()`).

### Scheduling and job locking
- Options considered: croner; node-cron; systemd timers calling `pnpm discover`.
- Chosen: croner in-process with `timezone: 'Europe/Warsaw'`, plus a job lock row in SQLite
  (owner pid, heartbeat; stale lock released on start).
- Strongest case against: systemd timers survive app bugs and are OS-native. We accept croner
  because the brief wants the UI to show schedule and runs, and the lock must also cover manual
  runs from UI/CLI; the CLI uses the same lock.
- Revisit if: the process proves unstable on the Pi.

### Outbound HTTP and SSRF guard
- Options considered: undici with a custom DNS lookup; `ssrf-req-filter`-style wrappers; plain
  `fetch` with pre-resolution.
- Chosen: one shared undici client: per-request timeout, maximum body size, manual redirects
  (each hop re-checked), and a `connect.lookup` that rejects loopback, private, link-local,
  CGNAT, ULA and metadata addresses after resolution (DNS rebinding safe).
- Strongest case against: a maintained library would carry the address list for us. We accept
  our own because it is ~100 lines, fully tested, and wrapper libraries do not cover our
  redirect and size rules together.
- Revisit if: a well-maintained guard library covers all of FR-03 AC2.

### Feeds, pages and e-mail
- Feeds: fast-xml-parser with our mapping to RawSignal (RSS 2.0 `item`, Atom `entry`). Runner-up
  rss-parser maps for us, but has not been released since 2023 and fetches by itself.
- Pages: Readability + linkedom for the main text; robots-parser for robots.txt. Runner-up
  cheerio with heuristics is lighter but extracts worse.
- E-mail: imapflow (`EXAMINE` = read-only, UID cursor) + mailparser for MIME; per-sender parsers
  (Useme first). Runner-up node-imap is unmaintained.

### LLM providers
- Options considered: official SDKs; plain `fetch` for both; a multi-provider library
  (Vercel AI SDK).
- Chosen: `@anthropic-ai/sdk` and `openai` (with `baseURL`) behind our `LlmProvider` port in
  `infrastructure/llm`; the domain never imports an SDK. Output always validated by Zod.
- Strongest case against: plain `fetch` keeps dependencies minimal and OpenAI-compatible servers
  differ in details anyway. We accept the SDKs for retries, typed errors and usage reporting;
  provider quirks live in the adapter.
- Revisit if: an OpenAI-compatible provider breaks with the SDK; then that adapter uses `fetch`.

### Authentication
- Chosen: one operator password, hash (scrypt, `node:crypto`) in `.env`; `pnpm auth:hash` prints
  a hash; sessions as random ids in SQLite, HttpOnly + SameSite=Strict cookie (Secure when
  served over HTTPS); login rate-limited.
- Strongest case against: argon2id is the current recommendation. We accept scrypt because it is
  built in, avoids a native addon on ARM64 and is adequate for one operator behind a LAN.

### Frontend
- Options considered: React + Vite SPA (mandated) with React Router + TanStack Query; SSR.
- Chosen: SPA, CSS Modules, no component library; strings in one Polish module (D-11).
- Strongest case against: a component library speeds up forms and tables. We accept hand-made
  components because the UI is seven simple views and must stay light on a phone.

### Testing and tooling
- Vitest projects per package; Fastify `inject` for API tests; undici `MockAgent` for every
  outbound call (a test fails on any unmocked request — FR-13 AC4); Testing Library for
  components; one Playwright test of the main path against the built app with the mock LLM.
- Stryker per module; scope decided in `/test-plan`.
- ESLint flat config + typescript-eslint + Prettier; `no-restricted-imports` enforces layers.

### Deployment
- Options considered: Docker Compose; `systemd` unit with Node on the host.
- Chosen: Docker Compose only (D-14, user). Multi-stage `Dockerfile` (build stage: pnpm install,
  native build, `pnpm build`; runtime stage: `dist`, production dependencies, non-root user;
  PID 1 via `init: true` in compose). Compose: `restart: unless-stopped`, `env_file: .env`,
  volume `./data:/data` (`DATA_DIR=/data`), `127.0.0.1:8080:8080`, healthcheck on
  `/api/health`. Optional `ollama` service behind a compose profile.
- Strongest case against: `systemd` (the brief's base) uses ~100–150 MB less RAM and no Docker
  daemon. We accept Docker because the operator runs everything in Docker and the image removes
  the better-sqlite3 build risk on the host.
- CI builds the image (`docker build`, amd64) on every PR so a broken Dockerfile is caught; the
  arm64 build happens on the Pi (`docker compose up -d --build`). Revisit: publish arm64 images
  from CI if the build on the Pi is too slow.

## Architecture sketch
```
apps/web (React SPA) ──HTTP /api──▶ apps/api
apps/api/src
  server.ts                composition root: config, db, adapters, routes, scheduler
  modules/<name>/          routes.ts (HTTP) → service.ts (use cases) → domain (pure rules)
                           ports.ts (interfaces the service needs: repositories, LlmProvider,
                           SourceAdapter, Clock, HttpClient)
  infrastructure/
    db/                    Drizzle schema, migrations, repository implementations
    llm/                   anthropic, openai-compatible, mock (implement LlmProvider)
    sources/               rss, imap, manual (implement SourceAdapter); http client + SSRF guard
    scheduler/             croner + job lock
packages/contracts         Zod schemas and DTO types shared by api and web
packages/config            env parsing (Zod), defaults, limits
```
Dependency direction: routes → service → domain; service → ports; infrastructure implements
ports; only `server.ts` wires infrastructure in. Domain (scoring, pre-filter, status machine,
dedup identity) imports nothing but `packages/contracts`. Lint rules enforce it.

## Local development
`pnpm dev` starts the API with tsx (watch) on 127.0.0.1 and the Vite dev server proxying
`/api`; database in `./data/dev.db` (gitignored); LLM provider defaults to `mock` when no key is
set. `pnpm build` produces `apps/api/dist` and `apps/web/dist`; `pnpm start` serves both from
one process. `pnpm db:migrate` applies migrations; `pnpm discover` runs one cycle from the CLI.
