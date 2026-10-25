#!/usr/bin/env bash
# Report-only mutation run on the changed target modules (test-plan "Mutation targets").
# Usage: scripts/mutation-changed.sh [base-ref]   (default: origin/main)
set -euo pipefail

BASE="${1:-origin/main}"

TARGETS=(
  apps/api/src/modules/scoring/rubric.ts
  apps/api/src/modules/scoring/score.ts
  apps/api/src/modules/analysis/prefilter.ts
  apps/api/src/modules/analysis/output-guard.ts
  packages/contracts/src/analysis.ts
  apps/api/src/modules/ingestion/canonical-url.ts
  apps/api/src/modules/ingestion/identity.ts
  apps/api/src/infrastructure/sources/http/address-guard.ts
  apps/api/src/infrastructure/sources/rss/map-feed.ts
  apps/api/src/infrastructure/sources/http/backoff.ts
  apps/api/src/infrastructure/sources/imap/parse-useme.ts
  apps/api/src/modules/analysis/budget.ts
  apps/api/src/modules/pipeline/transitions.ts
  apps/api/src/modules/reporting/insights.ts
  apps/api/src/infrastructure/scheduler/job-lock.ts
  apps/api/src/infrastructure/scheduler/schedule.ts
  apps/api/src/modules/auth/session.ts
)

summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
changed="$(git diff --name-only "$BASE"...HEAD || true)"

mutate=()
for target in "${TARGETS[@]}"; do
  if grep -qxF "$target" <<<"$changed" && [ -f "$target" ]; then
    mutate+=("$target")
  fi
done

if [ "${#mutate[@]}" -eq 0 ]; then
  echo "Mutation: no target files changed" >>"$summary"
  exit 0
fi

args=()
for file in "${mutate[@]}"; do args+=(--mutate "$file"); done

{
  echo "### Mutation report"
  echo '```'
  pnpm mutation "${args[@]}"
  echo '```'
} >>"$summary"
