import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../apps/web/app/sw.js/route';
import {
  deploymentId,
  offlineCacheName,
  offlineServiceWorkerScript,
  retiredServiceWorkerScript,
  unknownDeploymentId,
} from '../../apps/web/lib/ux/service-worker';
import {
  keepWorkerCurrent,
  shouldCheckForUpdate,
  updateCheckIntervalMs,
} from '../../apps/web/lib/ux/service-worker-update';

// An installed Corridra updates itself with every deployment (owner, 14 November 2026: "PWA should be auto
// updated with every new works deployed"). The worker never held the product, so pages were already current;
// what was fixed was the worker text itself, identical on every deployment, so a browser never saw an update
// and never refreshed the offline page and its stylesheets. These checks fail on that code: it had no
// deployment identifier, one fixed cache name, and a registration that never asked the browser to look again.

const SHA_A = '0123456789abcdef0123456789abcdef01234567';
const SHA_B = 'fedcba9876543210fedcba9876543210fedcba98';

afterEach(() => vi.unstubAllEnvs());

describe('the deployment identifier', () => {
  it('is the Git commit of the deployment, read from the server environment', () => {
    expect(deploymentId({ VERCEL_GIT_COMMIT_SHA: SHA_A } as NodeJS.ProcessEnv)).toBe(SHA_A);
  });

  it('falls back to the platform deployment identifier, then to a fixed word', () => {
    expect(
      deploymentId({
        VERCEL_DEPLOYMENT_ID: 'dpl_E9kDSK3ju9xiZetLLtQ14qjL6Y7e',
      } as NodeJS.ProcessEnv),
    ).toBe('dpl_E9kDSK3ju9xiZetLLtQ14qjL6Y7e');
    expect(deploymentId({} as NodeJS.ProcessEnv)).toBe(unknownDeploymentId);
    expect(deploymentId({ VERCEL_GIT_COMMIT_SHA: '' } as NodeJS.ProcessEnv)).toBe(
      unknownDeploymentId,
    );
  });

  it('never lets odd text into the worker or the cache name', () => {
    for (const bad of ['a b', 'x\nself.evil()', '"; alert(1); "', '../etc', 'a'.repeat(41)]) {
      expect(deploymentId({ VERCEL_GIT_COMMIT_SHA: bad } as NodeJS.ProcessEnv)).toBe(
        unknownDeploymentId,
      );
      expect(offlineCacheName(bad)).toBe(`corridra-offline-${unknownDeploymentId}`);
      expect(offlineServiceWorkerScript(bad)).not.toContain(bad);
    }
  });
});

describe('each deployment serves a different worker', () => {
  it('puts the identifier in the worker text and in the cache name', () => {
    const script = offlineServiceWorkerScript(SHA_A);
    expect(script).toContain(SHA_A);
    expect(script).toContain(`const CACHE = "corridra-offline-${SHA_A}";`);
    expect(offlineCacheName(SHA_A)).toBe(`corridra-offline-${SHA_A}`);
  });

  it('differs between two deployments, so the browser installs the new one', () => {
    expect(offlineServiceWorkerScript(SHA_A)).not.toBe(offlineServiceWorkerScript(SHA_B));
    expect(offlineCacheName(SHA_A)).not.toBe(offlineCacheName(SHA_B));
  });

  it('is identical for two requests of one deployment, so nothing reinstalls on every fetch', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', SHA_A);
    const first = await GET().text();
    const second = await GET().text();
    expect(first).toBe(second);
    expect(first).toContain(SHA_A);
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', SHA_B);
    const next = await GET().text();
    expect(next).toContain(SHA_B);
    expect(next).not.toBe(first);
  });

  it('keeps the worker file out of every cache and keeps the retirement setting working', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', SHA_A);
    const live = GET();
    expect(live.headers.get('cache-control')).toBe('no-store');
    expect(live.headers.get('service-worker-allowed')).toBe('/');
    vi.stubEnv('CORRIDRA_PWA_SERVICE_WORKER', 'false');
    const retired = GET();
    expect(retired.headers.get('cache-control')).toBe('no-store');
    expect(await retired.text()).toBe(retiredServiceWorkerScript());
  });
});

