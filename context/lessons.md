# Lessons

Rules from reviews. Binding for planning, implementing and reviewing once accepted at a PR.

## When a plan-review finding is accepted, apply its primary fix or log why not, and never let a comment describe config that does not exist
- Why: a half-applied finding left `.env.example` claiming compose pins HOST/DATA_DIR while it did not, so a copied template could break the container.
- Seen in: repo-skeleton, R1
- Scope: plans, config templates, compose/Docker files
- Status: accepted (PR #18)
