# ADR-087: Who on staff and in a workspace can read each share

Status: Accepted, 17 November 2026, on the owner answers recorded under Authority. Two sub-questions stay open (decisions 4a and 4c, below). Accepting this ADR changes nothing by itself. No code, migration, policy, grant or switch changes with this document. Every change below ships later through the implementation plan, in reviewed units, and reaches production only through the installer with the owner's install approval. Until the unit that enforces a row is installed, the TODAY column is what is true, and the PL1 "who can see it" label may quote only TODAY.

Authority:

- Owner decision of 17 November 2026, relayed by Guardian 14 (`session_0187kU9sT9kFeqkTSV3x29Q7`), exact words: "Ship label, write rule next (Recommended)". The label ships in a separate unit (PL1) with "Not stated" where access is unproven, and this ADR is the written rule.
- Owner answers to the five questions of the proposal (PR 540, head a6e7bd1), 17 November 2026. They were relayed by Guardian 14 as "first hand via orchestrator" and are not first hand to this unit. Recorded verbatim:
  1. Q1, staff viewers and third parties' words: "Metadata only (Recommended)".
  2. Q2, operators and replies: not asked. It stays at the recommended default, today's rule kept (an operator reads a reply where the relationship's visibility is `TEAM` or the operator owns the relationship, `0008_counterparty_research.sql:31`).
  3. Q3, report exports and snapshots: "Everyone except viewers".
  4. Q4, customer owners and admins seeing a member's shares: "Owners and admins see everything". Guardian 14 relayed the scope as: same workspace only; tenant isolation, row security and the creator's withdraw rights stay; no cross-workspace reading.
  5. Q5, intake receipt: "Keep, and say so (Recommended)".

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

| Reader                 | TODAY                                                                                                                                                                                                    | DECIDED                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| LH (the recipient)     | Reads their introduction, disclosure and own stored answer by token hash (`0009:195-202`, `0025:108-113`), until the communication and its retention end                                                 | Unchanged                                                                                                                 |
| CR (staff who sent it) | As staff below                                                                                                                                                                                           | Unchanged                                                                                                                 |
| WO, WM                 | No path. The customer sees a reply only after staff publish it into the request (ADR-081).                                                                                                               | Unchanged                                                                                                                 |
| SO, SA                 | Body, through `can_access`, then `buyer_link_access`, `communication_access`, `research_target_access` and `research_relationship_access` (`0009:73-78`; `0008_counterparty_research.sql:30-31,108-110`) | Unchanged                                                                                                                 |
| SP                     | Body where the relationship is `TEAM` or the operator owns it (`0008:31`)                                                                                                                                | Unchanged (Q2 default)                                                                                                    |
| SR                     | Body on every relationship (`member_role IN ('owner','admin','reviewer')`, `0008:31`)                                                                                                                    | Unchanged                                                                                                                 |
| SV                     | Body for every `TEAM` relationship                                                                                                                                                                       | **Meta only** (Q1): the reply exists, its decision, state and dates; never the typed words, quoted terms or revision text |
| EX                     | No                                                                                                                                                                                                       | No                                                                                                                        |

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

| Reader                     | TODAY                                                                                                                                                                                                                                                                                    | DECIDED                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| LH                         | Sample tenant: anyone with the link. Real tenant: only while `CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED` is on (`0010:12-17`; the switch is read at `packages/auth/src/real-report-access.ts:16` and sets `corridra.real_report_public` at `packages/delivery/src/index.ts:38`; ADR-063). | Unchanged                                                                                                                              |
| CR (customer who saved it) | Only that customer: `principal_id=actor` in the list and open reads (`0001_saved_mission_invitations.sql:94,107`), with the actor from `saved_mission_actor` (`:33-41`)                                                                                                                  | Unchanged, and keeps sole right to remove their save                                                                                   |
| WO                         | No: the save is personal                                                                                                                                                                                                                                                                 | **Yes, in full** (Q4): the saved reports of current members of the same workspace, read only; not removing them; scope per decision 4a |
| WM                         | No                                                                                                                                                                                                                                                                                       | No                                                                                                                                     |
| SO, SA, SP, SR             | Link meta (`0016:132`); export snapshot and artifact (`0016:132`)                                                                                                                                                                                                                        | Link meta unchanged; **exports and snapshots: yes** (Q3, everyone except viewers)                                                      |
| SV                         | Link meta; export snapshot and artifact                                                                                                                                                                                                                                                  | Link meta; **exports and snapshots: no** (Q3)                                                                                          |
| EX                         | No                                                                                                                                                                                                                                                                                       | No                                                                                                                                     |

