## Chunk120: PR86 to PR88 merged and released

Squash merges e31566e, 8bbbca2 and aebb527 after exact-head CI and CodeQL; production dpl_9ZxfddkTcqhPoMexsCeUvgu1pVqH, 64 of 64 live checks. Ignored Build Step set to scripts/vercel-ignore-build.sh. Gap fixed: PR86 and PR87 had been left undeployed. [Receipt](v3/cleanup/2026-10-19-pr86-pr88-release.json).

## Chunk121: programme coordination, reporting and templates (released)

ADR047 and ADR048 as optional additive modules (tasks, capacity, attendance, participant-shared feedback, organiser report; versioned templates applied only to an empty programme). PR90 squash d19e4c8 after CI and CodeQL at 4355c2d, base unchanged, merge tree equal to tested tree; production dpl_BwunTCzxWSk6trofUqTrvrUsutVP, 71 of 71 live checks. The first docs-only push built because a force-push removed the previous built commit; the next fast-forward docs-only push was skipped by the Ignored Build Step (proven; rule: do not force-push a branch whose previous preview you want compared). [Receipt](v3/cleanup/2026-10-19-pr90-release.json), [coordination](v3/phase-3/customer-programme-coordination/bounded-plan.md), [templates](v3/phase-3/customer-programme-templates/bounded-plan.md). Participant messaging stays unbuilt (outreach gated).

## Chunk122: founder activation view (released)

Staff-only table in the Business overview showing which of 16 customer modules a deployment serves and why (configuration only, no query, secret or live figure; database install state not inferred). My first push added role=status text that broke the governance spec's single-status expectation and its founder follow-on; fixed with aria-live and a component assertion, then full CI green at c81b0b1. PR92 squash 58ac24d, production dpl_BsKPfaEVuwqGzZzUk37BLDJdjB1T, 72 of 72 live checks. V3-04-089, V3-09-035, V3-09-036 PARTIAL, none verified. [Plan](v3/phase-4/founder/activation-plan.md). Unverified: real-user usability, role-state acceptance.

## Chunk123: plain-language front door (source, local evidence)

Home headline, intro and request page heading rewritten without idioms. Copy only; no behavior, route, flag or gate changed. Local: format, lint, typecheck clean, build exit 0, 74 browser specs passed including axe. Unverified: CI, deployment, reader comprehension. Published after the owner deleted a merged branch to meet the branch budget. [Work log](agents/work-log.md).

## Chunk124: Guided experience standard locked (documentation)

Owner approved and locked the Guided UX v2 style in docs/agents/ui-direction.md (eight rules, locked navigation, 36-screen map, ship conditions, open decisions). No code or behavior change. All 36 screens are design only; ease-of-use and blind-access claims stay unproven until real-user and screen-reader tests. Next: owner chooses the first build PR. [Work log](agents/work-log.md).

## Chunk125: Guided public site (UI only)

Public front door rebuilt to the approved mockups: home, header, footer, how it works, routes, trust and the ways-to-work pages (about, network, institutions share them). Copy cut to short blocks. Listen is a small icon in a new corner dock beside Help. Old Solutions menu, route explorer clutter, market selector and about 115 more dead CSS rules removed; legacy hex baseline 25 to 15. Every destination kept (footer, `/corridors`, `/trust`; `/#mission-example` redirects). No flag, gate, schema or money change. Not proven: real-user and screen-reader ease. Open: Help contact channel. Next: owner review, then the request flow. [Work log](agents/work-log.md).

## Chunk126: team roles and leaving (source, local evidence)

Phase 1 of the unfinished customer organisation work, after an audit showed invitations, acceptance and revocation already exist with UI and tests. New optional module `customer-member-role-migrations` ([ADR051](adr/0051-member-roles-and-leaving.md)): append-only admin and member roles chosen by the workspace owner with a stale-safe check, and a member leaving their own membership; flag `CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED`, default off. Only three role readers are replaced (same text but the role expression) and tests compare every function, table, digest, ACL and policy before and after on a populated database. Local: new database tests 12, browser protocol specs 8, all 25 customer integration suites 316 plus related specs green, format, lint, typecheck clean. Not done: CI, merge, install, flag, release, managed-provider acceptance. V3-06-003 stays PARTIAL. Later phases: canonical organisation linking and verification, coordination (eligibility, capacity, terms, account-linked tasks, in-app reminders), economics (pricing templates, series, repeat revenue, exports).
