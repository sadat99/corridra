# ADR-033: Private customer requests through the canonical mission engine

Status: implementation design; backend, migration, API and customer interface MISSING. This decision grants no admission or activation. It amends ADR-032 only for the next separately tested synthetic request capability.

V3-06-004 requires persistent customer-owned access. The existing public request factory already creates canonical missions; the existing receipt function already limits progress to status, received time and operator replies within the original retention period. Reuse both. Do not create another mission backend, infer ownership from email or company text, or expose staff/source/commercial records through a customer workspace.

## Authority and privacy

A fresh independently verified provider session, pinned issuer and active admitted customer principal remain necessary. Add a separate offline synthetic request admission and a separate default-off server flag. Workspace admission, signup and invitation acceptance alone do not grant this capability. Production remains hard-disabled and D01-D06/D08 remain closed.

New submission requires active membership in the selected synthetic workspace, checked under the same workspace-access advisory lock used by invitation/revocation commands. The creator alone owns the request resource. Neither the workspace owner nor another member, organiser or participant receives that private resource. Keep the workspace reference as immutable provenance, without making workspace membership an implicit sharing rule.

Leaving the workspace prevents new submissions there. It does not transfer or delete the creator's existing requests. Existing private reads require fresh active customer proof, continuing request admission, an unrevoked resource grant and the original receipt retention. Independent resource revocation and principal disablement deny reads; no account recovery, re-invitation or repeated command may revive a revoked resource. This distinction must be visible in acceptance tests and later customer copy.

The current capability-based client-publication interface remains independently authorized. A private request binding is not a CLIENT_PROGRESS publication and cannot disclose quotations, contact details, negotiations, contracts or financial observations. Those require separately reviewed grants. Customer proof continues to yield no staff actor; staff MFA, app.actor_id, app.member_role and existing RLS remain unchanged.

## Trusted submission and atomicity

Extend the existing server-verified proof boundary rather than trusting browser identity fields. An auth-side short-lived submission attestation binds the fresh proof hash and issuer/subject, selected workspace, command UUID, normalized existing brief digest, namespaced factory UUID, payload hash, original receipt digest and notice version. Restricted runtime SQL may consume a valid attestation, but cannot create or alter one. Auth SQL cannot grant request admission or write a resource binding. Cap the attestation lifetime at the original proof/provider expiry using the database clock.

Derive the namespaced factory UUID from trusted context; do not accept a browser's canonical request key or mission ID. The original receipt digest must remain private and immutable. Existing receipt reads use the stored original digest, so signing-key rotation does not invalidate already bound requests. Do not recompute a historical digest using a new signing secret. Retry an existing command by its stored binding and validated brief digest before deriving any new key material; preserve this behavior across rotation.

The narrow new database command obtains the admitted principal/request-admission row locks, command lock and workspace-access lock, then rechecks proof, admission, membership and attestation after waiting. Call unchanged app.submit_mission and insert the creator resource binding in the same transaction. A factory failure or binding/audit failure rolls back both. Preserve the existing global intake deduplication lock and establish a documented lock order before implementation to avoid a new cross-command deadlock.

Same principal/command and same input return the existing authorized binding without extra records. Conflicting input is rejected. A duplicate result with no ID creates no binding and must not be resolved by searching payloads, emails or organisations. A returned ID must match the attested namespace/request key and original receipt digest before binding. Existing anonymous missions and another creator's resources cannot be claimed. Lost responses use the exact command; no receipt secret is placed in a URL or browser storage.

## Events, retention and blast radius

The configured intake service remains the genuine executor of the original mission command. New resource events separately record the verified customer initiator, workspace provenance and command. Do not manufacture staff sessions or reinterpret existing mission events. A request remains a request; canonical status is displayed without inventing acceptance, a meeting or a deal.

Implementation will add one reviewed optional customer migration and new private module tables/functions/grants only. Preserve all 29 core migrations, customer modules 0001/0002, their registries and original rows/functions/policies/ACLs. Existing core records are created only through the unchanged canonical factory after explicit non-production synthetic admission. No money, provider setting, production schema or historical event/source record is changed by this design.

Do not copy the request brief, contact details or operator replies into a new perpetual customer store. Read bounded progress through unchanged app.mission_receipt with the original private digest. Retention expiry and existing source/legal restrictions remain binding. Resource reference metadata and audit retention need explicit treatment in the implementation report; a new binding cannot extend access to expired source content.

## Required acceptance and rollback

Before exposing UI, test fresh and populated additive upgrades, every old row/function/policy/ACL/receipt, restricted runtime/auth grants, actual canonical factory/event reuse, owner/member/organiser isolation, missing admission, forged issuer/subject/workspace, revoked membership versus retained private resource reads, expired proof/attestation after locks, disable/revoke serialization, same/conflicting/concurrent retries, no-ID duplicates, rollback of case and binding, signing-key rotation, receipt expiry and zero staff/source authority. Keep all original assertions. Run full static/security/unit/database/public/protected/build checks on the exact head.

Deploy additive schema before the compatible backend, with flags off. Disabling exposure or redeploying the retained application rolls back availability; preserve canonical cases, resource/audit history and migrations. Do not drop tables or rewrite records. The isolated child still requires separately evidenced intake-destination readiness and private authenticated provider/browser acceptance. This design does not authorize either configuration or real-data activation.
