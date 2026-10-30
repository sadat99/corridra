# Current programme and continuation plan

**Document status: CURRENT.** Stable work order. See the [plan status register](../PLAN_STATUS.md).

Use [V3_LEDGER.md](../V3_LEDGER.md) for current source, deployment, PRs, flags, blockers, results and next action. This file records the stable order without release metadata.

## Requirements and scope

The [V3 contract](../V3_CONTRACT.md) governs the three-product experience and preservation change. The [product vision v2.1](../product/corridra-product-vision-v2.1.md) and applicable ADR/security/privacy/money contracts remain binding. All 507 requirements are in the [V3 register](../v3/phase-0/requirements.json); inspect affected IDs and actual code/tests before deciding status.

V3 is PARTIAL. Public/product entry, retained managed engines, founder clarity and gated customer/delegation source increments have bounded evidence in their receipts. Full independent customer/organiser workflows and exhaustive acceptance are unfinished. Deployed code does not establish enabled or commercially live capability.

## Work order

The owner's 29 October request superseded the earlier queue: repair the installer input limit, audit PR210 within the UX upgrade, add separately switched request-form language drafts, then reassess authorised remaining work against existing records. It is merged (PR212, PR214, PR215); the reassessment is in the register. Work alone, with one draft PR per concern. No merge, workflow dispatch, provider operation, production settings, redeploy or Pulse opening unless the owner commands that step. Whether only the last PR still updates the ledger is UNRESOLVED for the owner. The owner checklist stays in the customer-module runbook.

1. Finish the owner's active bounded PR/release tasks from the ledger. [CodeQL analyses](../../security/README.md#codeql-setup-and-evidence) passed for JS/TS, Python and Actions on PR114 and the receipt head (21 October). Verify each head; branch-protection enforcement is unverified. Preserve checked heads, dependent branches and actual failure evidence; verify matching release source before continuing.
2. Complete controlled isolated auth signup/verification/sign-in/reload/sign-out/revocation acceptance. Keep identity admission and commercial/workspace authority separate. Never recover passwords, OTP stores or private sessions to bypass the tester.
3. Complete missing canonical organisation/customer commercial authoring and independent Delegation OS: profiles, eligibility/capacity/terms, activities/agendas, meeting coordination, consented reporting/templates and separate organiser economics. Reuse original services, source boundaries and versioned records; build real backends before claiming controls shipped.
4. Verify every original authorised role/action/exception/deep link and all affected customer journeys. Complete founder truth, accessibility, recovery, security/usability and agreed measurements. Retain exact source/currency/history and all advanced controls.
5. Follow ADR056 and the owner’s later real-use/scanning deferral. Preserve auth, RLS, roles, history and money. Verify genuine production account/email/private journeys; notifications, billing, outreach, inference and payments retain independent implementation/activation requirements.

The owner may reprioritise this order explicitly. Do not use an external gate as a reason to leave independent engineering unimplemented. Report missing, partial, gated and unverified work separately; no invented completion percentage.

## Retained historical programmes

V1 Parts 1-8 remain the foundation; the revised five-part V2 programme and UX-01 through UX-05 plus bounded UX-06/access repairs were merged. Do not resume old V1 Parts 9-12 or infer full UX/V3 acceptance from those releases.

The [implementation matrix](implementation-matrix.json) is a dated handoff index. Its linked legacy UX-06 coverage snapshot contains 773 NOT_YET_VERIFIED,3 VERIFIED and 1 PARTIAL records. These are historical static-ledger labels, not current V3 runtime acceptance. Compare fresh source/tests and retain unresolved gaps.

The entire previous current-plan document and dated forward notes are preserved in [historical programme text](../v3/history/implementation-plan-before-shared-handoff.md), hash-verified by the [history manifest](../v3/history/manifest.json). Originals and source uploads remain unchanged. Use the [shared handoff](../START_HERE.md) and [verification guide](../verification-guide.md) to reproduce checks; append work-log/ledger results before finishing.

## Guided request drafts packet

PR86 source accepted (chunk118, ADR045). Installation and activation: see the ledger.

## Organiser economics packet

Merged as PR88 (ADR046, bounded plan under docs/v3/phase-3/customer-programme-economics); the ledger records the release state. Current installation/activation is in the ledger; organiser production acceptance remains unverified. Programme coordination and reporting (ADR047, bounded plan under docs/v3/phase-3/customer-programme-coordination) and programme templates (ADR048, bounded plan under docs/v3/phase-3/customer-programme-templates) are built as source in chunk121; the ledger records the release state.

## Organisation profiles packet

Original source packet: chunk115 and ADR044; the ledger holds release/installation evidence. Canonical linking, verification and per-mission snapshots remain open. Preserve ADR032/038 customer authority, private append-only revisions, expected versions, exact retries, owner/admin writes, active-member reads and self-reported provenance. Never insert private input in globally readable `app.organisation` or merge identities by name/email. The verification guide applies to populated upgrades, restricted SQL, revocation/expiry, concurrency/history, issuer changes, recovery, accessibility and private headers. Private tester steps do not block independent engineering.
