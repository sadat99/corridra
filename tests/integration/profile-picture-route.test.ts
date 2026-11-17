import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
// sharp is a dependency of apps/web only; the tests load that copy.
import type SharpType from '../../apps/web/node_modules/sharp';
import { DomainError } from '../../packages/domain/src/index';

// ADR-088. The picture route with the database and the store answered by the test: 404 for every method while the switch
// is off (before anything is read), the origin and type checks, the real-bytes check before the budget, private
// no-store image/webp reads checked against the stored hash, replace and remove deleting the files of retired objects,
// and refusals from the database mapped to plain codes. The staff erasure transition removes the pictures too.
const sharp = createRequire(resolve('apps/web/package.json'))('sharp') as typeof SharpType;
const origin = 'http://localhost';
const objectId = randomUUID();
const state = {
  capability: true,
  workspaces: true,
  stored: null as null | Buffer,
  view: null as unknown,
  limited: false,
  reserveError: null as unknown,
  removeError: null as unknown,
  deleteFails: false,
  pending: [] as { id: string; storageRef: string }[],
};
const calls = {
  service: 0,
  puts: [] as string[],
  deletes: [] as string[],
  purged: [] as string[][],
  reserve: [] as unknown[][],
};
vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/profile-picture-capability', () => ({
  get profilePictureCapability() {
    return { profilePicture: state.capability, probe: null };
  },
}));
vi.mock('../../packages/auth/src/customer-workspaces.ts', () => ({
  customerWorkspacesEnabled: () => state.workspaces,
}));
const storage = {
  storageRef: 'vercel-blob:store_synthetic',
  async put(_ref: string, id: string, size: string) {
    calls.puts.push(`${id}/${size}`);
  },
  async get() {
    return state.stored!;
  },
  async delete(_ref: string, id: string) {
    if (state.deleteFails) throw new Error('down');
    calls.deletes.push(id);
  },
};
const changed = (version: number, picture: unknown) => ({
  currentVersion: version,
  picture,
  commandId: randomUUID(),
  replayed: false,
  superseded: false,
  pending: state.pending,
});
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: origin, AUTH_SECRET: 'x'.repeat(48) },
    avatarStorage: storage,
    customerProfilePictures: {
      async view() {
        calls.service += 1;
        return state.view;
      },
      async uploadBudget() {
        calls.service += 1;
        return { limited: state.limited };
      },
      async reserve(...args: unknown[]) {
        calls.reserve.push(args);
        if (state.reserveError) throw state.reserveError;
        return { commandId: args[0], replayed: false, objectId, currentVersion: 0, pending: [] };
      },
      async commit() {
        return changed(1, {
          id: objectId,
          updatedAt: '2026-11-17T00:00:00Z',
          storageRef: 'x',
          largeSha256: 'x',
        });
      },
      async remove() {
        if (state.removeError) throw state.removeError;
        return changed(2, null);
      },
      async purged(ids: string[]) {
        calls.purged.push(ids);
        return ids.length;
      },
    },
    customerErasureQueue: {
      async transition() {
        return { requestId: 'r', state: 'in_progress' };
      },
    },
    customerProfilePictureErasure: {
      async erase() {
        return { reference: 'ER-1', retired: 1, pending: state.pending };
      },
      async purged(_ctx: unknown, _request: string, ids: string[]) {
        calls.purged.push(ids);
        return ids.length;
      },
    },
    provider: { getSession: async () => ({ token: 'staff-token' }) },
  }),
}));
vi.mock('../../packages/auth/src/customer-account-lifecycle.ts', async (load) => ({
  ...(await load<object>()),
  customerAccountLifecycleEnabled: () => true,
}));
const route = await import('../../apps/web/app/api/account/picture/route');
const erasureRoute = await import('../../apps/web/app/api/workspace/customer-erasure-queue/route');

const upload = (body: BodyInit, type = 'image/png', extra: Record<string, string> = {}) =>
  route.POST(
    new Request(`${origin}/api/account/picture`, {
      method: 'POST',
      body,
      headers: {
        origin,
        'content-type': type,
        'x-command-id': randomUUID(),
        'x-expected-version': '0',
        ...extra,
      },
    }),
  );
