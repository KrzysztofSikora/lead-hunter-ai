# feat(repo-skeleton): pnpm workspace with health API, migrations, Polish UI shell, Docker and CI

Roadmap item F-01 (`repo-skeleton`). The repository is now a pnpm workspace in which every gate from `CLAUDE.md` exists: typecheck, lint, unit tests, e2e, image build and a report-only mutation run. The Fastify API answers `GET /api/health` (process and DB status, no secrets), creates its SQLite database from checked-in Drizzle migrations on every start and through `pnpm db:migrate`, serves the OpenAPI document outside production, and serves an empty Polish UI shell from the same process. Env is parsed by Zod, pino redacts secret paths, ESLint enforces the layer rules, CI rejects tracked `.env`/databases/logs, and `docker compose up --build` is wired up. PRD ACs covered: FR-20 AC5, FR-23 AC4 (and AC2 for the variables that exist so far), FR-24 AC1–AC2, FR-25 AC3.
Closes #1

> **Status:** Ready for review. Caveat: the Docker image and Playwright's pinned Chromium could not be built or downloaded in the agent sandbox, so those two gates rest on the CI `image` and `e2e` jobs. See the first items below.

## ⚠ Needs your decision
- **[REVIEW] The Dockerfile has never been built.** `pnpm docker:build` failed in the sandbox: the build stage could not resolve `deb.debian.org`. Review round 2 saw the build fail again for a different sandbox-only reason (corepack's download of pnpm 12.15.0 hit the proxy's TLS interception). Per the plan's *Risks*, the Dockerfile was not changed to work around it. The image, the container smoke (non-root, migrations on start, healthcheck, refusal without a hash) and `evidence/docker-smoke.txt` (which records `NOT RUN`) are unverified. Check the CI `image` job first. `docker compose config -q` passes. ([plan.md#deviations](context/changes/repo-skeleton/plan.md#deviations))
- **[REVIEW] e2e ran on a different Chromium locally.** `pnpm exec playwright install chromium` was blocked, so the local run and `shell-360.png` used the older Chromium 1243 from `/opt/pw-browsers` via an optional `E2E_CHROMIUM_PATH` (empty by default, so CI uses the pinned download). The CI `e2e` job must confirm the pinned browser.
- **[REVIEW] D-6 contradicts tech-stack.** The dev DB is `apps/api/data/lead-hunter.db` (`${DATA_DIR}/lead-hunter.db`), while `context/tech-stack.md` *Local development* says `./data/dev.db`. Tech-stack needs updating, or reply `D-6: take B` to follow it.
- **D-3 (costly):** operator-facing env variable names (`NODE_ENV`, `HOST`, `PORT`, `DATA_DIR`, `LOG_LEVEL`, `OPERATOR_PASSWORD_HASH`), with unknown variable names ignored (a typo such as `LOG_LEVL` passes silently; an invalid value of a known variable fails). → chose **A: plain names, only what the code reads**. Alternatives: B: add `LLM_*` now; C: prefix everything `LH_`. Switching costs: renaming in `packages/config`, `.env.example`, compose and README.
- **D-4 (costly, security):** `loadConfig` refuses a non-loopback `HOST` without `OPERATOR_PASSWORD_HASH`, but only checks that the value is present, so `placeholder` is accepted until S-01 adds the format and `pnpm auth:hash`. → chose **A**. Alternatives: B: ship `pnpm auth:hash` and the scrypt format now; C: defer the refusal to S-01. Switching costs: `packages/config/src/env.ts` plus S-01's contract.
- **D-6 (costly):** DB file `${DATA_DIR}/lead-hunter.db` in every environment (see the REVIEW item above). Alternatives: B: `./data/dev.db` at the repo root; C: a `DATABASE_FILE` variable. Switching costs: path logic in the API, `.gitignore`, compose, README.
- **D-7 (costly):** first migration `0000_neat_red_shift` creates the inert table `app_meta(key, value)`. Alternatives: B: hand-written SQL with an empty journal; C: a domain table such as `job_runs`. Switching costs: regenerate migrations (nothing depends on the table yet).
- **D-9 (costly):** public health contract `200 {status, version, uptimeSeconds, db:{status, migrations}}`, `503` with `degraded` and no error text. Alternatives: B: always 200 with a flag; C: also report data-dir free space. Switching costs: `packages/contracts/src/health.ts`, the route, the compose healthcheck, the web client.
- **D-11 (costly, security):** log redaction by pino `redact` paths (`REDACT_PATHS`, both `key` and `*.key` forms), not by scrubbing secret values. Marked costly after plan-review finding 2. Alternative: B: also scrub configured secret values in a destination stream. Switching costs: `apps/api/src/infrastructure/logging/logger.ts`.
- **First-run behaviour (from review R1):** compose pins `HOST=0.0.0.0` and `.env.example` ships `OPERATOR_PASSWORD_HASH=` empty, so the container refuses to start until the operator sets a value (FR-23 AC4 working as intended). `README.md` tells the operator to set it.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 4) Judge the Polish wording of the shell and whether it reads as an honest "nothing here yet" on a laptop and a phone-width window. Run: `pnpm build && pnpm start`, open http://127.0.0.1:8080. Evidence: [`shell-360.png`](context/changes/repo-skeleton/evidence/shell-360.png)
- [ ] (Phase 5) On a machine with Docker (ideally the Pi): `mkdir -p data && cp .env.example .env`, set `OPERATOR_PASSWORD_HASH=placeholder`, run `docker compose up -d --build`; after ~30 s `docker compose ps` shows `healthy` and `curl 127.0.0.1:8080/api/health` returns 200; `docker compose restart` keeps `data/lead-hunter.db`; also check that the container user is 1000 (`docker run --rm --entrypoint id lead-hunter-ai:local -u`) and that running without the hash exits non-zero. Note the Pi build time (better-sqlite3 ARM64). Evidence: none (sandbox build blocked, see [`docker-smoke.txt`](context/changes/repo-skeleton/evidence/docker-smoke.txt))
- [ ] (Phase 5) After the PR is pushed, the GitHub Actions run shows all five jobs green (`mutation-report` summary reads "no target files changed" or a score). Run: open the PR checks. Evidence: none

