# ADR-079: Real company linking, Phase 1

Status: DESIGN ONLY. Designed, nothing else. Nothing is implemented, tested, deployed, enabled, approved or live. No SQL, application code, migration, installer change, workflow input or switch change is part of this record. `CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED` stays OFF. This ADR amends [ADR-052](0052-canonical-organisation-linking.md) forward. ADR-052 is not edited here beyond a one-line pointer added by the index owner.

Authority: Authority Brief stamp `auth-c36160a85b5b`, base commit `104c9058` (branch `company-linking-phase1`). The phase plan, matrices and slice list are in [company-linking-phase1](../revamp/specs/company-linking-phase1.md).

## Owner decisions in force (relayed by S17, 10 November 2026)

These are not yet in the ledger. They are quoted as relayed.

- Scope: "Phase 1 now."
- Search: "1 & 2 in the best way possible". Read here as: combine exact match (legal name plus country, or website host) with name search (3 or more letters, same country, 10 rows at most), plus anti-enumeration safeguards.
- Source rights: "2+in better and faster way, not too much rigidity like 1". Read here as: no hard block. A lightweight rights record is captured at ingestion with defaults by source type. Warnings, not refusals.
- Erasure: "Redact by new record (Recommended)".
- Defaults that stand unless the owner overrides: OD3 self-declared (a link means "reviewed by staff from evidence supplied", never verified); OD5 staff revoke only (no customer unlink); OD2 wait for the scanner (text evidence only).

Other standing rules this design obeys: the owner merges any pull request that holds a migration or installer change; production installs are protected, owner-approved runs; closed gates D01 to D06 and D08, outreach, AI inference, payments and external sharing stay closed; the branch count stays below 9.

## Context

ADR-052 built claims, evidence, staff review and a link ledger. It is synthetic only and flag-off. ADR-056 later made real admission possible, and the real-use ladder (`packages/db/customer-real-use-migrations`) made claim filing, review and decision provenance-aware. Three things are still synthetic only or unsafe once real data exists. All were re-read in source at the base commit.

| #   | Fact                                                                                                                                                                                                                                                                                                         | Source                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Customer search returns only synthetic organisations: the search clause is `o.synthetic AND o.country=... AND lower(o.name) LIKE ... AND ..._public_organisation(o.id)`. No later migration replaces it.                                                                                                     | `customer-organisation-link-migrations/0001_canonical_organisation_links.sql:347-363` (clause at 359)                                                                                                                           |
| 2   | Staff candidates, organisation half, read `FROM app.organisation o WHERE o.synthetic`. A real claim is offered synthetic organisations and never real ones.                                                                                                                                                  | `0001:243`                                                                                                                                                                                                                      |
| 3   | Staff candidates, workspace half, list other workspaces' claims with legal name, workspace id and state, filtered only by `x.tenant_id<>c.tenant_id` and state. No provenance filter. A real reviewer can see synthetic workspaces' legal names and the reverse. The review payload returns it.              | `0001:245-258`; used by the queue count at `customer-real-use-migrations/0003_real_customer_modules.sql:205` and the review at `0005_real_staff_scope.sql:51`                                                                   |
| 4   | The linked-workspace count reads ledger rows across all tenants. It stays inside one provenance today only because `decide` checks provenance before it writes (`0003:121`, `0003:134`). The count does not check.                                                                                           | `0001:241-242`; `0003:140-141`                                                                                                                                                                                                  |
| 5   | The evidence `url` column has an inline CHECK that allows only hosts ending `example`, `test` or `invalid`. The real-use ladder replaced the statement and note CHECKs but not this one, while the replaced command function accepts any `https` URL without `@` in real context.                            | CHECK at `0001:62`; replaced constraints `0003:2643-2647`; function rule `0003:1187`. The real test uses `https://business.test/catalogue`, which hides the defect (`tests/integration/real-customer-modules.test.ts:549-585`). |
| 6   | The customer context is not a parameter. `customer_private.synthetic_context()` reads session settings. For a real customer session it is the provenance of the workspace in `corridra.customer_workspace_id`, which is set as a side effect of `customer_private.organisation_profile_role(target, actor)`. | `0002_real_request_authority.sql:10-12`, `:575-586`                                                                                                                                                                             |
| 7   | Real ingestion exists: `app.ingest_public_organisation` (8 arguments) is staff only, needs a current PUBLIC `public_record` source, writes the organisation, one public identifier and one organisation-source row. Its only call site is `packages/counterparties/src/index.ts:282`.                        | `0003:717-733`; `0007_real_private_contacts.sql:5-7` (domain check)                                                                                                                                                             |
| 8   | The module stores each customer command's full request and result JSON. Customer text also lives in claim note, evidence statement and url, event reason and internal note, and the profile revision legal name shown to staff. No other code reads these tables.                                            | `0001:88-95`; readers found only in `0001`, `0003`, `0005` and the two integration tests                                                                                                                                        |
| 9   | `app.data_rights_policy` exists but is strict (licence, jurisdictions, processing locations, transfer status, retention, per-tenant source).                                                                                                                                                                 | `packages/db/migrations/0022*.sql:2-9`                                                                                                                                                                                          |

[Real-use audit finding 3](../product/real-use-audit-2026-10-24.md) ("company registry search is empty for real workspaces") is evidence only. It is a data question: today there is no real organisation in the catalogue, so even a correct search returns nothing.

Nothing in this design changes ADR-044 (the profile stays self-reported, unverified, `organisationId` null, and customer text never writes to `app.organisation`).

## Decision summary