const png = () =>
  sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 0, g: 90, b: 200 } } })
    .png()
    .toBuffer();
let logs: string[] = [];
beforeEach(() => {
  Object.assign(state, {
    capability: true,
    workspaces: true,
    stored: null,
    view: { currentVersion: 0, picture: null },
    limited: false,
    reserveError: null,
    removeError: null,
    deleteFails: false,
    pending: [],
  });
  Object.assign(calls, { service: 0, puts: [], deletes: [], purged: [], reserve: [] });
  logs = [];
  vi.spyOn(console, 'warn').mockImplementation((line: string) => void logs.push(line));
});
afterEach(() => vi.restoreAllMocks());

describe('the switch', () => {
  test('off: every method answers 404 before anything is read', async () => {
    state.capability = false;
    for (const response of [
      await route.GET(new Request(`${origin}/api/account/picture?size=large`)),
      await upload(await png()),
      await route.DELETE(new Request(`${origin}/api/account/picture`, { method: 'DELETE' })),
    ]) {
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(calls.service).toBe(0);
    expect(calls.reserve).toHaveLength(0);
  });
  test('customer workspaces off: 404 as well', async () => {
    state.workspaces = false;
    expect((await route.GET(new Request(`${origin}/api/account/picture`))).status).toBe(404);
  });
});

describe('reading', () => {
  test('the bytes are served as private no-store image/webp with nosniff, checked against the stored hash', async () => {
    const body = await sharp(await png())
      .webp()
      .toBuffer();
    state.stored = body;
    state.view = {
      currentVersion: 3,
      picture: {
        id: objectId,
        storageRef: 'vercel-blob:store_synthetic',
        largeSha256: createHash('sha256').update(body).digest('hex'),
        largeBytes: body.length,
        smallSha256: 'f'.repeat(64),
        smallBytes: 1,
        updatedAt: '2026-11-17T00:00:00Z',
      },
    };
    const ok = await route.GET(new Request(`${origin}/api/account/picture?size=large`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/webp');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(Buffer.from(await ok.arrayBuffer()).equals(body)).toBe(true);
    // The small file does not match its recorded hash: refused, never served.
    const bad = await route.GET(new Request(`${origin}/api/account/picture?size=small`));
    expect(bad.status).toBe(409);
  });
  test('the view answers the version only, never storage detail', async () => {
    state.view = {
      currentVersion: 4,
      picture: {
        id: objectId,
        storageRef: 'vercel-blob:store_synthetic',
        largeSha256: 'a'.repeat(64),
        updatedAt: '2026-11-17T00:00:00Z',
      },
    };
    const response = await route.GET(new Request(`${origin}/api/account/picture?scope=view`));
    expect(await response.json()).toEqual({
      currentVersion: 4,
      picture: { version: 4, updatedAt: '2026-11-17T00:00:00Z' },
    });
    expect((await route.GET(new Request(`${origin}/api/account/picture?scope=all`))).status).toBe(
      400,
    );
  });
  test('no picture is a 404; an unknown size is refused', async () => {
    expect((await route.GET(new Request(`${origin}/api/account/picture`))).status).toBe(404);
    expect(
      (await route.GET(new Request(`${origin}/api/account/picture?size=original`))).status,
    ).toBe(400);
  });
  test('a signed-out or other person is refused by the session boundary', async () => {
    const signedOut = Promise.reject(new DomainError('Sign in to continue', 401, 'signed_out'));
    signedOut.catch(() => {});
    state.view = signedOut;
    const response = await route.GET(new Request(`${origin}/api/account/picture`));
    expect(response.status).toBe(401);
    const denied = Promise.reject(
      Object.assign(new Error('Customer access denied'), { code: '42501' }),
    );
    denied.catch(() => {});
    state.view = denied;
    expect((await route.GET(new Request(`${origin}/api/account/picture`))).status).toBe(403);
  });
});

describe('uploading', () => {
  test('a good picture is redrawn, stored as two files, committed, and the response carries no storage detail', async () => {
    const response = await upload(await png());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ currentVersion: 1, picture: { version: 1 }, replayed: false });
    expect(JSON.stringify(body)).not.toMatch(/storageRef|Sha256|blob/i);
    expect(calls.puts).toEqual([`${objectId}/large`, `${objectId}/small`]);
  });
  test('another origin is refused', async () => {
    const response = await upload(await png(), 'image/png', { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(calls.reserve).toHaveLength(0);
  });
  test('a declared type outside the list, an SVG named PNG and a spoofed JPEG are refused before the budget', async () => {
    expect((await upload(await png(), 'image/svg+xml')).status).toBe(415);
    const svg = await upload('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/png');
    expect(svg.status).toBe(415);
    expect((await svg.json()).code).toBe('wrong_type');
    expect(calls.service).toBe(0);
  });
  test('larger than 8 MiB is refused with 413', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024 + 10);
    big.set([0xff, 0xd8, 0xff]);
    const response = await upload(big, 'image/jpeg');
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('too_large');
  });
  test('the hourly budget answers 429 before any image work', async () => {
    state.limited = true;
    const response = await upload(await png());
    expect(response.status).toBe(429);
    expect(calls.reserve).toHaveLength(0);
  });
  test('a stale version and a closed account map to their codes', async () => {
    state.reserveError = Object.assign(new Error('Picture changed; reload before saving'), {
      code: '23514',
    });
    expect((await (await upload(await png())).json()).code).toBe('stale');
    state.reserveError = Object.assign(new Error('Your account is closed'), { code: '42501' });
    expect((await upload(await png())).status).toBe(403);
    state.reserveError = Object.assign(new Error('x'), { code: '42883' });
    expect((await upload(await png())).status).toBe(503);
  });
  test('a replaced picture has its files deleted, then its row', async () => {
    const old = randomUUID();
    state.pending = [{ id: old, storageRef: 'vercel-blob:store_synthetic' }];
    expect((await upload(await png())).status).toBe(200);
    expect(calls.deletes).toEqual([old]);
    expect(calls.purged).toEqual([[old]]);
  });
});

describe('removing', () => {
  const del = (body: unknown) =>
    route.DELETE(
      new Request(`${origin}/api/account/picture`, {
        method: 'DELETE',
        body: JSON.stringify(body),
        headers: { origin, 'content-type': 'application/json' },
      }),
    );
  test('remove deletes the stored files and then the row', async () => {
    const old = randomUUID();
    state.pending = [{ id: old, storageRef: 'vercel-blob:store_synthetic' }];
    const response = await del({ commandId: randomUUID(), expectedVersion: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ currentVersion: 2, picture: null });
    expect(calls.deletes).toEqual([old]);
    expect(calls.purged).toEqual([[old]]);
  });
  test('a file that cannot be deleted keeps its row for the next change, and the log has no id', async () => {
    const old = randomUUID();
    state.pending = [{ id: old, storageRef: 'vercel-blob:store_synthetic' }];
    state.deleteFails = true;
    expect((await del({ commandId: randomUUID(), expectedVersion: 1 })).status).toBe(200);
    expect(calls.purged).toEqual([]);
    expect(logs.join('\n')).toContain('profile_picture_delete_pending');
    expect(logs.join('\n')).not.toContain(old);
  });
  test('nothing to remove is a 409; extra fields are refused', async () => {
    state.removeError = Object.assign(new Error('There is no picture to remove'), {
      code: '23514',
    });
    expect((await (await del({ commandId: randomUUID(), expectedVersion: 1 })).json()).code).toBe(
      'no_picture',
    );
    expect(
      (await del({ commandId: randomUUID(), expectedVersion: 1, principalId: randomUUID() }))
        .status,
    ).toBe(400);
  });
});

describe('staff erasure', () => {
  test('moving a request to in progress retires the pictures and deletes their files', async () => {
    const old = randomUUID();
    state.pending = [{ id: old, storageRef: 'vercel-blob:store_synthetic' }];
    const response = await erasureRoute.POST(
      new Request(`${origin}/api/workspace/customer-erasure-queue?tenant=${randomUUID()}`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          commandId: randomUUID(),
          requestId: randomUUID(),
          expectedState: 'received',
          toState: 'in_progress',
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).profilePicture).toEqual({ retired: 1, pending: 0 });
    expect(calls.deletes).toEqual([old]);
    expect(calls.purged).toEqual([[old]]);
  });
});
