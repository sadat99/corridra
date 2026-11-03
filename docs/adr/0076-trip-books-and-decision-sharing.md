# ADR-076: Trip view, scoped books and decision sharing

Status: PARTLY ACCEPTED, 3 November 2026. Owner authorized sequential batch implementation and merges. The Trip view reuses already authorized itinerary data. The export/share field map and seven-day expiry below are proposed defaults for explicit owner acceptance before implementing those new disclosures.

Scope: Batch E, GAP-034/035/041. This extends ADR022 and ADR070 only as explicitly accepted here; existing identity, MFA, RLS, source revocation, approved publication and real-operation controls remain.

## Reused foundations

The saved commercial report already contains an approved itinerary with label, status, reviewed start/end/timezone/location and a scheduleChanged marker. The Room already composes that same report in Compare and Evidence views. Add Trip as another view with the existing CORRIDRA_UX_TRIP flag; no itinerary service, booking engine, canonical meeting change, schema or broader read permission is needed. A changed schedule suppresses stale appointment details. Existing report proof, refresh, expiry, visibility clearing and identity scope continue to apply.

CLIENT_PROGRESS currently forbids export. ADR022 requires explicit reporting/export permission; ADR070 is a proposal with an unset sharing expiry. A new button cannot override these boundaries.

## Proposed minimal disclosure contract

1. Trip Book: an explicit authenticated download for the currently permitted owner/admin of one owned saved mission. Include only its approved mission title/company/objective and reviewed itinerary label/status/time/place. Suppress changed schedules. No contacts, quotations, prices, notes, attachments, private identifiers or participant data.
2. Supplier Book: the same authority, with only the already reviewed shortlist company/country, fit/rationale, uncertainty/gaps and provenance/qualification labels. No offers, financial values, contact information or unreviewed suppliers.
3. Keep CLIENT_PROGRESS.allowExport=false. Books use a separate opt-in purpose and explicit field projection. Reuse existing PDF rendering/audit machinery; record immutable generation scope/version/digest and exact retries. A downloaded file cannot be revoked after it leaves the system; say that plainly at download.
4. Decision card: current owner/admin explicitly selects one currently reviewed SELECT/DECLINE/NEED_INFORMATION disclosure and previews the exact fields. Company, decision, rationale, next action, due date and provenance only. No quotation/price/contact/file/other decision. Public reading uses an unguessable fragment token, digest-only storage, read-only response, no-store/no-referrer, at most seven days and never beyond source access. Withdrawal, source loss and expiry answer as unknown. Sharing remains off until configured. No team-wide sharing.
5. Emailed status link: reuse the existing signed-in request Room deep link for the verified request holder. The URL gives no anonymous report authority and does not disclose request text in the email. Anonymous/unlinked requests keep their current receipt behavior. Reuse the existing permitted mail transport and idempotency; implementing a link does not authorize agent-triggered mail or provider activation.
6. Default off: retain CORRIDRA_UX_BOOKS, CORRIDRA_SHARE_CARD and CORRIDRA_STATUS_LINK until their real backend and focused permission/revocation/retry/browser proof exist. No real provider calls, booking or payment expansion.

## Required evidence

Trip reuses current report/Room regressions plus direct Trip rendering, empty/changed schedule, expiry/denial and off-path browser checks. New exports/shares require restricted real SQL/service tests for current ownership/role and source authority, field exclusion, exact retries/audit, expiry/revocation and no signed-out expansion beyond the deliberately issued card. Use current renderers and existing isolated fixtures; keep genuine provider/recipient acceptance separate. Frozen CI/CodeQL and automatic deployment verification remain mandatory per batch.
