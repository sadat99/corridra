import { afterEach, describe, expect, test, vi } from 'vitest';
import { foundations } from '../../apps/web/lib/foundations';
import { supplyMission, supplyTenant } from '../operator/supply-fixture';

// The foundations are never reached while the switch is off, so they are mocked and counted.
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: vi.fn(() => null) }));

// ADR-082 slice S3: with CORRIDRA_SUPPLY_SOURCES off, every action of the supply API answers 404 before the session, the
// database or the request body is read. Only the exact string "true" opens it (see tests/integration/supply-controls.test.ts).
const actions = [
  'sources',
  'source-versions',
  'missions',
  'route-kinds',
  'state',
  'candidates',
  'candidate',
  'batches',
  'blocks',
  'create-source',
  'source-version',
  'add-candidate',
  'import-file',
  'review',
  'match',
  'block',
  'lift',
];
const original = process.env.CORRIDRA_SUPPLY_SOURCES;
afterEach(() => {
  if (original === undefined) delete process.env.CORRIDRA_SUPPLY_SOURCES;
  else process.env.CORRIDRA_SUPPLY_SOURCES = original;
});

describe('supply API switch', () => {
  for (const value of [undefined, 'false', 'TRUE', '1', '']) {
    test(`every action answers 404 when the switch is ${JSON.stringify(value)}`, async () => {
      if (value === undefined) delete process.env.CORRIDRA_SUPPLY_SOURCES;
      else process.env.CORRIDRA_SUPPLY_SOURCES = value;
      const { GET, POST } = await import('../../apps/web/app/api/supply/[action]/route');
      for (const action of actions)
        for (const method of ['GET', 'POST'] as const) {
          const request = new Request(
            `http://localhost/api/supply/${action}?tenant=${supplyTenant}&mission=${supplyMission}`,
            { method },
          );
          const response = await (method === 'GET' ? GET : POST)(request, {
            params: Promise.resolve({ action }),
          });
          expect(response.status, `${action} ${method}`).toBe(404);
        }
      expect(foundations).not.toHaveBeenCalled();
    });
  }
});
