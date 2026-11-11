import { resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

// The web side of the one answer the menus depend on: what the application says when the services are missing, still
// starting, failing or answering. Nothing but a clear yes from both database probes is "offered".
afterEach(() => vi.resetModules());

async function ask(services: unknown) {
  vi.resetModules();
  vi.doMock(resolve('apps/web/lib/foundations.ts'), () => ({ foundations: () => services }));
  const { problemReportsOffered } = await import('../../apps/web/lib/problem-reports-offered');
  return problemReportsOffered();
}

describe('problemReportsOffered in the application', () => {
  test('no services (no database configured) is not offered', async () => {
    expect(await ask(null)).toBe(false);
  });
  test('both probes holding is offered, once the services are ready', async () => {
    const order: string[] = [];
    const services = {
      ready: Promise.resolve().then(() => order.push('ready')),
      problemReportsOffered: async () => {
        order.push('asked');
        return true;
      },
    };
    expect(await ask(services)).toBe(true);
    expect(order).toEqual(['ready', 'asked']);
  });
  test('a probe that says no is not offered', async () => {
    expect(await ask({ ready: Promise.resolve(), problemReportsOffered: async () => false })).toBe(
      false,
    );
  });
  test('services that failed to start, or a probe that throws, are not offered', async () => {
    const failed = Promise.reject(new Error('restricted role check failed'));
    failed.catch(() => undefined);
    expect(await ask({ ready: failed, problemReportsOffered: async () => true })).toBe(false);
    expect(
      await ask({
        ready: Promise.resolve(),
        problemReportsOffered: async () => {
          throw new Error('connection lost');
        },
      }),
    ).toBe(false);
  });
});
