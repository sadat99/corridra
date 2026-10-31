# Commercial readiness program: file ownership

Document status: CURRENT, DATED. Written by the lead in Wave 0 on 31 Oct 2026 from `main` at `1b09e89`. It turns section 5.1 of [the program](../../../CORRIDRA_COMMERCIAL_READINESS_PROGRAM.md) into exact paths for this repository.

## Rules

1. Each stream creates or edits only the paths listed for it. Reading anything is allowed.
2. A path not matched below belongs to the lead. Need a change there? Write one line under "Integration notes" in your status file.
3. A stream may create new files inside folders it owns, and new route folders that are listed for it (for example a new `app/api/team-work/` folder for WS-C).
4. Existing test files: a stream may update an existing test only where it asserts copy or layout of that stream's own pages, keeping every behaviour, denial and security assertion. Never delete or skip a test. If two streams change the same test file, the lead resolves it in Wave 2.
5. `tests/ux/ux-baseline.json`, `docs/V3_LEDGER.md`, `docs/agents/work-log.md` and `docs/documentation-map.json` are lead only.
6. No new runtime dependency (D19). The repository had no combobox or date picker primitive; Wave 0 built both without a dependency (`apps/web/components/ux/search-select.tsx`, `date-time-input.tsx`).

## Real script names for the gates

| Program name                           | This repository                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm lint`                            | `pnpm lint`                                                                                       |
| `pnpm typecheck`                       | `pnpm typecheck`                                                                                  |
| `pnpm test`                            | `pnpm test` (document and infrastructure tests) and `pnpm format:check`                           |
| `pnpm test:integration`                | `pnpm test:integration` (vitest, needs the local PostgreSQL from `docs/v3/KNOWN_ISSUES.md` KI-15) |
| `pnpm build`                           | `pnpm build`                                                                                      |
| Playwright verification                | `pnpm test:verification tests/e2e/verification/ws-x` (server on port 3300, flags on)              |
| Other browser suites (CI is the proof) | `pnpm test:e2e`, `pnpm test:operator`, `pnpm test:ux` (run against a production build)            |

In the cloud container set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium` (or the `chromium-1194` path if present) for browser runs. Concurrent Playwright runs need distinct `--output` paths.

## Working beside four other streams on one machine

The five streams share one cloud container (4 CPUs) and one local PostgreSQL 16 on port 54329 (KI-15). Ports 3100, 3200 and 3300 and the fixed test database names are shared too. So:

- Before anything else in a new worktree: `cp /home/user/corridra/.cache/part03-local.json .cache/` (create `.cache` first) and `pnpm install --frozen-lockfile --config.engine-strict=false`.
- Wrap every database or browser run in a lock: `flock /tmp/corridra-db.lock pnpm exec vitest run tests/integration/<file>` and `flock /tmp/corridra-browser.lock <playwright command>`. Wrap builds: `flock /tmp/corridra-build.lock pnpm build`.
- Run only the vitest files and browser specs that cover what you changed. The full `pnpm test:integration`, `pnpm test:operator`, `pnpm test:e2e` and `pnpm test:ux` run in CI on the integration PR.
- Never stop or reset the shared PostgreSQL server.

## WS-A Public site and intake

- `apps/web/app/page.tsx`, `apps/web/app/not-found.tsx`
- `apps/web/app/{about,how-it-works,trust,privacy,plan,sell,source,machinery,enter-market,business-trips,trade-missions,institutions,network,corridors,fairs,coming-soon,signin,signup,forgot-password,reset-password,verify-email,workspace}/**`
- `apps/web/content/**`
- `apps/web/components/{front-door.tsx,front-door.css,discovery-experience.tsx,corridor.tsx,corridor-map.tsx,corridor-geography.ts,world-route-map.tsx,world-geography.ts,fairs-view.tsx,home-example-record.tsx,journey-bar.tsx,public-page.tsx,ways-to-work.ts,legacy-hash-redirect.tsx,pending-request-notice.tsx,retained-submission.ts,specification-fields.tsx,countdown.tsx,verify-email-handoff.ts}`
- `apps/web/components/mr/{first-question.tsx,first-question.css}`
- `apps/web/lib/{front-doors.ts,first-question.ts,pending-request.ts,private-request-storage.ts,receipt-memory.ts,fairs.ts,account-return.ts}`
- `apps/web/lib/i18n/home-words.ts`, `apps/web/lib/i18n/form-words/**`, `apps/web/lib/i18n/ws/ws-a.ts`
- `apps/web/app/api/intake/**`
- `tests/e2e/verification/ws-a/**`, `docs/qa/2026-10-31/status/WS-A.md`

