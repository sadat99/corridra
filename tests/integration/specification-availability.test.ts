import { describe, expect, it, vi } from 'vitest';
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: vi.fn() }));
import { specificationConfirmationAvailable } from '../../apps/web/lib/specification-availability';

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
