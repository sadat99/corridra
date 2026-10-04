# ADR-001: Public launch and platform boundaries

Status: accepted for the initial public bootstrap

## Decision

Use a pnpm workspace with `apps/web`, Next.js App Router, React and strict TypeScript. Pin installed versions and use a committed lockfile. The first deployment serves a static coming soon experience without collecting personal information. Deploy the public page immediately after validation; future product releases add usable vertical slices.

Keep the modular-monolith boundaries and canonical PostgreSQL, evidence, event, tenancy and AI contracts from the implementation canvas. Add a domain package when it has an implemented responsibility. Turborepo is optional until multiple buildable packages justify it. Avoid creating empty packages that imply capabilities exist.

The user has explicitly authorized the initial commit, push and Vercel deployment. Bootstrap may be pushed to `main` if the repository accepts it. Following bootstrap, configure protected `main`, PR previews and checks before developing the main system. Do not bypass any branch protection already in force.

## Consequences

The public page can remain available without database, auth, AI, email or payment credentials. It makes no claim that mission delivery or network participation is available. All interactive links resolve to real content on the page. Data collection begins only after storage, authorization, retention and notices are implemented.

Next.js, React, pnpm and Node versions are recorded in manifests and the lockfile. Live processes do not survive a cloud snapshot. Vercel authentication is required to deploy; a successful local build is not evidence of a published site.

## Part 03 application boundaries

The modular monolith now has implemented packages: `domain` holds deterministic permissions and evidence transitions; `db` owns schemas, migrations and scoped transactions; `auth` owns the provider adapter and privileged access services; `evidence` owns provenance and file/review services; `config` validates environment guards. App Router handlers validate transport input and call these services. Client code imports only the identity client adapter and sends authenticated commands; database credentials never enter client bundles.

Database triggers enforce invariants and atomic events underneath these boundaries. Offline schema-owner provisioning is separate from request handling. There are no empty mission, money, AI or network modules. Keep those future domains out of Part 03. Splitting into independent services would add distributed transactions and deployment overhead without demonstrated need; the package boundaries leave that option open later.
