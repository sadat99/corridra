# Real company linking, Phase 1: phase plan

Document status: CURRENT.

Status of the work: DESIGN ONLY. Designed, nothing else. Nothing here is implemented, tested, deployed, installed, enabled, approved or live. The decisions are in [ADR-079](../../adr/0079-real-company-linking-phase-1.md), which amends [ADR-052](../../adr/0052-canonical-organisation-linking.md) forward. Authority Brief stamp `auth-c36160a85b5b`, base commit `104c9058`, branch `company-linking-phase1`.

Owner decisions of 10 November 2026, relayed by S17 and not yet in the ledger: "Phase 1 now."; search "1 & 2 in the best way possible"; source rights "2+in better and faster way, not too much rigidity like 1"; erasure "Redact by new record (Recommended)". Defaults that stand: OD3 self-declared, OD5 staff revoke only, OD2 wait for the scanner. `CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED` stays OFF.

This spec never overrides the [V3 contract](../../V3_CONTRACT.md), an accepted ADR or the [ledger](../../V3_LEDGER.md). Register states for V3-06-002, V3-06-011, V3-01-018 and V3-05-043 are not changed by this spec. The lightweight rights record does not satisfy or close V3-05-043.

## 1. Phases

| Phase   | What it is                                                                                                                                        | State                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Phase 1 | A real-ready, rights-aware, abuse-resistant company catalogue behind the OFF flag: one provenance rule, rights record, combined search, redaction | Designed                     |
| Phase 2 | The list in section 8                                                                                                                             | Not designed beyond the list |

End state of Phase 1: the flag is still OFF. The owner has merged and installed. Observation is done. The flag decision is separate and is not part of Phase 1.

## 2. Slices, in order

Every slice with a migration is merged by the owner (ledger rule: the owner merges any PR with a migration or installer change unless they say "u merge" for that PR). Each slice leaves main releasable because the SQL is dormant until the owner installs, and the application code in each slice works with or without the new SQL (a feature check, or the existing 503 pattern for a missing function, `route.ts` `failure()`).

| Slice | Scope (named objects, see section 3)                                                                                                                                                                    | What it proves                                                                                                                                | Tests                                                                                                                 | Merges                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 0     | This docs PR: ADR-079, this spec, index rows (ADR index, documentation map, specs README, ADR-052 pointer line, work log)                                                                               | The design is recorded and reviewable. No behaviour                                                                                           | `npx prettier --check`, docs tests                                                                                    | Normal lane (no migration). The owner may still choose to merge |
| 1     | Read side: the rule and eligibility helper; empty suppression and redaction tables with yes/no helpers; replaced candidates, queue, review, customer state, command replay; ledger guard; url CHECK fix | No real or synthetic data crosses in staff views, counts or queue. Masks work with fixture rows. A real evidence URL is accepted              | Provenance matrix (staff rows), orphan matrix, populated-database, repeat install, history mismatch, denial, real URL | Owner                                                           |
| 2     | Catalogue safeguards: rights table, defaults function, ingest wrapper, rights adjust and read; suppression writer and its event helper; ingest call site, domain schema, staff service and route        | Ingestion records rights in the same transaction and never refuses. A takedown hides a company everywhere a customer or staff candidate looks | Wrapper cases, atomicity, 8-argument hash unchanged, suppression cases, event privacy, denial                         | Owner                                                           |
| 3     | Search: attempts table; replaced search                                                                                                                                                                 | Combined search, 10-row cap, de-duplication, identical empty answers, rate limit, race at the cap                                             | Provenance matrix (customer rows), empty-answer table, rate-limit and race tests                                      | Owner                                                           |
| 4     | Erasure writer: redaction function; staff service and route                                                                                                                                             | A redaction hides text everywhere, survives retry, keeps the active link, leaves history intact                                               | Redaction cases, immutability, masked replay, event privacy, denial                                                   | Owner                                                           |

Order rule. Slice 1 first: it contains the fix for the legal-name leak that exists in installed code and it is the base for the rest. Slice 2 before slice 3 so a takedown exists before real search can return anything. Slice 4 is last because its readers are already in slice 1 and its writer needs the least new surface. The owner may install after each slice or once after slice 4. Either way, the flag decision waits for all four.