One forward set of files in the real-use ladder, applied in four slices. Reads first, writes later. Each function is replaced once, with a hash guard. The 8-argument ingest function is not touched. No workflow input is added.

## 1. One shared provenance rule

### Decision

There is one rule, named `same context`. A row may be seen by, matched against, or linked by a session only if the row's own provenance flag equals the session's single context.

It is expressed once, as one SQL helper: `customer_private.organisation_link_same_context(p_row_synthetic boolean)`. It returns true when `p_row_synthetic IS NOT NULL AND p_row_synthetic = customer_private.synthetic_context()`. A missing row flag is false. The row flag is `app.organisation.synthetic` for an organisation, and `app.tenant_is_synthetic(tenant_id)` for a claim, a workspace or a ledger row. Nothing else decides provenance.

Every path calls this helper. None re-writes the comparison.

| Call site                                                                                                                          | Where it is today                                                                              | What changes                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer name search                                                                                                               | `0001:359` literal `o.synthetic`                                                               | Replaced search uses the catalogue-eligibility helper, which calls the rule (below)                                                                                                              |
| Exact match (legal name plus country, website host)                                                                                | new, inside the same search function                                                           | Same eligibility helper                                                                                                                                                                          |
| Catalogue eligibility helper `organisation_link_public_organisation`                                                               | `0003:2275-2283` already compares `o.synthetic=synthetic_context()`                            | Replaced once: calls the rule, keeps the identifier-validity test, adds "not suppressed". Used by search, exact match and EXISTING filing                                                        |
| EXISTING filing check                                                                                                              | `0003:1218` calls the eligibility helper                                                       | Function unchanged for this reason. It inherits the new helper. A suppressed or other-provenance organisation reads as "That organisation cannot be requested"                                   |
| Staff candidates, organisation half                                                                                                | `0001:243`                                                                                     | Replaced: `same_context(o.synthetic)` and not suppressed                                                                                                                                         |
| Staff candidates, linked-workspace count                                                                                           | `0001:241-242`                                                                                 | Replaced: only ledger rows with `same_context(app.tenant_is_synthetic(h.tenant_id))`                                                                                                             |
| Staff candidates, workspace half                                                                                                   | `0001:252-258`                                                                                 | Replaced: `same_context(app.tenant_is_synthetic(x.tenant_id))` and the claim is not redacted                                                                                                     |
| Staff candidates, claim guard                                                                                                      | none                                                                                           | Replaced: if the claim's own tenant fails the rule, return empty lists                                                                                                                           |
| Queue `candidateCount`                                                                                                             | `0003:205` calls candidates; queue rows are already filtered at `0003:198`                     | Gets the fix by calling the replaced candidates. The queue is replaced once, only to mask a redacted legal name (decision 4)                                                                     |
| Review payload `candidates`                                                                                                        | `0005:51` calls candidates; the claim lookup is already filtered at `0005:25`                  | Same: inherits. Replaced once only for masks                                                                                                                                                     |
| Organisation names shown beside a claim or link (review `chosenOrganisation` and `activeLink`, customer state `target` and `link`) | `0005:37-39`, `0005:33-36`; `0003:2322-2323`, `0003:2348`                                      | Replaced with the same readers: an organisation object is shown only when `same_context(o.synthetic)`; otherwise it is null and the status is unchanged. Covers an existing cross-provenance row |
| Approve check in `decide`                                                                                                          | `0003:134` inline `o.synthetic=synthetic_context()`; claim lookup `0003:121`; count `0003:140` | `decide` is not replaced. Its inline test equals the rule. The database now also enforces it (next row)                                                                                          |
| Ledger guard (trigger on the link ledger)                                                                                          | `0001:135-148`, no provenance test                                                             | Replaced: a `linked` row must have `organisation.synthetic = app.tenant_is_synthetic(NEW.tenant_id)` and the organisation must not be suppressed. Backstop for every writer                      |

Which context wins. The session's context wins, and there is no second side. A real reviewer sees only real claims, real workspaces and real organisations. A synthetic reviewer sees only synthetic ones. A real customer session on a real workspace searches only real organisations; on a synthetic workspace it searches only synthetic ones. This replaces today's behaviour where a real claim is offered synthetic organisations.

One session has exactly one context. The helper has no argument for context. It reads session settings that are set once per request. For a customer, `customer_private.organisation_profile_role(target, actor)` sets the workspace and therefore the context. The build must call the rule only after that role check has authorised the target (as `organisation_link_search` does at `0001:352`), and a test must prove the context follows the authorised workspace when one person owns both a real and a synthetic workspace.

Existing rows. No existing row is altered. A cross-provenance ledger row, claim or organisation link, if one exists (none is expected: `decide` has enforced equality since `0003`), keeps its bytes. It simply stops appearing in search, candidates, counts and queue counts. The workspace that holds such a link still sees its own link status, because that status reads that workspace's own row. The install reports the number of cross-provenance ledger rows as a notice, and never blocks on it.

### Rejected options

| Option                                            | Reason                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filter only in the UI or the service              | Names and workspace ids would already be in the database answer and in the JSON. A bug or a second caller would leak them. Isolation has to hold in SQL. |
| Rely on `decide` to keep the two sides apart      | `decide` guards writes only. The count, candidates, queue and review read without it, and that is exactly where the leak (fact 3) is.                    |
| Repeat the comparison inline at each call site    | Many copies drift. One helper is hash-guarded and tested once.                                                                                           |
| A provenance column on the claim or ledger tables | Those tables are append-only and the value is already derivable from the tenant. A second copy could disagree.                                           |
| Separate tables or schemas per provenance         | Large rewrite of a working module. It buys nothing the one rule does not.                                                                                |
| Let a reviewer see both sides with a label        | This is the leak. Real legal names must not reach a synthetic session and the reverse.                                                                   |

