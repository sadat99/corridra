import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The staff billing route sends each action to the right command. Reversing a sample payment is an invoicing
// action, so it must reach the invoicing command and stop at the invoicing switch like issue, payment and credit.
const calls = vi.hoisted(() => ({ invoicing: [] as unknown[], billing: [] as unknown[] }));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    provider: { getSession: async () => ({ token: 'staff-token' }) },
    customerInvoicingStaff: {
      command: async (_ctx: unknown, input: unknown) => (calls.invoicing.push(input), { ok: true }),
    },
    customerBillingStaff: {
      command: async (_ctx: unknown, input: unknown) => (calls.billing.push(input), { ok: true }),
      revisePlan: async () => ({ ok: true }),
    },
    config: { APP_ORIGIN: 'https://corridra.example.invalid' },
  }),
}));
import * as route from '../../apps/web/app/api/workspace/customer-billing/route';

const origin = 'https://corridra.example.invalid';
const tenant = '11111111-1111-4111-8111-111111111111';
const post = (body: unknown) =>
  route.POST(
    new Request(`${origin}/api/workspace/customer-billing?tenant=${tenant}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const reverse = {
  action: 'reverse',
  invoiceId: '22222222-2222-4222-8222-222222222222',
  commandId: '33333333-3333-4333-8333-333333333333',
  paymentSeq: 1,
  reason: 'Synthetic payment entered in error',
};

describe('staff billing route sends invoicing actions to the invoicing command', () => {
  beforeEach(() => {
    calls.invoicing.length = 0;
    calls.billing.length = 0;
    vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
    vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'true');
    vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
    vi.stubEnv('CORRIDRA_CUSTOMER_BILLING_ENABLED', 'true');
    vi.stubEnv('CORRIDRA_CUSTOMER_INVOICING_ENABLED', 'true');
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const action of ['issue', 'payment', 'credit', 'reverse']) {
    test(`${action} reaches the invoicing command and nothing else`, async () => {
      const response = await post({ ...reverse, action });
      expect(response.status).toBe(200);
      expect(calls.invoicing).toHaveLength(1);
      expect(calls.billing).toHaveLength(0);
    });
  }

  test('reverse stops at the invoicing switch and reaches no command', async () => {
    vi.stubEnv('CORRIDRA_CUSTOMER_INVOICING_ENABLED', 'false');
    const response = await post(reverse);
    expect(response.status).toBe(503);
    expect(calls.invoicing).toHaveLength(0);
    expect(calls.billing).toHaveLength(0);
  });
});
