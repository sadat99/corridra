# ADR-075: Programme projections and consented meeting counts

Status: ACCEPTED, 3 November 2026. After authorizing Batch D, the owner answered “approved recommended options” to the bundled disclosure, readiness, qualification and agenda defaults. Implementation is authorized within this contract; production installation, activation and release controls remain separate.

Scope: GAP-037, GAP-038, GAP-039 and GAP-042. Relevant preserved requirements include V3-02-049, V3-02-051, V3-02-052, V3-02-054 and V3-02-056. ADR032/038/042/047/051/054/056 remain binding except for an explicitly accepted, narrowly stated forward extension below.

## Existing foundations

Programme registrations, organisation profiles, programme context, terms, eligibility, placed/waitlisted enrolments, coordination tasks and participant-owned mission-summary links already exist. Reuse them. A registration, shared label or mission-objective summary does not authorize private profile or meeting disclosure. Programme tasks have a due date; timed activities require explicit start/end records. Existing programme room views and switch-off behavior remain available.

The commercial engine ties opportunities to held meetings. An immutable qualification event is distinct from participant-reported outcomes and from merely scheduling a meeting. The display separates scheduled meetings from qualified held meetings; it does not fabricate a qualified scheduled state.

## Accepted contract

1. **Audience and fields.** Only current programme-workspace owners/admins may read a company projection. Its active participant explicitly shares a pinned company-profile version and a short objective. Returned fields are company name, country, business roles, sectors and that objective, with self-reported provenance. No contact, website, financial, private-summary, offer or negotiation fields are implied. Existing participants/members gain no new cross-participant view.
2. **Revocation.** Sharing is opt-in and versioned. Withdrawal, removed/withdrawn registration, lost source authority, disabled account and expired/revoked source access suppress the projection. Sharing a later profile version is a new explicit action; private edits never silently expand the disclosure. Owner/admin access is checked on every read.
3. **Readiness.** A ready participant has active registration, eligibility against the current rules, a confirmed place, current terms acceptance and a currently shared company profile. Report the missing criteria and denominator from complete server-side data. Missing/unavailable data is not an invented total. This is an operational checklist, not legal, company-verification, financial or launch approval.
4. **Agenda.** Organisers record bounded activity intervals in the programme timezone, with explicit attendees. An all-participant activity includes active participants; selected activities use validated active registrations. Half-open intervals allow adjacent activities. Overlap is flagged only for shared attendees; cancelled items are excluded. No automatic rescheduling or private mission-calendar import is authorized.
5. **Meeting counts.** A participant separately permits aggregate meeting counts for an existing owned-request/mission link. Prior objective-sharing consent alone is insufficient. Return scheduled and qualified-held counts separately, using canonical meeting and qualification-event records. Count each meeting once; never treat a self-reported outcome as qualification. No meeting titles, counterparties, contacts, notes, opportunity values, raw canonical mission IDs or private source records enter the organiser response.
6. **Unavailable and revoked links.** No consent or no permitted source is displayed as not shared/unavailable, not zero activity. Source retention/revocation and participant withdrawal remain authoritative. A programme relationship never transfers mission authority.

## Implementation and blast radius

Use one explicit optional programme-projections module, reusing the existing terms and mission-sharing migrations as dependencies, with its own checked migration registry and default-off application switch. This is a distinct disclosure/rollout lifecycle; existing single-file migration streams and their installed hashes remain immutable. Do not edit original migrations or tests to evade their preservation assertions.

Add only append-only sharing, activity revision and command-receipt objects. Restricted fixed-search-path functions enforce fresh customer identity, workspace owner/admin or own-registration authority, exact expected versions, idempotent retries and current source permissions. Runtime/auth roles receive no direct private-table access. Events contain identifiers and kinds only. Existing staff identity, MFA, RLS policies, money, evidence and historical records are unchanged.

The source company is the profile selected in the current enrolment; sharing pins its exact reviewed revision ID and version. Version numbers can coincide across company workspaces, so the server checks both identity and version, and rejects a source change during lock acquisition. The revision ID is returned only in the participant’s own view; the organiser field map is unchanged. Timed intervals extend existing coordination tasks, rather than creating another task system. The registry is `customer_programme_projection_migrations`, installed through the existing protected customer-modules installer. `CORRIDRA_CUSTOMER_PROGRAMME_PROJECTIONS_ENABLED` defaults off and also requires the existing terms, context and mission-sharing switches. No production switch value is inferred.

Reuse the current Programme Room, participant self-service, date/time input and HTTP/context guards. Surface company/agenda views and factual readiness/counts only behind the new switch. The old five views and off paths stay intact. No provider calls, real outreach, payment operation, production configuration change or implicit activation belongs to this packet.

## Acceptance before release

- Restricted-role tests exercise real SQL: owner/admin reads, participant own share/withdraw, member/outsider/cross-programme and forged-context denial, disabled/revoked identities, and direct table/function grant boundaries.
- Verify pinned/minimal company fields, explicit separate mission-count consent, withdrawal/source revocation/expiry, no private payload or identifier leakage, complete counts beyond a UI page and unknown/unavailable behavior.
- Verify readiness after rule/profile/terms/place changes; count only active registrations and expose exact reasons without claiming broader verification.
- Verify timezone conversion, interval bounds, all/selected attendee overlap, adjacency, cancellation, concurrent edits, exact retries and changed-payload conflicts.
- Use canonical held-meeting/qualification fixtures, deduplicate meetings across links, preserve scheduled-versus-qualified-held distinctions and reject self-reported qualification.
- Prove fresh and populated additive installation, repeat/hash mismatch handling and unchanged original core/module records and grants. Reuse existing fixtures and preservation checks.
- Exercise the new organiser and participant views plus off/loading/error/recovery paths in a compiled browser build. Run focused checks during edits and one required frozen CI/CodeQL cycle for the combined batch.

Production installation and activation remain separate existing owner controls. The accepted contract authorizes implementation, not an unverified finding closure.