## 3. Named database objects, by purpose

No SQL bodies here. Names follow the module pattern. All new tables are in `customer_private`, have row security on, no grant to the runtime or auth logins, and `app.reject_rewrite()` on update and delete. All new helpers are revoked from PUBLIC, the runtime and auth logins. Entry points that staff or customers call are the only ones granted to the runtime login.

### New tables

| Table                                               | Purpose                                                                                                                                                                         | Slice     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `customer_private.organisation_suppression`         | Append-only `hidden` and `shown` rows per organisation, with reason, request reference and staff actor                                                                          | 1 (empty) |
| `customer_private.organisation_link_redaction`      | One row per redacted claim: reason, request reference, staff actor, command id, stored request (for replay)                                                                     | 1 (empty) |
| `customer_private.organisation_source_rights`       | Versioned rights record per organisation: source type, basis note, personal-name flag, warnings, review-by date, source tenant and record, staff actor, reason (from version 2) | 2         |
| `customer_private.organisation_link_search_attempt` | One row per counted search: actor id and time only                                                                                                                              | 3         |

### New helpers

| Helper                                                      | Purpose                                                                                            | Slice |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- |
| `customer_private.organisation_link_same_context(boolean)`  | The one provenance rule: row flag is not null and equals `customer_private.synthetic_context()`    | 1     |
| `customer_private.organisation_link_suppressed(uuid)`       | True when the latest suppression row for the organisation is `hidden`                              | 1     |
| `customer_private.organisation_link_redacted(uuid)`         | True when the claim has a redaction row                                                            | 1     |
| `customer_private.organisation_rights_defaults(text)`       | Default rights fields and warnings for a source type; unknown becomes `other`; also the name check | 2     |
| `customer_private.organisation_catalogue_domain_event(...)` | Event, audit and outbox rows for a suppression change; payload ids, version, state only            | 2     |

### New entry points (granted to the runtime login, staff only)

| Function                                                | Purpose                                                                                                                                                                                                   | Slice |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `app.ingest_public_organisation_with_rights(...)`       | Wrapper: the 8 existing arguments plus a source type. Calls the unchanged 8-argument function, then appends rights version 1. Returns the id and the warnings                                             | 2     |
| `app.adjust_organisation_source_rights(...)`            | Append a new rights version with a mandatory reason. Authority: the ingest roles of the ingesting tenant                                                                                                  | 2     |
| `app.organisation_source_rights_read(...)`              | Read the current rights record and history. Same authority                                                                                                                                                | 2     |
| `app.customer_organisation_suppress(command, input)`    | Hide or show an organisation. Authority: the link staff authority (owner, admin, reviewer of the intake tenant, fresh MFA). Takes the organisation lock `decide` uses. Idempotent by staff and command id | 2     |
| `app.customer_organisation_link_redact(command, input)` | Redact one closed claim. Authority: link staff authority and owner or admin. Reason and request reference mandatory. Idempotent; conflicting command id conflicts                                         | 4     |

### Replaced objects (each once, each under a hash guard of the exact live text)

| Object                                                         | Slice | Change in words                                                                                                                            |
| -------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `customer_private.organisation_link_public_organisation(uuid)` | 1     | Catalogue eligibility: same context, identifier still valid, not suppressed                                                                |
| `customer_private.organisation_link_candidates(uuid)`          | 1     | Claim guard; organisation half, linked count and workspace half use the rule; suppressed and redacted dropped; empty on a wrong-side claim |
| `customer_private.organisation_link_ledger_guard()`            | 1     | A `linked` row needs matching provenance and a non-suppressed organisation                                                                 |
| `customer_private.organisation_link_state(uuid,boolean)`       | 1     | Masks redacted text; shows an organisation name only when the rule allows                                                                  |
| `app.customer_organisation_link_review(uuid)`                  | 1     | Masks note, evidence, history, profile name, website and summary of a redacted claim; names shown only by the rule                         |
| `app.customer_organisation_link_queue(text,uuid,integer)`      | 1     | Masks the legal name of a redacted claim; adds a `redacted` marker; the count uses the fixed candidates                                    |
| `customer.organisation_link_command(uuid,text,jsonb)`          | 1     | Replay branch returns the current masked state for a redacted claim. Nothing else changes                                                  |
| constraint `organisation_link_evidence_url_check`              | 1     | Conditional on provenance (see the ADR, shipping section)                                                                                  |
| `customer.organisation_link_search(uuid,text)`                 | 3     | Combined search, caps, lock, attempt row                                                                                                   |

