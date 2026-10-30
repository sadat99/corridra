import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: vi.fn() }));
import { specificationConfirmationAvailable } from '../../apps/web/lib/specification-availability';

const read = (path: string) => readFileSync(resolve(path), 'utf8');

const enabled = {
  DATA_ENVIRONMENT: 'synthetic',
  CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
  CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'true',
  CORRIDRA_DELIVERY_ENABLED: 'true',
  CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED: 'true',
};

describe('confirmation visibility uses the application gate and installation together', () => {
  it('never checks installation while the feature or any dependency is closed', async () => {
    for (const key of [
      'CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED',
      'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
      'CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED',
      'CORRIDRA_DELIVERY_ENABLED',
    ]) {
      const read = vi.fn(async () => true);
      expect(await specificationConfirmationAvailable(read, { ...enabled, [key]: 'false' })).toBe(
        false,
      );
      expect(read).not.toHaveBeenCalled();
    }
  });
  it('shows the panel only after an affirmative installation result', async () => {
    const installed = vi.fn(async () => true);
    expect(await specificationConfirmationAvailable(installed, enabled)).toBe(true);
    expect(installed).toHaveBeenCalledOnce();
    expect(await specificationConfirmationAvailable(async () => false, enabled)).toBe(false);
  });
  it('keeps the panel absent when installation cannot be checked', async () => {
    expect(
      await specificationConfirmationAvailable(async () => {
        throw new Error('unavailable');
      }, enabled),
    ).toBe(false);
  });
});

describe('the pages and the staff route decide visibility through the installation check', () => {
  for (const path of [
    'apps/web/app/account/missions/[resourceId]/page.tsx',
    'apps/web/app/account/rooms/[requestId]/page.tsx',
  ])
    it(`${path} shows the confirmation only after the installation check`, () => {
      const page = read(path);
      expect(page).toContain(
        "import { specificationConfirmationForPage } from '../../../../lib/specification-availability';",
      );
      expect(page.match(/specificationConfirmationsEnabled=/g) ?? []).toHaveLength(1);
      expect(page).toContain(
        'specificationConfirmationsEnabled={await specificationConfirmationForPage()}',
      );
      // The switch alone says nothing about the optional database module.
      expect(page).not.toContain('customerSpecificationConfirmationEnabled');
    });
  it('the staff delivery view learns availability from the same check', () => {
    const route = read('apps/web/app/api/workspace/delivery/route.ts');
    expect(route).toContain(
      "import { specificationConfirmationAvailable } from '../../../../lib/specification-availability';",
    );
    const start = route.indexOf("query.get('action') === 'experience'");
    const end = route.indexOf("query.get('action') === 'options'");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(route.slice(start, end)).toMatch(
      /specificationConfirmationsAvailable: await specificationConfirmationAvailable\(\(\) =>\s*s\.specificationConfirmations\.installed\(\),?\s*\)/,
    );
    expect(route.match(/specificationConfirmationsAvailable/g) ?? []).toHaveLength(1);
  });
});
