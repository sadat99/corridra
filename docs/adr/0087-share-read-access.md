# ADR-087: Who on staff and in a workspace can read each share

Status: Accepted, 17 November 2026, on the owner answers recorded under Authority. No owner item stays open; decision 4d (the interval between the member notice and switch-on) was answered on 17 November 2026. Accepting this ADR changes nothing by itself. No code, migration, policy, grant or switch changes with this document. Every change below ships later through the implementation plan, in reviewed units, and reaches production only through the installer with the owner's install approval. Until the unit that enforces a row is installed, the TODAY column is what is true, and the PL1 "who can see it" label may quote only TODAY.

Authority:

- Owner decision of 17 November 2026, relayed by Guardian 14 (`session_0187kU9sT9kFeqkTSV3x29Q7`), exact words: "Ship label, write rule next (Recommended)". The label ships in a separate unit (PL1) with "Not stated" where access is unproven, and this ADR is the written rule.
- Owner answers to the five questions of the proposal (PR 540, head a6e7bd1), 17 November 2026. They were relayed by Guardian 14 as "first hand via orchestrator" and are not first hand to this unit. Recorded verbatim:
  1. Q1, staff viewers and third parties' words: "Metadata only (Recommended)".
  2. Q2, operators and replies: not asked. It stays at the recommended default, today's rule kept (an operator reads a reply where the relationship's visibility is `TEAM` or the operator owns the relationship, `0008_counterparty_research.sql:31`).
  3. Q3, report exports and snapshots: "Everyone except viewers".
  4. Q4, customer owners and admins seeing a member's shares: "Owners and admins see everything". Guardian 14 relayed the scope as: same workspace only; tenant isolation, row security and the creator's withdraw rights stay; no cross-workspace reading.
  5. Q5, intake receipt: "Keep, and say so (Recommended)".
  6. Sub-question 4a, items saved before activation, 17 November 2026, relayed by Guardian 14 as first hand via the orchestrator: "Everything, including older". This is not the recommendation, which was "only after activation". Owners and admins see members' items saved before activation too.
  7. Sub-question 4c, books, same date and relay: "Yes". This is not the recommendation, which was "no". Owners and admins may download a member's Trip Book or Supplier Book.
  8. Item 4d, the interval between the member notice and switch-on, 17 November 2026, relayed by Guardian 15 as from the owner via the orchestrator: "24 hours". This is not the recommendation, which was 72 hours.

The proposal at a6e7bd1 is kept in the PR history.

Unchanged ADRs: ADR-003 (tenancy and row security), ADR-040 (reviewed delivery), ADR-051 (customer roles), ADR-063 (real report switches), ADR-069 (reply page), ADR-080 and ADR-084 (programme pages and share kit), ADR-081 (reply review) and ADR-085 (owner and admin with a fresh authenticator check, the precedent for a sensitive staff read) apply unchanged.

Amended forward: ADR-033, ADR-036 and ADR-076 item 4, by decision 4 (see "Amendment of ADR-033, ADR-036 and ADR-076 item 4").

## Context

A customer can share things outward: a link a supplier or buyer answers, a saved report, a decision card, a programme page or an export. The PL1 label tells the customer who can see a shared item. To be truthful, it needs one written rule per reader class and surface. The trace found:

1. **Staff reads have no role filter.** `app.can_access` (`packages/db/migrations/0001_identity_tenancy.sql:90-94`) requires a non-revoked membership, a role from `app.member_role` (`0001:84-89`), an allowed classification and the session's purpose. It never names a role. Every share table whose read policy is `can_access` alone is readable by all five staff roles, `viewer` included. The application registry agrees: `delivery.read` and `communications.read` list all five roles (`packages/domain/src/index.ts:73,79`).
2. **Every staff read is an authenticator-backed session.** `app.actor_id` (`0001:77-83`) requires `twoFactorEnabled`, an assurance under 12 hours old and a session under 24 hours old. A fresh check (`app.fresh_mfa`, 5 minutes, `0001:95-99`) is required only:
   - to write a disclosure (`0025_scoped_product_experience.sql:54`);
   - to review a reply (`recipient-reply-review-migrations/0001_reply_review.sql:68-70`);
   - to read programme applications (`customer-programme-publication-migrations/0002`, lines 45-66).
3. **Customer workspace roles are owner, admin and member.** Invited members are `admin` or `member` (`customer-member-role-migrations/0001_workspace_member_roles.sql:2-3,11`). `customer_private.organisation_profile_role` maps owner and admin to `writer` and everyone else to `reader` (`0001_workspace_member_roles.sql:77-89`).
4. **Bearer links store only a SHA-256 of the secret.** They are read through `SECURITY DEFINER` functions granted to the runtime login.

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

"Staff" means a member of `app.membership` in the tenant that holds the record: the Corridra staff workspace for real intake, or a sample tenant. A removed customer member (ADR-033 amendment of 11 November 2026) or a revoked staff membership (`0001:92`) reads nothing in every row below, today and after this ADR.

"Body" means what the external party typed or what the share shows. "Meta" means only:

- that the share exists;
- its state and audience;
- its dates and counts.

Real workspaces carry a second `real_use_read` policy with the same shape and the real purpose (`customer-real-use-migrations/0002_real_request_authority.sql`). Every decided change applies to both policies.

## Surfaces: TODAY (proved) and DECIDED

### S1. Supplier and buyer reply page (`/buyer/*`, ADR-069)

Records:

- `app.buyer_link` and `app.buyer_response` (`0009_controlled_communications.sql:160-166`). `buyer_response` holds the recipient's decision, not free text.
- `app.recipient_disclosure` and `app.recipient_detail_response` (`0025:22-34`; read policy `0025:97`; real policies `0002:376,380`).
- `app.recipient_detail_response_revision` (`recipient-response-revision-migrations/0001_response_revision.sql:62,64`; not installed).
- Reply review `app.recipient_reply_review` (`recipient-reply-review-migrations/0001_reply_review.sql:59-64`).

