# UX-01 validation

Baseline: `1e0dbea6f146265b256ca89b5482e789f97acdd9`. Tests use local synthetic PostgreSQL and malware scanning; customer providers and production operations are not activated. Original domain packages, API handlers, migrations, source documents, recovery resource implementation and lockfile have no diff against this baseline.

## Baseline evidence

Baseline integration: 199 tests / 24 files passed. Existing protected operator workflows: 7 passed. Public browser suite: 60 passed after releasing the capture server's occupied port. Production build, lint, type checks and document/infrastructure tests passed. Initial format-check failure included new unformatted audit artifacts and scratch references; it was not silently recorded as a pass. See `evidence/baseline/results.json` and the review packet for this distinction.

## Final execution

Final suite results and sanitized logs are saved in `evidence/after/`. The exact final commit is the PR head containing this report; the tested code and evidence are committed together. No application files change after these results. A subsequent capture-only correction disables smooth scrolling during screenshots; all three UX-01 scenarios passed again (evidence/after/focused-final.log).

- Formatting, lint and type checks: passed. Document checks: 9 passed; infrastructure checks: 7 passed.
- Real database integration: 199 passed across 24 files. Production build: passed. Public browser suite: 62 passed across desktop/mobile. Protected operator suite: all 10 passed (7 existing workflows plus 3 new UX-01 scenarios).
- Gitleaks 8.30.1 Git-history scan: zero findings. Production dependency audit: no known vulnerabilities. The first scanner invocation lacked the managed Node proxy; rerunning with `NODE_USE_ENV_PROXY=1` succeeded.
- Automated browser accessibility: zero axe violations across 30 public/access route × viewport observations before and after. No horizontal document overflow at any measured width. Authenticated mission section accessibility is checked by its protected test.
- Real boundaries in UX-01 tests: operator password and TOTP, tenant-scoped mission reads, anonymous and unrelated-tenant denial, viewer write denial, actual session expiry, actual PostgreSQL TCP outage/recovery. Only an outage transport response and delayed response timing are intercepted; no authorization success is mocked.
- Recovery test exposed an empty-link fragment loss. Full-document reload now preserves the complete URL and the test verifies the correction.

## Limits and outstanding acceptance

This is UX-01 acceptance evidence, not 100% programme coverage. Static discovery includes every baseline filesystem route and control expression, but does not expand every dynamic row or prove every possible role/state combination. Those source-control rows remain NOT_YET_VERIFIED. The bounded UX-01 scenario records link actual positive and negative tests; the whole-programme matrix remains available for UX-02–06.

Customer email-provider lifecycle and production infrastructure are not exercised here. Local paint/navigation values are measured samples, not field LCP/INP or production budgets. Desktop/mobile screenshots establish reviewed presentations, not a guarantee for every possible source-text length. Existing external production gates remain open.

No merge or deployment has occurred. Review the PR and authorize acceptance separately before starting UX-02. Rollback is a revert of this presentation/test/documentation diff; no migration or data rollback is required.
