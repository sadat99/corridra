# ADR-015: Production-domain rollout with explicit unscanned evidence

Status: authorized by the user's explicit instruction on 2026-10-05; release evidence is recorded separately. Supersedes ADR-014's preview-only and upload-disabled rollout limits.

The user requested the currently implemented system at https://corridra.vercel.app, with cloud scanning and account controls deferred and scanning bypassed temporarily. Promote the reviewed Part 03 branch through the authenticated Vercel deployment API. Do not merge around GitHub rules, spoof authors or silently claim later product parts are built. Keep the existing public routes and expose the operator workspace at /operator.

Production-domain activation requires both CORRIDRA_FOUNDATIONS_ENABLED=true and CORRIDRA_LIVE_ROLLOUT_ENABLED=true. Runtime remains explicitly DATA_ENVIRONMENT=synthetic with the separate Frankfurt restricted-role database already validated. It can be exercised on the live domain; no customer import or public signup is added. Public-domain placement is distinct from production-data readiness. Management and schema-owner credentials never enter the app.

The default evidence policy still requires a clean real scan. The temporary exception requires EVIDENCE_SCAN_MODE=bypass in runtime and a latest owner-authorized evidence.scan_bypass tenant flag. The database permits it only for a synthetic tenant. Files still start SUBMITTED/PENDING. Authorization, 4 MiB maximum, MIME inspection and an exact hash/length check precede an append-only BYPASSED report with engine owner-authorized-bypass. No CLEAN malware verdict is fabricated. The eligible state becomes UNDER_REVIEW and the UI labels the file Not scanned. Download links identify unscanned files; responses retain attachment/no-store/nosniff and expose X-Corridra-Malware-Scan.

Verification concerns claim content. It still requires a different reviewer, fresh MFA, valid retention and policy inheritance. BYPASSED does not imply malware safety, and remains visible even if content is verified. Default runtime blocks access to bypassed files. Turning off the tenant flag blocks bypassed downloads/review immediately. Cross-tenant access and revoked sessions remain denied.

Adding the real scanner later uses EVIDENCE_SCAN_MODE=required. Existing BYPASSED files can be rescanned under authorization. A real CLEAN report restores normal access. A failed scan leaves the historical unscanned state intact and unavailable under required mode. An infected result rejects unverified evidence or expires already verified evidence without rewriting history. Original report/verifications remain append-only.

Track scanner hosting and signature updates, account protection, CodeQL, S3 migration/retention/recovery and genuine Git deployment integration in the deferred controls register. These controls are deferred, not passed. The release must record the exact deployed SHA, live domain, real browser/API acceptance and the limits above.
