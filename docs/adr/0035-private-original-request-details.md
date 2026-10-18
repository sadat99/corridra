# ADR-035: Creator-only original request details

Status: implementation candidate;exact-head acceptance pending. No real-operation activation. This amends only ADR033's receipt-progress-only read limit to let an independently admitted creator inspect the original request they submitted. Staff research,quotations,contacts,negotiations,contracts and financial observations remain separately permissioned.

## Authority and source preservation

Reuse the existing fresh managed-provider proof boundary and independently admitted request actor. The existing immutable creator binding and request_result apply principal/admission/resource revocation and original receipt retention before a source read. Only the linked canonical mission_intake.brief is returned;no bearer/hash/canonical tenant identifier or staff record is exposed. No ownership inference from email,workspace or organiser role. Workspace departure preserves prior creator access under unchanged rules.

Return original JSONB without regeneration or AI interpretation. After all reads,recheck actual proof and wall-clock retention;expired source returns availablefalse,originalnull,progressnull. The row lock used by the original resource port continues to serialize offline revocation. Existing source,quote,money,event and evidence records are not rewritten. A submitted budget remains a budget,with original currency/exact minor units and no conversion.

## Separate rollout

The accepted customer-authority installer has a three-module lifecycle asserted by existing upgrade tests. Preserve it unchanged. A separate explicit migrateCustomerRequestDetails installer first verifies/applies that foundation,then atomically installs customer-detail-migrations/0001_original_request_details.sql with its own protected customer_detail_migrations.applied receipt and the existing migration advisory lock. Repeat applies only the exact same hash;unknown/mismatched history aborts. No destructive rollback. The new SQL adds one restricted SECURITY DEFINER read function,not new domain tables or changed legacy functions/policies/ACLs.

CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED is independently default-off and requires the existing synthetic request flag/nonproduction guards. Page/API check it before optional schema/provider access;missing module is an honest503. No cloud schema,admission,intake/provider setting or flags change in this packet. D01-D06/D08 remain closed.

## Interface and acceptance

A relative saved-request link opens Overview,original requirements and exact operator replies. Self-declared original input is explicitly unverified. Loading,empty replies,unavailable,malformed,denied,expired,retry and interrupted/page-restoration states are visible. Context-keyed client fetches abort on account/resource change;hide clears details and restore reads fresh authority. No private details enter local/session storage. Original capability/receipt/public/staff paths remain accessible.

Real PostgreSQL tests verify original content,money,restricted-role denials,creator confidentiality,revocation,retention and immutable old function/receipt preservation. Actual-component browser protocols verify scoped reads,malformed/denial/retry,account changes,hide/restore,keyboard/axe and three widths;these are not real provider acceptance. The missing tester session remains a verification gap,not a blocker for subsequent independent implementation.
