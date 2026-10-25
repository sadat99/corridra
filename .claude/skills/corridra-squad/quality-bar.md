# Corridra quality bar

The standard: a top engineering team reviewing this repository should find it as clean, safe and easy to run, change and grow as anything they have built, and its users should find it simple. Every change the squad ships meets all of this. The architect plans against it, the builder meets it before returning, the reviewer hunts against it and reports each miss as a finding with its category. It adds to the rules in `AGENTS.md`, the V3 contract and the ADRs in force; where they say more, they win.

## Clean

- Reads like the code around it: same naming, structure, comment density and idiom. Nearby code is the style guide, not the architecture.
- One job per function and per file. Names say what a thing is or does; no abbreviations a new reader must decode.
- Reuse the existing service, component or helper before writing a new one. No second copy of logic that already exists.
- No dead code, commented-out code, debug output, unused exports or leftover experiments.
- Types are precise: no `any`, no unchecked casts, no non-null assertions that hide a real absent case.

## Secure

- Every server entry point checks identity and authority before reading or writing, with tenant isolation enforced in the database as well as in code.
- Validate every input at the boundary (request bodies, query strings, headers, file uploads, provider callbacks) with a schema; reject what does not parse.
- Database access is parameterised. No string-built SQL, no dynamic identifiers from input.
- Secrets live only in secure settings. Never in code, tests, fixtures, logs, error messages or client bundles. Private responses carry the private cache headers.
- Errors shown to a person say what to do next and leak no internals (stack, SQL, ids of other tenants).
- A new dependency needs a reason no existing one covers, a pinned version and a maintained source.

## Easy to use

- Security protects without getting in the way. Match each control to the real risk of what it guards: strong checks on money, permissions, private data and account changes; no extra steps, prompts or re-entry where nothing sensitive is at stake.
- Prefer protection a person never sees (server-side checks, sensible defaults, safe limits) over protection they must perform.
- The common task takes the fewest steps the rules allow, works on a phone at the smallest supported width, and recovers from mistakes without starting over.
- Every block or denial says why in plain words and what to do next.
- A new safeguard that adds friction states, in the plan, the risk it removes and why a lighter option is not enough.

## Durable

- Writes are safe to retry: idempotency keys or expected-version checks where a retry or a double click could repeat an effect.
- Money, evidence and events are append-only with exact original values; migrations are additive and reversible by a forward migration.
- Every external call has a timeout, a handled failure and a state a person can recover from.
- Loading, empty, error, denied and conflict states are real, not only the happy path.
- New behaviour ships behind its switch when the brief says so, and switch-off behaves exactly as before.

## Maintainable

- Tests describe behaviour in their names and cover the acceptance checks: positive, denial and recovery. A test that cannot fail is not a test.
- A contract change has its ADR; a changed procedure has its runbook update; a finished plan has its status word changed.
- Anything an operator must do is written as exact steps where operators already look.
- Small, reviewable commits with messages that say why.

## Easy to change and scale

- Clear module boundaries with one owner each; a change in one area does not ripple through unrelated ones. Shared behaviour lives in a shared service, not in copies.
- Behaviour that varies by country, customer or plan is configuration and versioned data, never a code fork.
- Public and internal interfaces are explicit and typed; changing one is additive first, with the old shape kept until every caller has moved.
- Upgrading a dependency, the framework or the runtime is routine: pinned versions, no reliance on private internals, tests that would catch a breaking change.
- Designed for growth from the start: work that can grow runs in bounded batches or background jobs, and nothing assumes one tenant, one region, one currency or one language.
- A capable engineer new to the repository can find where a behaviour lives, why it is that way (ADR, plan, work log) and how to change it safely, from the repository alone.

## Observable

- Failures that matter are logged once, with enough context to act and no personal data or secrets.
- Anything that can silently stop working (a job, a sender, a sync) has a way to see that it stopped.

## Fast enough

- No query in a loop, no unbounded list, no unindexed lookup on a growing table.
- Pages stay within the UI direction's budgets; heavy assets load only where they are used.
