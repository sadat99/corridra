# Current programme and continuation plan

Use [V3_LEDGER.md](../V3_LEDGER.md) for current source, deployment, PRs, flags, blockers, actual results and next action. This document records the stable implementation order without duplicating live release metadata.

## Requirements and scope

The owner-authorised [V3 contract](../V3_CONTRACT.md) governs the three-product experience and preservation change. The [product vision v2.1](../product/corridra-product-vision-v2.1.md) and applicable ADR/security/privacy/money contracts remain binding. All 507 requirements are in the [V3 register](../v3/phase-0/requirements.json); inspect affected IDs and actual code/tests before deciding status.

V3 is PARTIAL. Public/product entry, retained managed engines, founder clarity and gated customer/delegation source increments have bounded evidence in their receipts. Full independent customer/organiser workflows and exhaustive acceptance are unfinished. Deployed code does not establish enabled or commercially live capability.

## Work order

1. Finish the owner's active bounded PR/release tasks from the ledger. After the shared-handoff packet, complete [CodeQL setup and actual analysis](../../security/README.md#codeql-setup-and-evidence), retaining its external entitlement/access blocker until real results exist. Preserve checked heads, dependent branches and actual failure evidence; verify matching release source before continuing.
2. Complete controlled isolated auth signup/verification/sign-in/reload/sign-out/revocation acceptance. Keep identity admission and commercial/workspace authority separate. Never recover passwords, OTP stores or private sessions to bypass the tester.
3. Complete missing canonical organisation/customer commercial authoring and independent Delegation OS: profiles, eligibility/capacity/terms, activities/agendas, meeting coordination, consented reporting/templates and separate organiser economics. Reuse original services, source boundaries and versioned records; build real backends before claiming controls shipped.
4. Verify every original authorised role/action/exception/deep link and all affected customer journeys. Complete founder truth, accessibility, recovery, security/usability and agreed measurements. Retain exact source/currency/history and all advanced controls.
5. Close real-operation prerequisites independently for the selected service/corridor. Notifications, paid-service packaging, billing and integrations require actual implementation and their own prerequisites. D01-D06/D08 remain closed; no real mission data, outreach, inference, payments or payouts follows from a UI/test/deployment result.

The owner may reprioritise this order explicitly. Do not use an external gate as a reason to leave independent engineering unimplemented. Report missing, partial, gated and unverified work separately; no invented completion percentage.

## Retained historical programmes

V1 Parts 1-8 remain the foundation; the revised five-part V2 programme and UX-01 through UX-05 plus bounded UX-06/access repairs were merged. Do not resume old V1 Parts 9-12 or infer full UX/V3 acceptance from those releases.

The [implementation matrix](implementation-matrix.json) is a dated handoff index. Its linked legacy UX-06 coverage snapshot contains 773 NOT_YET_VERIFIED,3 VERIFIED and 1 PARTIAL records. These are historical static-ledger labels, not current V3 runtime acceptance. Compare fresh source/tests and retain unresolved gaps.

The entire previous current-plan document and dated forward notes are preserved in [historical programme text](../v3/history/implementation-plan-before-shared-handoff.md), hash-verified by the [history manifest](../v3/history/manifest.json). Originals and source uploads remain unchanged. Use the [shared handoff](../START_HERE.md) and [verification guide](../verification-guide.md) to reproduce checks; append work-log/ledger results before finishing.

## Guided request drafts packet

Merged as PR86 (chunk118, ADR045, bounded plan under docs/v3/phase-3/customer-mission-drafts); not deployed, flag unset.

## Organiser economics packet

Implemented as source in chunk119 (ADR046, bounded plan under docs/v3/phase-3/customer-programme-economics) and awaiting exact-head CI and release. Delegation OS coordination and reporting (capacity, satisfaction, consented outcomes) and programme templates are next.

## Organisation profiles packet

Implemented as source in chunk115 (ADR044) and awaiting exact-head CI, merge and gated deployment; see the ledger for evidence. Canonical linking, verification and per-mission snapshots remain open. The original packet text follows.

- Authority: customer-session.ts/customer-workspaces.ts, customer-migrations0001/0002 and ADR032/038. app.organisation is globally readable: never insert private profile input there or merge identity by name/email.
- Write the ADR, optional additive profile migration/installer, fresh-session service, same-origin API and account UI. Reuse the existing workspace, event/audit/outbox authority. Private append-only revisions, expected-version conflicts, exact retries, owner/admin write, active-member read and explicit self-reported provenance. Global canonical linking stays partial until rights-safe implementation exists.
- Prove populated-upgrade preservation, tenant/role/session/direct-SQL denial, revocation/expiry, concurrency/history/events, changed account/issuer, recovery, keyboard/axe/widths and private headers. Follow existing programme-context patterns. Keep all original tests and mandatory exact-head release gates; no provider/admission/live activation.
- Continue customer commercial authoring and independent organiser coordination/reporting/economics afterward. Private tester steps must not block engineering.
