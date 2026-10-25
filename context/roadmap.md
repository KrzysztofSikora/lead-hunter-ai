# Roadmap

Sources: `context/prd.md`, `context/tech-stack.md`. Order follows the brief (B-52): first the
vertical slice from a manually imported signal to a recorded payment (S-01…S-08), then automatic
sources (S-09…S-11), then the routine (S-12, S-13), insights, data safety and deployment.
Security that every route depends on (login) comes first, because retrofitting it is costlier
than building on it.

## Overview
| ID | Issue | change-id | Type | Covers | Depends on | Size | Status |
|----|-------|-----------|------|--------|------------|------|--------|
| F-01 | #1 | repo-skeleton | foundation | C-01…C-08, FR-23 AC4, FR-24 AC1–AC2, FR-25 AC3 | - | M | todo |
| S-01 | #2 | operator-login | slice | FR-20 | F-01 | M | todo |
| S-02 | #3 | operator-profile | slice | FR-01 | S-01 | S | todo |
| S-03 | #4 | manual-text-import | slice | FR-02, FR-06, FR-11 AC1, FR-12 | S-02 | M | todo |
| S-04 | #5 | analysis-and-scoring | slice | FR-07, FR-08 (mock), FR-10 | S-03 | L | todo |
| S-05 | #6 | llm-providers | slice | FR-08 AC1–AC4, AC7, FR-09, FR-24 AC3 | S-04 | M | todo |
| S-06 | #7 | opportunity-card | slice | FR-11 AC2–AC4 | S-04 | M | todo |
| S-07 | #8 | offer-drafts | slice | FR-13 | S-05, S-06 | M | todo |
| S-08 | #9 | pipeline-and-payments | slice | FR-14, FR-15 | S-06 | M | todo |
| S-09 | #10 | url-import-guard | slice | FR-03 | S-03 | M | todo |
| S-10 | #11 | rss-sources | slice | FR-04, FR-18 AC3 | S-04, S-09 | L | todo |
| S-11 | #12 | email-alerts | slice | FR-05 | S-10 | L | todo |
| S-12 | #13 | scheduler-and-jobs | slice | FR-17, FR-18 AC1–AC2 | S-10 | M | todo |
| S-13 | #14 | today-brief | slice | FR-16 | S-08, S-12 | M | todo |
| S-14 | #15 | insights | slice | FR-19 | S-08 | M | todo |
| S-15 | #16 | data-ownership-backup | slice | FR-21, FR-22 | S-08 | M | todo |
| S-16 | #17 | pi-deployment | slice | FR-23, FR-26, NFR-01…NFR-04 | S-12, S-13, S-15 | M | todo |

## Items

### F-01 Repository skeleton (`repo-skeleton`)
- Goal: a pnpm workspace in which every gate in `CLAUDE.md` exists and passes, an API that
  answers `GET /api/health`, a database created from migrations, an empty Polish UI shell, and
  the whole app running with `docker compose up --build` from the first item (D-14).
- Covers: C-01…C-08; FR-24 AC1–AC2 (gitignore check, log redaction); FR-25 AC3 (OpenAPI matches
  routes); FR-20 AC5 (health without secrets).