| Reader                       | TODAY                                                                                                                                                                                                                                                                                                                                      | DECIDED                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| LH (anyone holding the link) | Bearer access: reads the introduction, disclosure and stored answer by token hash alone (`0009:195-202`, `0025:108-113`; `/api/buyer` needs no sign-in, `apps/web/app/api/buyer/route.ts:44-49`, `packages/communications/src/index.ts:66`), so a forwarded link works for whoever holds it, until the communication and its retention end | Unchanged                                                                                                                 |
| CR (staff who sent it)       | As staff below                                                                                                                                                                                                                                                                                                                             | Unchanged                                                                                                                 |
| WO, WM                       | No path. The customer sees a reply only after staff publish it into the request (ADR-081).                                                                                                                                                                                                                                                 | Unchanged                                                                                                                 |
| SO, SA                       | Body, through `can_access`, then `buyer_link_access`, `communication_access`, `research_target_access` and `research_relationship_access` (`0009:73-78`; `0008_counterparty_research.sql:30-31,108-110`)                                                                                                                                   | Unchanged                                                                                                                 |
| SP                           | Body where the relationship is `TEAM` or the operator owns it (`0008:31`)                                                                                                                                                                                                                                                                  | Unchanged (Q2 default)                                                                                                    |
| SR                           | Body on every relationship (`member_role IN ('owner','admin','reviewer')`, `0008:31`)                                                                                                                                                                                                                                                      | Unchanged                                                                                                                 |
| SV                           | Body for every `TEAM` relationship                                                                                                                                                                                                                                                                                                         | **Meta only** (Q1): the reply exists, its decision, state and dates; never the typed words, quoted terms or revision text |
| EX                           | No                                                                                                                                                                                                                                                                                                                                         | No                                                                                                                        |

### S2. Evidence reply on a delivery link (`delivery-view.tsx`, ADR-040)

Records: `app.delivery_link`, `app.delivery_request` and `app.delivery_response`. The read policy is `0016_scoped_delivery.sql:132`. Writers are owner, admin and operator (`0016:137`). The anonymous answer is `app.delivery_respond` (`0016:185`). Real policies: `0002:236,266`.

| Reader         | TODAY                                                                                                                                                                                                                                                                       | DECIDED                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| LH             | Reads the published scope and answers through `app.delivery_report` and `app.delivery_respond` (`0016:148-200`), only while the link is unexpired and unrevoked and its creator is still owner or admin with an authenticator (`app.delivery_subject_access`, `0016:68-71`) | Unchanged                                                                                                   |
| CR             | Staff owner or admin by construction (`0016:70`)                                                                                                                                                                                                                            | Unchanged                                                                                                   |
| WO, WM         | Through the saved report (S3)                                                                                                                                                                                                                                               | As S3                                                                                                       |
| SO, SA, SP, SR | Body (`can_access` only)                                                                                                                                                                                                                                                    | Unchanged                                                                                                   |
| SV             | Body                                                                                                                                                                                                                                                                        | **Meta only** (Q1): the request, whether it was answered, the claim status and dates; never the answer text |
| EX             | No                                                                                                                                                                                                                                                                          | No                                                                                                          |

### S3. Saved report links and their exports (ADR-036, ADR-040, ADR-063)

Records:

- `customer_private.saved_mission` (`customer-commercial-migrations/0001_saved_mission_invitations.sql:3-31`; grants revoked).
- `app.delivery_link`, with `audience`, `reporting_purpose` and `allow_export` (`0016:28-32`).
- Real report switches (`customer-real-use-migrations/0010_real_report_switches.sql:5-17`).
- Exports: `app.delivery_export`, which holds the `snapshot`, and `app.delivery_export_artifact` (`0016:205-226`; real policies `0002:226,228`).

| Reader                     | TODAY                                                                                                                                                                                                                                                                                    | DECIDED                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LH                         | Sample tenant: anyone with the link. Real tenant: only while `CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED` is on (`0010:12-17`; the switch is read at `packages/auth/src/real-report-access.ts:16` and sets `corridra.real_report_public` at `packages/delivery/src/index.ts:38`; ADR-063). | Unchanged                                                                                                                                                     |
| CR (customer who saved it) | Only that customer: `principal_id=actor` in the list and open reads (`0001_saved_mission_invitations.sql:94,107`), with the actor from `saved_mission_actor` (`:33-41`)                                                                                                                  | Unchanged, and keeps sole right to remove their save                                                                                                          |
| WO                         | No: the save is personal                                                                                                                                                                                                                                                                 | **Yes, in full** (Q4): the saved reports of current members of the same workspace, read only; not removing them; including items saved before activation (4a) |
| WM                         | No                                                                                                                                                                                                                                                                                       | No                                                                                                                                                            |
| SO, SA, SP, SR             | Link meta (`0016:132`); export snapshot and artifact (`0016:132`)                                                                                                                                                                                                                        | Link meta unchanged; **exports and snapshots: yes** (Q3, everyone except viewers)                                                                             |
| SV                         | Link meta; export snapshot and artifact                                                                                                                                                                                                                                                  | Link meta; **exports and snapshots: no** (Q3)                                                                                                                 |
| EX                         | No                                                                                                                                                                                                                                                                                       | No                                                                                                                                                            |

Relayed wording: Guardian 14 relayed Q3 as "staff owner, admin and operator may read report exports and snapshots; viewers may not". The owner's own words are "Everyone except viewers", which also includes `reviewer`. This ADR follows the owner's words (owner, admin, operator, reviewer), and Guardian 14 confirmed that reading on 17 November 2026. Narrowing to exclude reviewers needs a new owner word.

### S4. Decision card (`/decision-card`, ADR-070 narrowed by ADR-076 item 4)

Records:

