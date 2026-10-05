# Evidence storage: Blob now, S3 later

## Current synthetic Blob configuration

The Part 03 branch uses the empty dedicated `store_C84BIU3MhR34CyTX`, confirmed by the owner as `fra1, Private`. Bind these only to `feat/part-03-foundations`:

| Setting                     | Value/source                        |
| --------------------------- | ----------------------------------- |
| `EVIDENCE_STORAGE_PROVIDER` | `vercel-blob`                       |
| `EVIDENCE_BLOB_REGION`      | `fra1`                              |
| `BLOB_STORE_ID`             | The explicit dedicated store ID     |
| `BLOB_READ_WRITE_TOKEN`     | Secure server-only store credential |

The provider uses private access and refuses public or wrong-store confirmations. Never use `NEXT_PUBLIC_` for its credential. The SDK chooses its actual store from the token; the adapter verifies the token's store selector and the returned object identity. Region must match reviewed account settings. Do not share a store/token with production or other previews.

For Codex checks, the SDK needs the direct secure runtime token because it extracts the store selector locally. Use the configured HTTPS proxy and `NODE_USE_ENV_PROXY=1`, with `vercel.com` and `*.private.blob.vercel-storage.com` allowed. Do not unset the proxy or disable TLS. `node --import tsx scripts/blob-storage-check.mjs` requires an empty store, writes a unique harmless synthetic PDF, checks private read, duplicate-write denial and anonymous denial, and deletes only its own probe. It writes non-secret evidence in ignored `.cache`.

The actual cloud probe passed. The adapter integration test uses the real SDK against a local HTTP contract server and the real local ClamAV engine to verify quarantine and authenticated tenant access. Neither the local scanner nor an installed adapter establishes a deployed scanner. Keep upload flags off until private cloud scanning and the remaining Part 03 deployment gates pass.

Blob has no S3 lifecycle policy. Before any synthetic upload trial, review orphan and expiry cleanup with an offline administrator: reconcile `quarantine/` object metadata with database references, inspect retained/pending records and delete only explicitly approved expired synthetic/orphan objects. Never infer a legal-hold deletion policy from this temporary preview. No automatic Blob cleanup or object-version recovery is claimed.

## Switch new uploads to S3

Provision the planned private versioned EU bucket from `infrastructure/evidence-storage.yaml`. Verify actual region, TLS/encryption, public blocks, versioning, lifecycle, scoped IAM and a recovery drill. Runtime permissions remain limited to GetObject/PutObject under `quarantine/`; migration credentials stay in offline tooling.

Set `EVIDENCE_STORAGE_PROVIDER=s3`, `EVIDENCE_BUCKET` and `EVIDENCE_REGION`, and provide the AWS SDK credentials securely. For old Blob objects, set `EVIDENCE_BLOB_READS_ENABLED=true` and retain the existing Blob settings/token. New references point to S3; existing Blob references continue to use the original store. Old unqualified `quarantine/<tenant>/<object>` references continue to use the configured legacy S3 bucket. Changing provider does not automatically copy objects.

## Copy existing Blob evidence and retire its token

1. Review the non-production source and the destination bucket. Keep production credentials and data out of this synthetic tool. Switch new writes to S3 first so no new Blob reference appears during the copy.
2. Export the complete set of retained Blob evidence metadata from the authorized offline database, including objects still quarantined. Preserve the original hashes and byte counts. Save a reviewed manifest in ignored `.cache/evidence-migration.json`, with `sourceStoreId`, `targetBucket`, `dataEnvironment: "synthetic"` and `records`. Each record contains `objectKey`, `mime`, `sha256` and numeric `size`. Include each immutable reference once; no passwords, sessions, uploaded bytes or personal text belong in it.
3. Supply `DATA_ENVIRONMENT=synthetic`, the S3 selection/bucket/region and both source Blob and target S3 credentials through secure tooling settings. Leave `EVIDENCE_MIGRATED_BLOB_STORE_ID` unset. Run `pnpm exec tsx scripts/migrate-evidence-storage.ts .cache/evidence-migration.json` separately from the build. The tool checks source/target IDs, copies conditionally and verifies source and target hash/length. On failure, retain both providers and investigate; a retry never overwrites a different target object.
4. Reconcile the manifest with database counts and all intended records. The tool reports a manifest hash and copied count in `.cache/evidence-s3-migration-result.json`. Keep that non-secret evidence and verify tenant denial, quarantine, clean download and recovery against S3.
5. Set `EVIDENCE_MIGRATED_BLOB_STORE_ID` to the original store ID, clear `EVIDENCE_BLOB_READS_ENABLED`, and remove the Blob token and region variables from app runtime. Keep the S3 settings. The router resolves the original immutable Blob references to their verified S3 copies under the same logical paths. No metadata mutation, permission change or verification-state transition occurs.
6. Retain Blob originals until the operational recovery and retention decision is complete. The copy tool deliberately does not delete them. To roll back before retirement, clear the migrated-store setting and restore the transitional Blob read configuration. Do not delete the original store merely because copying completed.

The copy and routing behavior is tested locally, including retries and hash mismatch. A real S3 migration is not executed or claimed while AWS infrastructure/credentials are absent. Production migration requires a separately reviewed production procedure and controls.
