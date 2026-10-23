/**
 * Open gaps for the Owner page. The work, required-before and status text are copied from
 * docs/implementation/deferred-controls.md. A test compares them with that register, so this list
 * cannot drift from it. Nothing here claims a gap is closed.
 */
export type OwnerGap = {
  id: 'D01' | 'D02' | 'D03' | 'D04' | 'D05' | 'D06' | 'D08';
  work: string;
  requiredBefore: string;
  status: string;
};

export const ownerGaps: OwnerGap[] = [
  {
    id: 'D01',
    work: 'EU cloud malware scanner, authenticated/private connectivity, signature updates and health monitoring',
    requiredBefore: 'Scanner-backed file validation and retirement of the bypass',
    status: 'Deferred; explicitly authorized BYPASSED mode',
  },
  {
    id: 'D02',
    work: 'Main ruleset, required validate CI, no force pushes/deletion and review when a second trusted maintainer is available',
    requiredBefore: 'Unattended releases or real pilot',
    status: 'Deferred; manual PR releases',
  },
  {
    id: 'D03',
    work: 'Private-repository secret scanning and push protection, or an explicitly reviewed supported alternative',
    requiredBefore: 'Real pilot',
    status: 'Deferred; plan support unverified',
  },
  {
    id: 'D04',
    work: 'Code Security entitlement and actual CodeQL execution',
    requiredBefore: 'Real pilot',
    status: 'Deferred; skipped is not passed',
  },
  {
    id: 'D05',
    work: 'Planned private EU S3, scoped IAM, retention/lifecycle, version recovery and reconciled Blob migration',
    requiredBefore: 'Production evidence',
    status: 'Deferred; dedicated synthetic Blob only',
  },
  {
    id: 'D06',
    work: 'Reviewed Blob orphan/expiry cleanup',
    requiredBefore: 'Ongoing live synthetic uploads',
    status: 'Deferred; review retained objects before cleanup',
  },
  {
    id: 'D08',
    work: 'Production identity recovery, privacy/legal/retention and operational readiness',
    requiredBefore: 'Customer data or real pilot',
    status: 'Future work; no customer import',
  },
];

/**
 * A live signal only where one really exists in this deployment's settings. The scanner is the one
 * gap that has such a signal. For every other gap the register text is the only evidence.
 */
export function gapSignal(id: OwnerGap['id'], env: NodeJS.ProcessEnv = process.env): string | null {
  if (id !== 'D01') return null;
  if (env.EVIDENCE_SCAN_MODE === 'bypass') return 'This deployment sets the scanner to bypass.';
  if (env.CLAMAV_HOST) return 'A scanner address is set in this deployment.';
  return 'No scanner address is set in this deployment.';
}