### Blast radius

- Auth: no role, grant or login changes. A reviewer sees fewer rows, never more. One new helper, no grant to the runtime or auth logins.
- RLS: no policy on an existing table changes. The ledger guard is a trigger function, replaced under a hash guard.
- Migration history: adds a file to `customer_real_use_migrations.applied`. No existing file or hash changes.
- Events: no new event. A staff decision that the ledger guard refuses writes nothing (the whole transaction rolls back, so no half event).
- Money: none.
- Rollback: additive SQL is not undone. Back out by a new forward file that restores the previous function text (known in git, hash known). With the flag OFF nothing customer-facing is reachable meanwhile.

## 2. The real organisation source and the lightweight rights record

### Decision

Phase 1 adds no registry import, scrape, API call or provider. Real organisation rows come only from staff ingestion through the existing path. Until the owner names real sources and who vets them, the real catalogue is empty, and real search returns nothing. That is today's state, stated plainly.

Proposed source types (defaults the owner may change). Each type has default rights fields. Which defaults raise a staff warning is shown in the last column.

| Source type (proposed) | Default basis note (staff text, not a legal clearance)        | Default review-by | Default warning                         |
| ---------------------- | ------------------------------------------------------------- | ----------------- | --------------------------------------- |
| `government_registry`  | Public register entry. Register reuse terms not checked here. | 12 months         | none                                    |
| `company_website`      | The company's own public website.                             | 6 months          | none                                    |
| `trade_body_list`      | Member list published by a trade body or association.         | 12 months         | none                                    |
| `event_list`           | Exhibitor or attendee list published for an event.            | 6 months          | none                                    |
| `staff_research`       | Other public research by Corridra staff.                      | 6 months          | none                                    |
| `licensed_dataset`     | Dataset used under a licence. Licence terms not checked here. | 12 months         | `licence_not_checked` (always raised)   |
| `other`                | Source not classified.                                        | 3 months          | `source_not_classified` (always raised) |

A second warning applies to every type: `personal_name_check`. It is raised when the company name contains no legal-form word from the existing name list (the words removed by `customer_private.organisation_link_name_key`). The name may then be a sole trader, which is personal data. It is a prompt to look, not a judgement. An unknown or missing source type is stored as `other`.

The rights record. A new append-only table `customer_private.organisation_source_rights` (purpose: one row per version per organisation) holds source type, basis note, a personal-name flag, warnings, a review-by date, the staff tenant and source record it came from, the staff actor, and a reason (required from version 2). Staff may adjust it by appending a new version through a staff function. The latest version is the current one. Nothing is updated.

Written in the same transaction as ingestion. A new wrapper `app.ingest_public_organisation_with_rights` (the eight existing arguments plus a source type) calls the unchanged 8-argument `app.ingest_public_organisation`, then appends version 1 of the rights record. One function call is one atomic step: the organisation, its identifier, its source row and its rights row exist together or not at all. The wrapper returns the new organisation id and the list of warnings, to staff only. The 8-argument function is not replaced, not re-hashed and keeps its signature. Its one call site (`packages/counterparties/src/index.ts:282`) moves to the wrapper in the build, with a feature check so staff ingestion keeps working in an environment where the wrapper is not installed yet.

Never refuses. The wrapper has no rule that can reject: unknown source type falls back to `other`, defaults are fixed text, and it adds no check the 8-argument function does not already make. It never changes who sees an organisation in customer search. An organisation with no rights record (made by a direct call to the 8-argument function) is still searchable and is treated as `other`, `unrecorded`, for staff display.

The one exception to "never changes visibility" is an explicit suppression record (the takedown safety valve for warnings-not-refusals). A new append-only table `customer_private.organisation_suppression` holds `hidden` and `shown` rows per organisation, each with a reason, a request reference and the staff actor. The latest row decides. A hidden organisation is not returned by customer search or exact match, cannot be filed against, is not offered as a staff candidate, and cannot be newly linked (the ledger guard refuses). History and existing links are kept: a workspace already linked still sees its own link. Authority is the existing link staff authority (`customer_private.organisation_link_staff()`: owner, admin or reviewer of the intake tenant with fresh MFA). It takes the same organisation lock `decide` uses (`0003:138`), so a hide and an approval cannot interleave.

Not `app.data_rights_policy`, and V3-05-043 stays PARTIAL. The rights record is a defaults-based note. It is not a licence, jurisdiction, transfer or retention decision, and it does not satisfy, replace or close V3-05-043. It makes no legal clearance claim. Review-by dates are recorded and nothing acts on them in Phase 1.

### Rejected options

| Option                                               | Reason                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Require `app.data_rights_policy` before ingestion    | It is the rigid option the owner declined. It asks for licence, locations and transfer status per source, and would stop ingestion. It stays the route for V3-05-043 and a licensed dataset (Phase 2). |
| Hard block when the source type is unclear           | Owner: warnings, not refusals. A block pushes staff to pick a wrong type to get past it.                                                                                                               |
| Free-text note on `app.source_record`                | Not queryable. No warning list, no history of adjustments.                                                                                                                                             |
| New columns on `app.organisation`                    | A global table with no rewrite trigger. Editing it is outside this module's authority and would not be append-only.                                                                                    |
| Replace the 8-argument ingest function               | A hash-guarded core function with one caller. A wrapper gives the same result with no change to it.                                                                                                    |
| Let the rights record hide organisations from search | A default-driven note would silently hide companies. Hiding must be an explicit staff act with a reason (suppression).                                                                                 |
| Automatic import or provider lookup                  | Out of scope (Phase 2). It needs a vetted source and a licence review.                                                                                                                                 |