Not touched: `app.customer_organisation_link_decide`, `app.ingest_public_organisation` (8 arguments), `app.organisation`, `app.public_identifier`, profile revisions, any other module.

### Slice 1 install notice

The first file counts ledger rows whose tenant and organisation have different provenance and raises a notice with the number. It never blocks. A non-zero number is reported to the owner. Those rows are not changed.

## 4. Application changes (build-PR scope only, not part of this design)

Paths were found with `rg --files`. Nothing here is built.

| Path                                                                                                                   | Change                                                                                                                                                                                                                                              | Slice        |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `packages/counterparties/src/index.ts` (case `'ingest'`, call at line 282)                                             | Call the wrapper with a source type. First check, in the same transaction, that the wrapper exists (`to_regprocedure`). If it does not, call the 8-argument function as today. Return the id and the warnings                                       | 2            |
| `packages/domain/src/counterparties.ts`                                                                                | Add an optional `sourceType` to the ingest command. Absent means `other`                                                                                                                                                                            | 2            |
| `apps/web/app/operator/counterparties.tsx`                                                                             | One source-type choice on the existing ingest form, and show the returned warnings in the existing result area. A small change to an existing form, not a new screen. Copy needs designer review. Until built, mark MISSING                         | 2            |
| `packages/auth/src/customer-organisation-links.ts`                                                                     | Staff service methods for suppress, rights adjust and read (slice 2) and redact (slice 4), through `withTenant(..., 'trust.verify', ...)`. Types and Zod gain the masked marker and `redacted` flag. Customer `search` keeps its shape and its call | 2, 4         |
| New staff route files under `apps/web/app/api/workspace/`                                                              | Suppress, rights, redact. Gated by `deliveryEnabled()`, the staff session, `withTenant` and fresh MFA (KI-41 mapping), not by the customer link flag. Names chosen by the builder                                                                   | 2, 4         |
| `apps/web/app/api/customer-organisation-links/route.ts`                                                                | No change. The per-IP budget at line 47 stays the outer layer                                                                                                                                                                                       | none         |
| `apps/web/app/account/profile/company-link.tsx`                                                                        | No change in Phase 1. It already shows "No listed company matches. Try another word, or choose the other option." (line 586). Check that the masked marker text renders in note and evidence                                                        | none (check) |
| `apps/web/app/operator/company-link-review.tsx`                                                                        | No new control. It shows what it is sent, masked text included. Warning, suppression and redaction controls are MISSING in the UI until Phase 2                                                                                                     | none         |
| `scripts/install-customer-modules.ts`, `.github/workflows/install-customer-modules.yml`, `packages/db/src/*migrate.ts` | No change. Input count stays 25 (KI-25). `tests/workflow-inputs.test.mjs` unchanged                                                                                                                                                                 | none         |

## 5. Test matrices

Roles in the matrices: RC real customer (owner of real workspace WR1, writer); SC synthetic customer (writer of WS1); RS real staff (reviewer of the real intake tenant, fresh MFA); SS synthetic staff (reviewer of the synthetic intake tenant, fresh MFA). Country DE throughout.

### Fixture

