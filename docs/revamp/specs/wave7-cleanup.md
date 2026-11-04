# Wave 7: safe code and documentation consolidation

Document status: CURRENT.

Contract section 6, Wave 7. Nothing is deleted because it looks old. Deletion needs a usage graph, a manifest entry with proof, a Guardian PASS and an independent adversarial review, in that order, and goes in its own reviewable PR.

## Never touched (keep immutable)

`docs/source/`, locked AC/1 assets and their hashes, `docs/v3/history/` and its manifest, every ADR, statutory, legal and privacy disclosures, frozen QA baselines and receipts, original requirement ids, production migrations and installers, signed quote, evidence and event records, `docs/revamp/CONTRACT.md` and the evidence folders under `docs/design-system/evidence/`.

## Steps

| Id   | Owner | Step                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-01 | S4    | Candidate report only, no deletion. Build the usage graph (`git ls-files`, import, route and docs references, build and test manifests, runtime flags, deep-link aliases, privacy links) for code, CSS overrides, assets and scripts. Write `docs/revamp/wave-7/candidates.json`, one entry per candidate with `path`, `classification`, `reason`, `incomingReferences`, `replacement`, `recovery`, `proof` and `approval: null`. |
| K-02 | S1    | Guardian review of K-01. Each candidate is marked KEEP, CONSOLIDATE or DELETE-AFTER-PROOF in `docs/revamp/CLEANUP-MANIFEST.json`.                                                                                                                                                                                                                                                                                                 |
| K-03 | S4    | Deletion PR, limited to the approved DELETE entries. It uses `git rm`, gives each entry's recovery as the parent SHA, and must pass `pnpm test:docs`, route coverage, the full staff and customer parity guards, the build and every CI job. An independent adversarial review is required before merge.                                                                                                                          |
| K-04 | S1    | Documentation consolidation. Superseded status summaries and old next-task prose move behind a short index. Historical evidence is not rewritten. `node scripts/v3-context.mjs verify` and `node scripts/authority.mjs` must pass.                                                                                                                                                                                                |

## Gate

`node scripts/v3-context.mjs verify`, `node scripts/authority.mjs`, `pnpm test:docs`, hash and source tests, route coverage from `scripts/revamp-manifest.mjs` with no unmapped route, full old action parity, no broken docs links and no schema deletion.