### Blast radius

- Auth: no new role. Ingest authority is the existing one inside the unchanged function. Rights adjust and read use the same ingest roles (owner, admin, operator of the ingesting tenant). Suppression uses the existing link staff authority. No grant to the runtime or auth logins on any table.
- RLS: two new tables, row security on, no policy and no grant, `app.reject_rewrite()` on update and delete. No existing policy changes.
- Migration history: adds a ladder file. The wrapper is a new function. No hash guard is needed for the 8-argument function because it is not touched.
- Events: no event for a rights row (the row names the actor and time, like ingestion today). One event chain for each suppression change (`customer.organisation_catalogue.*`), payload ids, version and state only, never the reason or the reference.
- Money: none.
- Privacy: sole-trader names are personal data in a global table that is readable by the runtime role. Suppression hides a name from customers. It does not remove it from `app.organisation`.

## 3. Combined search with anti-enumeration

### Decision

`customer.organisation_link_search(uuid, text)` is replaced. The signature and the answer shape stay exactly `{workspaceId, expiresAt, organisations:[{id,name,country}]}`. The existing route and its per-IP request budget (`apps/web/app/api/customer-organisation-links/route.ts:47`) stay as the outer layer.

Order inside the function:

1. Existing checks, unchanged: signed in, writer role on the target (this also fixes the context), term 3 to 80 characters with no control characters, saved profile with a country. These raise errors. They say something about the caller, not the catalogue.
2. Take an advisory lock for the actor.
3. Count the actor's own rows in the attempts table. If the count is at or over a cap, skip the lookup and answer with the empty list. Nothing is inserted.
4. Otherwise insert one attempt row (actor id and time only), then run the lookup.
5. Exact lane first, then name lane, then de-duplicate by id, then at most 10 rows in total.

Lookup lanes. Exact lane: the same-country, eligible organisations whose normalised name equals the normalised legal name from the saved profile; or whose public identifier host (without `www.`) equals the saved profile website host; or whose normalised name equals the normalised typed term (at least 3 letters after normalising); or, when the typed text looks like a web address, whose identifier host equals it. Name lane: the existing case-insensitive "contains the term" test. Only organisations that pass the eligibility helper count (same context, current identifier, not suppressed). The caller's own country is always the filter. A term that normalises to fewer than 3 letters never takes the exact lane. The answer has no lane label, no total, no "more results" flag and no reason.

Rate limit. Per actor (the person), across all their workspaces. Caps are 10 searches in a rolling 10 minutes and 60 in a rolling 24 hours. Both are defaults the owner may change. They are constants in the replaced function. Changing them is a new hash-guarded replacement, not a settings table. The count reads the actor's own rows in `customer_private.organisation_link_search_attempt`: `id`, `actor_id`, `created_at`, and nothing else. No term, no result, no workspace, no foreign key, so account closure and erasure are never blocked by it. It is append-only (`app.reject_rewrite()`). Retention: rows are kept. The growth is bounded at 60 rows per person per day. Pruning needs the owner's retention decision and is Phase 2. The advisory lock makes count-then-insert atomic per person, so two parallel searches at the cap cannot both pass.

What yields the identical empty answer:

| Cause                                       | Same bytes? | Note                                                  |
| ------------------------------------------- | ----------- | ----------------------------------------------------- |
| No match                                    | yes         |                                                       |
| Rate limit reached (10 minutes or 24 hours) | yes         | The function returns, it does not raise               |
| Organisation is in another country          | yes         |                                                       |
| Organisation is in the other provenance     | yes         |                                                       |
| Public identifier expired                   | yes         |                                                       |
| Organisation suppressed                     | yes         |                                                       |
| Organisation has no rights record           | no          | It is returned like any other. The record never hides |

"Same bytes" means the body has the same keys and values in the same order, with `expiresAt` computed the same way in every branch. `expiresAt` itself changes with the clock, so tests compare the body with that value removed and check it separately.

Neutral message. The customer never sees a reason. The existing screen already shows "No listed company matches. Try another word, or choose the other option." (`apps/web/app/account/profile/company-link.tsx:586`). Phase 1 keeps that sentence and builds no screen. A limited customer sees it too, and can retry after the window.

Honest limits, stated and not hidden:

- No timing guarantee. A limited answer skips the lookup and is faster than a miss. That reveals only that this person is limited. All catalogue causes (miss, country, provenance, expiry, suppression) run one statement, but equal time is not promised.
- Sybil accounts are mitigated, not removed. A real session needs a verified email, and the per-IP budget still applies. Someone with many verified emails can still read about 600 rows per account per day (60 searches, 10 rows).
- The profile is self-reported and its country and website can be edited by a workspace owner or admin. Each edit is a new revision. So the "same country" filter and the website-host match can be steered by a determined person. The caps limit how fast. They do not stop it. Names found are public-record names.
- The route's per-IP budget error is a different answer from the neutral empty list. It tells nothing about the catalogue.
- No search or error path names another workspace, a claim or a count.

### Rejected options