Relayed wording: Guardian 14 relayed Q3 as "staff owner, admin and operator may read report exports and snapshots; viewers may not". The owner's own words are "Everyone except viewers", which also includes `reviewer`. This ADR follows the owner's words (owner, admin, operator, reviewer), and Guardian 14 confirmed that reading on 17 November 2026. Narrowing to exclude reviewers needs a new owner word.

### S4. Decision card (`/decision-card`, ADR-070 narrowed by ADR-076 item 4)

Records:

- `customer_private.decision_card*` (`customer-decision-card-migrations/0001_decision_cards.sql`; all grants revoked, `:86`).
- Creator check `:92-114`, public read `app.read_decision_card` `:298-329`, creator-only withdraw `:271-294`.
- Sample workspaces only (`:101,106`). Switch `CORRIDRA_SHARE_CARD`. Module not installed in production.

| Reader               | TODAY                                                                                                                          | DECIDED                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| LH                   | Six fields of one decision for at most 168 hours, until withdrawn, re-derived live (`:298-329`)                                | Unchanged                                                                                                                                  |
| CR                   | Lists and withdraws own cards. Must be `writer` (WO) of the request's workspace and hold the saved report (`:96,107,177-191`). | Unchanged; withdraw stays the creator's only                                                                                               |
| WO (not the creator) | No                                                                                                                             | **Yes, in full** (Q4): the card list, fields and state for cards made in the same workspace; read only, no withdraw; scope per decision 4a |
| WM                   | No (cannot create, `:107`)                                                                                                     | No                                                                                                                                         |
| All staff            | No path (tables revoked)                                                                                                       | No                                                                                                                                         |
| EX                   | No                                                                                                                             | No                                                                                                                                         |

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

| Surface                                                                                                                                                        | TODAY                                                                                      | DECIDED                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Trip Book and Supplier Book PDF (ADR-076 items 1-3), `customer.saved_mission_book` (`customer-book-migrations/0001_trip_and_supplier_books.sql:15-96`)         | Only the customer who saved the report; a download                                         | Unchanged: only the saver (WO access to books is open sub-question 4c)                          |
| Intake receipt lookup, `app.mission_receipt` (`migrations/0007_mission_core.sql:139-142`)                                                                      | Anyone holding the receipt reads the status and staff reply bodies until `retention_until` | **Kept** (Q5), and stated in the label and the privacy notice                                   |
| Workspace invitation (`customer-migrations/0002_workspace_collaboration.sql:114-148`)                                                                          | Signed-in invitee with the token, 24 hours                                                 | Unchanged                                                                                       |
| Participant invitation and email (`customer-participant-migrations/0001...:66-72`; `customer-real-use-migrations/0012_participant_invitation_email.sql:32-34`) | Signed-in invitee with the token, 7 days                                                   | Unchanged                                                                                       |
| `/access/link` field (`apps/web/components/private-link-field.tsx:8,27-37`)                                                                                    | Adds no access                                                                             | Unchanged                                                                                       |
| Published results report (ADR-084 S5)                                                                                                                          | Not built                                                                                  | When built: LH by token, CR and WO; staff meta only, except SO, SA, SP, SR for any export of it |
| Emailed status link (ADR-076 item 5)                                                                                                                           | Not a token; opens the signed-in page                                                      | Unchanged                                                                                       |
| Invoices (`customer-invoicing-real-migrations/0001_real_invoicing.sql:396-402`)                                                                                | No outward link found                                                                      | Out of scope; label "Not stated"                                                                |

