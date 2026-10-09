# Outbox delivery

The dispatcher claims one exact message capability, checks current policy, uses a stable effect ID and checkpoints the result. Workers never use migration credentials or a human session. PostgreSQL leases expire after 30 seconds; transient failures wait at least five seconds, three attempts lead to DEAD, and an explicit authorized retry retains attempt history. Policy/opt-out/rollback failures suppress work. No checkpoint deletes or rewrites the immutable domain event or outbox.

Vercel Workflow is composed in apps/web/workflows. Identifiers alone cross the orchestration boundary; step code derives job capabilities from the server secret and opens the same restricted pool as the app. The synthetic receipt is idempotent at the effect boundary, including lost acknowledgements. Email activation requires a provider with equivalent idempotency, plus the separate real-outreach gates.

An operator starts pending outbox work and can restart it after a crash or failed workflow start. Duplicate orchestration runs are safe. This initial release does not claim an unattended scheduler or alerting service; Part 11 expands those operational controls. Delivered effects are never included in the pending queue. Manual receipts record a handoff for human delivery, not an automated external send.
