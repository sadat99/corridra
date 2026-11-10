# CRUD audit: summary and gap plan

Document status: CURRENT.

Read-only audit of 5 November 2026 against the [CRUD standard](../specs/crud-standard.md), on main at 74b3681. The full per-object matrix, with a file and line for every claim, is [matrix.json](matrix.json). Findings are claims checked by S1 where marked; the rest are the audit's own and are re-checked by the track that fixes them.

## Counts

- 57 user-facing objects across customers, organisers, participants, scoped-link recipients, contributors, staff and the owner; 282 tables in 41 migration modules; 63 API routes, every change a POST with an `action` value, no server actions.
- Classes: 27 immutable, 19 append-only revisions, 4 draft then frozen, 7 mutable or partly mutable.
- Gaps: 3 high, 12 medium, 23 low.

## Stop-ship check (CRUD-5)

No business record can be edited or hard deleted. `app.reject_rewrite` triggers block UPDATE and DELETE on business tables (`packages/db/migrations/0002_trust_events.sql:86` and the trigger loops in later modules); the few updatable tables each carry a guard or version trigger. Hard deletes touch only short-lived rows: session proofs, execution grants, verification invitations, authenticator reset rows, mission-mail recipient addresses and the outcome projection rebuild.

## High severity

| Id  | Gap                                                                                                                                                                                                                          | Owner              | Needs                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| G1  | A customer cannot withdraw a sent private request. Revocation exists only as an offline schema-owner action (`packages/auth/src/customer-request-admission.ts:69`, checked by S1); service requests already have withdraw.   | S2                 | A customer withdraw function with reason (migration), UI |
| G2  | A sample-invoice payment entered in error cannot be reversed: no reversal row, and a credit note cannot exceed the unpaid amount (`packages/db/customer-invoicing-migrations/0001_sample_invoices_payments_credits.sql:47`). | S4                 | A payment reversal record with reason (migration)        |
| G3  | A real-invoice payment cannot be reversed, and one staff member records it alone, while invoices and credits need a second person (`packages/db/customer-invoicing-real-migrations/0001_real_invoicing.sql:129`, `:640`).    | S4, owner decision | Reversal record plus second-person decision (migration)  |

## Medium severity

| Id  | Gap                                                                                                                                                                                                                                                | Owner                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| G4  | Customer workspace: no rename, no archive or close, no ownership transfer.                                                                                                                                                                         | S2                           |
| G5  | Customers cannot close their account or ask for erasure themselves; disable is offline only.                                                                                                                                                       | S2, owner decision (privacy) |
| G6  | Notification and mission-mail mutes have no unmute.                                                                                                                                                                                                | S2                           |
| G7  | Programme: no rename of name or reporting purpose, no archive or close, creation capped at 100 per workspace.                                                                                                                                      | S3                           |
| G8  | Moves `set` replaces the open list with no expected version (`packages/domain/src/moves.ts:71`).                                                                                                                                                   | S4                           |
| G9  | Operator member role change and revoke carry no version and no command id (`packages/auth/src/access.ts:61-81`).                                                                                                                                   | S4                           |
| G10 | Cancelling a team invitation hard deletes the row and is not in the team-control audit. Fixed: PR 383 merged as 93ac1165 (10 Nov 2026, deployment success); migration 0010 installed by run 42835562806 (commercial_readiness_migrations 9 to 10). | S4; S20                      |
| G11 | Counterparty private notes and contact data cannot be withdrawn, corrected or erased.                                                                                                                                                              | S4                           |
| G12 | Operator communications, meetings, evidence and network lists stop at a fixed limit with no next page.                                                                                                                                             | S4                           |

## Low severity (examples; full list in the matrix)

Saved mission removal has no confirmation and no audit event; decision card withdraw is one click; notification preferences and attendance have no version check; participant label cannot be edited; the inbox stops at 100 items with no dismiss; a recipient cannot revise a response; discarded drafts list forever. (Correction, 5 Nov: series retire was listed as missing a UI control; S3 found the Retire Series and Restore Series buttons in programme-series.tsx, so that low gap is closed.)

## Order