## Decisions

1. **A link reaches exactly what its holder was given, and only while it lives.** Expiry, revocation, withdrawal, or a creator who lost their role ends it.
2. **Staff viewers see metadata only** on S1 and S2 (Q1). They never see a third party's typed words, quoted terms, revision text or evidence answer.
3. **Report exports and snapshots** are readable by staff owner, admin, operator and reviewer, and not by viewers (Q3).
4. **Customer workspace owners and admins read members' saved reports and decision cards in full** (Q4). This applies to the same workspace only, and is read only. The creator keeps the sole right to remove a save and to withdraw a card. Tenant isolation and row security are unchanged, and nothing crosses workspaces. A member who is removed stops being a source at once. Their items fall under the ADR-033 amendment of 11 November 2026 and are read by nobody on the customer side.
   - **4a, open owner sub-question.** Does this apply to items saved before the change is switched on?
     - (a) **Recommended:** only items saved or created after activation. Members saved under a "personal" rule, and changing that silently afterwards breaks a reasonable expectation. Each item records its creation time, so the rule is a single comparison.
     - (b) All items, past and future, after the member notice has been live for 14 days.
     - (c) All items at once.
   - **4b, member notice.** Before activation, every workspace member sees a plain notice on their saved reports and decision cards: "Owners and admins of this workspace can see the reports you save and the decision cards you make here. They cannot remove or withdraw them." The notice ships in the same unit, behind the same switch, and is visible for the whole notice period chosen in 4a.
   - **4c, open owner sub-question.** The owner's answer covers saved reports and decision cards, read only. It does not cover the Trip Book and Supplier Book downloads made from a saved report (ADR-076 items 1-3), which are a copy the reader can keep. Should owners and admins also download a member's book?
     - (a) **Recommended:** no. They read the saved report on screen; the book stays the saver's own download. A copy that leaves Corridra should not be wider than the owner's words.
     - (b) Yes, with one ids-only event per download.
5. **Intake receipts stay as they are** (Q5). The label says "Anyone with your receipt can see the status and the team's replies until it expires." The privacy notice says the same in one sentence. Its wording goes to the owner before it ships.
6. **Nothing here weakens the authenticator rules.** Every staff read stays behind `app.actor_id`. Fresh checks stay where they are today, and no read gains one.

### Label wording once each unit is installed

| Surface           | Label                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 reply link     | "The person you sent it to, and the Corridra team working on your request"                                                                                                                              |
| S2 evidence link  | "Anyone with this link until it expires, and the Corridra team working on your request"                                                                                                                 |
| S3 saved report   | Sample: "Anyone with this link until it expires". Real: "You, when signed in", or with the public switch on, "Anyone with this link until it expires". Both add "and your workspace owners and admins". |
| S4 decision card  | "Anyone with this link for up to 7 days, until you withdraw it. Your workspace owners and admins can also see it. Not the Corridra team."                                                               |
| S5 programme page | "Public: anyone with the address"                                                                                                                                                                       |
| S6 export         | "You and your workspace owners and admins. Once downloaded, whoever holds the file."                                                                                                                    |
| S7 summaries      | "You and the programme's organisers"                                                                                                                                                                    |
| S8, S9            | "Only you"                                                                                                                                                                                              |
| Intake receipt    | "Anyone with your receipt, until it expires"                                                                                                                                                            |
| Anything unproven | "Not stated" (PL1 rule, unchanged)                                                                                                                                                                      |

Before unit U2 is installed, the honest staff wording for S1 and S2 is "anyone on the Corridra team". Before unit U4 is installed, the S3 and S4 rows drop the workspace owners and admins clause.

## Amendment of ADR-033, ADR-036 and ADR-076 item 4 (17 November 2026)

Owner's words, 17 November 2026, relayed by Guardian 14: "Owners and admins see everything".

Until now these ADRs kept a customer's requests, saved reports and decision cards personal to their creator. From unit U4's activation, a current owner or admin of the same workspace also reads, in full and read only, the saved reports (ADR-036) and decision cards (ADR-076 item 4) of current members in that workspace. The scope of past items is set by decision 4a.