## WS-B Customer, participant and contributor

- `apps/web/app/account/**`, `apps/web/app/contributor/**`, `apps/web/app/pulse/**`, `apps/web/app/mute/**`
- `apps/web/app/api/{account,customer-assigned-missions,customer-companies,customer-decisions,customer-mission-drafts,customer-missions,customer-organisation-links,customer-organisation-profiles,customer-programme-context,customer-programme-coordination,customer-programme-economics,customer-programme-exports,customer-programme-objectives,customer-programme-participants,customer-programme-pricing,customer-programme-templates,customer-programme-terms,customer-programmes,customer-requests,customer-saved-missions,customer-service-requests,customer-specification-confirmations,customer-workspace-access,customer-workspace-members,customer-workspaces,move,pulse,auth-mail}/**`
- `apps/web/components/{account-access.tsx,account-form.tsx,workspace-chooser.tsx,email-nudge.tsx,email-nudge.css,mission-passport.tsx,next-step-card.tsx,participant-scope.tsx,commercial-arrangement.tsx,commercial-arrangement-fields.tsx,comparison-matrix.tsx,compare-lens.tsx,compare-lens.css}`
- `apps/web/components/mr/**` except the two WS-A files above
- `apps/web/lib/{customer-page-session.ts,move-cards.ts,move-constants.ts,move-loader.ts,move-pages.ts,room.ts,room-loader.ts,programme-room.ts,quote-cards.ts,recoverable-resource.ts,specification-availability.ts,workspace-choice.ts,all-tools.ts,pulse-orchestrator.ts,pulse-step.ts}`
- `apps/web/lib/ux/customer-road.ts` (the mapping contract)
- `packages/auth/src/customer-*.ts` except the billing, invoicing, payments and commercial arrangement files listed for WS-C; `packages/auth/src/pulse-*.ts`
- `apps/web/lib/i18n/ws/ws-b.ts`, `tests/e2e/verification/ws-b/**`, `docs/qa/2026-10-31/status/WS-B.md`

## WS-C Team work

- `apps/web/app/operator/{missions.tsx,mission-moves.tsx,commercial-mission.tsx,opportunities.tsx,delivery.tsx,delivery-experience.tsx,customer-billing.tsx,customer-invoicing.tsx,customer-real-invoicing.tsx,customer-simulated-payments.tsx,customer-service-catalogue.tsx,customer-service-requests.tsx,customer-mission-delivery.tsx,specification-requests.tsx,reply-review.tsx,reply-review.css,counterparties.tsx,company-link-review.tsx,decision-disclosures.tsx,access.tsx,country-options.tsx}`
- `apps/web/app/operator/[section]/[missionId]/**` (new: the mission page with tabs at `/operator/missions/<id>`; it must answer not found for any section other than `missions`). Do not create an `app/operator/missions/` folder: `tests/integration/ux-operator-urls.test.ts` forbids a folder named like a section word. The queue at `/operator/missions` is the existing section, rendered by `missions.tsx`.
- `apps/web/app/{client,buyer,programme}/**`, `apps/web/app/delivery-view.tsx`, `apps/web/app/mission-experience-view.tsx`
- `apps/web/app/api/{buyer,delivery,mission-mail,reply}/**`, `apps/web/app/api/workspace/{customer-billing,customer-decision-disclosures,customer-mission-delivery,customer-organisation-links,customer-service-requests,customer-simulated-payments,delivery,specification-confirmations}/**`, new `apps/web/app/api/team-work/**`
- `packages/missions/**`, `packages/opportunities/**`, `packages/delivery/**`, `packages/counterparties/**`, `packages/communications/src/{index.ts,adapters.ts}`, `apps/web/workflows/**`
- `packages/auth/src/{customer-billing.ts,customer-billing-real-configuration.ts,customer-invoicing.ts,customer-invoicing-real.ts,customer-invoicing-real-configuration.ts,customer-payments-simulated.ts,customer-payments-simulated-configuration.ts,mission-mail.ts,mission-mail-gate.ts,mission-mail-mute.ts,mission-mail-templates.ts,real-report-access.ts}`
- `apps/web/lib/{communication-orchestrator.ts,communication-step.ts,mission-mail-orchestrator.ts,mission-mail-step.ts,delivery-http.ts,reply-receipt.ts,reply-review-view.ts,reply-terms.ts,reply-words.ts,staff-db-error.ts}`
- Exception: `packages/missions/src/route-pack-form.ts` belongs to WS-D (it sits next to `CorridorService` so the reviewed command stays in one place).
- `apps/web/lib/i18n/ws/ws-c.ts`, `tests/e2e/verification/ws-c/**`, `docs/qa/2026-10-31/status/WS-C.md`