| Option                                                         | Reason                                                                                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact match only                                               | Owner asked for both. A typo or a renamed company finds nothing.                                                                                                                   |
| Name search only (ADR-052 as built)                            | Misses the same company under another spelling or name when the website matches. Owner asked for both.                                                                             |
| Prefix, fuzzy or trigram search                                | More matches per query means faster enumeration. Trigram needs an extension not assumed here.                                                                                      |
| Per-IP limit only                                              | Shared by an office, forged or rotated. The person is the right unit. The IP budget stays as the outer layer.                                                                      |
| Reuse `customer.real_request_budget` / `app.intake_rate_limit` | It is an upserted hourly counter keyed by a hash and accepts only the maxima 120 and 10000 (`0004_real_request_budgets.sql:6`). It is not append-only and cannot carry these caps. |
| Store the search term for review                               | Search terms about companies are sensitive and would add a new store of customer text.                                                                                             |
| Show "try again later" when limited                            | It tells an attacker the limit was hit and separates the answer from a miss. Open owner choice 3 records the alternative.                                                          |
| Return a total count or "more results"                         | It is an enumeration oracle.                                                                                                                                                       |
| CAPTCHA or an external service                                 | A new third party. Out of scope.                                                                                                                                                   |

### Blast radius

- Auth: the writer-role check and customer identity are unchanged. The function stays SECURITY DEFINER and VOLATILE (it now writes). No grant change: the existing grant to the runtime login survives `CREATE OR REPLACE`.
- RLS: one new table, row security on, no policy, no grant.
- Migration history: one ladder file. Hash guard on the exact 0001 text of the search function (never replaced before).
- Events: none. An attempt row is not a domain event.
- Money: none.
- Privacy: one new store of pseudonymous actor id plus time. No customer text.

## 4. Erasure by a redaction record

### Decision

Customer text on a claim can be hidden by a new append-only record. No row of the immutable tables is changed or deleted.

Scope. One redaction record hides, for one claim, all of: the claim note; every evidence statement and url; every event `reason` and `internal_note`; the stored request and result JSON of the claim's customer commands (the receipts); and the legal name, website and summary of the profile snapshot as staff see it in the queue and the review. Redaction is all or nothing for a claim. It does not redact the profile revision itself (ADR-044 module, Phase 2), and it is not how a catalogue organisation is hidden (that is suppression, decision 2).

Readers mask. Every reader that returns this text is replaced once to return a fixed marker instead: customer link state (`organisation_link_state`), staff review, staff queue, and the customer command replay branch (an exact retry would otherwise return the stored original result, which contains the text). The replay branch of a redacted claim returns the current, masked state. Staff candidates drop a redacted claim from the workspace half. Ids, states, times, versions, the ledger and the domain events are kept. The only code that reads these tables is in the files listed in fact 8, so the replaced readers are the complete set. No export of this data exists in source today.

Honest wording. The customer and staff are told the text is "hidden from every screen and export". It is never called "deleted". The bytes stay in the immutable tables, in the stored receipts, in the derived matching keys (`name_key`, `host_key`) and in backups. Removing the bytes is a different design (see Rejected) and needs its own decision.

Who may redact. Staff with the link staff authority (`customer_private.organisation_link_staff()`) who are owner or admin, with fresh MFA, in a session that obeys KI-41 (`CORRIDRA_REAL_USE_ENABLED=true`, lifecycle and real-use configuration on). A reason and a request reference (the erasure request or ticket, 3 to 120 characters) are mandatory. The reference is free text on purpose: the privacy-queue module is optional and Phase 1 does not depend on it. The staff route for redaction is not behind the customer link flag, so an erasure request can be completed after the customer flag is paused. A redaction is irreversible by design. There is no "show again" record, because that would let erased text come back.

A claim that is still open (pending, needs evidence, approved for creation) cannot be redacted. Staff first reject it with a reason using the existing decision, then redact. This keeps one writer of claim state. The same command from the same staff returns the original answer; the same command id with other content conflicts.

Effect on candidates. A redacted claim drops out of the workspace half of other claims' candidates, and out of the queue and review counts. An organisation's linked-workspace count still counts a redacted claim's active link, because the count carries no text.

An active link whose claim is redacted. The link stays. The customer sees status "approved", the organisation name and country, the existing label, and the reviewed profile version. The staff reason for the approval and all the claim text show as hidden. A staff revoke (OD5) still ends the link and is a separate decision.

The event for a redaction carries ids, version and state only, never the reason or the request reference.

### Rejected options

| Option                                          | Reason                                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update the text columns to null                 | Every link table has `app.reject_rewrite()`. It would break the append-only rule the whole module rests on.                                                             |
| Physical delete                                 | Breaks foreign keys, the event chain and the ledger. "Deletion without manifest and guardian PASS" is a closed gate.                                                    |
| Crypto-shredding (encrypt text, drop the key)   | No key management exists in this module. A new security system is a larger decision than Phase 1.                                                                       |
| Redact a copy of the tables                     | Two sources of truth. The original stays readable.                                                                                                                      |
| Redact per field                                | More states to test and explain. All-or-nothing is the honest scope of a removal request.                                                                               |
| Allow reveal of a redaction                     | Defeats the purpose.                                                                                                                                                    |
| Depend on the account-lifecycle staff authority | That module is optional and may be absent. Calling a missing function would fail at run time. The link staff authority plus owner or admin is the same strictness here. |
| Do nothing                                      | G5: erasure is a request staff must complete within the legal deadline, keeping the records the law requires.                                                           |

### Blast radius

