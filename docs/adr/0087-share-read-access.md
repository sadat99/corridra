# ADR-087: Who on staff and in a workspace can read each share

Status: Proposed, awaiting owner acceptance. This ADR grants, removes and changes nothing. It records who can read each customer share today, proved at file and line on `origin/main` as of 17 November 2026, and proposes a least-privilege rule that a later build would implement only after the owner accepts it. No code, migration, policy, grant or switch changes with this document.

Authority: owner decision of 17 November 2026, relayed by Guardian 14 (`session_0187kU9sT9kFeqkTSV3x29Q7`), exact words: "Ship label, write rule next (Recommended)". The "who can see it" label ships now in a separate unit (PL1) and says "Not stated" wherever access is not proven. This ADR is the written rule that the label can quote once it is accepted. ADR-003 (tenancy and row security), ADR-033 and its 11 November 2026 amendment (a removed member sees nothing from that workspace), ADR-040 (reviewed delivery), ADR-051 (customer roles), ADR-063 (real report switches), ADR-069 (reply page), ADR-076 (books and decision card), ADR-080 and ADR-084 (programme pages and share kit), ADR-081 (reply review) and ADR-085 (owner and admin with a fresh authenticator check as the precedent for a sensitive staff read) apply unchanged. Where this proposal and an accepted ADR differ, the accepted ADR wins until the owner accepts this one, and each difference is named below.

## Context

A customer can share things outward: a link a supplier or buyer answers, a saved report, a decision card, a programme page, an export. The PL1 label tells the customer who can see the shared item. To be truthful, the label needs one written rule for every reader class, on every surface. The trace below found:

1. **Staff reads have no role filter.** `app.can_access` (`packages/db/migrations/0001_identity_tenancy.sql:90-94`) requires a non-revoked membership, a role from `app.member_role` (`0001:84-89`), an allowed classification and the session's purpose. It never names a role. Every share table whose read policy is `can_access` alone is therefore readable by all five staff roles, `viewer` included. The application registry agrees: `delivery.read` and `communications.read` list all five roles (`packages/domain/src/index.ts:73,79`).
2. **Every staff read is an authenticator-backed session.** `app.actor_id` (`0001:77-83`) requires `twoFactorEnabled`, an assurance under 12 hours old and a session under 24 hours old. A fresh check (`app.fresh_mfa`, 5 minutes, `0001:95-99`) is required only to write a disclosure (`0025_scoped_product_experience.sql:54`), to review a reply (`recipient-reply-review-migrations/0001_reply_review.sql:68-70`) and to read programme applications (`customer-programme-publication-migrations/0002`, `staff_application_actor`, lines 45-66).
3. **Customer workspace roles are owner, admin and member.** Invited members are `admin` or `member` (`customer-member-role-migrations/0001_workspace_member_roles.sql:2-3,11`). `customer_private.organisation_profile_role` maps owner and admin to `writer` and everyone else to `reader` (`0001_workspace_member_roles.sql:77-89`).
4. **Bearer links** store only a SHA-256 of the secret and are read through `SECURITY DEFINER` functions granted to the runtime login.

## Reader classes

| Code | Reader                                                                         |
| ---- | ------------------------------------------------------------------------------ |
| LH   | Link holder: anyone with the link or address, signed in or not                 |
| CR   | Creator: the customer or staff member who made the share                       |
| WO   | Customer workspace owner or admin                                              |
| WM   | Other customer workspace members (role `member`)                               |
| SO   | Corridra staff `owner` in the tenant that holds the share                      |
| SA   | Corridra staff `admin`                                                         |
| SP   | Corridra staff `operator`                                                      |
| SR   | Corridra staff `reviewer`                                                      |
| SV   | Corridra staff `viewer`                                                        |
| EX   | External party with no link: other customers, other tenants' staff, the public |

"Staff" means a member of `app.membership` in the tenant that holds the record (the Corridra staff workspace for real intake, or a sample tenant). A removed member (customer, ADR-033 amendment) or a revoked membership (staff, `0001:92`) reads nothing in every row below. That is true today and stays true.