## WS-D Team control, access and trust

- `apps/web/app/operator/{today.tsx,network.tsx,contributor-invitations.tsx,operations.tsx,intelligence.tsx,review-settings.tsx,workspace-audit.tsx,workspace-controls.tsx,authenticator-check.tsx,recovery-form.tsx,operator-flags.tsx,sources-panel.tsx,evidence-panel.tsx}`
- `apps/web/app/operator/{owner,setup,signin,forgot-password,reset-password,view-as}/**`
- `apps/web/app/api/{workspace/[action],network,operator-auth,operator-setup,auth,picker}/**`, new `apps/web/app/api/team-control/**`
- `packages/auth/**` except the files listed for WS-B and WS-C; `packages/evidence/**`, `packages/network/**`, `packages/intelligence/**`, `packages/missions/src/route-pack-form.ts`
- `apps/web/components/{founder-activation.tsx,founder-overview.tsx,operator-invitation-hint.tsx}`
- `apps/web/lib/{authenticator-check.ts,owner-access.ts,owner-gaps.ts,owner-waiting.ts,view-as-gate.ts,neon-auth.ts,neon-auth-client.ts}`
- `scripts/qa/{label-synthetic.ts,cleanup-qa-records.ts}` (new), `docs/runbooks/{dsar-manual.md,backup-pitr.md,owner-technical-setup.md}`
- `apps/web/lib/i18n/ws/ws-d.ts`, `tests/e2e/verification/ws-d/**`, `docs/qa/2026-10-31/status/WS-D.md`

## WS-E Platform and UX system