| Name          | What it is                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| OR1           | Real organisation "Acme GmbH", current identifier with host `acme-gmbh.de`, rights record present                               |
| OS1           | Synthetic organisation "Acme GmbH", current identifier with host `acme.example.invalid`                                         |
| OR2           | Real organisation "Beta Werke GmbH", identifier expired                                                                         |
| OR3           | Real organisation "Gamma Handel GmbH", hidden by a suppression row                                                              |
| OR4           | Real organisation "Delta Bau GmbH" made by the 8-argument function directly (no rights row)                                     |
| WR1, WR2, WR3 | Real workspaces. Profile of WR1 and WR2: "Acme GmbH", DE, website `https://www.acme-gmbh.de`                                    |
| WS1, WS2      | Synthetic workspaces. Profile "Synthetic Acme GmbH", DE                                                                         |
| CR1           | Open claim of WR1 (EXISTING OR1)                                                                                                |
| CR2           | Approved claim of WR2, active link WR2 to OR1                                                                                   |
| CS1           | Open claim of WS1                                                                                                               |
| CS2           | Approved claim of WS2, active link WS2 to OS1                                                                                   |
| LX            | Cross-provenance ledger row: WR3 linked to OS1. Inserted as the table owner on the old ladder, before the new files are applied |

### Provenance matrix (expected result per cell, after the relevant slice)

"Wrong side" means pointing a staff session at a claim of the other provenance.

| Path                                                          | RC (WR1)                                     | SC (WS1)                                     | RS                                                                 | SS                                                                 |
| ------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1 Customer search "acme"                                      | `[OR1]` only                                 | `[OS1]` only                                 | not applicable                                                     | not applicable                                                     |
| 2 Exact lane, typed "zzz" (profile name and host)             | `[OR1]`                                      | `[OS1]`                                      | not applicable                                                     | not applicable                                                     |
| 3 Candidates, organisation half                               | no candidate field in any answer             | no candidate field in any answer             | on CR1: `[OR1]` (name and host reasons); on CS1: empty             | on CS1: `[OS1]`; on CR1: empty                                     |
| 4 Candidates, workspace half                                  | nothing sent                                 | nothing sent                                 | on CR1: `[CR2/WR2]`; on CS1: empty                                 | on CS1: `[CS2/WS2]`; on CR1: empty                                 |
| 5 Linked-workspace count                                      | nothing sent                                 | nothing sent                                 | OR1 from CR1: 1 (WR2)                                              | OS1 from CS1: 1 (WS2); LX not counted (current main would say 2)   |
| 6 Queue `candidateCount`                                      | nothing sent                                 | nothing sent                                 | CR1: 2 (1 organisation, 1 workspace); CS1 not listed               | CS1: 2; CR1 not listed                                             |
| 7 Review payload `candidates`                                 | nothing sent                                 | nothing sent                                 | CR1: same as rows 3 and 4. CS1: "Company link request unavailable" | CS1: same as rows 3 and 4. CR1: "Company link request unavailable" |
| 8 `decide` approve to the other side's organisation           | not applicable                               | not applicable                               | CR1 to OS1: "That organisation is not in the catalogue"            | CS1 to OR1: "That organisation is not in the catalogue"            |
| 8b Direct insert of a cross `linked` ledger row (table owner) | not applicable                               | not applicable                               | rejected by the ledger guard (new)                                 | rejected by the ledger guard (new)                                 |
| 9 EXISTING filing to the other side's organisation            | OS1: "That organisation cannot be requested" | OR1: "That organisation cannot be requested" | not applicable                                                     | not applicable                                                     |
| 10 Text scan of the whole answer for the other side's names   | no synthetic name                            | no real name                                 | no synthetic legal name or workspace id                            | no real legal name or workspace id                                 |
| 11 Person who owns a real and a synthetic workspace           | search on WR1: `[OR1]`; on WS1: `[OS1]`      | same person                                  | not applicable                                                     | not applicable                                                     |

Row 5 and row 10 must fail on the base commit. That is the bite proof.

### Orphan matrix