- `customer_private.decision_card*` (`customer-decision-card-migrations/0001_decision_cards.sql`; all grants revoked, `:86`).
- Creator check `:92-114`, public read `app.read_decision_card` `:298-329`, creator-only withdraw `:271-294`.
- Sample workspaces only (`:101,106`). Switch `CORRIDRA_SHARE_CARD`. Module not installed in production.

| Reader               | TODAY                                                                                                                          | DECIDED                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LH                   | Six fields of one decision for at most 168 hours, until withdrawn, re-derived live (`:298-329`)                                | Unchanged                                                                                                                                                        |
| CR                   | Lists and withdraws own cards. Must be `writer` (WO) of the request's workspace and hold the saved report (`:96,107,177-191`). | Unchanged; withdraw stays the creator's only                                                                                                                     |
| WO (not the creator) | No                                                                                                                             | **Yes, in full** (Q4): the card list, fields and state for cards made in the same workspace; read only, no withdraw; including cards made before activation (4a) |
| WM                   | No (cannot create, `:107`)                                                                                                     | No                                                                                                                                                               |
| All staff            | No path (tables revoked)                                                                                                       | No                                                                                                                                                               |
| EX                   | No                                                                                                                             | No                                                                                                                                                               |

### S5. Programme pages and share kit (`/delegations/[address]`, ADR-080, ADR-084 S1)

Records:

- `customer-programme-publication-migrations/0001`: anonymous read `app.read_programme_publication` (`:354-372`), organiser views (`:254-268,565-578`), applicant view (`:582-606`).
- `0002`: staff applications (`:45-108`).
- `0003`: schedule (`:114-127`).

| Reader     | TODAY                                                                                                                           | DECIDED   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | --------- |
| LH         | Reviewed public copy and dates while OPEN or CLOSED; the address has 10 random characters (`0001:111-112`)                      | Unchanged |
| CR, WO     | Draft, counts, applicant names and statements (`customer-participant-migrations/0001_private_programme_participants.sql:50-54`) | Unchanged |
| WM         | No (42501)                                                                                                                      | No        |
| Applicant  | Own applications only (`0001:582-606`)                                                                                          | Unchanged |
| SO, SA     | Applications after the 0002 install, with a fresh check (`0002:45-66`; `packages/domain/src/index.ts:101`)                      | Unchanged |
| SP, SR, SV | No                                                                                                                              | No        |
| EX         | Public copy only                                                                                                                | Unchanged |

### S6. Programme and ledger exports (`/api/customer-programme-exports`, ADR-054)

Records: `customer.programme_export` (current body `customer-programme-lifecycle-migrations/0001_programme_lifecycle.sql:328-375`), scoped by `customer_private.pricing_scope` (`customer-programme-pricing-migrations/0001_pricing_series_and_exports.sql:217-228`).

TODAY and DECIDED are the same:

- WO receives a CSV. Only a who, what and count record is kept.
- WM, LH, EX and all staff have no path.
- Once downloaded, the file is outside Corridra's control, and the label says so.

### S7. Mission-share summaries

Records: `customer-mission-share-migrations/0001_participant_mission_summaries.sql` (no policies; grants revoked `:21-27`; functions `:129-186`).

TODAY and DECIDED are the same:

- CR (the participant) reads their own summary, status and request id (`:159-161,169-176`).
- The WO of the programme workspace reads the summary and status, without the request id, while the registration is active (`:161-175`).
- Nobody else.

### S8. Mission mail (request acknowledgement email)

Records: `customer-mission-mail-migrations/0001_mission_mail.sql` (tables revoked `:26-27,43-44,67-68,96-97`; the recipient is kept at most 24 hours, `:4-6,61,89-97`).

TODAY and DECIDED are the same:

- CR receives it at their own verified address only (`:120-132`).
- A mute link holder can only mute (`0002_mute_events.sql:95-117`).
- The email provider receives the name, job and links (`packages/auth/src/mission-mail.ts:161-181`).
- Nobody else.

### S9. Supplier reply notification

Records: `commercial-readiness-migrations/0009_reply_posted_notification.sql`. The writer must be owner, admin or operator and the reply's author (`:7-12`). It writes one row, for the request owner (`:14-22`). Read policies: `0001_inbox_and_links.sql:22-28`.

TODAY and DECIDED are the same:

- The request owner, while a current member, reads "There is a new reply" and a link, with no reply text (`0009:22`).
- A removed member reads nothing (`0012_removed_member_inbox.sql:88-107`).
- Other staff and customers read nothing.

### S10. Other outward surfaces

| Surface                                                                                                                                                        | TODAY                                                                                      | DECIDED                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Trip Book and Supplier Book PDF (ADR-076 items 1-3), `customer.saved_mission_book` (`customer-book-migrations/0001_trip_and_supplier_books.sql:15-96`)         | Only the customer who saved the report; a download                                         | Also WO of the same workspace, for a current member's saved report (4c), with a book record and an audit event |
| Intake receipt lookup, `app.mission_receipt` (`migrations/0007_mission_core.sql:139-142`)                                                                      | Anyone holding the receipt reads the status and staff reply bodies until `retention_until` | **Kept** (Q5), and stated in the label and the privacy notice                                                  |
| Workspace invitation (`customer-migrations/0002_workspace_collaboration.sql:114-148`)                                                                          | Signed-in invitee with the token, 24 hours                                                 | Unchanged                                                                                                      |
| Participant invitation and email (`customer-participant-migrations/0001...:66-72`; `customer-real-use-migrations/0012_participant_invitation_email.sql:32-34`) | Signed-in invitee with the token, 7 days                                                   | Unchanged                                                                                                      |
| `/access/link` field (`apps/web/components/private-link-field.tsx:8,27-37`)                                                                                    | Adds no access                                                                             | Unchanged                                                                                                      |
| Published results report (ADR-084 S5)                                                                                                                          | Not built                                                                                  | When built: LH by token, CR and WO; staff meta only, except SO, SA, SP, SR for any export of it                |
| Emailed status link (ADR-076 item 5)                                                                                                                           | Not a token; opens the signed-in page                                                      | Unchanged                                                                                                      |
| Invoices (`customer-invoicing-real-migrations/0001_real_invoicing.sql:396-402`)                                                                                | No outward link found                                                                      | Out of scope; label "Not stated"                                                                               |