/** Runs the worker text as a browser would, with a fake cache store, and returns what it registered. */
function runWorker(script: string, existingCaches: string[]) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const store = new Map<string, Map<string, unknown>>(
    existingCaches.map((name) => [name, new Map()]),
  );
  const calls = { skipWaiting: 0, claim: 0 };
  const fakeCaches = {
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const cache = store.get(name)!;
      return {
        put: async (key: string, value: unknown) => void cache.set(key, value),
        match: async (key: string) => cache.get(key),
      };
    },
  };
  runInNewContext(script, {
    self: {
      addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn),
      skipWaiting: () => void calls.skipWaiting++,
      clients: { claim: async () => void calls.claim++ },
      location: { origin: 'https://example.test' },
    },
    caches: fakeCaches,
    fetch: async () => ({ ok: true, clone: () => ({ text: async () => '' }) }),
  });
  const run = async (type: string) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]({ waitUntil: (promise: Promise<unknown>) => (pending = promise) });
    await pending;
  };
  return { store, calls, run };
}

describe('activation after an update', () => {
  it('drops every older Corridra cache, keeps its own and never touches another application', async () => {
    const worker = runWorker(offlineServiceWorkerScript(SHA_B), [
      'corridra-offline-v1',
      `corridra-offline-${SHA_A}`,
      `corridra-offline-${SHA_B}`,
      'other-app-cache',
    ]);
    await worker.run('activate');
    expect([...worker.store.keys()].sort()).toEqual([
      `corridra-offline-${SHA_B}`,
      'other-app-cache',
    ]);
    expect(worker.calls.claim).toBe(1);
  });

  it('installs a fresh offline cache under its own name and takes over at once', async () => {
    const worker = runWorker(offlineServiceWorkerScript(SHA_B), [`corridra-offline-${SHA_A}`]);
    await worker.run('install');
    expect(worker.calls.skipWaiting).toBe(1);
    expect(worker.store.has(`corridra-offline-${SHA_B}`)).toBe(true);
    expect([...worker.store.get(`corridra-offline-${SHA_B}`)!.keys()]).toEqual(['/offline']);
  });
});

describe('the update check made by an open or reopened app', () => {
  it('is allowed first, then at most once every ten minutes, and once the clock goes backwards', () => {
    expect(updateCheckIntervalMs).toBe(10 * 60 * 1000);
    expect(shouldCheckForUpdate(null, 5)).toBe(true);
    expect(shouldCheckForUpdate(1000, 1000 + updateCheckIntervalMs - 1)).toBe(false);
    expect(shouldCheckForUpdate(1000, 1000 + updateCheckIntervalMs)).toBe(true);
    expect(shouldCheckForUpdate(5000, 4000)).toBe(true);
  });

  function fakePage() {
    let listener: (() => void) | null = null;
    const page = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (_type: string, fn: () => void) => void (listener = fn),
      removeEventListener: () => void (listener = null),
    };
    return { page, fire: () => listener?.(), listening: () => listener !== null };
  }

  it('asks once on load, then again when the page becomes visible after ten minutes, never sooner', () => {
    let clock = 1_000_000;
    let updates = 0;
    const { page, fire, listening } = fakePage();
    const stop = keepWorkerCurrent(
      { update: async () => void updates++ },
      page as never,
      () => clock,
    );
    expect(updates).toBe(1);
    clock += 60_000;
    fire();
    expect(updates).toBe(1);
    page.visibilityState = 'hidden';
    clock += updateCheckIntervalMs;
    fire();
    expect(updates).toBe(1);
    page.visibilityState = 'visible';
    fire();
    expect(updates).toBe(2);
    fire();
    expect(updates).toBe(2);
    stop();
    expect(listening()).toBe(false);
  });

  it('ignores a failed check, such as one made with no connection', async () => {
    const { page, fire } = fakePage();
    let clock = 0;
    const calls: string[] = [];
    keepWorkerCurrent(
      {
        update: () => {
          calls.push('update');
          return Promise.reject(new Error('offline'));
        },
      },
      page as never,
      () => clock,
    );
    clock += updateCheckIntervalMs;
    fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['update', 'update']);
  });

  it('is wired into the registration, which never reloads the page', () => {
    const source = readFileSync('apps/web/components/ux/service-worker-registration.tsx', 'utf8');
    expect(source).toMatch(/keepWorkerCurrent\(registration, document\)/);
    expect(source).not.toMatch(/location\.reload|\.reload\(|navigate\(/);
  });
});