## Other decisions made by the agent (cheap to change)
Full table with reasons: [plan.md#decisions](context/changes/repo-skeleton/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-1 | Workspace package names | `@lead-hunter/{api,web,contracts,config}`, private | unscoped; `@lead-hunter-ai/*` |
| D-2 | How workspace TS packages resolve in dev/test/prod | custom export condition `source` (dist for plain node) | always build first; bundle with esbuild; Node type stripping |
| D-5 | Loading `.env` | Node `--env-file-if-exists` in api scripts | `dotenv` |
| D-8 | When migrations run | every server start and `pnpm db:migrate`, same `runMigrations()` | CLI only, entrypoint runs `db:migrate && start` |
| D-10 | Where OpenAPI is served | `/api/openapi.json`, not in production, no Swagger UI | always served; Swagger UI |
| D-12 | API vs SPA routing | JSON 404 for `/api/*`, SPA fallback otherwise | SPA under `/app/` |
| D-13 | UI shell content | heading, one sentence, health status line | nav with seven disabled views |
| D-14 | Permissions on `./data:/data` | run as `node` (uid 1000), writable check at start, README `mkdir -p data` | root entrypoint with `chown`; named volume |
| D-15 | Language of operator-facing start/CLI errors | Polish, naming the variable | English |
| D-16 | Layer rules | ESLint `no-restricted-imports`, five rules | `eslint-plugin-boundaries`; dependency-cruiser |
| D-17 | Prettier scope | code/JSON/YAML/CSS; Markdown and `context/`, `docs/`, `.claude/` ignored | format Markdown too |
| D-18 | e2e server start | Playwright `webServer` on the production build, fixed port 4317 | free-port wrapper; run against `pnpm dev` |
| D-19 | Repo hygiene check | `scripts/check-tracked.ts` with unit test, CI job | inline shell `grep` |
| D-20 | CI mutation job | report-only `mutation-report`, `continue-on-error` | add it with the first target module |
| D-21 | `pnpm discover` in F-01 | prints `brak skonfigurowanych źródeł`, exit 0, no DB | exit 1 |

Smaller deviations, all logged as `[minor]` in [plan.md#deviations](context/changes/repo-skeleton/plan.md#deviations): pnpm 12.15 uses `allowBuilds` instead of `onlyBuiltDependencies` (esbuild and better-sqlite3 approved); Stryker needs an explicit `plugins` entry under pnpm's isolated `node_modules`; `typecheck` also covers `scripts/` and `e2e/`; `.env.example` keeps `NODE_ENV`, `HOST`, `PORT`, `DATA_DIR`, `LOG_LEVEL` commented out; `src/version.ts` and `src/cli/config.ts` added beyond the plan's file list; D-18 differs from the test plan (fixed port, no hash on loopback).

## Quality
- Gates (from [review.md](context/changes/repo-skeleton/review.md)): typecheck ok, lint ok, unit tests ok (87/87), e2e ok (2/2, local Chromium 1243 via `E2E_CHROMIUM_PATH`), **image fail (sandbox only)**: corepack's download of pnpm 12.15.0 fails on the proxy's TLS interception (`self-signed certificate in certificate chain`); not a code defect, the CI `image` job and the Pi human check must confirm it. Mutation not re-run in review (no change to `env.ts`).
- Review: APPROVE, round 2. Round 1 found 4 (1 major, 3 minor): fixed 4, deferred 0, rejected 0. Round 2 confirmed each fix, no new findings. Round 1 findings:
  - R1 (major): compose did not pin `HOST`/`DATA_DIR`, so a copied `.env` could break the container and bypass the refusal → fixed (5ee7993)
  - R2 (minor): health `version` always `0.0.0` → fixed (939dcc6)
  - R3 (minor): Dockerfile kept the build toolchain that plan-review finding 4 asked to drop → fixed (2da780e)
  - R4 (minor): SPA fallback answered `/api` and missing assets with `200 text/html` → fixed (85712e6)
- Plan review: READY WITH NOTES, round 1; 13 findings (2 major, 11 minor) in [plan-review.md](context/changes/repo-skeleton/plan-review.md). Applied in implementation: 1 (primary fix completed in R1), 2, 3, 4 (completed in R3), 5, 6, 10; 9 and 13 are noted in the deviations, 11 is the D-6 `[REVIEW]` entry, and 12 (`fetch-depth: 0` on `mutation-report`) is in `ci.yml`. Findings 7 and 8 are not recorded in the artifacts.
- Mutation: 75.00 % → 94.12 % on `packages/config/src/env.ts` (64 killed, 3 survived, 1 no coverage); `bug` mutants: none. Survivors are judged equivalent or incidental ([mutation.md](context/changes/repo-skeleton/mutation.md)).
- Proposed lessons: "When a plan-review finding is accepted, apply its primary fix or log why not, and never let a comment describe config that does not exist" (`context/lessons.md`, commit cb5fac3 `docs(repo-skeleton): propose lessons`; drop that commit to reject it).

## Follow-ups
- Update `context/tech-stack.md` *Local development* for D-6 (`apps/api/data/lead-hunter.db`) at this PR.
- S-01 must tighten the `OPERATOR_PASSWORD_HASH` format check (D-4) and add `pnpm auth:hash`; the placeholder is accepted until then.
- S-16 adds the ARM64 build on the Pi and Tailscale notes; plan-review finding 4 lowered the assumed better-sqlite3 build risk (prebuilds exist for `linux-arm64`).
- Value scrubbing of configured secrets in log output (D-11 option B) can be added in S-05 when real keys exist.

## Commits
```
a6e659b docs(repo-skeleton): review
cb5fac3 docs(repo-skeleton): propose lessons
f78da6c docs(repo-skeleton): triage review round 1
85712e6 fix(repo-skeleton): JSON 404 for /api and missing assets (R4)
939dcc6 fix(repo-skeleton): give the API package a real version (R2)
2da780e fix(repo-skeleton): drop unused build toolchain from Dockerfile (R3)
5ee7993 fix(repo-skeleton): pin container env in compose (R1)
e4b2952 docs(repo-skeleton): review
06e57e6 docs(repo-skeleton): mutation
77e6b9c test(repo-skeleton): strengthen assertions from mutation check
17f299b feat(repo-skeleton): Docker image, compose, CI and docs
c418a9a feat(repo-skeleton): web shell, static serving and e2e smoke
33eb7c7 feat(repo-skeleton): API server, database, health, OpenAPI and CLIs
a58c631 feat(repo-skeleton): env config and logger with secret redaction
5b81c85 feat(repo-skeleton): workspace, tooling and layer rules
66a38b8 docs(repo-skeleton): plan-review
e6cdbc5 docs(repo-skeleton): plan
```

<details><summary>Run</summary>

Branch `change/repo-skeleton`, base `main`, started 2026-10-25T08:46:19+00:00. No failed step, no draft reason.

| Step | Model | Attempts | Cost |
|------|-------|----------|------|
| plan | opus | 1 | $1.79 |
| plan-review (READY WITH NOTES) | opus | 1 | $0.88 |
| implement, phases 1–5 | sonnet | 5 × 1 | $0.57 + $0.26 + $0.38 + $0.37 + $0.36 |
| mutation | sonnet | 1 | $0.22 |
| review round 1 (APPROVE WITH FOLLOW-UPS, 4 findings) | opus | 1 | $1.22 |
| fix-review | sonnet | 1 | $0.17 |
| review round 2 (APPROVE, 0 open) | opus | 1 | $0.36 |

Phases ticked: 5/5. Total of the listed step costs: about $6.57.
</details>