## Decisions

1. **A link reaches exactly what its holder was given, and only while it lives.** Expiry, revocation, withdrawal, or a creator who lost their role ends it.
2. **Staff viewers see metadata only** on S1 and S2 (Q1). They never see a third party's typed words, quoted terms, revision text or evidence answer.
3. **Report exports and snapshots** are readable by staff owner, admin, operator and reviewer, and not by viewers (Q3).
4. **Customer workspace owners and admins read members' saved reports and decision cards in full** (Q4). This applies to the same workspace only, and is read only. The creator keeps the sole right to remove a save and to withdraw a card. Tenant isolation and row security are unchanged, and nothing crosses workspaces. A member who is removed stops being a source at once. Their items fall under the ADR-033 amendment of 11 November 2026 and are read by nobody on the customer side.
   - **4a, decided ("Everything, including older").** The rule covers every item a current member saved or made in the workspace, including those from before activation.
   - **4b, member notice, required before go-live.** Every workspace member is told before the switch is turned on. The notice is shown in product on `/account` (saved reports and decision cards) and sent through the existing in-app inbox, `app.inbox_notification` with `recipient_kind='customer'` (`commercial-readiness-migrations/0001_inbox_and_links.sql:9-28`). Its `type` check (`:14`) needs one new value through a forward migration. Whether the inbox also triggers an email depends on `emailDecision` in `apps/web/lib/notify.ts`, which is not proven, so email is not relied on. Plain words: "Owners and admins of this workspace can read the reports you save and the decision cards you make here, and download the Trip Book and Supplier Book of your saved reports. This includes items you saved before today. They cannot remove or withdraw them. If there is anything you do not want them to see, you can remove it before [date and time]."
   - **4c, decided ("Yes").** Owners and admins of the same workspace may download a current member's Trip Book or Supplier Book. Each download writes the existing book record and event, plus an audit event naming the reader.
   - **4d, decided ("24 hours", owner, 17 November 2026).**
     - The clock is per workspace. It starts only when the notice has actually been delivered in product to that workspace's members: the inbox rows are written and the `/account` notice is live. It does not start from a deploy or an install.
     - Access switches on per workspace, 24 hours after that delivery. The date and time in the notice are that moment.
     - After switch-on, the notice stays visible to each member until that member dismisses it.
     - Nothing switches on in any workspace before its notice has been delivered and the owner has approved the install.
   - **Protections kept.**
     - Tenant isolation and row security are unchanged, and there is no cross-workspace reading.
     - The creator keeps the sole right to remove a save and to withdraw a card.
     - Expiry and revocation still end links.
     - A removed member's items are read by nobody on the customer side (ADR-033 amendment of 11 November 2026).
     - Every owner or admin read or download of a member's item writes one audit event (who, what, when). It reuses the existing writer `customer_private.workspace_access_event` (`customer-migrations/0002_workspace_collaboration.sql:82-95`; real-use replacement `customer-real-use-migrations/0003_real_customer_modules.sql:2620-2640`). That writer adds:
       - an `app.domain_event` row: the reader is `initiator_id` in its payload, the item ids are in its payload, and the time is `occurred_at`;
       - an `app.audit_event` row: its `actor_id` is the service executor, not the reader, and it carries `domain_event_id` and `action`.
         Audit queries for "who read what, when" must therefore join `app.audit_event` to `app.domain_event`. No new audit mechanism is proposed.
     - Removed saves and withdrawn cards stay unreadable. The owner and admin reads (workspace saved reports, workspace decision cards and the book path) exclude a save with `removed_at` set and a withdrawn card, as the existing reads do: the saved report list and open filter `removed_at IS NULL` (`customer-commercial-migrations/0001_saved_mission_invitations.sql:94,107`), and the public card read refuses a withdrawn card (`customer-decision-card-migrations/0001_decision_cards.sql:304`). The creator's own card list still shows withdrawn cards as not live (`:185-186`); the owner and admin view shows them not at all. This keeps the notice's promise that a member can remove something before access opens.
5. **Intake receipts stay as they are** (Q5). The label says "Anyone with your receipt can see the status and the team's replies until it expires." The privacy notice says the same in one sentence. Its wording goes to the owner before it ships.
6. **Nothing here weakens the authenticator rules.** Every staff read stays behind `app.actor_id`. Fresh checks stay where they are today, and no read gains one.

### Label wording once each unit is installed

| Surface           | Label                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 reply link     | "Anyone with this link until it expires, and the Corridra team working on your request"                                                                                                                                                                                         |
| S2 evidence link  | "Anyone with this link until it expires, and the Corridra team working on your request"                                                                                                                                                                                         |
| S3 saved report   | Sample: "Anyone with this link until it expires". Real: "You, when signed in", or with the public switch on, "Anyone with this link until it expires". Both add "Owners and admins of your workspace can also read it and download its books, including reports saved earlier." |
| S4 decision card  | "Anyone with this link for up to 7 days, until you withdraw it. Owners and admins of your workspace can also read it, including cards made earlier. Not the Corridra team."                                                                                                     |
| S5 programme page | "Public: anyone with the address"                                                                                                                                                                                                                                               |
| S6 export         | "You and your workspace owners and admins. Once downloaded, whoever holds the file."                                                                                                                                                                                            |
| S7 summaries      | "You and the programme's organisers"                                                                                                                                                                                                                                            |
| S8, S9            | "Only you"                                                                                                                                                                                                                                                                      |
| Intake receipt    | "Anyone with your receipt, until it expires"                                                                                                                                                                                                                                    |
| Anything unproven | "Not stated" (PL1 rule, unchanged)                                                                                                                                                                                                                                              |

