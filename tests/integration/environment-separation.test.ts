import { test, expect } from 'vitest';
import { validateEnvironmentPlan } from '../../packages/config/src/environments';
const resource = (i: number) => ({
  projectId: 'synthetic-project-' + i,
  branchId: 'br-synthetic-' + i,
  databaseHost: `ep-synthetic-${i}.eu-central-1.aws.neon.tech`,
  databaseName: 'corridra',
  authHost: `ep-synthetic-${i}.neonauth.c-5.eu-central-1.aws.neon.tech`,
  storageId: 'synthetic-store-' + i,
  credentialRef: 'ENVIRONMENT_SECRET_' + i,
  region: 'aws-eu-central-1',
  data: 'SYNTHETIC',
});
const plan = () => ({
  synthetic: resource(1),
  candidate: resource(2),
  production: { ...resource(3), data: 'REAL_CUSTOMER' },
  approvals: {
    jurisdiction: null,
    retention: null,
    storage: null,
    communications: null,
    operations: null,
    pilot: null,
    rollback: null,
  },
});
test('distinct environment design never substitutes IDs for approval evidence or activates real data', () => {
  const r = validateEnvironmentPlan(plan());
  expect(r.separationValid).toBe(true);
  expect(r.realDataActivation).toBe(false);
  expect(r.missingApprovalReferences).toHaveLength(7);
});
test('live data, shared storage, shared identity and reused credential references are denied for previews', () => {
  for (const field of [
    'projectId',
    'databaseHost',
    'authHost',
    'storageId',
    'credentialRef',
    'branchId',
  ]) {
    const p = plan();
    Object.assign(p.synthetic, { [field]: p.production[field as keyof typeof p.production] });
    expect(() => validateEnvironmentPlan(p)).toThrow('distinct');
  }
  const p = plan();
  p.synthetic.data = 'REAL_CUSTOMER';
  expect(() => validateEnvironmentPlan(p)).toThrow('synthetic');
});
test('secret values, unapproved region and unknown policy fields cannot enter a metadata plan', () => {
  for (const extra of [
    { apiKey: 'never-submit-secret-values' },
    { region: 'aws-us-east-1' },
    { code: 'arbitrary expression' },
  ]) {
    const p = plan();
    Object.assign(p.production, extra);
    expect(() => validateEnvironmentPlan(p)).toThrow();
  }
});
