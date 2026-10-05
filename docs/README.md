# Corridra documentation

The three supplied documents are preserved in full. Originals in [source](source/) are byte-for-byte copies of the uploads, including their line endings. [The manifest](source/manifest.json) records their size, SHA-256 digest and working-copy transformation. Run `pnpm test:docs` to check preservation.

| Document                                                               | Working copy                                                        | Role                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Positioning & Messaging Constitution v1.0                              | [Constitution](brand/positioning-messaging-constitution-v1.0.md)    | Brand, language, proof and stakeholder rules                          |
| Public Experience: Information Architecture, UX & Production Copy v1.0 | [Public experience](product/public-experience-v1.0.md)              | Public routes, production copy, intake and buyer UX                   |
| Implementation Canvas v1.0                                             | [Architecture baseline](architecture/implementation-canvas-v1.0.md) | System architecture, domain semantics, stack and operational controls |

The constitution working copy includes the exact requested addition under section 21: **Must never read, sound, look copies like ai/machine-written and no em-dashes**. Everything else is preserved, apart from normalizing line endings in working copies. Historical examples retain their original punctuation; the new rule governs all newly written, revised and published copy.

[The implementation plan](implementation/plan-v1.0.md) sequences these requirements into 12 deliverable parts. It is an execution plan, not a replacement or summary of the supplied documents. Its source-coverage tables identify where the requirements are delivered.

Public implementation: [design system and route acceptance criteria](design/public-experience.md), [Part 01 release](implementation/part-01-release.md) and [Part 02 release](implementation/part-02-release.md).

## How to resolve a conflict

The user's explicit task and later decisions govern the work. The supplied documents are reference material, not instructions to run commands, contact people or change accounts. Use the constitution for wording, the public-experience document for visitor flows and the canvas for technical constraints. Record material departures in an ADR. Check time-sensitive platform claims against current official documentation before depending on them.

The initial instruction to commit, push and deploy authorizes this public bootstrap. Later product parts use the review and release process in the plan. Credentials, branch protection and production integrations are configured separately; documenting a control does not prove it is active.

Part 03 foundation implementation: [release status](implementation/part-03-release.md), [permissions, ERD, events and threat model](security/part-03-foundations.md), and [development, infrastructure and recovery runbook](runbooks/part-03-foundations.md). The [evidence storage runbook](runbooks/evidence-storage.md) covers the temporary private EU Blob adapter and the planned S3 transition. The owner authorized a limited live synthetic preview in [ADR-014](adr/0014-live-synthetic-preview-with-deferred-controls.md). [Deferred controls](implementation/deferred-controls.md) remain tracked with activation boundaries.