Before unit U2 is installed, the honest staff wording for S1 and S2 is "anyone on the Corridra team". Before unit U5 is switched on, the S3 and S4 rows drop the workspace owners and admins clause.

## Amendment of ADR-033, ADR-036 and ADR-076 item 4 (17 November 2026)

Owner's words, 17 November 2026, relayed by Guardian 14: "Owners and admins see everything".

Until now these ADRs kept a customer's requests, saved reports and decision cards personal to their creator. Owner's words on the sub-questions, 17 November 2026, relayed by Guardian 14: 4a "Everything, including older"; 4c "Yes".

From unit U5's activation, which follows the member notice (unit U4) and the interval in decision 4d, a current owner or admin of the same workspace also reads, in full and read only, the saved reports (ADR-036) and decision cards (ADR-076 item 4) of current members in that workspace, including items from before activation. They may also download those reports' Trip Book and Supplier Book (ADR-076 items 1-3). Each read or download writes an audit event.

What does not change:

- Requests (ADR-033) stay personal: this amendment covers saved reports and decision cards only.
- The creator's sole right to remove a save and to withdraw a card.
- Expiry and revocation of links.
- The ADR-033 amendment of 11 November 2026: a removed member reads nothing from that workspace, and is read by nobody on the customer side.
- No cross-workspace reading.

A one-line forward note is added to each amended ADR.

## Implementation plan (units in order, all Class A)

Every unit that touches the database (U2, U3, U4, U5):

- is an additive forward migration in its own module folder, hash-guarded against the definition it replaces, and replaces only the named policies or functions;
- is applied only by the reviewed installer through a new `field_modules_action` value;
- needs the owner's install approval before any production change.

U1 and U6 change no database object. They ship as normal reviewed code changes, with no installer action.

Every unit:

- writes no customer data, except U4's inbox notices and U5's ids-only audit events and book records;
- changes no switch default;
- carries tests that fail on the code before it;
- states its rollback (a forward migration restoring the hashed original text).

### U1. Staff body permission split (application only, no migration)

Add `communications.read_body` and `delivery.read_body` (owner, admin, operator, reviewer) to the registry in `packages/domain/src/index.ts` and `packages/db`. Keep `*.read` for all five roles as meta.

Every place that shows reply or evidence bodies to a viewer today must read the body only with `*.read_body`, and otherwise return `null` with "Not available for your role":

| Path                                                                                                               | Body it returns today                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `packages/delivery/src/experience.ts:21` (`DeliveryExperienceService.workspace`, `delivery.read`), query `:94-108` | `recipient_detail_response.body` and the latest revision body                                                    |
| `apps/web/app/api/workspace/delivery/route.ts:34` (GET)                                                            | Serves the above                                                                                                 |
| `apps/web/app/operator/delivery-experience.tsx:41,639`                                                             | Renders `r.body.body`                                                                                            |
| `apps/web/app/operator/reply-review.tsx:40,151-153`                                                                | Renders the reply body and the quotation (reviews themselves are owner and admin, `0001_reply_review.sql:66-70`) |
| `packages/delivery/src/index.ts:75` (`DeliveryService.workspace`, `delivery.read`), query `:108`                   | `delivery_response.body AS response`                                                                             |
| `apps/web/app/api/workspace/delivery/route.ts:59`                                                                  | Serves the above                                                                                                 |
| `apps/web/app/operator/delivery.tsx:1016`                                                                          | Renders "Self-declared response: {r.response}"                                                                   |
| `apps/web/app/api/picker/[kind]/route.ts:98`                                                                       | Calls `s.delivery.workspace`                                                                                     |

`packages/communications/src/index.ts:106,158-164` (`communications.read`) returns `buyer_response.status`, a decision, and no free text. It stays meta and is unchanged.

`packages/auth/src/team-today.ts:90-103` counts responses without reading bodies, and is unchanged.

Tests that fail today, in `packages/delivery` service tests and an operator page test:

1. A viewer context calling `DeliveryExperienceService.workspace` receives `responses[].body` (today) and must receive `null`.
2. The same for `DeliveryService.workspace` `requests[].response`.
3. The operator delivery and experience pages render no body text for a viewer, and do render it for an operator.

### U1q. Staff viewers see quotation metadata only (application only, no migration, no switch)

Owner, 17 November 2026, answered first hand to the orchestrator and relayed: "Yes, hide from viewers". Decision 2 covers a published quotation's terms too: price, shipping, delivery terms and uncertainties. This changes who may read, not the data. Exact money, the original currency and every revision stay as recorded.

Rule: a role holding `delivery.read_body` (owner, admin, operator, reviewer, as U1 defines it) reads every quotation whole. Any other role (staff viewer) gets the same rows with the term fields null: `terms` (every price, amount, quantity, shipping, delivery and payment term), `uncertainties` and `reason` (the recorded reason, which can restate the terms). Id, target, requirement, currency code, revision, previous revision, source and claim references, state and dates stay, so a viewer still sees that a quotation exists. The comparison for a viewer names each current offer, its currency and evidence state only: status, missing terms, differences, inconsistency, expiry and the derived total are all read from the terms and are null. No new permission; U1's `delivery.read_body` and its words "Not available for your role" are reused (`withholdQuotationTerms` and `withheldComparison` in `packages/domain/src/commercial-missions.ts`).