- Depends on: -
- Acceptance:
  - Workspace per tech-stack *Architecture sketch*: `apps/api`, `apps/web`, `packages/contracts`,
    `packages/config`, `deploy/`, `docs/`, `scripts/`; Node 24, TypeScript 6.0.3 strict, ESM.
  - Root scripts `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `db:migrate`, `discover`
    (prints "brak skonfigurowanych źródeł"), plus the e2e and mutation scripts from
    `context/test-plan.md`; one trivial test per package.
  - `GET /api/health` returns process and DB status; OpenAPI document served in dev; a test
    compares registered routes with the document.
  - `packages/config` parses env with Zod; `.env.example` lists every variable; unknown or
    invalid values fail at start with a clear message.
  - pino with redaction of secret paths; a test asserts a configured secret never appears in
    log output.
  - ESLint `no-restricted-imports` enforces the layers; a fixture shows a forbidden import fails.
  - `.github/workflows/ci.yml`: install, typecheck, lint, test on every PR and push; a step that
    fails if `.env`, `*.db`, backups or logs are tracked.
  - `pnpm-workspace.yaml` lists `better-sqlite3` in `onlyBuiltDependencies`.
  - `Dockerfile` (multi-stage, `node:24-bookworm-slim`, non-root, migrations on start) and
    `docker-compose.yml` at the repo root: `restart: unless-stopped`, `env_file: .env`, volume
    `./data:/data`, port `127.0.0.1:8080:8080`, healthcheck on `/api/health`, `init: true`.
    `docker compose up --build` serves health and the UI shell (FR-23 AC4).
  - CI builds the image on every PR; gate `pnpm docker:build` (= `docker build .`).
  - CLAUDE.md *Gates* and *Commands* tables updated to the real scripts.
- Unknowns: none blocking.
- Decided up front:
  - All UI strings in one module `apps/web/src/strings.pl.ts` (D-11).
- Size: M

### S-01 Operator login (`operator-login`)
- Goal: the panel and every API route except health and login require the operator's session.
- Covers: FR-20 AC1–AC5.
- Depends on: F-01
- Acceptance: PRD FR-20 AC1–AC5; `pnpm auth:hash` prints a scrypt hash for `.env`; login and
  logout in the UI; API tests for 401, throttle and logout invalidation.
- Unknowns: -
- Decided up front:
  - Remote access is through **Tailscale** (`tailscale serve` → HTTPS → 127.0.0.1). The app
    trusts `X-Forwarded-Proto` only from loopback and sets the cookie `Secure` when the request
    came over HTTPS. LAN binding stays possible behind the explicit flag (FR-20 AC2). (user)
  - Sessions expire after 30 days of inactivity; one operator, many devices (phone, laptop) may
    hold sessions at once. (default)
- Size: M

### S-02 Operator profile (`operator-profile`)
- Goal: the operator edits skills, preferences and goals in the UI; scoring and pre-filter read it.
- Covers: FR-01 AC1–AC4.
- Depends on: S-01
- Acceptance: PRD FR-01 AC1–AC4.
- Unknowns: -
- Decided up front:
  - The example profile is seeded on first start, labelled `PRZYKŁAD`, and contains generic
    skills from brief §2.1 without names, rates or clients. (default)
- Size: S

### S-03 Manual text import (`manual-text-import`)
- Goal: paste text (optionally with a URL, not fetched yet), get a stored signal and a `NEW`
  opportunity in a list; duplicates are recognised; the empty state is honest.
- Covers: FR-02 AC1–AC4, FR-06 AC1–AC3, FR-11 AC1, FR-12 AC1.
- Depends on: S-02
- Acceptance: PRD FR-02 AC1–AC4 (AC3: queued with `analysisStatus = PENDING`), FR-06 AC1–AC3,
  FR-11 AC1, FR-12 AC1. Data survives restart.
- Unknowns: -
- Decided up front:
  - **One opportunity per distinct signal identity** in the MVP; a duplicate links its evidence
    to the existing opportunity. Grouping several signals into one need is P1 (FR-30). (default,
    costly data shape — review in PR)
  - URL canonicalisation: lower-case scheme and host, drop fragment, default port, trailing
    slash and `utm_*`, `fbclid`, `gclid`, `ref` parameters; keep other query parameters. (default)
- Size: M

### S-04 Analysis and scoring (`analysis-and-scoring`)
- Goal: every pending opportunity passes the deterministic pre-filter, is analysed (mock
  provider in this item) into the versioned schema, and gets a deterministic 0–100 score with a
  five-part breakdown.
- Covers: FR-07 AC1–AC3, FR-08 AC5, AC6, AC8, FR-10 AC1–AC6.
- Depends on: S-03
- Ship with `--mutation` (scoring is a mutation target).
- Acceptance: PRD FR-07 AC1–AC3, FR-08 AC5–AC6, AC8, FR-10 AC1–AC6; schema version `1`; the
  scoring rubric is documented in `docs/scoring.md` and every rule has a table-driven test.
- Unknowns: how the mock derives a plausible analysis from text (keyword rules) — agent decides.
- Decided up front:
  - Evidence caps on demand (max 30): `DIRECT_REQUEST` 30, `EXPLICIT_PROBLEM` 18,
    `INDIRECT_SIGNAL` 10, `SPECULATIVE` 6. Rubrics for the other four components are the agent's
    decision, recorded in the plan and in `docs/scoring.md`. (default; brief fixes only the
    speculative cap — review in PR)
  - Weights 30/25/20/15/10 are not operator-configurable in the MVP (brief §7.1). (brief)
- Size: L

### S-05 LLM providers (`llm-providers`)
- Goal: real analysis through Anthropic or any OpenAI-compatible endpoint, validated, limited
  and costed honestly.
- Covers: FR-08 AC1–AC4, AC7; FR-09 AC1–AC5; FR-24 AC3.
- Depends on: S-04
- Acceptance: PRD FR-08 AC1–AC4, AC7, FR-09 AC1–AC5, FR-24 AC3; adapters tested with undici
  `MockAgent` (valid JSON, invalid JSON, 401, 429, timeout, injection fixture); `docs/llm.md`
  lists what is sent to the provider. Human check: one real analysis with Anthropic and one with
  an OpenAI-compatible endpoint (e.g. Groq free tier or Ollama), evidence in the PR.
- Unknowns: JSON-mode and usage reporting per OpenAI-compatible provider (PRD *External
  integrations*, `UNVERIFIED`).
- Decided up front:
  - `LLM_PROVIDER` = `mock` | `anthropic` | `openai-compatible`; `LLM_BASE_URL`, `LLM_MODEL`,
    `LLM_MODEL_OFFER`, `LLM_API_KEY`, `LLM_MONTHLY_BUDGET_USD`, `LLM_PAID` (true for paid
    endpoints; default true for `anthropic`, false for `openai-compatible`). (D-07, D-09)
  - Prices per model for cost come from a small table in `packages/config`, overridable in
    `.env`; unknown model → cost "brak danych". (default)
- Size: M

### S-06 Opportunity card (`opportunity-card`)
- Goal: the full §8 card on phone and laptop, facts clearly separated from inferences.
- Covers: FR-11 AC2–AC4.
- Depends on: S-04
- Acceptance: PRD FR-11 AC2–AC4; component tests for each of the twelve elements; actions
  Zapisz/Odrzuć/Dodaj notatkę work (Przygotuj ofertę and Oznacz jako kontakt arrive in S-07/S-08
  and are shown disabled until then).
- Unknowns: -
- Decided up front: -
- Size: M

### S-07 Offer drafts (`offer-drafts`)
- Goal: on request, an editable offer draft that never leaves the app on its own.
- Covers: FR-13 AC1–AC5.
- Depends on: S-05, S-06
- Acceptance: PRD FR-13 AC1–AC5; the AC4 test fails on any outbound request except the
  configured LLM.
- Unknowns: -
- Decided up front:
  - One current draft per opportunity, regenerating keeps the previous text in history. (default)
- Size: M

### S-08 Pipeline and payments (`pipeline-and-payments`)
- Goal: statuses, activity history, follow-ups, wins and payments; the vertical slice is complete
  (brief phase 1 DoD).
- Covers: FR-14 AC1–AC4, FR-15 AC1–AC2.
- Depends on: S-06
- Acceptance: PRD FR-14 AC1–AC4, FR-15 AC1–AC2; Pipeline view (§11.4); the e2e main path from
  `context/test-plan.md` (import → analysis (mock) → card → draft → contacted → payment) passes.
- Unknowns: -
- Decided up front:
  - **Forward moves may skip stages** (skipped stages are recorded in the history); moving back
    requires a note; `REJECTED`, `EXPIRED`, `NEEDS_VERIFICATION` are reachable from any stage;
    `WON`/`LOST` only after `CONTACTED`. (user)
- Size: M

### S-09 URL import with SSRF guard (`url-import-guard`)
- Goal: a pasted URL is fetched once, safely, and its main text becomes the signal.
- Covers: FR-03 AC1–AC4.
- Depends on: S-03
- Ship with `--mutation` (the address guard is a mutation target).
- Acceptance: PRD FR-03 AC1–AC4; guard tests for each blocked range (IPv4 and IPv6), redirects
  to private hosts, DNS rebinding, oversize and timeout. The shared HTTP client from this item is
  used by every later adapter.
- Unknowns: -
- Decided up front:
  - User agent `LeadHunterAI/<version> (+<repo URL>)`; robots.txt cached 24 h; maximum page
    1 MB, timeout 20 s (NFR-03). (default)
- Size: M

### S-10 RSS/Atom sources (`rss-sources`)
- Goal: configured feeds (HN freelance, WWR presets, any URL) become signals, safely and without
  duplicates, with visible errors.
- Covers: FR-04 AC1–AC7, FR-18 AC3; `docs/source-policy.md` (FR-26 AC2, first entries).
- Depends on: S-04, S-09
- Acceptance: PRD FR-04 AC1–AC7, FR-18 AC3; Sources view (§11.5) with enable/disable, presets
  and manual run; parser tests on recorded fixtures of both feeds. Human check: a real run on
  both presets from a machine with internet, evidence (counts, a sample signal) in the PR; the
  fixtures are recorded from that run.
- Unknowns: current item format of hnrss and WWR feeds (`UNVERIFIED`).
- Decided up front:
  - HN preset uses `https://hnrss.org/whoishiring/freelance`; WWR presets: programming,
    full-stack, back-end, devops. Optional HN query preset `whoishiring/jobs?q=contract`. (D-01)
  - Minimum interval per source 1 h (A-03). (default)
