# ADR-012: Preview branches only from a sterile non-production parent

Status: lifecycle tooling implemented; live account execution pending.

Production and non-production must have distinct Neon project IDs. Preview creation validates both names/regions, an explicitly selected non-production parent named `synthetic`, and the database host against that parent's API endpoint. It reads all app/identity tables and refuses a parent containing any rows other than factual country/corridor primitives. The sterile parent contains reviewed schema and migration hashes. Accounts are seeded separately on each child; password/session records are never inherited.

One branch named `corridra-pr-<number>` is created per PR. The script is repeatable, refuses mismatched parents and never deletes the parent or protected branches. Close the preview by deleting only that matched child and removing its branch-scoped Vercel secrets. Do not depend on Neon's early-access automatic expiry. An account operator must run cleanup while automated account integration is pending.

Preview runtime receives only restricted branch credentials. A separate migration job receives the child schema-owner credential. Vercel builds have no migration hook. Bind the exact preview origin and a unique auth secret to that branch. Test authentication, RLS, uploads and revocation against the deployed URL before acceptance. The app's `DATA_ENVIRONMENT=synthetic` flag is a guard, not independent proof of isolation.

Current account findings: the supplied database host is US East; Vercel contains Neon integration variables scoped to both preview and production, plus a deployment token in app environments. No credential values were disclosed and those resources were not modified. These shared scopes must be reviewed and separated before enabling a data preview. The current Vercel token cannot query integration-owned resource metadata (HTTP 403). GitHub branch-protection inspection also returned HTTP 403. Config files and API scripts do not prove those account controls are active.
