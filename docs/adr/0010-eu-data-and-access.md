# ADR-010: EU-primary storage and explicit access purpose

Status: enforced by application configuration; cloud resource acceptance pending.

Use an approved EU Neon region and EU S3 bucket. Startup rejects US database hosts, weak remote TLS mode, shared auth/runtime usernames and databases that differ between those roles. Part 03 is synthetic-only and refuses activation in Vercel production. The public site remains data-free with these features disabled.

Store classification, purpose, retention and AI-use policy on provenance. Child records inherit policy in both services and SQL. Membership scopes restrict recorded operating countries, purposes and classifications. AI has no call path, credentials or authority in this part. Metadata policy is a prerequisite for a later AI gateway, not a claim that an AI governance workflow exists.

Never use a production database or user records to test. Use `example.invalid` synthetic accounts. Treat auth secrets and scanner/storage credentials as environment-scoped secrets; never emit them in logs, test artifacts or documentation. Operator browser tests disable screenshots, tracing and video around real test credentials.

EU residency alone does not establish GDPR compliance. Before personal data or international access, confirm controller/processor roles, notices, contracts, lawful basis, transfer safeguards, retention and legal holds with qualified counsel. Operational country flags cannot substitute for that review. These unresolved prerequisites block production data, not synthetic local engineering.