What does not change:

- Requests (ADR-033) stay personal: this amendment covers saved reports and decision cards only.
- The creator's sole right to remove a save and to withdraw a card.
- The ADR-033 amendment of 11 November 2026: a removed member reads nothing from that workspace, and is read by nobody on the customer side.
- No cross-workspace reading.

A one-line forward note is added to each amended ADR.

## Implementation plan (units in order, all Class A)

Every unit that touches the database (U2, U3, U4):

- is an additive forward migration in its own module folder, hash-guarded against the definition it replaces, and replaces only the named policies or functions;
- is applied only by the reviewed installer through a new `field_modules_action` value;
- needs the owner's install approval before any production change.

U1 and U5 change no database object. They ship as normal reviewed code changes, with no installer action.

Every unit:

- writes no customer data, except U4's ids-only read events;
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

### U3. Database: exports and snapshots, everyone except viewers

Replace the read policies, sample and real, of `app.delivery_export` and `app.delivery_export_artifact` (`0016:132`; `0002:226,228`) with the same text plus `AND app.member_role(tenant_id) <> 'viewer'`.

No application path reads these for staff today: `packages/delivery/src/index.ts:470-493` uses the link holder's token functions only, and that path is unchanged.

Tests that fail today:

1. A viewer selecting from either table gets a row today and must get none.
2. Owner, admin, operator and reviewer still do.

### U4. Customer: workspace owners and admins read members' saved reports and decision cards (new module, behind a new switch, off)

Decisions 4a and 4c must be answered before U4 is built. Work:

- A new optional module adds read-only functions:
  - `customer.workspace_saved_missions(workspace)`;
  - `customer.workspace_decision_cards(workspace)`;
  - a WO path into the existing saved-report read. Not the book (`customer-book-migrations/0001:15-96`), which stays the saver's only, unless the owner answers 4c otherwise.
- Each function requires:
  - a current owner or admin of that workspace (`customer.collaborative_workspaces()` role IN ('owner','admin'));
  - a source item made in that workspace by a current member (`customer_private.workspace_member_current`, ADR-033 amendment);
  - a creation time that meets decision 4a.
- The creator-only functions are not replaced: `customer.remove_saved_mission` and `customer.withdraw_decision_card` (`0001_decision_cards.sql:271-294`). The public card read is also unchanged.
- One event per owner or admin read of a member's item, with ids only.
- The member notice (decision 4b), shown on `/account` saved reports and decision cards behind the same switch.
- The PL1 label rows for S3 and S4 switch to the decided wording only when the switch is on.

Tests that fail today:

1. WO reading a member's saved report in the same workspace is refused today and must succeed.
2. WO in another workspace is refused on both versions.
3. A member reading another member's item is refused on both versions.
4. WO cannot remove a save or withdraw a card.
5. An item before activation is hidden under option 4a(a).
6. A removed member's items are read by nobody.

### U5. Records and words

- PL1 label constants move from TODAY to DECIDED, row by row, in the same PR as the unit that enforces each row.
- The intake receipt sentence goes into the label and the privacy notice. The privacy wording is shown to the owner before it ships.
- Ledger and work log entries record each unit's installation.

Order: U1, then U2 and U3 (they can run in parallel; they touch different policies), then U4 after 4a is answered. U5 travels with each unit.

## Blast radius

**Gains access:** customer workspace owners and admins, to their own workspace members' saved reports and decision cards (U4, switch off until the owner turns it on).

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
- U4 changes a privacy expectation, which decision 4b's notice and option 4a(a) address.

## Rollback

Each unit has a forward migration that restores the hashed original policy or function text, plus a revert of its application change. No unit writes or deletes customer data, so each rollback is exact for every access rule. U4's ids-only read events stay after its rollback: they are history and are never deleted. U4 can also be paused at once by its switch.

## Not decided here

- Decisions 4a and 4c (open, owner).
- Legal review of the label and privacy wording.
- Translations beyond English (native review).
- Staff reads of non-share records (missions, research, opportunities).
