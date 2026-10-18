# ADR042: Participant-owned commercial missions and explicit programme summaries

Status: bounded synthetic implementation; full exact-head acceptance pending. Requirements V3-02-049/V3-02-059/V3-02-061/V3-02-062/V3-02-063 remain PARTIAL/NOT VERIFIED as recorded in the ledger. Independent programme economics,coordination and real operation are not enabled.

## Actual preservation mapping

An original customer-owned request already references one canonical app.mission through customer_private.owned_request. Its customer workspace,canonical mission tenant and programme workspace can be three different authorities. The private creator retains the original request/detail/report paths. A programme registration does not grant organiser or staff access to those authorities. Never create a duplicate mission,manufacture a confirmed-import row,copy original private requirements into an organiser report or impersonate the request creator.

The next addition connects an existing creator-owned request to the same person's active programme registration. The participant explicitly writes and consents to a short fictional objective for programme organisers. Only that new self-declared text and the already consented registration label are shared. Original request/mission IDs,tenants,contacts,requirements,offers,quotations,negotiations,values,receipt hashes and source documents are not returned to organisers. The participant keeps a real relative link to the original private request;no bearer link is issued.

This is optional commercial context,not a forced stage for every participant. Original buyer/supplier/machinery/other objectives and their domain engines remain unchanged. Linking or sharing an objective does not mean qualification,an accepted meeting,a held meeting or a commercial outcome. Existing staff imported participants and CSV/PDF/report grants remain exactly as they are.

## New authority and blast radius

A separate optional additive module may add immutable link/revision/command records and narrow functions after the participant and original-request-detail dependencies. No existing function,ACL,RLS,source,money,approved migration or historical event record changes. Reuse original customer proof/request admission and canonical source checks. Mutations require the actual participant to own both the active registration and original request,plus explicit sharing consent. Programme owners/admins may read only the current expressly granted objective;they cannot create or amend it for another participant.

Acquire customer principal/admission and actor-command authority first,then affected customer workspace locks in sorted order. Do not assume the canonical mission tenant is a customer workspace. Recheck registration revocation,source request admission/revocation/retention,proof and scope after every wait and before returning or committing. Reuse the original workspace event helper with actual service/customer attribution;event payloads carry opaque programme/link IDs,not private source IDs,text or contact details.

For participant writes and reads,the original creator-only customer.private_request_detail remains the authority. For organiser reads,never mint a creator proof or call that getter as another identity. A private grant validator instead verifies the immutable binding,explicit consent,current active creator/admission,unrevoked original request,canonical retained source/receipt and active programme grant,then returns only the separately authored summary. Source availability is checked again after projection reads. Short UI snapshots expire at the earliest source deadline or60seconds;pagination does not extend them.

The new objective grant explicitly depends on active programme registration and source availability. Ending programme participation or withdrawing the summary closes programme visibility without changing the underlying private mission/report rights. Source revocation/retention closes this dependent summary by the participant's explicit consent terms. Revisions and withdrawal are append-only;withdrawal never falls back to an older shared revision. Exact retries re-evaluate authority and must not duplicate links,revisions or audit/outbox. Unknown installer history fails closed.

## Bounded acceptance and rollout

New gates default off,require participant/request/detail/synthetic/nonproduction prerequisites and remain production hard off. No cloud installation,real admission,provider change,outreach,payment,inference or D01–D06/D08 activation. This grants no original private commercial disclosure or legal approval.

Tests must prove populated old definition/ACL/RLS/row/receipt equality;genuine existing canonical mission reuse;creator-only link/share/withdraw;organiser-only exact programme read;workspace owner/colleague/other participant/source/cross-tenant denial;no private source fields in organiser responses/events;three-authority separation;sorted-lock concurrency;late proof/registration/source expiry/revocation rollback;idempotency/conflict/append-only history;source preserving original-script/currency/machinery requirements;current UI scope,recovery,privacy,keyboard/axe/responsive and actual closed routes. Actual provider end-to-end acceptance remains independently NOT VERIFIED.

Rollback disables the independent feature and retains additive records plus original canonical source,consent and event history. Full profiles,eligibility,agenda/meetings,reporting and economics are not supplied by this increment.

New share/withdraw commands also require an expected current revision. Concurrent new edits from an old view conflict instead of silently overwriting an objective. Exact retry is checked against the actual current head;retrying a superseded share or withdrawal cannot restore or remove a later consent. Own private-source reads use the original creator getter;the organiser projection uses only the explicit grant validator and never a forged creator identity.