- `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/fonts/**`, `apps/web/app/icon.svg`, `apps/web/proxy.ts` (the middleware: host redirect and headers), `apps/web/next.config.ts`
- `apps/web/app/operator/{page.tsx,[section]/page.tsx,operator-entry.tsx,workspace.tsx,workspace-types.ts,error.tsx,panel-heading.tsx,operator-overview.css}` and a new `apps/web/app/operator/layout.tsx`
- `apps/web/components/{site-header.tsx,site-footer.tsx,site-footer-view.tsx,skip-link.tsx,public-shell.tsx,customer-shell.tsx,customer-nav.tsx,workspace-shell.tsx,workspace-area-bar.tsx,role-navigation.tsx,language-provider.tsx,language-switcher.tsx,language-switcher.css,language-scripts.css,translated-main.tsx,corner-dock.tsx,phone-fold.tsx,session-events.ts,use-sign-out.ts,operator-icon.tsx,corridra-icon.tsx,arrow.tsx,access-state.tsx,private-capability.ts,fact-label.tsx}`
- `apps/web/components/ux/**`, `apps/web/lib/ux/**` except `customer-road.ts`, `apps/web/lib/notify.ts`, `apps/web/app/api/notifications/**`, `packages/communications/src/inbox.ts`
- `apps/web/lib/i18n/{locales.ts,messages.ts,fill.ts,pages.ts}` (infrastructure only; never another stream's block), `apps/web/lib/i18n/ws/ws-e.ts`, `apps/web/lib/canonical-origin.ts`, `apps/web/lib/address-store.ts`, `apps/web/lib/use-*.ts`
- `.github/workflows/ci.yml`, `playwright.verification.config.ts`, `scripts/qa/{verification-server.ts,ux-measure.ts}`, `tests/e2e/verification/{fixtures.ts,ws-e/**,integration/**}`, `tests/browser/**` harness files it adds, `tests/design-system.test.mjs` (token rule)
- `docs/qa/2026-10-31/status/WS-E.md`

## Lead

- `packages/db/**`, `packages/domain/**`, `packages/config/**`, `packages/workflows/**`, every `package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `vitest.config.ts`, `playwright.*.config.ts` other than the verification config
- `apps/web/lib/{ux-switches.ts,owner-switches.ts,workspace-navigation.ts,operator-urls.ts,foundations.ts}` (flag registry, navigation config, service wiring)
- `scripts/qa/seed-preview.ts`, `scripts/install-customer-modules.ts`, `.github/workflows/install-customer-modules.yml`
- `docs/qa/2026-10-31/*` except the status files, `docs/V3_LEDGER.md`, `docs/agents/work-log.md`, `docs/documentation-map.json`, `docs/PLAN_STATUS.md`, `tests/ux/ux-baseline.json`, `CORRIDRA_COMMERCIAL_READINESS_PROGRAM.md`

## Contracts built in Wave 0 (signatures fixed)

| Contract                                                                          | Path                                                                   | Owner after Wave 0 |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------ |
| `formatDateTime`, `formatDate`, `formatRelativeDue`, zone helpers                 | `apps/web/lib/ux/format.ts`                                            | WS-E               |
| `formatMoney`, `toMinor`, `currencyExponent`, `currencyOptions`                   | `apps/web/lib/ux/money.ts`                                             | WS-E               |
| `countryOptions`, `timeZoneOptions`                                               | `apps/web/lib/ux/options.ts`                                           | WS-E               |
| `SearchSelect`, `CountrySelect`, `CurrencySelect`, `TimeZoneSelect`               | `apps/web/components/ux/search-select.tsx`, `pickers.tsx`              | WS-E               |
| `MoneyInput`, `DateTimeInput`                                                     | `apps/web/components/ux/money-input.tsx`, `date-time-input.tsx`        | WS-E               |
| `ReferencePicker` and `GET /api/picker/<kind>?tenant=&q=`                         | `apps/web/components/ux/reference-picker.tsx`, `app/api/picker/[kind]` | WS-E UI, WS-D API  |
| `useFormDraft(key)`                                                               | `apps/web/lib/ux/use-form-draft.ts`                                    | WS-E               |
| `withStepUp`, `readJson`, `ActionError`, `StepUpDialog`                           | `apps/web/lib/ux/step-up.ts`, `components/ux/step-up-dialog.tsx`       | WS-E               |
| `stepUpRequired()` (HTTP 401, `code: STEP_UP_REQUIRED`)                           | `packages/domain/src/index.ts`, used by `withTenant`                   | WS-D (server use)  |
| `ActionFeedback`, `useActionFeedback`, `ErrorSummary`                             | `apps/web/components/ux/feedback.tsx`                                  | WS-E               |
| `PageHeader`, `StatusChip`, `pageMetadata`                                        | `apps/web/components/ux/page-header.tsx`, `lib/ux/page-metadata.ts`    | WS-E               |
| `customerRoad`, `customerStatusLabel`                                             | `apps/web/lib/ux/customer-road.ts`                                     | WS-B               |
| `notify(...)`, `InboxService`, `NotificationInbox`, `GET/POST /api/notifications` | `apps/web/lib/notify.ts`, `packages/communications/src/inbox.ts`       | WS-E               |
| `listDeliveredPublications`                                                       | `packages/delivery/src/delivered-publications.ts`                      | WS-C               |
| `getTeamToday`                                                                    | `packages/auth/src/team-today.ts`                                      | WS-D               |
| `assignRoute`                                                                     | `packages/missions/src/route-assignment.ts`                            | WS-C               |
| `createRoutePack`                                                                 | `packages/missions/src/route-pack-form.ts`                             | WS-D               |

## Schema module (lead, Wave 0)

`packages/db/commercial-readiness-migrations/0001_inbox_and_links.sql`, installed by `migrateCommercialReadiness` and by the owner's `Install customer modules` run (default installer list). It adds `app.inbox_notification` with recipient-only RLS and the `app.inbox_record` write function, nullable `mission_id` and `organisation_id` on `app.source_record` and `app.claim`, and nullable `recipient_email` on `customer_private.programme_invitation`. Team invitations needed no schema change: the operator invitation model already stores a 7-day `identity.verification` row, so resend is a new row and cancel is a revoke. Proof: `tests/integration/commercial-readiness-database.test.ts`. Indexes for `getTeamToday` and `listDeliveredPublications`: none added in Wave 0; a stream that needs one writes an integration note and the lead adds a reviewed `0002` file.

## Shared scaffolding

- Messages: one file per stream in `apps/web/lib/i18n/ws/ws-x.ts`, already merged into every catalog, so streams never edit the same lines.
- Flags: registered in `apps/web/lib/ux-switches.ts` and described in `apps/web/lib/owner-switches.ts`; on in the verification server, unset (off) in production.
- Operator workspace: the inline sources and evidence sections moved unchanged into `sources-panel.tsx` and `evidence-panel.tsx` so WS-D owns them without editing `workspace.tsx`.
- Verification: `playwright.verification.config.ts` (390, 768 and 1280 px), `scripts/qa/verification-server.ts`, `scripts/qa/seed-preview.ts` and a seed hook per stream in `tests/e2e/verification/ws-x/seed.ts`.
