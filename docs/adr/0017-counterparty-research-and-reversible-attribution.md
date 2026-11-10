# ADR-017: Counterparty research and reversible attribution

Status: Part 05 implementation; release evidence is recorded separately.

The owner requested Part 05. Continue on the existing Frankfurt synthetic branch and live domain, preserving Part 03 permissions, MFA, independent verification and explicit unscanned-file handling. Real customer data and authorized pilot records remain gated by the unresolved readiness items; a live deployment does not approve them.

Shared company identities contain only source-reported public business identifiers, domain, address, country, source locator and observation/validity dates. An operator can manually ingest an invented PUBLIC public-record source from example.invalid. Ingestion records an immutable tenant source binding. No supplied URL is fetched. Identifiers are country-scoped, and duplicate domains/addresses are allowed: groups and shared premises can collide. Source-reported identity is never labeled verified. Only an independent authorized reviewer with fresh MFA can explicitly publish an existing, current PUBLIC canonical fact from their evidence review. Internal facts and contacts cannot be promoted. Shared facts retain exact statement, observation, method, scope, validity and malware scan distinction; publication does not manufacture a new verification.

Products, capabilities, certifications, requirements and markets use one typed organisation_attribute table with the same immutable claim/provenance contract. Each attribute points to the original claim, inherits its classification and purpose, and cannot exceed source retention. Read models distinguish the original self-declared claim from independent current evidence verification. Expired attributes, sources, contacts and public facts are visibly expired. A certificate and a strong fit assessment do not establish commercial fit or turn a claim into fact. AI use is denied in this packet.

Relationships carry an active owner and explicit OWNER or TEAM visibility. OWNER admits that owner plus authorized owner/admin/reviewer oversight. TEAM admits permitted workspace members, never another tenant. Contacts and append-only private notes inherit the relationship access boundary. Operators may write their own relationship records; owners/admins can administer allowed records. The synthetic contact format requires @example.invalid; production personal data is not admitted. The existing membership country, purpose and classification policies still apply. Fixed-search-path access helpers validate those policies and the exact relationship visibility before returning a boolean; RLS uses the same rules for contacts, joins and targets. Search uses PostgreSQL full-text and exact identifier/domain indexes, 50-record catalogue pages and scoped joins. Shortlist reads batch contacts, sources and history per page rather than querying each target separately. Private contact and negotiation text cannot be searched through the shared catalogue.

Deterministic entity candidates explain exact domain, country-scoped identifier and country-scoped address collisions. Candidates never perform automatic merges. Authorized owner/admin/reviewer decisions require fresh MFA. Resolution records are append-only MERGE, DISTINCT or REVERSE decisions with reason, actor and original pair. A tenant-scoped attribution view maps the pair to a selected survivor; it never rewrites organisations, source records, relationships, contacts or target records. A reversal references the exact prior decision. Concurrent decisions serialize per tenant. Active chains and conflicting pair decisions are rejected until the current decision is reversed. This avoids global changes by a tenant operator and ensures that private commercial attribution does not become shared public truth.

Targets bind an active mission to a visible relationship and optional contact from that same relationship. Versioned assessments explain fit, rationale, uncertainty, evidence gaps, next action and due date. Every assessment requires at least one current claim attributable to that target. Immutable assessment_claim links retain the original attribute identity, so merge reversal cannot erase the provenance used for a past recommendation. Claim labels and evidence quality remain separate from operator fit judgments. Updating an assessment uses expected version, an advisory transaction lock and append-only history. Mission commands now permit ACTIVE to TARGETING, including hold/resume/cancel from TARGETING; outreach remains reserved for Part 06.

Research command IDs serialize retries and reject changed payloads. Their immutable ledger stores action, actor, request hash and result references, not private request text. Material records emit transactional domain events, audit, outbox and delivery checkpoints using the established minimal payload contract. Scoped shortlist export returns one explicitly labeled 50-target JSON page, including only contacts permitted by the same RLS policies. It uses authentication and no-store responses, and does not include negotiation notes. Disabling research.ingestion or research.resolution blocks new commands while keeping historical read models available. Default behavior is enabled when a workspace has no explicit version; owners can append a disabling configuration version.

No AI enrichment, crawler, automatic email, buyer outreach, production contact import, irreversible global merge, separate search service or automatic retention executor is introduced. Those limits do not prevent the complete manual research and shortlist workflow from operating with invented records.

The protected mission queue uses materialized scoped mission, intake and market reads, followed by the original joined-record pagination and a single latest-profile read for that page. This prevents PostgreSQL from repeatedly evaluating protected joins for each mission. RLS remains active on every underlying relation; no new database capability or bypass is added. The 105-fixture test retains record completeness, filters and cross-tenant denial and bounds the combined queue reads. This is a read-query correction, not a schema or state-machine change.

## Amendment, 10 November 2026: withdraw, correct and hide private contacts and notes (CRUD gap G11)

Status: accepted for build. Installed only by the owner's explicit module action; the control ships closed.

