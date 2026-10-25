# Lessons

Rules from reviews. Binding for planning, implementing and reviewing once accepted at a PR.

## When a plan-review finding is accepted, apply its primary fix or log why not, and never let a comment describe config that does not exist
- Why: a half-applied finding left `.env.example` claiming compose pins HOST/DATA_DIR while it did not, so a copied template could break the container.
- Seen in: repo-skeleton, R1
- Scope: plans, config templates, compose/Docker files
- Status: accepted (PR #18)

## Validate every value against its contract schema before storing it, not only when reading it back
- Why: a generated justification longer than the contract allowed was saved unchecked, then silently turned into `null` on read, so a scored row showed no breakdown.
- Seen in: analysis-and-scoring, R1
- Scope: services that persist generated or derived data (`apps/api/src/modules/*/service.ts`)
- Status: proposed in the PR for analysis-and-scoring

## A guard that verifies a quote must also verify the values derived from it
- Why: checking only that a quote occurs in the source let a model attach invented amounts to a real, unrelated phrase and show them as "ze źródła".
- Seen in: analysis-and-scoring, R2
- Scope: `apps/api/src/modules/analysis/output-guard.ts` and any provider-output check
- Status: proposed in the PR for analysis-and-scoring
