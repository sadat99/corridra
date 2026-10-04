# ADR-004: Claims, evidence and verification stay distinct

Status: implemented locally; EU object store and cloud scanner pending.

Preserve source, self-declared claim, immutable evidence object, scan report, independent verification and canonical fact as separate records. A fact copies the reviewed claim exactly. Composite foreign keys and provenance triggers prevent cross-tenant links or weakened classification/purpose. Source and evidence retain observation/creation dates, author, retention deadline and AI policy. Verification adds reviewer, method, scope and validity. No inference or recommendation automatically becomes a verified fact.

Accept PDF, PNG and JPEG with matching file signatures and declared MIME, SHA-256 and a 4 MiB maximum, compatible with the Vercel request size limit. Signature checks establish a permitted container format, not that all content is safe. Private S3 objects use random immutable keys, encryption and conditional create. New versions create new objects. Download is authenticated, forced as an attachment, hash checked, and denied while quarantined or past retention.

`SUBMITTED` starts with `PENDING` scanning. A real scanner's clean result and matching hash permit `UNDER_REVIEW`. Malware rejects the object; scanner/storage errors leave it unavailable and retryable. Only an independent authorized reviewer with fresh MFA can verify clean evidence. Scan reports, verifications and facts are immutable. The review service locks state to prevent concurrent decisions. Database triggers independently enforce legal transitions and provenance.

The S3 and scanner adapters are replaceable. Local tests exercise the real ClamAV engine and the S3 SDK against a local HTTP contract server; the latter is not an AWS deployment test. ClamAV TCP must be private/trusted in a cloud deployment, with current signatures and monitoring. Do not expose an unauthenticated scanner on the internet. Uploads remain disabled until that deployment and EU storage checks pass.

Synthetic source retention is at most 30 days. The supplied synthetic-only bucket expires objects after 35 days and old versions after seven more days, including failed database-write orphans. Lifecycle rules must not be reused for production legal-hold records. Full DSAR, retention execution and legal-hold workflows belong to later production hardening; no personal data is admitted here.
