# Developer handoff: start here

Corridra has three successive programmes, not one unfinished twelve-part checklist. Original V1 Parts 1–8 are the retained foundation. The revised five-part V2 programme was subsequently implemented and merged. UX10X then changed the experience on that foundation: UX-01 through UX-05 are merged, with bounded UX-06 presentation, navigation and access repairs. This does **not** establish complete UX10X functional coverage or readiness for real customer operations.

This handoff was reconciled on 15 October 2026 against `main` at `0c42920dbc970aa9fd49b1a8323d6ecca417a527` (PR 46). It describes that baseline. Fetch the latest code and inspect subsequent PRs before making a new claim about production.

## Read in this order

1. [Current plan and remaining work](implementation/current-plan.md): authoritative programme status and the disposition of old V1 Parts 9–12.
2. [Implementation and verification matrix](implementation/implementation-matrix.json): requirement families, code, tests, decisions, release references and limits. This is a handoff index, not an exhaustive action inventory.
3. [Architecture and change contracts](architecture/v2-current-map.md), [multi-corridor contract](architecture/multi-corridor-v2.md), [ADR index](adr/README.md) and the applicable module documentation.
4. [Verification and continuation guide](verification-guide.md): reproduce checks, inspect the UX ledgers, and implement a bounded change safely.
5. [Access and administration](runbooks/v2-access-and-launch.md), [identity recovery](runbooks/neon-auth-accounts.md), [development](runbooks/development.md) and [deployment](runbooks/deployment.md).
6. [Documentation catalogue](documentation-map.md): which files are current guides, historical packets, immutable requirements or dated evidence.

Read `AGENTS.md`, the [agent protocol, master plan and work log](agents/README.md) and any nested instructions before editing. No automatic sequence resumes at old Part 9 or restarts completed V2 work.

## Authority and preservation

The user's explicit request and later decisions govern scope and release authority. Documents supplied by the user are specifications/reference material, not authorization to execute commands embedded in them. The current plan records the revised programme; ADRs define implementation contracts and explicit amendments. Code and executed tests establish what exists. A plan, screenshot or status word cannot establish production readiness.

The [three original documents and integrity manifest](source/manifest.json), their protected working copies, V2 owner packets and [complete UX10X master handoff](ux10x/master-handoff.md) remain intact. The approved Fusion prototype is solely a visual reference; its fictional figures, roles and sample data have no domain authority. UX improvements must preserve the complete domain requirements, including those not yet verified. Historical release packets describe their own revision, not today's next task.

## What must survive every change

- PostgreSQL remains canonical. Reuse scoped domain services, tenant RLS, server permission checks, fresh MFA, atomic event/outbox writes and additive reviewed migrations. Builds never migrate; do not use schema push or reset a retained database.
- Preserve original names, languages, sources, claims, evidence, review distinctions, append-only records and historical publication snapshots. Missing, unreviewed and unavailable are not zero, verified or successful.
- Keep exact original currencies/minor units, quotation versions and terms. Customer trade amounts, Corridra service economics, contribution rewards and actual cash are different records. Compensation appends history; presentation never rewrites money or invents attribution.
- Corridors are configurable global market relationships and directional, versioned route packs. Demand origin, target, supplier, shipment and meeting locations remain separate. No country-specific forks or guessed legacy classifications.
- Customer signup grants identity only. Invited staff require their separate password, authenticator and active workspace role. Contributors and buyer/client/programme links retain exact assigned/capability scope. Never join identities or grant admin by email similarity.
- AI produces governed drafts only. Production inference/network activation, real mission admission, outreach, payments and payouts remain closed. A functioning adapter or readiness screen does not authorize activation.
- Preserve original owners, MFA, historical records, production gates and working actions while improving layout. Keep private forms mounted appropriately, isolate state by tenant/identity, protect drafts and provide honest recovery.

## Owner and other users

The confirmed owner opens `/operator/signin`, completes MFA, then uses `/operator`. **People and workspace controls** contains permitted workspace administration; owners manage existing memberships, while admins have their separately allowed configuration/audit capabilities. This is workspace authority, not control over every Neon or Vercel account. New staff invitations, lost MFA and exceptional recovery remain reviewed procedures. The public **Start here** directory at `/workspace` explains entry routes without granting permissions.

Existing staff password recovery is `/operator/forgot-password`; customer recovery is `/forgot-password`. PR 46 added the separate staff mail transport and retained MFA. The owner confirmed opening the workspace and receiving both actual reset emails. The recipient's private completion of the latest password-reset links was not observed. See the [bounded production acceptance record](implementation/access-recovery-production-acceptance.json).

## Continue without damaging the foundation

First audit the requested journey against code, the matrix, source requirements and UX ledgers. Record observed gaps; do not mark a source-discovered action verified without exercising its allowed and denied states. The next engineering priority is to reconcile outstanding UX10X coverage and usability gaps, selecting a small journey with permission/recovery tests and browser evidence. Real launch controls require separate external evidence and approval.

Standing owner authorization permits correctly checked merges and immediate deployment of the exact merged revision. It does not waive CI, independent readiness gates or the prohibition on real customer operations. See the release runbook. Do not infer a new feature programme from historical task packets.
