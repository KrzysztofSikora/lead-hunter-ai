# Mutation: code-bounties

Target: `apps/api/src/infrastructure/sources/github/reward.ts` (test-plan target 80 %).
Run after review round 1 (R2), `pnpm mutation --mutate … --force`: **96.50 %** (138 killed, 4 survived, 1 no coverage). Was 84.62 % with 21 survivors.

| Mutant | Decision | Why |
|--------|----------|-----|
| `/us$/i`, `/^us/i` on `text.slice(start - 2, start)` (73) | equivalent | the slice is exactly two characters, so anchoring either end changes nothing |
| `.trim()` removed from the quote (83) | equivalent | a match starts at a marker and ends at a digit, `k` or marker; the only optional space is inside the match |
| `if (distinct.size > 1) return null` → `false` (115) | equivalent | the final `distinct.size === 1` check returns `null` for the same inputs |
| `?? ''` → `"Stryker was here!"` in `minorOf` (49) | equivalent | the NUMBER pattern always sets `t` or `i`, so the fallback is never read |

The killed survivors of round 1 are pinned by new rows in `reward.test.ts`: `1.5k USD`, `$1.5`, `EUR 40`, `40 EUR`, `US$` at the start, `BUS$100`, `A1US$100`, a CRLF body, a keyword-free line, the amount and quote limits, and the inflected Polish keywords.