- Size: L

### S-11 E-mail alerts over IMAP (`email-alerts`)
- Goal: Useme job alerts in a dedicated IMAP folder become signals.
- Covers: FR-05 AC1–AC6.
- Depends on: S-10
- Acceptance: PRD FR-05 AC1–AC6; parser tests on anonymised real samples in
  `apps/api/test/fixtures/email/`. Human check: one run against the operator's mailbox.
- Unknowns: Useme alert format (Q-02); Oferia format.
- Decided up front:
  - **Prerequisite (person):** the operator creates/enables Useme e-mail alerts and commits 2–3
    anonymised `.eml` samples before this item starts; `ship` for this item is not run until they
    are in the repo. Oferia is added only if a sample exists. (user)
  - IMAP via a dedicated mailbox or folder; read-only `EXAMINE`; sender allow-list in config
    (default `@useme.com`). (D-04)
- Size: L

### S-12 Scheduler and job runs (`scheduler-and-jobs`)
- Goal: discovery runs at 08:00 and 18:00 Europe/Warsaw and on demand, one at a time, survives
  restarts, and every run is visible.
- Covers: FR-17 AC1–AC5, FR-18 AC1–AC2.
- Depends on: S-10
- Acceptance: PRD FR-17 AC1–AC5, FR-18 AC1–AC2; DST tests with a fake clock for the last Sunday of
  March and October; `pnpm discover` uses the same lock.