| Path                                                                                                                                                | Before                                                            | Now for a viewer                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/missions/src/commercial.ts` `CommercialMissionService.workspace` (`missions.read`), `data.quotations` (`SELECT *` on `mission_quotation`) | terms, uncertainties, reason                                      | null                                                                                         |
| same, `offers` (`q.*`) into `comparison` (`compareOffers`)                                                                                          | terms, uncertainties, status, missing, differences, derived total | null; id, currency, requirement, evidence state kept                                         |
| `packages/delivery/src/experience.ts` `DeliveryExperienceService.workspace`, `quotations`                                                           | uncertainties                                                     | null                                                                                         |
| `apps/web/app/operator/commercial-mission.tsx` comparison table and "Original offers and revision history"                                          | rendered the terms                                                | "USD · Not available for your role" and "Terms and uncertainty: Not available for your role" |
| `apps/web/app/operator/delivery-experience.tsx` "Explicitly approved quotations"                                                                    | rendered the uncertainties                                        | "Not available for your role"                                                                |
| `apps/web/app/operator/[section]/[missionId]/mission-page.tsx` Quotes                                                                               | price from terms                                                  | currency and "Not available for your role"                                                   |

Checked and unchanged: `app.reply_quotation_prefill` runs under `missions.manage` (no viewer); the quotation and selection forms are manage-only; `packages/missions/src/operations.ts` counts quotes; `mission_rfq.requested_terms` and `mission_selection.rationale`/`next_action` are staff-written, not supplier terms (staff reads of non-share records are not decided here); the experience snapshot, saved reports, decision cards, report links and their exports are link or customer surfaces (S3, S4, U3), not staff viewer reads.

Tests: `tests/integration/commercial-missions.test.ts` ("a staff viewer reads quotation metadata only; owner and admin read the full terms") and `tests/operator/adr087-staff-quotations.spec.ts`; both viewer cases fail on the U1 head.

### U1r. Staff viewers lose quotation evidence, selection rationale and RFQ terms (application only, no migration, no switch)

Owner, 17 November 2026, answered first hand to the orchestrator and relayed: "yes to both, drop the rest". (1) Hide from staff viewers the claims and evidence files linked to a quotation. (2) Hide from staff viewers the staff-written selection rationale (`mission_selection.rationale` and `next_action`) and the RFQ `requested_terms` (`mission_rfq`). This changes who may read, not the data: no row, amount, currency or history changes. It amends forward the U1q sentence that called these selection and RFQ fields "not decided here", and narrows the "Not decided here" bullet on staff reads of non-share records for these fields only. "Drop the rest" drops the other proposed units (CI-U3, CI-U5 and C1-U2 to C1-U4); they come back only with an owner one-line scope.

Rule, as U1 and U1q: a role holding `delivery.read_body` (owner, admin, operator, reviewer) reads everything unchanged. Any other role (staff viewer) gets the same rows with the protected fields null, and the screens say "Not available for your role". The check is `permits()`, fail closed, never a role-name compare. No new permission.

A claim is linked to a quotation when a `mission_quotation` row names it (`claim_id`) or names its source (`source_id`). Those are the only quotation link columns; `mission_selection` and `mission_rfq` also carry `source_id` and `claim_id`, but they are provenance of a decision or an RFQ, not of a quotation, and are unchanged. Claims and evidence not linked to a quotation are unchanged for a viewer.

| Path                                                                                                                                     | Before, for a viewer                         | Now for a viewer                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/evidence/src/index.ts` `EvidenceService.workspace` (`trust.read`), `claims`                                                    | statement of every claim                     | statement null on a linked claim                                        |
| same, `evidence`                                                                                                                         | evidence rows                                | the same rows with `withheld` true on a file whose claim is linked      |
| same, `facts` (verified facts copy the claim statement)                                                                                  | statement                                    | statement null when the verified file's claim is linked                 |
| `EvidenceService.download` (`trust.read`), `/api/workspace/download`                                                                     | the file                                     | refused, 403 "Not available for your role"; unlinked files still served |
| `packages/missions/src/commercial.ts` `CommercialMissionService.workspace` (`missions.read`), `decisions`                                | `rationale`, `next_action`                   | null                                                                    |
| same, `rfqs`                                                                                                                             | `requested_terms`                            | null; `buyer_context` stays (who the buyer is, not terms)               |
| `apps/web/app/operator/evidence-panel.tsx`, `sources-panel.tsx`, `commercial-mission.tsx` (Proof, Records)                               | rendered the statement, file link, rationale | "Not available for your role"; no download link on a withheld file      |
| `packages/counterparties/src/index.ts` `CounterpartyService.detail` (`research.read`), company details (`organisation_attribute` claims) | statement                                    | statement null on a linked claim                                        |
| same, `shortlist` sources (`assessment_claim` claims) and `shortlistExport` (`/api/workspace/shortlist-export`)                          | statement                                    | statement null on a linked claim, in the page and the JSON export       |
| `apps/web/app/operator/counterparties.tsx` company details and shortlist sources                                                         | rendered the statement                       | "Not available for your role"                                           |

Checked and unchanged: `packages/delivery/src/decision-disclosures.ts:33` reads rationale and next action for owner and admin only (`options`, existing role check, no viewer); the picker `source` kind lists source locators, not claims; the claim picker on `counterparties.tsx` is in a form shown to managers only; the staff audit list (`packages/auth/src/access.ts` `audit`) reads event metadata, never payloads, and `commercial_mission_command` stores an input hash only; decision cards, saved reports, delivery decisions and their exports are customer or link surfaces (S3, S4, U3). The SQL link test is one shared function, `quotationLinkedClaimSql` in `packages/domain/src/commercial-missions.ts`, used by the evidence and counterparty services.

Residue, not closed by U1r: the link test reads `mission_quotation` under the viewer's own row security (`research_target_access`). A quotation on a target the viewer cannot see does not mark its claim, so the viewer still reads that claim's statement and its verified fact and can download its evidence file. Relationship visibility defaults to OWNER, so this is the common case, not a corner: in most workspaces U1r hides only claims behind quotations on relationships shared with the team. The closing fix is a SECURITY DEFINER `app.quotation_linked_claim(tenant, claim)` in a later database unit, called by `quotationLinkedClaimSql`; until it is installed, U1r must not be described as hiding all quotation evidence from viewers. The integration test asserts today's residue explicitly so that unit has to flip it. Note (quotation link check, below): this residue paragraph is superseded, replaced by quotation_link_check once installed; it still describes production until the owner's install.

