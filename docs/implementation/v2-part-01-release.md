# V2 Part 01 release record

## Baseline and scope

Starting/current accepted main: `54d9ba36d7f7be4e4c235b4a15d7af82d91f6d08`. Git fetch confirmed this baseline. Vercel production `dpl_DGZbDGq4b8Xtnzfy5HjueBCaaeTm` was READY at that exact commit on inspection. Baseline validate CI: https://github.com/sadat99/corridra/actions/runs/37952236350. The separate later Dependabot failure is not a passed check.

The [scope map](v2-part-01-scope.md) inventories preserved identity, tenant, mission, research, commercial, event/outbox and institutional components. Original migrations 0001–0018 and immutable source documents are unchanged. Verified customer identity email is preserved; operational mission data remains synthetic.

## Implementation

- `packages/domain`: controlled geography/currency registries, constrained route pack resolution, capability readiness, source-rights/AI/contributor policy contracts and derived-only rational FX.
- `packages/missions`: privileged CorridorService, six idempotent draft seed directions, versioned pack and assignment commands; qualified alternate-origin pipeline transition.
- `packages/opportunities`: typed source/claim-backed origins and `createFromOrigin`; original held-meeting `create`, stages, records, confirmations and replay remain.
- 0019 expands existing registries/validators and organisation ingestion; preserves old country text and legacy OTHER values.
- 0020 adds market scopes/membership/aliases, tenant corridor definitions/routes, mission/requirement/assessment definitions, packs and immutable assignments. Existing missions become explicitly unresolved.
- 0021 adds commercial origin records, mutually exclusive opportunity parentage, scope guards and version-1/version-2 outcome coexistence.
- 0022 adds source rights, effective reward rules, contributions, separate fee/cost/reward ledger, independent reconciliation and per-currency margin view.

## Available behavior and limits

Operators can use typed backend services to configure any registered country pair, retain exact historical pack assignments and originate an evidence-backed sourcing opportunity without a meeting. Existing exporter, importer, sourcing-buyer and institution screens retain their workflows. V2 route administration, alternate-origin entry forms, institutional route UI and contributor UI are not exposed in this foundation. Contributors gain no public login/task or payout capability. There is no LLM, international payout, billing or real outreach adapter.

Japan→Kenya, Brazil→Mexico, BD→CN and BD→EU use the same route service. Six initial BD↔ES/CN/EU directions seed as unapproved DRAFT configurations. Existing Spain journeys and commercial/institutional totals remain under regression tests. New seed configuration does not assert launch readiness, legal approval or provider coverage.

## Verification evidence

Formatting, lint, typechecking, seven document-integrity tests, seven infrastructure tests and production build passed locally. Public browser checks: 46 passed. Protected operator journeys: 5 passed, including cash, compensation, replay and institutional reports. Final sequential integration run: **130 tests passed across 14 suites**, including nine V2 foundation cases. A subsequent focused run passed all ten foundation cases, adding 44 direct SQL permission-denial assertions across every new sensitive table and the global registries. No tests skipped. Production dependency audit: no known vulnerabilities. See [sanitized validation evidence](v2-part-01-validation.json).

The final Neon preview upgrade passed on `br-square-firefly-b1dx3ov0` (`v2-01-global-foundation-final-validation`), child of the sterile synthetic parent. It has all 22 migration hashes and no copied live records. Populated compatibility is tested separately against production-shaped synthetic local data. No missing check is considered passed. The PR must receive successful validate CI on its exact final head before merge. The Git deployment must be READY at the merged SHA before reporting production completion.

Initial focused suite: eight tests passed, covering global identifiers/exponents, lower-level override denial, AI/contributor denial, new country pairs, tenant/MFA/pack history, alternate-origin progression and v2 replay, populated 0018 history preservation, reward duplicate/currency/review/compensation and source-policy restrictions. Additional FX coverage is included in final validation.

The first overlapping database runs were invalidated because separate test commands reset a shared isolated database. They are not release evidence. The first full sequential run found an old migration-count assertion and a 33 ms miss on the unchanged 10-second shortlist budget during a concurrent build. The count now expects 22; the unchanged performance test passed in a dedicated rerun. Tests were not skipped or thresholds relaxed.

## Migration and rollback

Run all four migrations as a separate release job, never from a build. Verify project `odd-pond-26265871` (`corridra-nonprod`, Frankfurt) and live synthetic branch `br-lucky-darkness-b1ppj8en` before any live operation. Do not migrate the production-candidate project or Neon Auth customer-account database. Validate first on a child of sterile `synthetic`, then preserve all live source/event/identity/commercial counts and original migration hashes. Local populated upgrades prove record equality, not only counts.

The rollout is additive: one opportunity column becomes nullable with an exclusive origin constraint, and restrictive checks/functions are replaced in successors. No retained row or historical event is deleted or rewritten. Existing clients still use the original meeting insert shape. Old application versions may not understand alternate-origin details; disable new entry points and retain a compatible build for reads. Recovery uses forward corrections, exact compensations and deterministic replay, not dropping tables or reverting immutable records.

Risks: registry/timezone data requires maintained reviewed snapshots; legal/coverage reviews remain manual; backend-only APIs require later UI work; source confidentiality and real-data restrictions remain. No automatic deletion under retention/legal hold is implemented.

## External controls and next dependencies

D01 scanner infrastructure/bypass, D02 branch rules, D03 secret scanning, D04 CodeQL entitlement/execution, D05 private S3, D06 reviewed cleanup and D08 legal/retention/pilot readiness remain open with their existing owners in [deferred controls](deferred-controls.md). D07 Git deployment and D09 identity email retain closure. GitHub reported repository ADMIN access, but reading branch protection returned 403; the normal merge API must enforce available protections, with no admin bypass.

Part 2 consumes CorridorService, pinned assignments, canonical identifiers, explicit legacy classification and alternate-origin commands. It must handle null meetingId and v2 outcome snapshots without inventing meeting history. Service economics remain separate from customer outcomes. See the [master plan](v2-master-plan.md); this release authorizes no later part.

## PR and Git identity

PR: https://github.com/sadat99/corridra/pull/30. The first Git preview was BLOCKED because the inherited workspace email resolved to `sadatnitex`. The authenticated repository owner is `sadat99`; GitHub independently confirmed that the accepted baseline author is Nazmus Sadat with the owner email already used by the READY production release. The local Git identity was corrected to that established owner identity. A new documentation commit preserves all pushed history and retriggers normal Git preview/CI. No team-access control or branch protection is bypassed. Final production evidence is reported after exact-head checks and merge.