- Unknowns: -
- Decided up front:
  - A run missed while the Pi was off is **not** caught up later; the next scheduled time runs.
    (default — review in PR)
- Size: M

### S-13 Today and daily brief (`today-brief`)
- Goal: the Today view and `GET /api/digest/today` show the 3–5 best opportunities and what to do.
- Covers: FR-16 AC1–AC3.
- Depends on: S-08, S-12
- Acceptance: PRD FR-16 AC1–AC3; follow-ups due today listed (FR-14 AC4).
- Unknowns: near-duplicate measure for diversification — agent decides (token similarity of
  title + buyer), recorded in the plan.
- Decided up front: -
- Size: M

### S-14 Insights (`insights`)
- Goal: weekly and monthly numbers that reflect the real funnel and payments.
- Covers: FR-19 AC1–AC3.
- Depends on: S-08
- Acceptance: PRD FR-19 AC1–AC3.
- Unknowns: -
- Decided up front:
  - Weeks are ISO weeks in Europe/Warsaw. (default)
- Size: M

### S-15 Data ownership and backup (`data-ownership-backup`)
- Goal: delete, export, retention, backup and restore.
- Covers: FR-21 AC1–AC3, FR-22 AC1–AC2.
- Depends on: S-08
- Acceptance: PRD FR-21 AC1–AC3, FR-22 AC1–AC2; restore procedure in the README tested by a
  script in CI (backup → new data dir → restore → migrate → start).
- Unknowns: -
- Decided up front:
  - Daily backup at 03:30 Europe/Warsaw, keep 14 copies, in `DATA_DIR/backups`. (default)
- Size: M

### S-16 Raspberry Pi deployment (`pi-deployment`)
- Goal: install on the Pi from the README, auto-start, survive reboot, measured footprint.
- Covers: FR-23 AC1–AC5, FR-26 AC1, NFR-01…NFR-04.
- Depends on: S-12, S-13, S-15
- Acceptance: PRD FR-23 AC1–AC3, AC5, FR-26 AC1; README install for 64-bit Raspberry Pi OS with Docker and Tailscale serve; "Co działa / Co wymaga
  kluczy / Co wymaga ręcznej weryfikacji" complete. Human checks on the Pi: install, reboot,
  scheduled run, memory and response-time measurements (NFR-01, NFR-02), offline behaviour.
- Unknowns: image build time and RAM on the Pi (NFR-01 measured inside the container).
- Decided up front:
  - Docker Compose is the only deployment; no `systemd` unit for the app (D-14). Dockerfile and
    compose exist since F-01; this item adds the ARM64 build on the Pi, Tailscale serve docs, an
    optional `ollama` service behind a compose profile, and the measurements. (user)
- Size: M

## Later
- FR-27 GitHub Issues adapter (P1).
- FR-28 Web search adapter (P1).
- FR-29 Telegram notifications (P1; Q-04).
- FR-30 CSV export, semantic grouping, multiple evidence per need (P1).
- Oferia e-mail parser if no sample is available for S-11.
- English UI / i18n (NG-06).

## Open roadmap questions
- Q-01 Licence before the repository goes public.
- Useme samples must exist before S-11 (person).
