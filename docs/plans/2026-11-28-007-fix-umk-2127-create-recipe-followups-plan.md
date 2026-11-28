# UMK-2127 follow-ups: `create_recipe` review minors

Linear: UMK-2127 (epic UMK-1924). Builds on [2026-11-28-005](2026-11-28-005-feat-umk-2127-agent-create-recipe-plan.md).

## Goal

Close three reviewer minors on the merged `create_recipe` tool. No migration, no route change.

## Findings

- The catalog route already requires `sellingPrice > 0` (`catalog.schemas.ts`), so the write is refused (422) for
  Rp0 even today, but only after the preview passed. The tool's schema allowed 0, so the preview promised a product
  the route would not make. Catalog rules forbid an inactive-at-Rp0 workaround; the tool simply requires >= 1.
- `runWrite` already refuses the same key with another body (hash of the arguments). The gap is the released key:
  a first try that made the product and was then refused (4xx) frees the key, and a retry with a different
  `newProduct` body found the first product by SKU and reused it silently.

## Definition of Done

- [test] `newProduct.sellingPrice` 0 is refused (preview and confirm) and nothing is written.
- [test] A retry of a released key with another `newProduct` body is refused with the idempotency-mismatch message,
  writes no product and no recipe; a retry with the same product and corrected lines still works.
- [test] A recipe above Rp1.000.000.000.000 through the agent is refused with the route's message; the product
  and recipe are not left written beyond the documented "product without recipe" case.
- [cmd] `PGTEST_DB=pos_s28 PAYTEST_DB=pay_s28 npx jest --runInBand test/agent src/agent src/guards`, tsc, eslint.
- [manual] Revert-red once for the mismatch test.
- Docs: `docs/agent-integration.md` states the price rule and the mismatch refusal.

## Files

`apps/pos-api/src/agent/tools.ts`, `apps/pos-api/test/agent-recipe.e2e-spec.ts`, `docs/agent-integration.md`.

## Not covered

A lost/unknown answer path for `create_recipe`: no existing sibling test fakes a lost route answer cheaply; skipped.
