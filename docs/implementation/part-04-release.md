# Part 04 release

Historical implementation packet for its named revision. Its scope, acceptance and next-step statements are dated context. Use [the current plan](current-plan.md) and [developer handoff](../START_HERE.md) for present status; old task sequencing or unclosed-at-the-time issues are not current instructions. Do not infer full requirement acceptance from this packet.

Scope: five-step no-account test intake, normalized mission records, private status/reply receipts and protected Ops Home. The current live data environment remains synthetic under ADR-015. See ADR-016 for the ingress and state contracts and the mission runbook for operations/rollback.

Implementation includes server and step-specific validation; tab-scoped draft preservation; retry-key/content deduplication; shared abuse budgets; original brief, notice and self-declared provenance; owner/next action/due date; structured market and append-only target profiles; qualification, activation, hold/resume and cancellation; source/claim creation; idempotent commands/replies; atomic event/audit/outbox and database guards. No future targeting, outreach, meeting, money or AI flow is included.

All 111 local tests passed: 7 document, 7 infrastructure, 49 integration, 46 public browser and 2 protected operator/browser workflow tests. Formatting, lint, typecheck, the production build and dependency audit passed. The final browser suites ran sequentially. The local validation record covers the final migration hash and exercised failure paths. PR #14 merged as fbee283 after the final candidate 4c9dbfd passed all CI gates. Main CI passed too. Genuine Vercel Git deployment dpl_ts9uHU7ysNUAVAjMusQWguCmx8Ae is READY in fra1 and serves corridra.vercel.app. The existing Frankfurt synthetic branch has seven migrations; the separate production candidate was untouched.

The real customer pilot remains pending the legal entity, monitored privacy/response contact and approved retention details requested from the owner. Email sending, customer identity recovery and automated retention are not claimed. The public form accepts invented details and @example.invalid addresses only; its notice explains the current processing and cleanup limit. The original source documents remain immutable.

[Local validation evidence](part-04-validation.json).

Actual production browser acceptance passed: anonymous intake and reload preservation, duplicate retry, test-address/CSRF denial, real TOTP operator login, the protected queue with original notice/provenance, qualification/activation/hold/resume, self-declared claim retention, restricted configuration/cross-tenant denial, receipt reply and reload, cancellation with retained history, and signout denial. No screenshots, traces, video, customer data or outbound email were used.

The temporary test operator membership in the owner workspace was revoked and read back as revoked. All tester sessions were removed. The cancelled synthetic mission retains the existing owner, and intake remains enabled. Runtime/auth roles remain restricted, context-free mission reads return zero, identity access is denied, and all 25 app tables carrying tenant_id have RLS. Management/schema-owner variables are absent from production runtime.

[Production deployment and workflow evidence](part-04-production-rollout.json). This is the implementation deployment checkpoint; later documentation-only commits retain identical application code.