| #   | Case                                                                  | Customer search                  | Staff candidates                                        | Queue count     | Approve (staff)                                     | Other expected result                                                                                                                 |
| --- | --------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------- | --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Real claim pointing at a synthetic organisation (fixture, owner role) | not found                        | organisation not listed                                 | excluded        | refused                                             | Review shows `chosenOrganisation` null. Row bytes unchanged                                                                           |
| O2  | Synthetic claim pointing at a real organisation                       | not found                        | organisation not listed                                 | excluded        | refused                                             | Same masking. Row bytes unchanged                                                                                                     |
| O3  | Ledger row whose organisation is later hidden                         | not found (same bytes as a miss) | not listed                                              | excluded        | new approvals refused by the ledger guard           | The linked workspace still sees its own link and name. Revoke still works. A new EXISTING filing is refused with the standard message |
| O4  | Organisation whose public identifier expired                          | not found (same bytes as a miss) | still listed to staff                                   | counted         | allowed (as today; no identifier check in `decide`) | EXISTING filing refused with the standard message. Existing link unchanged                                                            |
| O5  | Claim with a redacted note                                            | not applicable                   | dropped from the workspace half of other claims         | its count drops | not applicable                                      | Its own review and queue row show hidden text and `redacted`. It stays in the closed list                                             |
| O6  | Organisation with no rights record (OR4)                              | found like any other             | listed                                                  | counted         | allowed                                             | Rights read returns "unrecorded". No warning is invented after the fact                                                               |
| O7  | Workspace half after the other workspace redacts (CR2 redacted)       | not applicable                   | CR1 candidates: 1 (was 2); linked count for OR1 still 1 | CR1 count 1     | not applicable                                      | CR2 must be closed first (reject), then redacted. Open claims refuse redaction                                                        |
| O8  | Linked count with a ledger row of another provenance (LX)             | not applicable                   | LX not counted                                          | not counted     | not applicable                                      | LX row hash unchanged after install. WR3 still sees its own link status                                                               |
| O9  | Hidden then shown again                                               | found again                      | listed again                                            | counted         | allowed                                             | Both rows kept in history, in order                                                                                                   |
| O10 | Two hide commands at once on one organisation                         | not applicable                   | not applicable                                          | not applicable  | not applicable                                      | Serialised by the organisation lock. Exactly one row per distinct command id                                                          |

### Empty-answer table (customer search)

| Case                                 | Body has the same keys and values as a miss? | How the test arranges it                                                      |
| ------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------- |
| No match                             | yes (reference answer)                       | Term with no match                                                            |
| Rate limit, 10 minutes               | yes                                          | Fixture attempt rows (10 within 10 minutes); the lookup would otherwise match |
| Rate limit, 24 hours                 | yes                                          | Fixture attempt rows (60 within 24 hours)                                     |
| Organisation in another country      | yes                                          | OR1 with the profile country changed                                          |
| Organisation in the other provenance | yes                                          | OS1 searched by RC                                                            |
| Identifier expired                   | yes                                          | OR2                                                                           |
| Organisation hidden                  | yes                                          | OR3                                                                           |
| Organisation with no rights record   | no, it is returned                           | OR4                                                                           |

Compare the body with `expiresAt` removed, and check `expiresAt` separately (present, within 60 seconds). Also assert the answer keys are exactly `workspaceId`, `expiresAt`, `organisations`, each organisation has exactly `id`, `name`, `country`, there are at most 10 rows, and no total or flag exists. The existing test at `tests/integration/customer-organisation-links.test.ts:433` asserts these keys and must keep passing unchanged.

### Other cases