Tests: `tests/integration/commercial-missions.test.ts` ("a staff viewer reads no quotation evidence, selection rationale or RFQ terms; other roles read them whole") and `tests/operator/adr087-staff-evidence.spec.ts`. The viewer service and panel cases fail on the U1q head. Two cases are regression guards: the viewer Proof picker case passes on the U1q head too (the picker was already manage-only), and the route 403 case passes on the first U1r head c13b0fe (its service already refused the file).

### U2. Database: viewers read metadata only (core forward migration, next free number)

Replace the read policies, sample and real, of:

- `app.recipient_detail_response` (`0025:97`; `0002:376`);
- `app.recipient_detail_response_revision` (`recipient-response-revision-migrations/0001:62,64`, only when installed);
- `app.delivery_response` (`0016:132`; `0002:266`).

Each keeps the same text plus `AND app.member_role(tenant_id) <> 'viewer'`.

Add two typed meta reads (security definer, fixed search path, runtime only, same scope checks), so a viewer still sees that a reply or answer exists with its state and dates:

- `app.reply_meta(tenant, link)`;
- `app.delivery_response_meta(tenant, request)`.

`app.buyer_response` holds no free text and is unchanged.

Tests that fail today, PostgreSQL 16 tests in `packages/db`:

1. A viewer selecting `body` from each of the three tables, in a sample and a real tenant, gets rows today and must get none.
2. The meta functions return a row for the viewer.
3. Regression, passing on both versions:
   - an operator reads bodies on `TEAM` relationships and on their own, and not on another's private relationship;
   - a reviewer reads all;
   - link holders' token reads are unchanged;
   - removed or revoked members read nothing.

U1 ships first, so no screen breaks when U2 is installed.

