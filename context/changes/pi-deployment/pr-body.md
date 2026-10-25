# feat(pi-deployment): Raspberry Pi install, durable commits, DEMO seed, Pi measurement and container smoke

Roadmap S-16: the operator can install Lead Hunter AI on a Raspberry Pi 4B from the README alone. This change adds `synchronous = FULL` for SQLite, `pnpm seed:demo` (10 000 `DEMO` signals), `deploy/pi-check.sh` (`rss`, `perf`, `integrity`), an optional `ollama` compose profile, a container smoke test (`pnpm docker:smoke`) in the CI `image` job, and the README install/update/Tailscale/backup/offline sections with the "Co działa / Co wymaga kluczy / Co wymaga ręcznej weryfikacji" section. PRD ACs covered: FR-23 AC1, AC2, AC4, AC5 (AC3 documented, Pi check), FR-26 AC1, NFR-01…NFR-04 (measured by human checks on the Pi).
Closes #17

> **Status:** Ready for review

## ⚠ Needs your decision
- **Image and image smoke never ran.** The sandbox has no Docker daemon, so `pnpm docker:build` and `pnpm docker:smoke` did not run (plan Deviations, review Gates). The first real run is the CI `image` job: read its log before merging. The HTTP steps of the smoke were run by hand against the built app instead.
- **D-1 (costly on SD card):** `synchronous = FULL` in `openDb` → chose **FULL**. Alternatives: B: keep NORMAL (fewer fsyncs, a power loss can lose recent commits); C: NORMAL plus periodic `wal_checkpoint` (still lossy, more code). Switching costs: one line in `apps/api/src/infrastructure/db/client.ts`. Read the Pi write-latency evidence.
- **D-2 (safety):** `seed:demo` writes to whatever `DATA_DIR` points at; its only guard is the refusal of a non-empty database. Confirm the README never points it at `./data`. Alternatives: B: SQL insert script; C: import via `POST /api/signals/import`.
- **[REVIEW] plan-review #1 (major):** `docker kill` counts as a manual stop, so `unless-stopped` would not restart the container. The crash human check kills the server process inside the container instead; README wording follows.
- **[REVIEW] plan-review #2 (major):** the seed calls `ensureExample()` for the profile before the runner and exits 1 if any analysis is `FAILED` or not all N are analysed, so evidence never measures unscored rows.
- **Plan review / review leftovers:** none open. Plan review was READY WITH NOTES (7 findings, all handled as above or in Deviations); review ended APPROVE, 0 open findings.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
All on the Pi; none run yet. Evidence goes to `context/changes/pi-deployment/evidence/` (see [plan](context/changes/pi-deployment/plan.md#human-checks)).
- [ ] Install from the README on a clean 64-bit Raspberry Pi OS; record the build time of `docker compose up -d --build` and whether better-sqlite3 needed a source build. Run: README steps 1-5, `docker compose ps`. Evidence: `evidence/pi-install.txt`
- [ ] Reboot: healthy within 2 minutes, panel opens. Run: `sudo reboot`, then `docker compose ps`
- [ ] Crash during *Uruchom teraz*: container returns, run shown as failed, integrity ok (NFR-04). Run: `sudo kill -9 $(docker compose top app | awk '/dist\/server.js/ {print $2}')`, then `deploy/pi-check.sh integrity`
- [ ] Only `127.0.0.1:8080` is listening. Run: `ss -tlnp | grep 8080`
- [ ] A scheduled 08:00/18:00 run appears in run history untouched. Run: open the panel next day
- [ ] NFR-01: VmHWM <= 500 MB after a discovery cycle. Run: `deploy/pi-check.sh rss`
- [ ] NFR-02: each endpoint max <= 500 ms with 10 000 signals. Run: `deploy/pi-check.sh perf 10000` (sandbox amd64 reference, not the Pi: max 13/23/54 ms, [evidence/sandbox-timing.txt](context/changes/pi-deployment/evidence/sandbox-timing.txt))
- [ ] Offline behaviour (FR-23 AC3): import, status change, payment work; *Uruchom teraz* shows errors. Run: `sudo ip link set wlan0 down`
- [ ] Tailscale: panel opens on the phone and login works. Run: `tailscale serve --bg 8080`
- [ ] Update keeps data (FR-23 AC5). Run: `git pull && docker compose up -d --build`
- [ ] Read the README install as the operator: complete, ordered, three-part section accurate (FR-26 AC1)

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-3 | Where NFR-01/02 are measured | `deploy/pi-check.sh` (`rss`, `perf`, `integrity`) | B: `docker stats` only; C: RSS field in `/api/health` |
| D-4 | Shape of `ollama` | compose profile `ollama`, `ollama/ollama:0.40.2`, named volume, no published port (user decided up front) | B: publish `127.0.0.1:11434`; C: models under `./data` |
| D-5 | Automatic check of FR-23 AC1/AC4/AC5 | `scripts/container-smoke.sh` with `docker run`, in CI `image` job | B: smoke through `docker compose`; C: human check only |
| D-6 | arm64 build verification | on the Pi only | B: CI buildx under QEMU (15+ min per PR) |
| D-7 | Backup before S-15 | README cold copy to `data/backups/` (plan-review #6) | B: nothing; C: online backup (S-15's scope) |
| D-8 | Test proof | container smoke + existing tests; no new Vitest (test budget) | B: unit test of the pragma; C: Vitest timing test |

Minor deviations: plan-review #3 (perf seeds before the server starts), #4 (smoke recreate step proves "data kept, start on a migrated DB", not new migrations), #5 (`manual_text`, `publishedAt: null`), #6/#7 (backups under `data/backups/`, per-adapter table in README). Details in [plan.md](context/changes/pi-deployment/plan.md#deviations).

## Quality
- Gates: typecheck ok, lint ok, unit tests ok, e2e ok; image not run, image smoke not run (no Docker daemon in the sandbox).
- Review: APPROVE, round 2: fixed 4 (R1 blocker: `rss` measured `docker-init` instead of the server; R2 major: `perf` exited 1 after success; R3 minor: no-hash smoke could hang; R4 minor: README claimed LAN access to a loopback-only port), deferred 0, rejected 0. See [review.md](context/changes/pi-deployment/review.md).
- Mutation: skipped: no `mutation.md`; no TypeScript logic with a mutation target beyond one pragma line (no new Vitest by budget, D-8).
- Proposed lessons: none (the review marked R1 as a lesson candidate but no lessons commit exists).

## Follow-ups
- Backup part of FR-23 AC1 belongs to S-15; the README's interim copy is replaced there.
- New migrations on upgrade are covered only by the migration integration test and the human `git pull` check.
- Ollama is documented as not used by the app before S-05.

## Commits
```
8a79caa docs(pi-deployment): review
91d3449 docs(pi-deployment): triage review round 1
3ff6a9e fix(pi-deployment): measure the server process, global cookie jar, bounded no-hash smoke, loopback wording (R1-R4)
618839c docs(pi-deployment): review
94c8929 feat(pi-deployment): Raspberry Pi install and operator docs
f55d50f feat(pi-deployment): ollama compose profile and container smoke in CI
df41a1a feat(pi-deployment): durable SQLite commits, DEMO seed and Pi measurement script
fcba051 docs(pi-deployment): plan-review
81c164e docs(pi-deployment): plan
```

<details><summary>Run</summary>

Base main, branch `change/pi-deployment`, no failed step, no draft reason.

| Step | Model | Cost |
|------|-------|------|
| plan-review (READY WITH NOTES) | opus | $0.75 |
| implement ×3 phases | sonnet | $0.64 + $0.32 + $0.32 |
| review round 1 (CHANGES REQUESTED, 4 findings) | opus | $1.01 |
| fix-review | sonnet | $0.17 |
| review round 2 (APPROVE) | opus | $0.29 |

Phases ticked 3/3. Total about $3.50 (excluding pr-body).
</details>

https://claude.ai/code/session_01L7xnPWXcnFkaxbXFZSCLFq
