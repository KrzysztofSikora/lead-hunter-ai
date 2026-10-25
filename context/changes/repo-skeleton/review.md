# Review: repo-skeleton

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (87/87), e2e ok (2/2, local Chromium 1243 via `E2E_CHROMIUM_PATH`; the pinned download is blocked in the sandbox), image fail (sandbox only: corepack's download of pnpm 12.15.0 fails on the proxy's TLS interception, `self-signed certificate in certificate chain`; not a code defect, the CI `image` job and the Pi human check must confirm it), mutation not re-run (no change to `packages/config/src/env.ts`; see `mutation.md`) · Round: 2

## Round 2 (re-review after `/fix-review`)
Diff checked: `e4b2952..HEAD` (9 files). Every round-1 finding marked `fixed` was confirmed:

| Finding | Commit | Verified by |
|---------|--------|-------------|
| R1 | 5ee7993 | `docker compose config` on a scratch copy whose `.env` is the template with every key uncommented: effective env is `HOST: 0.0.0.0`, `DATA_DIR: /data`, `NODE_ENV: production`, `PORT: "8080"`. The `.env.example` comment is now true. The empty template hash plus the pinned `0.0.0.0` makes the container refuse to start until a hash is set, which is FR-23 AC4 working as intended; `README.md:18` tells the operator to set it. |
| R2 | 939dcc6 | `apps/api/package.json` has `version: 0.1.0`; the new `test/version.test.ts` ties `VERSION` to the manifest and rejects the fallback; the runtime image copies `apps/api/package.json`, so `version.ts` resolves `../package.json` from `dist/` there too. |
| R3 | 2da780e | Both `apt-get install python3 make g++` blocks are gone from `Dockerfile`; this matches plan-review finding 4 and is logged in *Deviations* (review round 1). |
| R4 | 85712e6 | `app.ts` drops the query before matching, treats `/api` and `/api/*` as API, and skips the fallback for `/assets/*` and paths with an extension; `static.int.test.ts` asserts the JSON 404 for `/api`, `/api?x=1`, `/assets/nope.js` and `/favicon.ico`, and still serves the shell for client routes. |

