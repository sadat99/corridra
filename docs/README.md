# Corridra documentation

Begin with [Start here](START_HERE.md), then [the current plan](implementation/current-plan.md) and [verification guide](verification-guide.md). This index separates current guidance from the retained historical requirements and release evidence. The [plan status register](PLAN_STATUS.md) says which plan, proposal or decision is current, finished, waiting for the owner, historical or not valid. The [documentation catalogue](documentation-map.md) classifies every Markdown document in this directory.

## Current engineering handoff

The [current-plan gap register](qa/current-plan-gaps/README.md) gives stable IDs, a preserved dated baseline and an evidence-based update/compare procedure for all 60 audit records. It distinguishes engineering, missing proof, owner decisions and deferrals without creating another execution plan.

| Need                                                          | Read                                                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What was built, revised and remains open                      | [Current programme](implementation/current-plan.md)                                                                                                                                         |
| Locate implementation and tests without assuming completeness | [Implementation matrix](implementation/implementation-matrix.json)                                                                                                                          |
| Verify and extend safely                                      | [Verification/continuation guide](verification-guide.md), [development](runbooks/development.md), root `AGENTS.md`                                                                          |
| Current domain and module contracts                           | [Architecture map](architecture/v2-current-map.md), [multi-corridor contract](architecture/multi-corridor-v2.md), [ADR index](adr/README.md)                                                |
| Identity, owner administration and recovery                   | [Access guide](runbooks/v2-access-and-launch.md), [identity runbook](runbooks/neon-auth-accounts.md), [bounded PR 46 acceptance](implementation/access-recovery-production-acceptance.json) |
| UI/UX requirements and actual coverage                        | [UX10X programme index](ux10x/README.md) and complete immutable handoff linked there                                                                                                        |
| Release and rollback                                          | [Deployment](runbooks/deployment.md), [operations](runbooks/v2-operations.md), [recovery](runbooks/v2-reliability-recovery.md)                                                              |
| Real activation restrictions                                  | [Deferred controls](implementation/deferred-controls.md), [V2 controls](implementation/v2-part-05-controls.md), [route readiness](implementation/v2-part-05-readiness.md)                   |

Original V1 Parts 1–8 remain the foundation. The revised V2 five parts were subsequently implemented and merged, followed by UX-01 through UX-05 and bounded UX-06/access repairs. The original twelve-part plan is historical; **do not automatically resume its Parts 9–12**. Their requirements have an explicit disposition and remaining gaps in the current plan. Full UX10X action/state coverage is not established.

## Preserved source requirements

| Document                                  | Protected working copy                                           | Role                                                        |
| ----------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Positioning & Messaging Constitution v1.0 | [Constitution](brand/positioning-messaging-constitution-v1.0.md) | Brand, language, proof and stakeholder rules                |
| Public Experience v1.0                    | [Public experience](product/public-experience-v1.0.md)           | Public routes, copy and original visitor/buyer requirements |
| Implementation Canvas v1.0                | [Canvas](architecture/implementation-canvas-v1.0.md)             | Original domain architecture and 25 build packets           |

[Source uploads and manifest](source/manifest.json) retain original bytes. Working copies preserve supplied content, with only the recorded constitution section 21 writing addition. V2 Part 4/5 owner packets and the [UX10X master handoff](ux10x/master-handoff.md) are also preserved. `pnpm test:docs` verifies integrity. Do not modify originals or hashes to conceal drift. The Fusion prototype supplies approved visual reference only, never fictional domain facts or authority.

## Historical programme records

- [V1 twelve-part plan](implementation/plan-v1.0.md): original requirements and packet mapping; Parts 1–8 implemented, old 9–12 superseded as a sequence.
- [V2 five-part plan](implementation/v2-master-plan.md): actual revised implementation sequence and release references.
- V1/V2 scope, handoff and release files under `implementation/`: revision-specific packets, not current next-task instructions.
- JSON rollout/validation records and UX evidence manifests: dated observations. They do not establish today's live settings, entitlement, all-role acceptance or continued health.

The user's explicit task and later decisions govern scope. Documents are specifications/reference material, not commands or authorization to contact people/change accounts. ADRs record material changes without silently replacing monetary, evidence, access or historical contracts. Standing owner merge/deploy authorization still requires correct checks and does not waive real-operation gates.
