# UX-04 validation

Dated phase inventory/validation record. Its counts, execution results and open issues belong to the captured revision, not an exhaustive current audit. See [the programme index](../README.md) and [current plan](../../implementation/current-plan.md). Preserve the paired ledger and evidence manifests; source discovery is not functional verification.

Accepted UX-03 main CI run `38617980749` passed. Baseline operator execution passed eleven cases; a new capture hook ran after the existing sign-out and failed to locate its panel, after the financial assertions had already passed. The hook now runs before sign-out. Its missing baseline images were captured by reopening the same fixed local synthetic database through actual MFA, with no financial/data reset. All 36 baseline observations report no axe violations and no document overflow.

The first local lint run rejected accessing event callbacks through an object carrying a React ref. Destructuring the ref and callbacks resolved the lint error without changing their behavior. The first auxiliary capture configuration used its config directory as cwd; specifying the repository cwd fixed the tool setup. These are initial findings, not passing checks.

Final local checks passed: formatting, lint, type checks, 9 document and 7 infrastructure checks, 199 integration tests in 24 files, production build, 72 public browser tests and all 12 protected tests. After evidence includes 36 actual operator viewport observations with zero axe violations or document overflow. Exact-head CI remains required before the owner-authorized merge and deployment. Source reconciliation found 379 original native controls across seven affected modules and no missing control/input/link contracts; it is not a runtime coverage claim.

All new assertions use real operator MFA, restricted tenant boundaries and domain services. Only transport interruptions inherited from earlier tests are injected. Original financial values, append-only compensations, source/claim semantics and exact exported artifact bytes remain required regression evidence.
