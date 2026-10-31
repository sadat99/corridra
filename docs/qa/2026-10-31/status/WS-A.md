# WS-A status: public site and request intake

Document status: CURRENT, DATED 31 Oct 2026. Branch `worktree-agent-a068844025cc3d03e`, from `b57cf69`.

State: DONE

Items: CQ-04=DONE, CQ-05=DONE, CQ-11=DONE, CQ-13=DONE, CQ-14=DONE, CQ-15=PARTIAL(countries listed by name in the shown language with BD, CN, ES first, then the EU, through the `countryOptions` contract, in the native select; the `CountrySelect` combobox is not adopted because about twenty existing browser specs drive these selects with `selectOption`), CQ-16=DONE, CQ-18=DONE, CQ-19=DONE, CQ-25=DONE, CQ-38=PARTIAL(subtitle and the 14 character rule shown before submit on /signup through a local `signup-access.tsx`; placing the rule directly under the password field needs `account-form.tsx`, WS-B), CQ-41=DONE, CQ-43=DONE, CQ-44=DONE, CQ-45=PARTIAL(`/signin?next=` keeps a safe internal page through the reviewed ADR-067 list and becomes `returnTo`; the account pages that send people to sign-in are WS-B and still redirect without `next`), CQ-49=DONE, CQ-53=DONE, CQ-58=PARTIAL(no signed-in customer proof exists on the intake route, so `notify(REQUEST_RECEIVED)` is not called here; the claim records the sent request once in tab storage for the account page; the success panel belongs on the WS-B request page), UX-08=DONE, UX-14=DONE, Appendix B on WS-A pages=DONE (real use shows no pattern; without real use the form and the preview notice version are marked `data-madeup-panel`)

Gates (worktree, 31 Oct 2026):

- `pnpm format:check` exit 0
- `pnpm lint` exit 0
- `pnpm typecheck` exit 0
- `pnpm test` exit 0 (63 node tests, 7 python tests)
- vitest under the DB lock, 13 files exit 0 (349 tests): language-form, language-catalog, language-pages, privacy-notice, account-return, ux-front-door, ux-front-doors, ux-first-question, ux-teaching-layer, pending-notice, ux-fairs, ux-pulse, commercial-readiness-contracts
- `flock /tmp/corridra-build.lock pnpm build` exit 0
- `pnpm test:verification tests/e2e/verification/ws-a` exit 0 on the final build (27 passed: 9 cases at 390, 768 and 1280 px)
- Browser specs whose copy changed, `pnpm exec playwright test` on product-experience, ux02-discovery, any-route, ux06-presentation, public-experience: exit 0 (78 passed over two runs)
- Operator specs touching /plan (`--config playwright.operator.config.ts`): real-use-intake and ux-first-question 48 passed; ux-plan-languages and z-ux02-intake 102 passed, then the 7 that expected the raw status re-run after the D6 label update: exit 0 (7 passed)
- `test:ux` AC/1 gate on the 18 WS-A routes (`-g`): exit 0 (18 passed), no baseline change needed
- Full `pnpm test:integration`, `test:operator`, `test:e2e`, `test:ux`: not run here (shared machine); CI on the integration PR. `tests/operator/workspace.spec.ts` got the same one-line D6 label change as z-ux02 and was not run locally.

Verification cases: V-10 (submit part) PASS, V-49 PASS, A-1 PASS, A-2 PASS, A-3 PASS, A-4 PASS, A-5 PASS, A-6 PASS, plus CQ-53 PASS. Specs: `tests/e2e/verification/ws-a/{public-copy,plan,access}.spec.ts`. No seed data needed.

Integration notes:

- WS-B: account pages redirect to `/signin`; send `/signin?next=<path>` so CQ-45 keeps the page (the sign-in page applies the ADR-067 list).
- WS-B: in `components/account-form.tsx` show "Your password needs at least 14 characters." under the signup password field with `aria-describedby`; then `app/signup/signup-access.tsx` can drop its own line.
- WS-B: `components/account-access.tsx` still says "Prepare an example request without an account" and "account and test intake notice" without real use (forgot, reset and verify pages); A-1 skips those pages for that reason.
- WS-B: on `/account/requests/[id]` call `takeSentRequest(sessionStorage, id)` from `apps/web/lib/private-request-storage.ts` and, when true, show "Request sent", what happens next and the D6 label (CQ-58).
- WS-B or lead: call `notify({ type: 'REQUEST_RECEIVED', ... })` inside `packages/auth/src/customer-requests.ts` (`submit` and `claimPending`), where the customer proof exists; the intake route has none.
- Lead: `tests/operator/ux-plan-languages.spec.ts` compares the form with a baseline commit; it now names WS-A commit `93cc41a` (was PR 214 `c29f2cc`) because the English form changed on purpose. Merge this branch without squashing, and after the program reaches main point it at the main commit with the same `app/plan/page.tsx` and `intake.tsx`.
- Lead: add the 14 `wsa.plan.*` keys and the new home keys (`home.step.{define,find,compare,visit,decide,follow}.*`, `home.proof.prev`, `home.proof.next`) to `docs/qa/2026-10-31/i18n-review.md` as "draft, needs native review".
- Lead: the home page now has six steps and two carousel buttons below 70rem; if `test:ux` moves a home count, re-measure `tests/ux/ux-baseline.json`.
- Lead: RESULTS.md owner checklist line per D4 ("Confirm Corridra Pte Ltd registration and real UEN before the first real invoice.").
- WS-E: the site header CTA reads "Start a request (sample...)" without real use; outside the WS-A pages.

Decisions taken:

- D5 home words live in `lib/i18n/home-words.ts` as `home.*` keys, because the language tests allow only `home.` keys on the home page; all other new words are `wsa.*` in `lib/i18n/ws/ws-a.ts`, seven languages, drafts.
- Without real use (preview, local) the request form is a made-up data panel; its test wording stays because that mode really refuses real details. Production runs real use, where none of it shows.
- Schema messages are unchanged (the catalogues key on them); English display maps the library wording to plain text (`plainMessage` in `app/plan/form-words.tsx`).
- The receipt check shows `customerStatusLabel(status, true)`, so a sent request reads "Received, waiting for review" (D6); two operator specs now expect that label.
- `/signin?next=` reuses `accountReturnTo` unchanged; no destination outside the reviewed list is added.
- CQ-01 on /plan (lead note from WS-E): the form's own summary takes focus only when a check runs (a `focusSummary` ref set in `validate()`); typing never moves focus (A-2 proves it at three widths). The shared `<ErrorSummary>` is not adopted because the language specs and the baseline form comparison key on the existing `.ux-error-summary` markup. If WS-E's integration spec needs the shared component, the lead can swap it in `intake.tsx`. /plan does not call `notify()`.
