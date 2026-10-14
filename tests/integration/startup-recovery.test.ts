import { expect, test } from 'vitest';
import { recoverableResource } from '../../apps/web/lib/recoverable-resource';
test('a failed startup is denied and a later request rechecks readiness', async () => {
  let attempts = 0;
  const get = recoverableResource(() => ({
    ready:
      ++attempts === 1
        ? Promise.reject(new Error('Synthetic cold-start timeout'))
        : Promise.resolve('restricted roles verified'),
  }));
  const failed = get()!;
  await expect(failed.ready).rejects.toThrow('cold-start timeout');
  const recovered = get()!;
  expect(recovered).not.toBe(failed);
  await expect(recovered.ready).resolves.toBe('restricted roles verified');
  expect(get()).toBe(recovered);
  expect(attempts).toBe(2);
});
test('retries do not turn a persistent failed security check into readiness', async () => {
  let attempts = 0;
  const get = recoverableResource(() => ({
    ready: Promise.reject(new Error('Restricted role denied ' + ++attempts)),
  }));
  for (let i = 0; i < 3; i++) await expect(get()!.ready).rejects.toThrow('Restricted role denied');
  expect(attempts).toBe(3);
  const unavailable = recoverableResource(() => null);
  expect(unavailable()).toBeNull();
});
