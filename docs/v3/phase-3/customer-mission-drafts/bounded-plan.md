# Customer guided request drafts: bounded plan and acceptance record

Governing decision: [ADR-045](../../../adr/0045-private-customer-mission-drafts.md). Contract sections: 2 (Products 1 to 3), 4 (guided request, Level 1) and 9 (per-PR acceptance). Status of the whole capability: PARTIAL. Source and local evidence only until exact-head CI, merge and a gated deployment are recorded in the ledger.

## Changed requirement IDs

| Requirement                                                                                                                                                                             | Status after this work                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V3-04-033 (minimum questions), V3-04-040 (save, draft continuation, safe retries, recovery), V3-04-041 (no full profile, uploads or mandatory AI)                                       | PARTIAL: authoring and drafts exist; staff delivery, uploads and AI stay out of scope                                                                  |
| V3-04-005 to V3-04-009 (current objective, essential questions, options, what happens next, next useful result)                                                                         | PARTIAL: implemented on the guided screen; no measured usability evidence                                                                              |
| V3-02-004 to V3-02-006 (Product 1 offering, event, target profile prompts), V3-02-021 and V3-02-022 (Product 2 objective and requirement capture), V3-02-045 and V3-02-046 (delegation) | PARTIAL: authoring prompts only. Targeting, qualification, shortlists and programme administration are unchanged and separate                          |
| V3-02-034 to V3-02-037 (machinery, finished products, materials, OEM context prompts exactly as written)                                                                                | PARTIAL: authoring prompts only. Quotation comparison and technical evaluation are not part of this work                                               |
| V3-02-038 (other procurement under reviewed configuration)                                                                                                                              | NOT VERIFIED: reviewed category configuration does not exist, so the screen says suggested questions are unavailable and offers free requirement lines |
| V3-04-076 (machinery controls only when relevant)                                                                                                                                       | PARTIAL: enforced in the interface and in the stored draft; no usability evidence                                                                      |
| V3-06-004 (persistent customer-owned mission access)                                                                                                                                    | PARTIAL: drafts and linked requests are persistent and creator-owned; full customer commercial authority remains unfinished                            |

## Existing versus new

Existing and unchanged: the single-page request form at `/account/request/[workspaceId]`, `POST /api/customer-requests`, the mission factory, request admission, receipts, staff delivery, the delegation planner and every earlier customer module. New: optional module `customer-mission-draft-migrations`, `/api/customer-mission-drafts`, `/account/drafts/[workspaceId]` and a link from the workspace list.

## Original and destination paths

Original `/account/request/[workspaceId]` stays reachable from the guided screen and is checked by a browser test. Destination `/account/drafts/[workspaceId]`. No legacy action was removed or renamed.

## Server and domain contracts

Four private tables and four restricted `customer.mission_draft_*` functions. Draft details are stored exactly as typed, including non-Latin script. No change to `app.mission`, `app.organisation`, staff identity, RLS, money or any earlier migration. Sending reuses the existing request path with a command id derived from the draft and its saved version, so a repeat returns the original request.

## Tests

Positive and denial: real PostgreSQL integration (creator-only isolation including from the workspace owner, missing request admission, non-members, other workspaces, forged ids, revoked and disabled access, direct SQL denial for runtime and auth roles, immutability even for the schema owner, populated additive upgrade with unchanged functions, policies and receipts, repeat install). States: stale version, exact retry, conflicting retry, concurrent writers, closed and discarded drafts, linked-request integrity (foreign, other-workspace, revoked and reused requests), expiry window, changed-account guard. Parity: the browser validator and the server schema agree on every mirrored rule. Contract fidelity: the sourcing prompt lists match the contract rows exactly and buyer or delegation requests never offer machinery prompts. Browser: actual-component protocol tests for loading, empty, conflict, error, retry, denied, unavailable and interrupted states, read-only sent drafts, optional profile, keyboard and axe at 320, 390, 768 and 1440, plus closed-gate checks.

## Responsive, accessibility and data preservation

Keyboard-operable step buttons with focus moved to each step heading, labelled fields with described errors, `role="alert"` for problems, `role="status"` for progress, no horizontal scroll at 320. Unsaved text is kept on a version conflict, a failed save and a failed send; it is cleared only when access ends. Nothing is stored in browser storage. Original wording is preserved and requirement lines are appended to the offer text without interpretation.

## Remaining gaps, blockers and flags

Default off behind `CORRIDRA_CUSTOMER_MISSION_DRAFTS_ENABLED` together with the workspace, request and profile flags; synthetic only; production hard-disabled. Not built: sharing a draft, document upload, AI wording help, organiser drafting for participants, reviewed category configuration, and canonical organisation linking. Not verified: usability with real users, private managed-provider sign-in, the cloud module install and an isolated preview. D01 to D06 and D08 stay closed.

## Deployment and rollback

Additive schema installed explicitly before enabling any flag. Rollback is disabling the flag and redeploying the previous application; tables and drafts are retained and never dropped.

## Exact result

PARTIAL. Source implemented and locally tested; exact-head CI and release evidence are recorded in the ledger once they exist.
