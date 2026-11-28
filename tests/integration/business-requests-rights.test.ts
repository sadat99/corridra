import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// My Businesses (customer account v18) offers Start a Request for each business the server lists for this person,
// only while customer requests are on, and the request page refuses a business the person does not belong to.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;

const member = '11111111-1111-4111-8111-111111111111';
const archived = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';

const calls: { subject?: string; issuer?: string }[] = [];
let listed: { id: string; name: string; role: string; synthetic: boolean; archived: boolean }[] =
  [];
let admitted = true;

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => createElement('a', { href, className }, children as never),
}));
vi.doMock(web.resolve('next/navigation'), () => ({
  redirect: (to: string) => {
    throw new Error('redirect:' + to);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => ({ NEON_AUTH_BASE_URL: 'https://auth.example' }),
}));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({
    getSession: async () => ({ data: { user: { id: 'user-1', emailVerified: true } } }),
  }),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    customerRequests: {
      list: async (_input: unknown, subject?: string, issuer?: string) => {
        calls.push({ subject, issuer });
        if (!admitted) throw new Error('Customer request access denied');
        return { requests: [] };
      },
    },
    customerWorkspaces: { list: async () => listed },
  }),
}));
vi.mock('../../apps/web/components/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: unknown }) =>
    createElement('main', { 'data-shell': 'workspace' }, children),
}));
vi.mock('../../apps/web/components/customer-shell', () => ({
  CustomerShell: ({ children }: { children: unknown }) =>
    createElement('main', { 'data-shell': 'customer' }, children),
}));
vi.mock('../../apps/web/app/account/request/private-request-intake', () => ({
  PrivateRequestIntake: ({ workspaceId }: { workspaceId: string }) =>
    createElement('form', { 'data-intake': workspaceId }),
}));

const switches = [
  'DATA_ENVIRONMENT',
  'CORRIDRA_CUSTOMER_REQUESTS_ENABLED',
  'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
  'VERCEL_ENV',
] as const;
const saved = Object.fromEntries(switches.map((name) => [name, process.env[name]]));

beforeEach(() => {
  process.env.DATA_ENVIRONMENT = 'synthetic';
  process.env.CORRIDRA_CUSTOMER_REQUESTS_ENABLED = 'true';
  process.env.CORRIDRA_CUSTOMER_WORKSPACES_ENABLED = 'true';
  delete process.env.VERCEL_ENV;
  calls.length = 0;
  admitted = true;
  listed = [
    {
      id: member,
      name: 'Synthetic Harbour Foods',
      role: 'member',
      synthetic: true,
      archived: false,
    },
    { id: archived, name: 'Synthetic Old Mill', role: 'owner', synthetic: true, archived: true },
  ];
});
afterEach(() => {
  for (const name of switches)
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
});

const requestsFor = async () => {
  const { BusinessRequests } =
    await import('../../apps/web/app/account/businesses/business-requests');
  const element = await BusinessRequests({ subject: 'user-1', issuer: 'https://auth.example' });
  return element === null ? '' : render(element);
};

describe('Start a Request on My Businesses', () => {
  it('links each business the server lists for this person, and no other', async () => {
    const html = await requestsFor();
    expect(html).toContain(`href="/account/request/${member}"`);
    expect(html).toContain('Start a Request');
    expect(html).toContain('href="/account?view=work"');
    expect(html).not.toContain(stranger);
    // The proofs are read for this person on the server, never from the browser.
    expect(calls).toEqual([{ subject: 'user-1', issuer: 'https://auth.example' }]);
  });
  it('offers no Start a Request for an archived business and says how to reopen it', async () => {
    const html = await requestsFor();
    expect(html).not.toContain(`href="/account/request/${archived}"`);
    expect(html).toContain('Restore this business to start a request.');
  });
  it('shows nothing and reads nothing while customer requests are off', async () => {
    process.env.CORRIDRA_CUSTOMER_REQUESTS_ENABLED = 'false';
    expect(await requestsFor()).toBe('');
    expect(calls).toEqual([]);
  });
  it('shows nothing while customer workspaces are off', async () => {
    process.env.CORRIDRA_CUSTOMER_WORKSPACES_ENABLED = 'false';
    expect(await requestsFor()).toBe('');
    expect(calls).toEqual([]);
  });
  it('shows nothing for a person with no business', async () => {
    listed = [];
    expect(await requestsFor()).toBe('');
  });
  it('says plainly when request access is refused, with no link', async () => {
    admitted = false;
    const html = await requestsFor();
    expect(html).toContain('Requests for your businesses could not be confirmed.');
    expect(html).not.toContain('/account/request/');
  });
});

describe('the request page checks the membership again', () => {
  const open = async (workspaceId: string) => {
    const { default: page } = await import('../../apps/web/app/account/request/[workspaceId]/page');
    return render(await page({ params: Promise.resolve({ workspaceId }) }));
  };
  it('opens the request form for a business the person belongs to', async () => {
    expect(await open(member)).toContain(`data-intake="${member}"`);
  });
  it('refuses a business the person does not belong to, whatever the address says', async () => {
    const html = await open(stranger);
    expect(html).toContain('Private request access for this workspace could not be confirmed.');
    expect(html).not.toContain('data-intake');
  });
  it('refuses a person whose request access the server does not admit', async () => {
    admitted = false;
    const html = await open(member);
    expect(html).toContain('Private request access could not be confirmed.');
    expect(html).not.toContain('data-intake');
  });
});
