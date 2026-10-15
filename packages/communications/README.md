# Controlled communications

Read the [current programme](../../docs/implementation/current-plan.md), [module map](../README.md) and applicable ADRs before changing this module. Part references below describe its original release; later V2/UX amendments and current activation limits are linked from the developer handoff.

Owns approved jurisdiction/channel/purpose policy versions, templates, reviewed introduction records, recipient opt-outs, buyer capabilities and dispatch authorization. Routes call this service; no route writes its tables. Templates and policies require an owner/admin with fresh MFA. Other commands require communications.manage and the existing target/relationship boundary.

Buyer capabilities expose only the introduction snapshot. Token and job capability domains are separate; PostgreSQL stores hashes only. Command retry recovers the original sender's fragment link without storing plaintext tokens. Each link accepts one decision. Repetition of that decision is harmless; changed replay is rejected. Revocation, expiry, changed policy, paused missions and opt-outs block access immediately.

Opt-outs apply to the same recipient email across contacts in this tenant and every channel/purpose. No command clears them. A new approved purpose is not a reason to ignore a recorded opt-out. Shared rate limits retain keyed hashes, never raw client addresses. Automatic abuse-ledger cleanup remains part of D08.

Synthetic/manual adapters persist stable receipts. A manual receipt records the operator's controlled handoff, not proof that an external email was sent. The email adapter fails closed unless a separately configured idempotent transport and evidenced sender/policy/send permission are present; the current database and runtime prohibit EMAIL. No real contact or sender is configured by Part 06.

Read ADR-018 and the Part 06 runbook before release. New introductions and dispatch default off; owners explicitly enable them after validation. Historical reads and link revocation remain available when dispatch is paused.