1. Low and medium gaps that need no schema change go into each track's next PR in its own area, with the CRUD tests named in the standard.
2. Every gap that needs a schema change (G1 to G7, G10, G11) goes in its own PR with its migration, `Sensitive: yes` where it touches money, consent or access, and waits for the owner's merge. Nothing is installed in production without the owner.
3. Owner decisions, 5 November 2026 (answers to S1's questions, verbatim choices):
   - G3, real payments: "Two people for both". Recording a real payment and reversing one both need a second staff member's approval, and every reversal carries a reason, the same rule as invoices and credit notes. Correction (S1, 5 Nov): the question asked was about real payments only. "G2 follows the same shape" was S1's own wording, not the owner's. For sample invoices (G2), a reversal record with a required reason is built. Owner, 6 November 2026, answering whether a sample reversal needs a second staff person, verbatim: "One person + reason (Recommended)". A sample-invoice reversal takes one staff member with fresh MFA and a written reason of at least 20 characters, recorded permanently; ADR-061 stays "not a four-eyes control" for samples. Real money keeps two people (G3).
   - G7, archive (6 November 2026, after the Guardian review of PR 322), verbatim: "Archive closes new invitations and public registration while it's archived, and Restore reopens them." Invitations already issued are not revoked; they cannot be redeemed while archived and work again after Restore unless expired. Existing registrations, terms and coordination stay readable and editable. Built into PR 322.
   - G3 follow-ups (6 November 2026, after the Guardian review of PR 327), verbatim: single-approver control and real payments "Yes, marked (Recommended)"; reason for a real reversal "20 characters (Recommended)". Recorded in the ADR-064 amendment.
   - G5, closing and erasure: "Close with undo + erasure request". A customer closes their account in Settings with 30 days to undo; erasure is a request that staff complete within the legal deadline, keeping the records the law requires (invoices, signed decisions). The privacy notice wording still needs the owner's named review before it ships.
   - G4 and G5 together, 6 November 2026 (owner's verbatim choices, relayed by S1): "when ready build g4, g5 together"; confirmation "Typed name + fresh sign-in (Recommended)"; day 30 "Final at day 30 (Recommended)"; erasure "Separate button (Recommended)"; privacy wording "Ship closed, review later (Recommended)". S1 (Conductor) decisions: ownership transfer is allowed, with one owner at all times, a 7-day offer that the named member accepts, and the old owner becoming admin through the role history; a sole owner may close while the workspace is archived; one PR; mark-all-read becomes a server bulk action (the Codex P2 on PR 347: Mark All Read covered only the loaded 30). The ADR-032 and ADR-051 amendments for ownership transfer are not yet written.
   - Guardian answers to S2's G4/G5 questions (6 November 2026): `membership_guard` replaces `membership_immutable`; DELETE is always refused, and the only UPDATE allowed is owner to admin in the same transaction as an ownership history acceptance, with exactly one owner at commit (tested). Three fingerprint-guarded `CREATE OR REPLACE` statements: skipped when the function is absent, refused when its hash differs. The closed-account gate sits in `CustomerSessionBoundary.transaction` and is a no-op unless the module is installed and the flag is on; Sensitive: yes. Install actions are script-only; a later workflow PR is needed before an owner run. Rename writes `app.tenant.name` plus a revision row; snapshots stay pinned. Close and erasure are refused for a person with no workspace. The staff erasure queue route and page belong to S4. The archive screen lists exactly what archiving stops: new private requests, invitations and registrations; service requests and drafts staying open is a follow-up. Typed phrases: "Close my account" to close, and the workspace name to archive or transfer.

## Status, 6 November 2026

- G7 module 3, a recipient's answer correction through the private link: merged as PR 344 (`2217fd5`), shipped with its control closed; review decisions bind to the version the reviewer saw (`app.review_recipient_reply_seen`). Not installed. Follow-up: the two-window stale editor (Codex P2 on PR 344), S3.
- G4 and G5: in build by S2 as one PR with a migration; the owner merges. Also in that PR: Company Profile shows Coming soon when organisation profiles are off, and the All Tools "Missions" heading.
