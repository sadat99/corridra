# UX-01 architecture and preservation contract

**Document status: HISTORICAL.** The UX10X programme was merged (UX-01 to UX-05 and bounded UX-06). This is a dated record, not a to-do list. See the [plan status register](../PLAN_STATUS.md).

## Authority and scope

This contract originated in UX-01 and remains a preservation contract for later UX changes. UX-01 through UX-05 are merged, with bounded UX-06/access repairs; see [current programme](../implementation/current-plan.md). The UX10X.1.0 handoff governs UX within current server/domain contracts. Fusion 01 supplies visual reference only. Its fictional metrics, approval controls and historical implementation instructions do not define production behavior. The sequential programme requirements remain; implementation of a phase is not exhaustive functional acceptance.

Baseline main is `1e0dbea6f146265b256ca89b5482e789f97acdd9`. The existing checkout was clean at `5a5f6b7` and was fast-forwarded after inspecting the seven-file PR #38 diff. The 15-second connection timeout, rejected-resource eviction and full-document recovery remain unchanged. No worktree, migration or domain fork is introduced.

## Presentation boundaries

- `WorkspaceShell` owns page geometry and heading hierarchy, never identity or membership.
- `AccessState` renders a caller-established state with persistent recovery controls. Expired and revoked states must not be inferred from generic 403/404 errors: the server intentionally withholds those distinctions where necessary.
- `StatusBadge` carries text and semantic color; color alone never establishes evidence or readiness.
- `RoleNavigation` consumes the existing closed section registry. It is navigation convenience; APIs and RLS remain authoritative. Section navigation retains mounted forms and legacy anchors.
- A tenant-keyed workspace content boundary isolates in-flight state updates. Switching tenants must not reuse private data, form values, flags, audit rows or response messages from the previous tenant.
- Mission presentation consumes the existing scoped mission queue. No new API, recommendation engine, inferred route, ranking, FX calculation or synthesized fact is introduced.

## Tokens and typography

Preserve ivory `#f5f3ec`, ink `#222d29`, forest `#526544` and existing brand identity. Semantic aliases cover raised/subtle surfaces, strong/muted text, border, action/focus, positive, caution, critical, info and unknown. Dense forms and data use sans-serif with Bangla/Han fallbacks; serif is reserved for editorial headings. Use a small spacing scale, restrained corner radii, visible keyboard focus, readable line height and 44px primary touch controls. Wide comparisons scroll locally with an accessible label; do not hide content to conceal overflow. Reduced motion disables smooth scrolling and transitions.

## Identity and access

Customer identity is separate from invited operator membership and TOTP. Contributor access is exact-assignee scope, not tenant membership. Private capability views remain subject to audience, publication, expiry/revocation and current source rights. Closed return URLs preserve only existing registered destinations. The shared Skip to content anchor (`#main`) remains a valid accessibility destination. Unknown fragments must produce recovery guidance and must never focus arbitrary form inputs or private controls.

Read-only mission presentation must retain original company/name/language, source/claim distinctions, version, next action, owner and explicit timezones. Unknown values remain unknown. Customer trade, original quotation terms and Corridra service economics remain separate. Existing forms, command IDs, exports and history stay in their domain panels.

## Gates and rollback

The UX-01 branch and main explicitly opt out of automatic Vercel Git deployment in apps/web/vercel.json. Main Git auto-deployment was disabled then; the owner switched it on on 2026-10-20. The owner subsequently authorized immediate exact-revision deployment after correctly checked merges, without another approval. No runtime environment settings, production data, provider credentials, readiness observations, outreach adapters or payment/payout paths change. D01–D06/D08 remain open under the existing controls register. UI changes do not close any external gate. Local synthetic provider fixtures are test transports, not live inference.

Rollback is the application diff against the accepted baseline; no database rollback is needed. Follow current standing merge/deploy authorization and exact-revision checks; external activation and real operations still require their separate gates. Later migration-bearing repairs follow their own additive compatibility contract. Validate the exact proposed code and preserve evidence before publication. The coverage ledger distinguishes source discovery from executed functional verification.