## Surfaces

Each table gives TODAY (proved) and PROPOSED (least privilege, with the reason). "Body" means what the external party typed or what the share shows. "Meta" means the fact that the share exists, plus its state, audience, dates and counts, with no body. Real workspaces carry a second `real_use_read` policy with the same shape and the real purpose (`customer-real-use-migrations/0002_real_request_authority.sql`). Every change proposed below applies to both policies.

### S1. Supplier and buyer reply page (`/buyer/*`, ADR-069)

Records: `app.buyer_link`, `app.buyer_response` (`0009_controlled_communications.sql:160-166`), `app.recipient_disclosure`, `app.recipient_detail_response` (`0025:22-34`, read policy `0025:97`; real `0002:376,380`), reply review `app.recipient_reply_review` (`recipient-reply-review-migrations/0001_reply_review.sql:59-64`).

| Reader                 | TODAY                                                                                                                                                                                                             | PROPOSED                                                                                                      | Reason                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| LH (the recipient)     | Reads their introduction, disclosure and own stored answer through `app.buyer_view`/`app.recipient_detail_view` by token hash (`0009:195-202`, `0025:108-113`). Expires with the communication and its retention. | Unchanged                                                                                                     | Bearer capability, already scoped to one recipient                                       |
| CR (staff who sent it) | Yes, as staff below                                                                                                                                                                                               | Unchanged                                                                                                     | Needs to follow up                                                                       |
| WO, WM                 | No path. The customer sees a reviewed reply only after staff publish it into the request (ADR-081).                                                                                                               | Unchanged                                                                                                     | The raw reply is unreviewed and the recipient's words                                    |
| SO, SA                 | Body, through `can_access` plus `buyer_link_access` → `communication_access` → `research_target_access` → `research_relationship_access` (`0009:73-78`, `0008_counterparty_research.sql:30-31,108-110`)           | Unchanged                                                                                                     | They publish disclosures (owner or admin plus fresh check, `0025:54`) and review replies |
| SP                     | Body, same chain                                                                                                                                                                                                  | Body, only where the relationship is `TEAM` or the operator owns it (that is today's relationship rule, kept) | Operators run the outreach (`0025:100`)                                                  |
| SR                     | Body, same chain (`member_role IN ('owner','admin','reviewer')` lets a reviewer read every relationship, `0008:31`)                                                                                               | Unchanged                                                                                                     | ADR-003 names reviewers for relationship notes                                           |
| SV                     | Body, for every `TEAM` relationship (no role filter on `can_access`)                                                                                                                                              | **Meta only**                                                                                                 | A viewer has no task that needs a third party's typed words or quoted terms              |
| EX                     | No                                                                                                                                                                                                                | No                                                                                                            |                                                                                          |

### S2. Evidence reply on a delivery link (`delivery-view.tsx`, ADR-040)

Records: `app.delivery_link`, `app.delivery_request`, `app.delivery_response` (read policy `0016_scoped_delivery.sql:132`; writes owner, admin, operator `0016:137`; anonymous answer `app.delivery_respond` `0016:185`; real `0002:236,266`).

| Reader     | TODAY                                                                                                                                                                                                                                                                   | PROPOSED                        | Reason                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------- |
| LH         | Reads the published scope and answers through `app.delivery_report`/`app.delivery_respond` (`0016:148-200`), only while the link is unexpired and unrevoked and its creator is still owner or admin with an authenticator (`app.delivery_subject_access`, `0016:68-71`) | Unchanged                       |                                   |
| CR         | Staff owner or admin by construction (`0016:70`)                                                                                                                                                                                                                        | Unchanged                       |                                   |
| WO, WM     | A customer who saved the link reads it through the saved report (S3), and only that customer                                                                                                                                                                            | Unchanged here; see S3 question |                                   |
| SO, SA, SP | Body (`can_access` only)                                                                                                                                                                                                                                                | Unchanged                       | They create and work the requests |
| SR         | Body                                                                                                                                                                                                                                                                    | Unchanged                       | Review of evidence                |
| SV         | Body                                                                                                                                                                                                                                                                    | **Meta only**                   | Least privilege                   |
| EX         | No                                                                                                                                                                                                                                                                      | No                              |                                   |

### S3. Saved report links (CLIENT_PROGRESS and INSTITUTION_REPORT, ADR-040, ADR-063)

Records: `customer_private.saved_mission` (`customer-commercial-migrations/0001_saved_mission_invitations.sql:3-31`, grants revoked), `app.delivery_link` with `audience`, `reporting_purpose`, `allow_export` (`0016:28-32`); real switches `customer-real-use-migrations/0010_real_report_switches.sql:5-17`.

| Reader                     | TODAY                                                                                                                                                      | PROPOSED                    | Reason                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------ |
| LH                         | Sample tenant: anyone with the link. Real tenant: anyone with the link only while `CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED` is on (`0010:12-17`, ADR-063) | Unchanged                   | ADR-063 is the owner's rule    |
| CR (customer who saved it) | Only that customer: `principal_id=actor` (`saved_mission_actor`, `0001_saved_mission_invitations.sql:33-41`)                                               | Unchanged                   |                                |
| WO                         | No (the save is personal)                                                                                                                                  | Unchanged (open question 4) | ADR-033 kept requests personal |
| WM                         | No                                                                                                                                                         | No                          |                                |
| SO, SA, SP, SR             | Link meta through `delivery_link` read (`0016:132`)                                                                                                        | Unchanged                   | They publish and revoke        |
| SV                         | Link meta                                                                                                                                                  | Unchanged                   | Meta only already              |
| EX                         | No                                                                                                                                                         | No                          |                                |

INSTITUTION_REPORT exports (`app.delivery_export`, `app.delivery_export_artifact`, `0016:205-226`; real `0002:226,228`) hold a full report snapshot. TODAY all five staff roles read them (`0016:132`). PROPOSED: **SO and SA only** for `delivery_export_artifact` and the `snapshot` column (open question 3). Reason: an export is a copy made for one named institution, and a copy should not be wider than the link that made it.

### S4. Decision card (`/decision-card`, ADR-070 narrowed by ADR-076 item 4)

Records: `customer_private.decision_card*` (`customer-decision-card-migrations/0001_decision_cards.sql`, all grants revoked `:86`), creator check `:92-114`, public read `app.read_decision_card` `:298-329`, withdraw creator-only `:271-294`. Sample workspaces only (`:101,106`). Switch `CORRIDRA_SHARE_CARD`; module not installed in production.

| Reader               | TODAY                                                                                                                         | PROPOSED                    | Reason                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------ |
| LH                   | Six fields of one decision, at most 168 hours, until withdrawn, re-derived live (`:298-329`)                                  | Unchanged                   | Accepted under ADR-076               |
| CR                   | Lists and withdraws own cards; must be `writer` (WO) of the request's workspace and hold the saved report (`:96,107,177-191`) | Unchanged                   |                                      |
| WO (not the creator) | No                                                                                                                            | Unchanged (open question 4) |                                      |
| WM                   | No (cannot create, `:107`)                                                                                                    | No                          |                                      |
| All staff            | No path (tables revoked)                                                                                                      | No                          | The card is the customer's own share |
| EX                   | No                                                                                                                            | No                          |                                      |

### S5. Programme pages and share kit (`/delegations/[address]`, ADR-080, ADR-084 S1)

Records: `customer-programme-publication-migrations/0001` (anonymous read `app.read_programme_publication` `:354-372`, organiser views `:254-268,565-578`, applicant `:582-606`), `0002` (staff applications `:45-108`), `0003` (schedule `:114-127`); share kit routes `apps/web/app/delegations/[address]/{flyer,calendar.ics,preview-image}`.

| Reader     | TODAY                                                                                                                                                          | PROPOSED  | Reason                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------ |
| LH         | Reviewed public copy and dates while OPEN or CLOSED; the address has 10 random characters (`0001:111-112`)                                                     | Unchanged | A public page by design        |
| CR, WO     | Draft, counts, applicant names and statements (`participant_scope(...,true)`, `customer-participant-migrations/0001_private_programme_participants.sql:50-54`) | Unchanged | Organiser decides applications |
| WM         | No (42501)                                                                                                                                                     | No        |                                |
| Applicant  | Own applications only (`0001:582-606`)                                                                                                                         | Unchanged |                                |
| SO, SA     | Applications after the 0002 install, with a fresh check (`0002:45-66`; `programme.applications.read`, `packages/domain/src/index.ts:101`)                      | Unchanged |                                |
| SP, SR, SV | No                                                                                                                                                             | No        |                                |
| EX         | Public copy only                                                                                                                                               | Unchanged |                                |

### S6. Programme and ledger exports (`/api/customer-programme-exports`, ADR-054)

`customer.programme_export` (current body `customer-programme-lifecycle-migrations/0001_programme_lifecycle.sql:328-375`), scope `customer_private.pricing_scope` (`customer-programme-pricing-migrations/0001_pricing_series_and_exports.sql:217-228`).

| Reader                | TODAY                                                                       | PROPOSED  |
| --------------------- | --------------------------------------------------------------------------- | --------- |
| WO                    | CSV of the workspace or one programme; only a who-what-count record is kept | Unchanged |
| WM, LH, EX, all staff | No path found                                                               | Unchanged |

The downloaded file is outside Corridra's control. The label says so.

### S7. Mission-share summaries (ADR-043 family)

`customer-mission-share-migrations/0001_participant_mission_summaries.sql` (no policies, all grants revoked `:21-27`, functions `:129-186`).

| Reader                        | TODAY                                                                                 | PROPOSED  |
| ----------------------------- | ------------------------------------------------------------------------------------- | --------- |
| CR (participant)              | Own summary, status, request id (`:159-161,169-176`)                                  | Unchanged |
| WO of the programme workspace | Summary text and status, no request id, while the registration is active (`:161-175`) | Unchanged |
| WM, LH, EX, all staff         | No                                                                                    | Unchanged |

### S8. Mission mail (request acknowledgement email)

`customer-mission-mail-migrations/0001_mission_mail.sql` (all four tables revoked `:26-27,43-44,67-68,96-97`; recipient kept at most 24 hours `:4-6,61,89-97`).

| Reader                | TODAY                                                                                                                                            | PROPOSED                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| CR                    | Receives the email at their own verified address only (`:120-132`); sees own mute states while a member (`0004_removed_member_mail.sql:120-131`) | Unchanged                                          |
| Mute link holder      | Can mute only; reads nothing personal (`0002_mute_events.sql:95-117`)                                                                            | Unchanged                                          |
| Email provider        | Name, job, links (`packages/auth/src/mission-mail.ts:161-181`)                                                                                   | Unchanged (processor, named in the privacy notice) |
| WO, WM, all staff, EX | No path                                                                                                                                          | Unchanged                                          |

### S9. Supplier reply notification

`commercial-readiness-migrations/0009_reply_posted_notification.sql` (writer must be owner, admin or operator and the reply's author, `:7-12`; one row for the request owner, `:14-22`); `app.inbox_notification` read policies (`0001_inbox_and_links.sql:22-28`).

| Reader                             | TODAY                                                              | PROPOSED  |
| ---------------------------------- | ------------------------------------------------------------------ | --------- |
| CR (request owner, current member) | Title "There is a new reply" and a link, no reply text (`0009:22`) | Unchanged |
| Removed member                     | No (`0012_removed_member_inbox.sql:88-107`)                        | Unchanged |
| Staff writer                       | Receipt with the recipient's account id (`0009:28`)                | Unchanged |
| Other staff, WO, WM, EX            | No                                                                 | Unchanged |

### S10. Other outward surfaces found

| Surface                                                                                                                                                            | TODAY                                                                                          | PROPOSED                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Trip Book and Supplier Book PDF (ADR-076 items 1-3), `customer.saved_mission_book` (`customer-book-migrations/0001_trip_and_supplier_books.sql:15-96`)             | Only the customer who saved the report; a download, no link. Switch `CORRIDRA_UX_BOOKS`.       | Unchanged                                                          |
| Intake receipt lookup, `app.mission_receipt` (`migrations/0007_mission_core.sql:139-142`)                                                                          | Anyone holding the receipt reads the status and **staff reply bodies** until `retention_until` | Unchanged in reach; open question 5                                |
| Workspace invitation (`customer-migrations/0002_workspace_collaboration.sql:114-148`)                                                                              | Signed-in invitee with the token, 24 hours; owner creates                                      | Unchanged                                                          |
| Participant invitation and its email (`customer-participant-migrations/0001...:66-72`, `customer-real-use-migrations/0012_participant_invitation_email.sql:32-34`) | Signed-in invitee with the token, 7 days; owner or admin creates                               | Unchanged                                                          |
| `/access/link` field (`apps/web/components/private-link-field.tsx:8,27-37`)                                                                                        | Adds no access; navigates in the browser                                                       | Unchanged                                                          |
| Published results report (ADR-084 S5)                                                                                                                              | Not built                                                                                      | When built: LH by a 64-character token, CR and WO; staff meta only |
| Emailed status link (ADR-076 item 5)                                                                                                                               | Not a token; opens the signed-in page                                                          | Unchanged                                                          |
| Invoices (`customer-invoicing-real-migrations/0001_real_invoicing.sql:396-402`)                                                                                    | No outward link found; label "Not stated"                                                      | Out of scope                                                       |

## The rule (what the label may say once accepted)

1. **A link reaches exactly what its holder was given.** For as long as the link lives, a holder reads only that one recipient's scope. Expiry, revocation, withdrawal or a creator who lost their role ends it (true today on S1 to S5).
2. **Inside the customer's workspace, a share is personal unless the module says otherwise.** The creator reads it. Owners and admins read organiser surfaces (S5, S6, S7). Members read none.
3. **Corridra staff read by job, not by membership.** Owner and admin read everything their work needs. Operators read what they run, under today's relationship rule. Reviewers read what they review. **Viewers read meta only, never a third party's typed words, a report snapshot or an export.**
4. **Copies are no wider than their source.** Export artifacts and report snapshots: staff owner and admin only.
5. **Nothing here weakens the authenticator rules.** Every staff read stays behind `app.actor_id`. Fresh checks stay where they are today. No read gains one, so no current flow breaks.

### Label wording per surface (under the proposal)

| Surface           | Label                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 reply link     | "The person you sent it to, and the Corridra team working on your request"                                                                                                                                 |
| S2 evidence link  | "Anyone with this link until it expires, and the Corridra team working on your request"                                                                                                                    |
| S3 saved report   | Sample: "Anyone with this link until it expires". Real: "You, when signed in" or, with the public switch on, "Anyone with this link until it expires". Both add "and the Corridra team that published it". |
| S4 decision card  | "Anyone with this link for up to 7 days, until you withdraw it. Not the Corridra team."                                                                                                                    |
| S5 programme page | "Public: anyone with the address"                                                                                                                                                                          |
| S6 export         | "You and your workspace owners and admins. Once downloaded, whoever holds the file."                                                                                                                       |
| S7 summaries      | "You and the programme's organisers"                                                                                                                                                                       |
| S8, S9            | "Only you"                                                                                                                                                                                                 |
| Anything unproven | "Not stated" (PL1 rule, unchanged)                                                                                                                                                                         |

Until the owner accepts this ADR, PL1 may only quote the TODAY column. For S1 and S2, today's honest staff wording is "anyone on the Corridra team", because viewers read bodies today.

## Changes a later build would need (described, not written)

1. One forward core migration (next free number) that:
   - replaces the read policy on `app.buyer_response`, `app.recipient_detail_response`, `app.delivery_response` and the `snapshot` read of `app.delivery_export` with the same text plus `AND app.member_role(tenant_id) <> 'viewer'`. The policy is replaced by `DROP POLICY` and `CREATE POLICY` with the same name, guarded by a hash of the old definition, as real-use 0005 does;
   - restricts `app.delivery_export_artifact` read to `app.member_role(tenant_id) IN ('owner','admin')`.
2. The same changes in a forward real-use migration for the `real_use_read` policies (`0002:226,228,266,376`). `app.buyer_response` has no `real_use_read` policy: its single read policy (`0009:166`) checks the row's own classification and purpose, which real-use 0002 widened to the real purpose (`0002:25-26`), so change 1 covers it.
3. Two typed meta reads (security definer, runtime only) so a viewer still sees that a reply or response exists, with its state and dates: `app.reply_meta(tenant, link)`, `app.delivery_response_meta(tenant, request)`.
4. Application: split `communications.read` and `delivery.read` into `*.read` (meta, all five roles) and `*.read_body` (owner, admin, operator, reviewer) in `packages/domain/src/index.ts` and `packages/db`. Operator screens that show bodies use the new permission and show "Not available for your role" to a viewer.
5. PL1 label constants updated from TODAY to PROPOSED in the same PR as the migration. They must not be updated before it, because the label must never promise more than the database enforces.
6. No change to S4 to S10 (no difference between today and the proposal), except the open questions.

## Blast radius

- **Gains access:** nobody.
- **Loses access:** staff with role `viewer` lose the bodies of supplier and buyer replies, recipient detail answers and delivery evidence answers (they keep that each exists, its state and its dates). Staff `operator` and `reviewer` lose export artifacts and report snapshots. Option-dependent: see questions 1 to 3.
- **Unchanged:** every customer reader, every link holder, every external party, staff owner and admin, every switch, every real-operation gate, money, history, events and retention.
- **Risk:** a viewer-backed screen that renders a body would show an empty state. The build must list those screens first (`grep communications.read|delivery.read apps/web`).

## Rollback

One forward migration that restores the original policy text, guarded by a hash, plus a revert of the permission split. No data is written or deleted by either direction, so the rollback is exact. The label constants revert in the same PR.

## Tests a build must add (each must fail on today's code)

1. A viewer selects `body` from `app.buyer_response`, `app.recipient_detail_response` and `app.delivery_response`: today a row comes back. Under the proposal, zero rows, while the meta reads return a row. This applies to sample and real policies.
2. An operator and a reviewer select `app.delivery_export_artifact`: today a row. Under the proposal, none. Owner and admin: a row in both.
3. Regression (passes on both): an operator still reads bodies for `TEAM` relationships and for relationships they own, and not for another's private relationship. A reviewer reads all. Link holders' reads by token are unchanged. A removed or revoked member reads nothing.
4. Label parity: a test that every PL1 label constant maps to a surface row whose PROPOSED reader set equals the policy set exercised in tests 1 to 3.

## Open questions for the owner (one batch; recommended first)

1. **Staff viewers and third parties' words (S1, S2).** (a) Viewers see that a reply exists, its state and its dates, but not its words (Recommended). (b) Keep today: viewers read everything the team reads. (c) Viewers see nothing about replies.
2. **Operators and replies (S1).** (a) Keep today's rule: operators read replies on shared (TEAM) relationships and on their own (Recommended). (b) Operators read only replies to messages they sent. (c) Operators read all replies.
3. **Report exports and snapshots (S3).** (a) Staff owner and admin only (Recommended). (b) Everyone on staff except viewers. (c) Keep today: all staff.
4. **Customer owners and admins seeing a member's shares (S3, S4).** (a) Keep personal: only the creator sees their saved reports and cards (Recommended; ADR-033 and its amendment). (b) Owners and admins also see a list of the members' shares, with no bodies, and can withdraw them. (c) Owners and admins see the members' shares in full.
5. **Intake receipt (S10).** Anyone with the receipt reads the staff replies until retention ends. (a) Keep, and say so in the label and privacy notice (Recommended; no change to a live path). (b) Shorten the receipt's life to 30 days. (c) Show the status only and move the replies behind sign-in.

## Not decided here

- Any change to an accepted ADR. Questions 4 and 5 would amend ADR-033 and the intake ADR forward if the owner picks a non-recommended option.
- Legal review of any label wording. Translations beyond English (native review).
- Staff reads of non-share records (missions, research, opportunities): out of scope.