| Area                       | Cases (positive, denial, recovery)                                                                                                                                                                                                                                                                                              | Suite             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Populated database         | Install on a database holding claims, links, events, receipts and organisations. Hash of every pre-existing row of every link table, `app.organisation`, profile revisions, and of every function outside the replaced list is unchanged. The 8-argument ingest function hash is unchanged                                      | integration       |
| Repeat install             | Second run applies nothing and changes nothing                                                                                                                                                                                                                                                                                  | integration       |
| History mismatch           | Change one applied ladder file's hash in the registry: refused with "Customer real-use migration history mismatch" before any statement runs                                                                                                                                                                                    | integration       |
| Guard drift                | Change the live text of one guarded function: the file aborts with "Real-use prerequisite function differs: <name>" and nothing is applied                                                                                                                                                                                      | integration       |
| Direct SQL denial          | The runtime and auth logins cannot select, insert, update or delete any new table, and cannot call any new private helper                                                                                                                                                                                                       | integration (RLS) |
| Customer roles             | Owner and admin search; member, outsider, revoked, disabled and signed-out denied; expired proof denied; a forged workspace id denied                                                                                                                                                                                           | integration       |
| Staff roles                | Reviewer of the intake tenant with fresh MFA only. Operator, viewer, other tenant, stale MFA denied. Redaction also denies a reviewer who is not owner or admin                                                                                                                                                                 | integration       |
| Rate limit                 | 10th search in 10 minutes allowed, 11th empty; 60 per 24 hours; fixture rows older than a window stop counting; counts span two of the person's workspaces; no term is stored (scan the table)                                                                                                                                  | integration       |
| Rate-limit race            | Two parallel searches with 9 counted rows: exactly one runs the lookup, the other gets the empty answer, final count is 10                                                                                                                                                                                                      | integration       |
| Exact lane                 | Profile name match with typed junk; host match with and without `www.`; typed address as host; typed term of fewer than 3 letters after normalising does not take the exact lane; `%%%` returns empty; exact results come first; duplicates removed; total capped at 10                                                         | integration       |
| Wrapper                    | Each source type stores its defaults and warnings; unknown and missing type store `other`; name with no legal-form word adds `personal_name_check`; a failure after the ingest call leaves no organisation, identifier, source row or rights row; never refuses a call the 8-argument function accepts                          | integration       |
| Rights adjust              | Version 2 needs a reason; history kept; wrong tenant denied                                                                                                                                                                                                                                                                     | integration       |
| Suppression                | Hide and show; reason and reference mandatory; same command id returns the original, other content conflicts; staff authority and MFA enforced; event payload has ids, version and state only                                                                                                                                   | integration       |
| Redaction                  | Open claim refused; closed claim redacted; every reader masks (customer state, command replay, review, queue); exact retry after redaction returns the masked view; update and delete on the table rejected; an active link survives with name, country and label, reason hidden; event payload has ids, version and state only | integration       |
| Real evidence URL          | A real tenant accepts `https://acme-gmbh.de/about` end to end. A synthetic tenant still refuses it. The old `.test` URL still works. A URL with `@` or whitespace is refused for both                                                                                                                                           | integration       |
| Event privacy              | Scan every new event payload for the note, statement, url, reason and reference text: none present                                                                                                                                                                                                                              | integration       |
| Workflow inputs            | `tests/workflow-inputs.test.mjs` passes unchanged; input count 25                                                                                                                                                                                                                                                               | unit              |
| Operator and UX            | Existing operator screen test renders masked text and the `redacted` marker. No new screen, so no new UX gate                                                                                                                                                                                                                   | operator          |
| Denial and recovery states | Stale profile version refused; exact retry returns the original answer; conflicting command id conflicts; redacted-then-retried claim shows the masked view; a limited customer sees the neutral list and can retry after the window                                                                                            | integration       |
| Preserved baseline         | `customer-organisation-links.test.ts` and `real-customer-modules.test.ts` pass with no assertion changed. A fixture change (a second actor) is allowed if an old test would cross the search cap. Check the search count per actor before building                                                                              | integration       |

Measurable pass line: zero cross-provenance rows in any search or candidate output across the matrix; at most 10 rows in any answer; workflow input count still 25; every pre-existing row unchanged by hash on a populated database.

## 6. Owner steps, in order

1. Review and merge the docs PR (slice 0).
2. For each build slice 1 to 4: review and merge the PR. The owner merges because each holds a migration. Builds never migrate.
3. Protected install: run the install workflow with `apply = yes` and `real_use_action = install`, everything else unchanged. This is the existing path. It only migrates; it neither enables nor pauses (`scripts/install-customer-modules.ts:378-389`). The owner can install after each slice or once after slice 4. No new workflow input is used.
4. Observe: read the run log for the applied file names, check `customer_real_use_migrations.applied` shows the new names with their hashes, read the notice from slice 1 (cross-provenance ledger rows), and confirm the customer link route still answers "unavailable" with the flag OFF. No data is changed by observing.
5. Separately, later: the flag decision. It is not part of Phase 1 and needs, at least: real sources named and vetted by the owner, rights defaults reviewed, staff trained to use warnings, suppression and redaction, the production values of the real-use switches observed (KI-41), and real-session acceptance of the whole flow.

Nothing in these steps is performed by this design.

## 7. Branch rule