**Status (17 November 2026): built in PR 554, not installed.** Module `packages/db/viewer-reply-metadata-migrations` (0001 for the reply and answer tables and four meta reads: `app.reply_meta_list`, `app.reply_meta`, `app.reply_review_meta` and `app.delivery_response_meta`, 0002 for the answer-correction table, applied only where that module exists and re-run by its install), reached only through `field_modules_action=viewer_reply_metadata`. Each file is hash-guarded against the policies it replaces. Rollback text: `packages/db/viewer-reply-metadata-migrations/rollback/` (copied to the next free number only on the owner's word). Installing needs the owner's word.

### U3. Database: exports and snapshots, everyone except viewers

Replace the read policies, sample and real, of `app.delivery_export` and `app.delivery_export_artifact` (`0016:132`; `0002:226,228`) with the same text plus `AND app.member_role(tenant_id) <> 'viewer'`.

No application path reads these for staff today: `packages/delivery/src/index.ts:470-493` uses the link holder's token functions only, and that path is unchanged.

Tests that fail today:

1. A viewer selecting from either table gets a row today and must get none.
2. Owner, admin, operator and reviewer still do.

**Status (17 November 2026): built in PR 554, not installed.** Module `packages/db/viewer-export-access-migrations`, reached only through `field_modules_action=viewer_export_access`, hash-guarded against the four policies it replaces. Rollback text: `packages/db/viewer-export-access-migrations/rollback/0001_restore_original_export_reads.sql`. Installing needs the owner's word.

### Quotation link check. Database: closes the U1r residue (module quotation_link_check)

Adds `app.quotation_linked_claim(p_tenant uuid, p_claim uuid) RETURNS boolean`: SECURITY DEFINER, STABLE, `SET search_path = pg_catalog, app`, every name schema-qualified, EXECUTE revoked from PUBLIC and granted to `corridra_runtime` only. It answers one boolean: true when a quotation in the tenant names the claim (`claim_id`) or its source (`source_id`), whatever target or relationship visibility the quotation sits on. It returns plain false, with no error, unless `p_tenant` equals the caller's `corridra.tenant_id` setting (the setting every read policy uses). It also adds `mission_quotation(tenant_id, claim_id)` and `(tenant_id, source_id)` indexes, which did not exist.

`quotationLinkedClaimSql(tenant, claim, installed)` emits today's row-security EXISTS alone when the module is not installed, and `(EXISTS ... OR app.quotation_linked_claim(tenant, claim))` when it is. Each reader that does not hold `delivery.read_body` learns `installed` from `quotationLinkCheckInstalled`, which asks `to_regprocedure` on the reader's own connection at most once a minute per process. A stale "installed" after a rollback names the dropped function, so the read fails with an error and reveals nothing; a stale "not installed" after an install reads what it read before, for at most a minute. The readers are unchanged apart from passing that boolean: evidence workspace claims, evidence and verified facts, evidence download, company details, shortlist and shortlist export.

The definer reads every row of both tables only because its owner is not held to their row security. The 0001 proof refuses unless the function owner owns `app.claim` and `app.mission_quotation` or has BYPASSRLS (or is a superuser), and unless neither table has FORCE ROW LEVEL SECURITY. The two indexes are built without CONCURRENTLY inside the installer's one transaction: `mission_quotation` is small, so writes to it wait only briefly. Accepted by the Guardian.

Tests that fail on the code before it: `tests/integration/adr087-quotation-link-check.test.ts` (refusal without the real-use modules, install once, function attributes and grants, tenant guard, owner and FORCE guard, indexes, stale cache fails closed, rollback and reinstall) and the residue part of `tests/integration/commercial-missions.test.ts` (not installed: today's residue, now including the verified fact and the download; installed: statement, verified fact and file withheld in the evidence and counterparty readers, the residue set empty, read_body roles unchanged; rolled back with a stale cache: viewer reads fail with an error; then today's residue again).

**Status (17 November 2026): built, not installed.** Module `packages/db/quotation-link-check-migrations`, reached only through `field_modules_action=quotation_link_check`; it refuses unless the customer real-use modules are installed. Rollback text: `packages/db/quotation-link-check-migrations/rollback/0001_drop_quotation_linked_claim.sql` drops the function and the two indexes; the application falls back by itself. No customer row is written or deleted. Installing changes what a staff viewer reads at once, so it needs the owner's word.

### U4. Member notice (required before U5; new optional module and inbox type)

- A forward migration adds one value to the `app.inbox_notification` type check (`commercial-readiness-migrations/0001_inbox_and_links.sql:14`).
- It adds a function, owner-installed and run once per workspace by the owner's activation step. It writes one customer inbox row per current member, with the decision 4b words and the switch-on time (delivery time plus 24 hours). It records that workspace's notice delivery time, which is the start of the 4d clock.
- The same words show on `/account` saved reports and decision cards, behind a "notice" switch that is separate from the U5 switch. They stay visible after switch-on until each member dismisses them, and a dismissal is recorded per member.
- No access changes.

Tests that fail today:

1. Every current member of a workspace receives exactly one notice row, and a removed member receives none.
2. The `/account` banner renders the 4b words with the time.
3. The banner stays after switch-on until that member dismisses it.

### U5. Customer: workspace owners and admins read members' saved reports and decision cards and download their books (new module, behind a new switch, off)

Access opens per workspace, and only 24 hours after that workspace's recorded notice delivery (4d). The global switch and the owner's install approval are also required. A workspace with no delivery record never opens. Work:

- A new optional module adds read-only functions:
  - `customer.workspace_saved_missions(workspace)`;
  - `customer.workspace_decision_cards(workspace)`;
  - a WO path into the existing saved-report read;
  - a WO path into the book (`customer-book-migrations/0001_trip_and_supplier_books.sql:15-96`). It writes the existing book record (`customer_private.saved_mission_command`, `:85-87`, with the reader as principal) and the existing `delivery.book.generated` event (`:89`), within the existing limit of 30 an hour (`:79-82`).
- Each function requires:
  - a current owner or admin of that workspace (`customer.collaborative_workspaces()` role IN ('owner','admin'));
  - a source item made in that workspace by a current member (`customer_private.workspace_member_current`, ADR-033 amendment).
  - Creation time is not filtered (4a).
  - The save is not removed (`removed_at IS NULL`) and the card is not withdrawn.
- Every read and download calls `customer_private.workspace_access_event` (see Protections kept) with kind `customer.member_item.read` or `customer.member_item.book`, and ids only.
- The creator-only functions are not replaced: `customer.remove_saved_mission` and `customer.withdraw_decision_card` (`0001_decision_cards.sql:271-294`). The public card read, expiry and revocation are unchanged.
- The PL1 label rows for S3 and S4 switch to the decided wording only when the switch is on.

Tests that fail today:

1. WO reading a member's saved report, card or book in the same workspace is refused today and must succeed, including an item saved before the module was installed.
2. WO in another workspace is refused on both versions.
3. A member reading another member's item is refused on both versions.
4. WO cannot remove a save or withdraw a card.
5. A removed member's items are read by nobody.
6. Each WO read or download writes exactly one audit event naming the reader and the item ids.
7. An expired or revoked link still ends the item's report for everyone.
8. A save removed by its member, and a card withdrawn by its creator, are unreadable to owners and admins (list, open and book).
9. The reused writer, in its real-use version (`customer-real-use-migrations/0003_real_customer_modules.sql:2620-2640`), records a `domain_event` and an `audit_event` for a non-synthetic workspace. If it cannot, U5 stops and reports to the owner rather than adding a new mechanism.
10. A workspace is refused before its notice delivery time plus 24 hours and with no delivery record, and allowed after that time; another workspace's delivery has no effect.

### U6. Records and words

- PL1 label constants move from TODAY to DECIDED, row by row, in the same PR as the unit that enforces each row.
- The intake receipt sentence goes into the label and the privacy notice. The privacy wording is shown to the owner before it ships.
- Ledger and work log entries record each unit's installation.

Order: U1, then U2 and U3 (they can run in parallel; they touch different policies), then U4 (the notice), then U5 (opening per workspace 24 hours after that workspace's notice delivery). U6 travels with each unit.

## Blast radius

**Gains access:** customer workspace owners and admins, to their own workspace members' saved reports, decision cards and books, including older items (U5, switch off until the notice interval has passed and the owner turns it on).

**Loses access:**

- Staff `viewer` loses the bodies of reply and evidence answers (keeping metadata).
- Staff `viewer` loses report exports and snapshots.

**Unchanged:**

- every link holder and external party;
- staff owner, admin, operator and reviewer for every share they read today;
- customer members;
- programme pages, exports, summaries, mail and notifications;
- every real-operation gate, money and history record.

**Risk:**

- A viewer screen that renders a body shows an empty state. U1 lists and changes those screens before U2.
- U2 also hides from a viewer the rows of tables whose read policies reach a reply through its read policy: the team's reply reviews (`app.recipient_reply_review`) and reply-to-offer bindings (`app.reply_quotation_binding`). Review state reaches a viewer as metadata through `app.reply_review_meta` (decision and date only); no staff screen reads bindings. The staff readers (delivery experience, delivery workspace, Today and the reply review list) read through the meta functions for a role without the body permission (PR 554).
- The meta functions restate the read scope of these tables. Any later change to the read policies of `app.recipient_detail_response`, its corrections, `app.delivery_response` or `app.recipient_reply_review` must change the meta functions in the same reviewed unit.
- U5 changes a privacy expectation, including for older items. The required notice (U4), the interval (4d) and the audit event per read address it.

## Rollback

Each unit has a forward migration that restores the hashed original policy or function text, plus a revert of its application change. No unit writes or deletes customer data, so each rollback is exact for every access rule. U4's inbox notices and U5's audit events and book records stay after a rollback: they are history and are never deleted. U4 and U5 can also be paused at once by their switches.

## Not decided here

- Legal review of the label and privacy wording.
- Translations beyond English (native review).
- Staff reads of non-share records (missions, research, opportunities), except the selection rationale, next action and RFQ requested terms that U1r withholds from viewers.