- Auth: no new role. Owner or admin of the intake tenant with fresh MFA, inside the existing staff gates. The new function is granted to the runtime login like the other staff functions. Table has no grant.
- RLS: one new table, row security on, no policy, no grant, `app.reject_rewrite()`. No existing policy changes.
- Migration history: readers are replaced in slice 1 and the writer is added in slice 4, so each function is replaced once. All under hash guards.
- Events: one event, audit and outbox chain per redaction, `customer.organisation_link.redacted`, ids, version and state only.
- Money: none. Invoices and signed decisions are outside this module and unaffected.
- Rollback: a redaction cannot be undone. A bad deployment of the writer is backed out by a forward file. Rows already written stay.

## 5. Shipping as forward migrations

### Decision

Option A: new files in the real-use ladder, `packages/db/customer-real-use-migrations`, numbered from the next free number at build time (the ladder ends at `0012`). Four files, one per slice (decision 6 and the spec). The multi-file migrator is unchanged: it reads every `.sql` file, hashes each, refuses a changed or missing applied file with "Customer real-use migration history mismatch" (`packages/db/src/customer-real-use-migrate.ts:73`), takes the global advisory lock `corridra:migrations` (`:60`), applies only unapplied files in one transaction and records name and SHA-256 in `customer_real_use_migrations.applied`.

| Option                                                  | Verdict  | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. New ladder files                                     | Chosen   | The new SQL depends on `customer_private.synthetic_context()` (ladder `0002:10`), on the post-`0003` and post-`0005` function texts it replaces, and on the link tables. The ladder runs after the link module, so all of that exists. No migrator, registry, workflow or installer change. It is the precedent for hash-guarded `CREATE OR REPLACE` (`0003`, `0005`). Ladder `0001` already creates tables, so tables are allowed.                                                       |
| B. New module folder with its own migrator and registry | Rejected | It would work (precedents: programme lifecycle, participant labels, response revision), but it needs a new migrator, a new registry name in `scripts/install-customer-modules.ts:255-300`, an installer branch, a 13th choice on `field_modules_action`, workflow mapping and tests. All of that is owner-merged risk with no benefit, because the replaced functions only make sense at exact ladder states.                                                                             |
| C. Extend the single-file link migrator                 | Rejected | `customer-organisation-link-migrate.ts:31` throws on any applied row whose name or hash differs from its one file, so a second file breaks every installed environment unless the migrator is rewritten. It also runs before the ladder (`customer-real-use-migrate.ts:45`): `synthetic_context()` does not exist yet on a fresh install, and replaced function texts would break the ladder's own guards (for example `0003:2274` expects the exact 0001 text of `public_organisation`). |
| D. Edit `0001`                                          | Rejected | It changes the file's SHA-256. Every installed environment then refuses to install ("Customer organisation-link migration history mismatch"). It also breaks the additive-only rule and the ladder guards.                                                                                                                                                                                                                                                                                |

Slices and files (detail in the spec). Slice 1 holds every read side: the rule, the eligibility helper, empty suppression and redaction tables with their yes/no helpers, the replaced candidates, queue, review, state and command, the ledger guard and the url CHECK. Slice 2 adds the rights table, the ingest wrapper and the suppression writer. Slice 3 adds the attempts table and the replaced search. Slice 4 adds the redaction writer. Readers come first so each function is replaced once and can be tested with fixture rows before any writer exists.

Challenge to the packet default. The default A stands. The only reason found to prefer B is dependency isolation, and A already gets that from ladder order.

A side effect to say out loud. Eight other optional installers call `migrateCustomerRealUse` first (for example mission mail, response revision, billing real, move records, reply review). Installing any of them applies unapplied ladder files too. This is how every ladder file already behaves. It is acceptable here because the flag is OFF and nothing in the files is customer-reachable (below).

The url CHECK defect (fact 5) is fixed in the first file. The file drops `organisation_link_evidence_url_check` and adds it back conditional on provenance, as `0007` did for `public_identifier.domain` (`0007:5-7`). Synthetic tenants keep the exact current expression; real tenants allow `https://` plus any characters except whitespace and `@`, at most 200 characters, the same as `0003:1187`. It uses `app.tenant_is_synthetic(tenant_id)` on the row, so it does not depend on session settings. It is guarded by a hash of the live constraint definition. Existing rows all satisfy the old, narrower rule, so re-adding the check validates and passes. Tests include a real host such as `https://acme-gmbh.de/about`, and a case with the old `.test` host.

Hash guards by purpose, one per replaced object (exact hashes are computed by the builder from a clean install at the base commit and written into the file; none is invented here):

| Replaced object                                                | Purpose                                          | Text the guard expects         |
| -------------------------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| `customer_private.organisation_link_candidates(uuid)`          | provenance, suppression, redaction in candidates | `0001` text (never replaced)   |
| `customer_private.organisation_link_public_organisation(uuid)` | catalogue eligibility                            | post-`0003` text (`0003:2275`) |
| `customer_private.organisation_link_ledger_guard()`            | database backstop for provenance and suppression | `0001` text (`0001:135`)       |
| `customer_private.organisation_link_state(uuid,boolean)`       | mask in customer state                           | post-`0003` text (`0003:2307`) |
| `app.customer_organisation_link_review(uuid)`                  | mask in staff review                             | post-`0005` text (`0005:15`)   |
| `app.customer_organisation_link_queue(text,uuid,integer)`      | mask in staff queue                              | post-`0003` text (`0003:180`)  |
| `customer.organisation_link_command(uuid,text,jsonb)`          | masked replay                                    | post-`0003` text (`0003:1151`) |
| `customer.organisation_link_search(uuid,text)`                 | combined search and rate limit                   | `0001` text (`0001:347`)       |
| constraint `organisation_link_evidence_url_check`              | real evidence URL                                | `0001` inline definition       |