The branch count stays below 9 ("always keep the branch count below 9", ledger, 3 November). One branch per slice, in order, deleted after merge. The branch budget check (`node scripts/check-git-branch-budget.mjs`) reported 7 distinct branches before this docs branch was pushed, against a cap of 8, so there is little room. No slice may be started while 9 or more exist, and the check runs before each push.

## 8. Phase 2 list (left out of Phase 1, with a reason)

| Left out                                                                 | Reason                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Automatic registry import or provider lookup                             | Needs vetted sources and licence review. Provider activation is a closed gate |
| Bulk catalogue operations; acting on review-by dates; re-verification    | Needs the rights-policy design (V3-05-043)                                    |
| Licensed datasets and use of `app.data_rights_policy`                    | Strict policy and legal review                                                |
| Customer-initiated unlink                                                | OD5: staff revoke only                                                        |
| File evidence                                                            | OD2: wait for the scanner                                                     |
| Redaction of profile revisions                                           | Belongs to the ADR-044 profile module                                         |
| Staff screens for warnings, suppression, redaction and rights adjust     | MISSING in the UI; Phase 1 builds the functions and service routes only       |
| Email or notice of a decision                                            | Outreach is a closed gate                                                     |
| Sharing a linked identity with counterparties; portfolio use (V3-06-011) | V3-06-011 stays PARTIAL; the real catalogue is a prerequisite                 |
| Automatic creation of canonical organisations                            | Customer text never writes to `app.organisation`                              |
| Pruning of the attempts table                                            | Needs the owner's retention decision                                          |
| Staff queue and review while the customer flag is OFF                    | Not needed while the flag has never been ON                                   |
| Legal review of rights defaults and of any licensed dataset              | Counsel work                                                                  |
| Production enable and real-session acceptance                            | A separate owner decision after install and observation                       |

## 9. Facts this plan relies on, re-read at the base commit

| Fact                                                                                                       | Where                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The ladder migrator is multi-file, hashes each file, refuses a changed one, takes the global advisory lock | `packages/db/src/customer-real-use-migrate.ts:55-85` (refusal at 73, lock at 60)                |
| The link migrator accepts exactly one file and hash                                                        | `packages/db/src/customer-organisation-link-migrate.ts:31`                                      |
| The ladder runs the link module before its own files                                                       | `customer-real-use-migrate.ts:45`                                                               |
| Eight other installers call `migrateCustomerRealUse` first                                                 | `rg migrateCustomerRealUse packages/db/src`                                                     |
| `real_use_action = install` only migrates                                                                  | `scripts/install-customer-modules.ts:378-389`; `.github/workflows/install-customer-modules.yml` |
| The installer workflow has exactly 25 inputs; the guard test enforces it                                   | KI-25; `tests/workflow-inputs.test.mjs:13`                                                      |
| The customer search route already applies a per-IP budget                                                  | `apps/web/app/api/customer-organisation-links/route.ts:47`                                      |
| The only call site of the 8-argument ingest function                                                       | `packages/counterparties/src/index.ts:282`                                                      |
| `synthetic_context()` depends on `corridra.customer_workspace_id`, set by the profile role check           | `0002_real_request_authority.sql:10-12`, `:586`                                                 |
| Staff review and the queue already filter claims by provenance; candidates do not                          | `0003:198`, `0005:25`; `0001:228-260`                                                           |
| The evidence url CHECK is not provenance-aware                                                             | `0001:62`; `0003:1187`; `0003:2643-2647`                                                        |
| The existing customer screen has an empty-result sentence                                                  | `apps/web/app/account/profile/company-link.tsx:586`                                             |
| `app.data_rights_policy` is strict and per tenant                                                          | `packages/db/migrations/0022*.sql:2-9`                                                          |

Corrections to earlier assumptions found while re-reading: (1) the stored result of a customer command contains the text, so the command function must be replaced for a masked retry; (2) the packet's wording for an empty search ("No match. Check the legal name and country, or ask us to add it") is new copy, while the screen already has a sentence, so the default here is to keep the existing sentence; (3) the account-lifecycle staff authority is in an optional module, so redaction uses the link staff authority plus owner or admin; (4) review and customer state also print organisation names beside a claim or link, so they follow the same rule; (5) installing any of eight other optional modules also applies the new ladder files.
