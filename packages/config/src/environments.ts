import { z } from 'zod';
const resource = z
  .object({
    projectId: z.string().min(3).max(100),
    branchId: z.string().min(3).max(100),
    databaseHost: z.string().regex(/^[a-z0-9.-]+\.neon\.tech$/),
    databaseName: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    authHost: z.string().regex(/^[a-z0-9.-]+\.neon\.tech$/),
    storageId: z.string().min(3).max(100),
    credentialRef: z.string().regex(/^[A-Z][A-Z0-9_]{2,99}$/),
    region: z.enum(['aws-eu-central-1', 'aws-eu-west-1', 'aws-eu-west-3']),
    data: z.enum(['SYNTHETIC', 'REAL_CUSTOMER']),
  })
  .strict();
export const environmentPlan = z
  .object({
    synthetic: resource,
    candidate: resource,
    production: resource,
    approvals: z
      .object({
        jurisdiction: z.uuid().nullable(),
        retention: z.uuid().nullable(),
        storage: z.uuid().nullable(),
        communications: z.uuid().nullable(),
        operations: z.uuid().nullable(),
        pilot: z.uuid().nullable(),
        rollback: z.uuid().nullable(),
      })
      .strict(),
  })
  .strict();
export function validateEnvironmentPlan(input: unknown) {
  const p = environmentPlan.parse(input),
    resources = [p.synthetic, p.candidate, p.production];
  for (const r of resources) {
    const suffix = '.' + r.region.replace('aws-', '') + '.aws.neon.tech';
    if (!r.databaseHost.endsWith(suffix) || !r.authHost.endsWith(suffix))
      throw new Error('Declared hosts must match their approved EU region');
  }
  if (p.synthetic.data !== 'SYNTHETIC')
    throw new Error('Development and preview must use synthetic data');
  for (const key of [
    'projectId',
    'databaseHost',
    'authHost',
    'storageId',
    'credentialRef',
  ] as const)
    if (new Set(resources.map((r) => r[key])).size !== 3)
      throw new Error('Environment resources and credential references must be distinct: ' + key);
  if (new Set(resources.map((r) => r.branchId)).size !== 3)
    throw new Error('Each environment requires a distinct branch');
  const missing = Object.entries(p.approvals)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  // IDs are references to approval evidence, not evidence that approvals exist or remain valid.
  return {
    separationValid: true,
    realDataActivation: false,
    approvalReferences: p.approvals,
    missingApprovalReferences: missing,
    blockedReason: missing.length
      ? 'BLOCKED: external prerequisite; missing reviewed approval evidence'
      : 'BLOCKED: external prerequisite; verify referenced approvals and provider bindings independently before activation',
    plan: p,
  };
}