Not replaced: `app.customer_organisation_link_decide` and `app.ingest_public_organisation` (8 arguments). Every guard raises "Real-use prerequisite function differs: <name>" and aborts the transaction, so a changed live function is never overwritten. Each object is replaced in one file only (readers in slice 1, search in slice 3).

Installer. Existing input only: `real_use_action = install` with `apply = yes`. It runs `migrateCustomerRealUse` and then does nothing else (`scripts/install-customer-modules.ts:378-389`: enable and pause are separate values). No workflow edit, so the `workflow_dispatch` input count stays 25 (KI-25 zero headroom respected) and `tests/workflow-inputs.test.mjs` still passes unchanged. The owner merges every slice PR (each holds a migration) and runs the protected install. A builder or agent never runs it.

Install with the flag OFF. What changes, and why it is acceptable:

| Object                                                | Reachable by a customer with the flag OFF? | Why acceptable                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New tables (attempts, rights, suppression, redaction) | no                                         | Empty. No grant to the runtime or auth logins. Row security on                                                                                                                                                                                       |
| Replaced customer functions (search, command, state)  | no                                         | Only the customer route calls them. It returns 503 when `customerOrganisationLinksEnabled()` is false (`apps/web/app/api/customer-organisation-links/route.ts:11-12`; the flag also needs the workspace flag, `customer-organisation-links.ts:8-12`) |
| Replaced staff functions (queue, review, candidates)  | no                                         | Staff link routes are behind the same flag (`apps/web/app/api/workspace/customer-organisation-links/route.ts:17-18`)                                                                                                                                 |
| Ledger guard, url CHECK                               | no                                         | Only matter when a link is written or evidence added, which needs the flag                                                                                                                                                                           |
| Ingest wrapper, rights adjust and read, suppression   | staff only                                 | After the build PR, ingest records a rights row and returns warnings. This is a staff-side change with no customer effect                                                                                                                            |
| Redaction function                                    | staff only                                 | Needs staff authority, fresh MFA and an existing claim. With the flag never ON, there is no claim to target                                                                                                                                          |
| Side effect of other installers applying the files    | no                                         | Same as above                                                                                                                                                                                                                                        |

Application changes are build-PR scope, listed in the spec. They are not part of this design PR.

### Blast radius

- Auth: none. No login, role or grant changes. New functions are revoked from PUBLIC, the runtime and auth logins unless a staff or customer entry point needs the runtime grant.
- RLS: no existing policy changes. New tables follow the module pattern.
- Migration history: exactly the four new files appear in `customer_real_use_migrations.applied`. All earlier hashes are untouched. If the ladder history differs, the migrator refuses before running anything.
- Events: none from the install.
- Money: none.
- Rollback: forward file only (restore known function text). Tables and rows are kept.

## 6. Test plan

### Decision

Tests follow the module pattern (`tests/integration/customer-organisation-links.test.ts`, `real-customer-modules.test.ts`) and prove the following. No existing test is weakened. Every new test must fail on the base commit for the behaviour it adds (a "bite" check).

Full matrices live in the spec. Headers:

- Provenance matrix. Rows: path (customer search, exact lane, candidates organisation half, candidates workspace half, linked-workspace count, queue `candidateCount`, review payload, `decide` approve, EXISTING filing). Columns: real customer, synthetic customer, real staff, synthetic staff. Each cell has an expected result.
- Orphan matrix. Rows: real claim to a synthetic organisation and the reverse; a ledger row whose organisation is later suppressed; an organisation whose identifier expired; a claim with a redacted note still in candidates; an organisation with no rights record; the workspace half after the other workspace redacts; a linked count including a ledger row of another provenance.
- Empty-answer table (decision 3), with byte comparison.

Other required items:

- Populated-database preservation: install on a database with data; every pre-existing row and function (outside the replaced list) has an unchanged hash; `app.organisation`, profile revisions and the 8-argument ingest function are unchanged.
- Repeat install changes nothing. A changed or missing applied file is refused with the history-mismatch error. A drifted live function aborts at its guard and nothing is applied.
- Direct SQL denial: the runtime and auth logins cannot read or write any new table or call any new private helper.
- Roles: owner and admin search; member, outsider, revoked and disabled customers are denied; signed-out and expired proof are denied; wrong tenant staff, operator, viewer and stale MFA are denied for staff functions.
- Rate limit: 10 in 10 minutes and 60 in 24 hours; rows older than the window stop counting (fixture rows with older times); two parallel searches at the cap produce exactly one counted lookup; counts span all the actor's workspaces.
- Byte identity of a miss and a rate-limited answer (and every other cause in the table).
- Redaction: immutability (updates and deletes rejected); every reader masks; exact retry after redaction returns the masked view; staff review shows hidden text; the active link survives.
- Event content privacy for redaction and suppression events: ids, versions and state only.
- A real (non-`.test`) evidence URL passes the table check for a real tenant and a non-reserved URL still fails for a synthetic tenant.
- Wrapper: all source types; unknown type; same-transaction atomicity (a failure after ingestion leaves no organisation and no rights row); the 8-argument function hash unchanged; never refuses.
- Denial and recovery states: stale profile version refused; exact retry returns the original answer; conflicting command id conflicts; rate-limited customer sees the neutral list and can retry after the window.
- Measurable: zero cross-provenance rows in any search or candidate output across the matrix; at most 10 rows in any answer; workflow input count still 25.