Owner decisions (owner, 10 November 2026, answered to S33):

1. How to meet a request to stop showing a third party's details: "Redact by new record (Recommended)".
2. Who may hide: "Owner/admin + MFA (Recommended)".
3. What one hide covers: "One contact or note (Recommended)".
4. Real workspaces: "Real and sample (Recommended)".
5. Switches: "One switch (Recommended)".
6. Second approver: "No, one person (Recommended)".
7. Server rate limit: "No, UI handles 429 (Recommended)".
8. Note scope: "Yes, all versions (Recommended)".

### Context

Private contacts and notes were append-only with no way to withdraw a wrong entry, correct it, or honour a request to stop showing a third party's details. Real-use workspaces admitted by ADR-056 (customer-real-use 0003 and 0007) can already hold real third-party contact data, so the line above, "production personal data is not admitted", is out of date. Opt-out suppression recomputes `sha256(lower(email))` from the stored email, so any mask or null in the stored row would silently break it.

### Decision

1. Contacts and notes stay Record class. Their rows are never updated (`reject_rewrite` unchanged). A withdrawal or correction is a new row in `app.private_contact_change` or `app.private_note_change` that references the exact version the person saw, with a reason, actor and time. A correction also adds a new contact or note row that passes the same provenance, source-retention and email rules as any new row. Each version can be superseded once (unique per version, serialised by a per-chain advisory lock), so of two concurrent changes exactly one succeeds and the other is told to refresh. A change records its chain: the id of the first version.
2. Hiding (redact by new record, decision 1) is a permanent `app.private_record_redaction` row for one contact chain, covering all its corrected versions, or one note chain with all its corrected versions (decisions 3 and 8). Only a workspace owner or admin with a fresh authenticator check may hide, with a written reason, a ticket reference that holds no personal data, and the id of the current version typed again (decisions 2 and 6). The typed id is compared after the chain lock is taken, so a hide never acts on a version that changed while it waited. There is no undo row and no update path.
3. Every runtime read of contact or note text goes through the views `app.private_contact_state` and `app.private_note_state`. They show the state (current, expired, withdrawn, corrected, hidden) and, for a hidden chain, return NULL for the name, job title, email, body and change reason with status `HIDDEN`; screens and the shortlist export write the word "Hidden" from that status. Relationship detail, shortlist, shortlist export and the communications contact list use these views; command replay returns ids only. Ids, times, actors, events and every reference held by targets, communications and opt-outs remain.
4. Stored bytes are not changed, so opt-out suppression keeps working after hiding. New targets and new communications are refused for a withdrawn, corrected or hidden version, and new communications also for any chain with an opted-out address. A queued message whose contact changed is stopped at send time (dispatcher check and a receipt trigger), and a staff retry of it is refused. These are separate additive triggers; the reviewed research and communication guards are not replaced.
5. Change and hide rows inherit the relationship's access boundary for reading. Writing requires the relationship owner or a workspace owner or admin; hiding requires owner or admin with a fresh authenticator check. Events carry ids and version only, never text, reasons, ticket references or emails. Each change row carries its own command id and request hash for safe retries. No server rate limiter is added (decision 7); the screen handles a 429 and resends the same command id.
6. Real and sample workspaces behave the same (decision 4). This corrects forward the line "The synthetic contact format requires @example.invalid; production personal data is not admitted": sample workspaces still require @example.invalid, and real-use workspaces admitted under ADR-056 may hold real contact data within the same boundaries. D08 (privacy, legal basis, retention) stays open and V3-09-043 stays gated; this amendment does not close them and admits no new real data.
7. The schema is an optional module (`packages/db/counterparty-change-migrations`), installed by the owner with `field_modules_action=contact_changes_install` and its one control closed (decision 5). `contact_changes_enable` and `contact_changes_pause` open and pause withdraw, correct and hide together; pausing keeps every record and state.

### Consequences

- Hidden means the text is no longer shown or exported in the workspace. What remains: the original values in the database rows and in backups, the sha256 request hashes in the command and change records (they are computed over the submitted text), text already sent in communications, and `relationship.note`, the free text on the relationship itself, which this amendment does not cover.
- Opt-out reasons and introduction presentation text are operator-written and are not hidden by this feature.
- Readers that bypass the views would show hidden text; a source scan test fails if runtime code reads contact or note text from the base tables outside the stated module-absent branches and the opt-out hash.
- No automatic retention executor is added; expiry stays visible through validity and source retention.

### Rejected options

- Taking rows physically out of the database: breaks target, communication, opt-out and event links, lifts append-only, and can stop opt-out suppression.
- Crypto-shredding: closest to true erasure of the bytes but needs key management and its own ADR.
- Masking or nulling stored columns: breaks the recomputed opt-out hash and the append-only rule.
- Hiding everything on a relationship, or every contact with the same address: wider than the request (decision 3).
- Replacing `guard_research_record` or `guard_communication`: both are fingerprinted by later modules; additive triggers achieve the same refusals.
- A core migration: it would install on every base run and could not ship closed.