No new findings. The lesson proposed from R1 (`context/lessons.md`) is well-formed and carries the `proposed` status for the PR.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` | done | `allowBuilds` instead of `onlyBuiltDependencies` (logged) |
| `eslint.config.js`, `.prettierrc.json`, `.prettierignore` | done | D-16, D-17 |
| `vitest.config.ts`, `stryker.config.mjs`, `playwright.config.ts` | done | Stryker `plugins` and `E2E_CHROMIUM_PATH` logged |
| `packages/contracts/**` | done | D-9 strict schema + test |
| `packages/config/**` | done | D-3, D-4, D-15 |
| `apps/api/src/app.ts`, `server.ts` | done | `deps.onRoute` seam (plan-review 6, logged); SPA fallback fixed in round 1 (R4) |
| `apps/api/src/infrastructure/db/*`, `logging/logger.ts` | done | D-7, D-11 |
| `apps/api/src/modules/health/*` | done | D-9 |
| `apps/api/src/cli/migrate.ts`, `cli/discover.ts` | done | D-21 |
| `apps/api/src/cli/config.ts`, `apps/api/src/version.ts` | unplanned | logged under *Deviations* |
| `apps/api/drizzle.config.ts`, `migrations/**` | done | `0000_neat_red_shift` (`app_meta`) |
| `apps/api/test/*` (cli, db, health, lint-layers, logging, openapi, static, setup, helpers) | done | |
| `apps/api/test/network-isolation.test.ts` | unplanned | plan-review 10, logged |
| `apps/api/test/version.test.ts` | unplanned | added for R2, logged (review round 1 deviation) |
| `apps/api/package.json`, `tsconfig*.json`, `vitest.config.ts` | done | `version` 0.1.0 (R2) |
| `apps/web/**` (index.html, vite/vitest config, App, strings, api/health) | done | D-13 |
| `apps/web/src/css.d.ts`, `e2e/tsconfig.json`, `scripts/tsconfig.json` | unplanned | logged |
| `e2e/smoke.spec.ts` | done | |
| `scripts/check-tracked.ts` (+ test), `scripts/mutation-changed.sh` | done | D-19, D-20 |
| `Dockerfile` | done | toolchain removed per plan-review finding 4 (R3) |
| `.dockerignore` | done | |
| `docker-compose.yml` | done | `environment:` pins NODE_ENV, HOST, PORT, DATA_DIR (R1, plan-review finding 1) |
| `.github/workflows/ci.yml` | done | five jobs, `fetch-depth: 0` on `mutation-report` |
| `.env.example` | done | keys commented out (logged); the compose comment is now accurate |
| `.gitignore` | done | `data/` added |
| `README.md`, `deploy/README.md`, `CLAUDE.md` | done | |
| `context/roadmap.md` | done | status column only (`review`) |
| `context/lessons.md` | unplanned | lesson proposed from R1 |
| `pnpm-lock.yaml` | unplanned | expected by-product of install |
| `context/changes/repo-skeleton/{plan,plan-review,mutation}.md`, `evidence/*` | done | `docker-smoke.txt` records NOT RUN |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | Compose now pins the container env (R1); health reports the real version (R2); `/api` and missing assets get the JSON 404 (R4) |
| Design | ok | Layers hold (`app.ts` gets infrastructure through `deps`, lint fixture proves it); decisions live in one place each |
| Safety | ok | D-4 refusal in one `superRefine` and no longer bypassable through a copied `.env`; redaction canary covers top-level, nested and header paths; no secrets tracked |
| Tests | ok | Behavioural, deterministic, failure paths covered (503, JSON 404 incl. `/api` and assets, config refusal, unmocked fetch, version vs manifest); mutation decisions plausible |
| Simplicity | ok | Small files, no dead code |
| Plan fidelity | ok | Plan-review findings 1 and 4 now applied and logged; the image and container smoke remain unverified here (logged `[REVIEW]`, CI `image` job and Pi human check) |
| Agent decisions | ok | D-3/D-4/D-6/D-7/D-9/D-11 each implemented in one place and swappable as claimed; D-6 tech-stack mismatch is a logged `[REVIEW]` |

## Findings
### R1: Compose does not pin HOST/DATA_DIR, and `.env.example` says it does
- Severity: major
- Where: `docker-compose.yml:7`, `.env.example:5`
- Problem: `.env.example:5` says "Under Docker Compose NODE_ENV, HOST, PORT and DATA_DIR are set by docker-compose.yml", but the compose file sets no `environment:`; the values come only from the image `ENV`, which `env_file: .env` overrides. The template invites "Copy to .env and adjust", and every key is shown with its *dev* default. Verified with `docker compose config` on a copy where `# HOST=` and `# DATA_DIR=` were uncommented: the effective service env is `HOST: 127.0.0.1`, `DATA_DIR: ./data`. In the container that means the app binds loopback (the `127.0.0.1:8080:8080` mapping stops working while the in-container healthcheck still reports healthy, and the FR-23 AC4 refusal is bypassed because loopback needs no hash), and `./data` resolves to `/app/data`, outside the `./data:/data` volume. This is exactly plan-review finding 1; only its secondary mitigation was applied.
- Fix: add `environment: { NODE_ENV: production, HOST: 0.0.0.0, PORT: '8080', DATA_DIR: /data }` to the `app` service (it takes precedence over `env_file`), which also makes the template comment true. Optionally add a test or agent check that `docker compose config` with an uncommented template still yields `HOST=0.0.0.0` and `DATA_DIR=/data`.
- Effort: small
- Lesson candidate: When a plan-review finding is accepted, apply its primary fix or log why not; a comment must never describe config that does not exist.
- Decision: fixed (5ee7993) + lesson proposed

### R2: Health `version` is always `0.0.0`
- Severity: minor
- Where: `apps/api/src/version.ts:8`, `apps/api/package.json:1`
- Problem: `VERSION` reads `version` from `apps/api/package.json`, which has no `version` field, so it always falls back to `'0.0.0'` (see `evidence/health.txt`: `"version":"0.0.0"`). The D-9 contract publishes `version` as a public field that drives nothing but operator diagnosis; a constant makes it useless for telling deployed builds apart on the Pi. The tests inject `version: 'test'`, so nothing exercises the real value.
- Fix: add `"version": "0.1.0"` to `apps/api/package.json` (and bump it with releases), or drop the `?? '0.0.0'` fallback so a missing version fails loudly; a test that `VERSION` matches the package manifest would hold it.
- Effort: small
- Lesson candidate: no
- Decision: fixed (939dcc6)

### R3: Dockerfile keeps the build toolchain that plan-review finding 4 asked to drop
- Severity: minor
- Where: `Dockerfile:7-10`, `Dockerfile:21-23`
- Problem: Both `build` and `prod-deps` run `apt-get install python3 make g++` "in case the better-sqlite3 prebuilt binary is unavailable". Plan-review finding 4 verified that better-sqlite3 13.0.3 has no install script and ships `linux-x64`/`linux-arm64` prebuilds, so this is dead weight that adds an apt round-trip (two, one per stage) to every build on the Pi, and it is the step that fails first in the sandbox. The finding was neither applied nor answered in *Deviations* or *Review response*. Note: removing it does not by itself make the sandbox build pass (corepack's pnpm download then fails on the proxy's TLS interception), so this is about plan fidelity and Pi build time, not the gate.
- Fix: remove both `RUN apt-get ...` blocks; or keep them and log a `[minor]` deviation that says why.
- Effort: small
- Lesson candidate: no
- Decision: fixed (2da780e)

### R4: SPA fallback answers `/api` and missing assets with `200 text/html`
- Severity: minor
- Where: `apps/api/src/app.ts:56`
- Problem: The fallback condition is `!request.url.startsWith('/api/')`. Verified against the built server: `GET /api` and `GET /api?x=1` return `200 text/html` (the shell) instead of the D-12 JSON 404, and a missing hashed asset such as `GET /assets/nope.js` also returns `200 text/html`, so after a rebuild a stale browser tab gets HTML for a script and fails with a MIME error instead of a 404.
- Fix: treat the path (without query) `=== '/api'` or starting with `/api/` as API, and skip the fallback for paths with a file extension (or under `/assets/`); add the two cases to `static.int.test.ts`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (85712e6)