### Rejected options

| Option                                     | Reason                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Test only through the service layer        | The leaks are in SQL results. Direct database tests are needed, as the module already does.    |
| One large matrix test                      | A failure would not say which path leaked. One case per cell.                                  |
| Skip the "fails on base" check             | A test that passes on the old code proves nothing about the fix.                               |
| Raise or loosen existing caps in old tests | Never weaken a test. A fixture change (a second actor) is allowed, an assertion change is not. |

### Blast radius

- Auth, RLS, migration history, events: tests create fixture rows as the table owner in an isolated test database only. They touch no shared or production database.
- Money: none.

## 7. What Phase 2 leaves out

| Left out                                                                 | Reason                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic registry import or provider lookup                             | Needs vetted sources, licence review and a provider. Closed gates (provider activation) apply.                                                                                     |
| Bulk catalogue operations; re-verification and expiry of source rights   | Phase 1 records review-by dates only. Acting on them needs the rights policy design (V3-05-043).                                                                                   |
| Licensed datasets and `app.data_rights_policy` use                       | Strict policy and legal review. Phase 1 only warns.                                                                                                                                |
| Customer-initiated unlink                                                | OD5: staff revoke only.                                                                                                                                                            |
| File evidence                                                            | OD2: wait for the scanner.                                                                                                                                                         |
| Redaction of the profile revisions themselves                            | Belongs to the ADR-044 profile module.                                                                                                                                             |
| Staff screens for warnings, suppression, redaction and rights adjust     | Phase 1 builds functions and service routes. Any control without a backend would be MISSING, and the reverse: a function with no screen is marked MISSING in the UI until Phase 2. |
| Email or notice of a decision                                            | Outreach is a closed gate.                                                                                                                                                         |
| Sharing a linked identity with counterparties; portfolio use (V3-06-011) | V3-06-011 stays PARTIAL. A real catalogue is a prerequisite, not the feature.                                                                                                      |
| Automatic creation of canonical organisations                            | Customer text never writes to `app.organisation` (ADR-044, ADR-052).                                                                                                               |
| Pruning of the attempts table                                            | Needs the owner's retention decision.                                                                                                                                              |
| Staff queue and review reachable while the customer flag is OFF          | Not needed while the flag has never been ON. See open choice 12.                                                                                                                   |
| Legal review of the rights defaults and of any licensed dataset          | Counsel work, not a build task.                                                                                                                                                    |
| Production enable and real-session acceptance                            | A separate owner decision after install and observation.                                                                                                                           |

### Blast radius

None. This section builds nothing.

## Consequences

- Real and synthetic data stop meeting in staff views, the count and search. This also closes the legal-name leak (fact 3) that exists in installed code today, behind the flag.
- Staff get a light, honest record of where an organisation came from and a way to hide one without losing history.
- A takedown or erasure request can be met by hiding, not by deleting. The text stays in immutable storage and backups. This must be said plainly to anyone who asks.
- The first four-file install touches 8 existing functions. Each is hash-guarded, so a drifted environment aborts instead of being overwritten. The builder must compute the hashes from a clean install at the build base, and re-read them if main moves.
- Search gains a write (the attempt row). It is serialised per person and bounded.
- Real search stays empty until the owner names sources and staff ingest real organisations. That is data work, not code.

## What this record does not claim

Designed only. Not implemented, tested, deployed, installed, enabled, approved or live. The register states for V3-06-002, V3-06-011, V3-01-018 and V3-05-043 are not changed by this record. The rights record does not close V3-05-043. A link still means "reviewed by Corridra staff from the evidence supplied", never verified.

## Open owner choices (each has a proposed default; none blocks this ADR)

| #   | Choice                                      | Proposed default                                                                                                                                             |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Real sources and who vets them              | Staff-only research from the seven proposed source types. Licensed datasets in Phase 2. Until the owner names sources, real search is empty                  |
| 2   | Rate limit                                  | 10 per 10 minutes and 60 per day per person across all workspaces                                                                                            |
| 3   | Message when limited                        | Same empty answer and same existing sentence as a miss. Alternative: "try again later"                                                                       |
| 4   | Exact-match input                           | Saved profile (legal name plus country, website host) plus the typed text; typed text that looks like a web address is a host; names compared normalised     |
| 5   | Rights warning triggers                     | `licensed_dataset`, `other`, and a name with no legal-form word. The record never hides a company                                                            |
| 6   | Takedown in Phase 1                         | Yes: the suppression record (hide and show) with history and existing links kept                                                                             |
| 7   | Erasure scope                               | Redact the customer's claim text on a documented request. Ids, states, times and the active link stay. Revoking a link is a separate staff decision          |
| 8   | Shipping route                              | A: real-use ladder files. Owner merges each slice and runs `real_use_action=install`                                                                         |
| 9   | Customer wording for the real link          | Existing real-context label without "(synthetic test)"; "reviewed by Corridra staff from the evidence supplied"; self-declared                               |
| 10  | New screens                                 | None in Phase 1. Warnings, suppression, redaction and rights adjust are staff functions marked MISSING in the UI until Phase 2                               |
| 11  | Who may redact                              | Owner or admin of the intake tenant with fresh MFA (not the optional privacy-queue module)                                                                   |
| 12  | Staff routes while the customer flag is OFF | New redaction and suppression routes do not need the customer flag. Existing queue and review keep it. Revisit before any flag-off period after claims exist |
| 13  | Monthly search cap                          | None in Phase 1. Revisit when the real catalogue has a size                                                                                                  |
