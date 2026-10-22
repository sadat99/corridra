import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { randomBytes, createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { createIdentity } from '../../packages/auth/src/index';
import { AccessService } from '../../packages/auth/src/access';
import { configureNetworkRealUse } from '../../packages/auth/src/network-real-use-configuration';
import { realNetworkFixture } from '../integration/real-network-fixture';
import { prepareRealNetworkTask } from '../integration/real-network-scenario';

// Actual application components, HTTP handlers, identity password/TOTP and scoped
// PostgreSQL roles. Only the external verified-customer provider proof is a fixture.
let f: Awaited<ReturnType<typeof realNetworkFixture>>, server: Server, origin: string;
const email = 'invited-contributor@business.test';
const password = 'Invited-network-work-local-fixture-42!';
const savedReal = process.env.CORRIDRA_REAL_USE_ENABLED;
function totp(secret: string) {
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  return ((mac.readUInt32BE(mac[mac.length - 1] & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, '0');
}
test.beforeAll(async () => {
  process.env.CORRIDRA_REAL_USE_ENABLED = 'true';
  f = await realNetworkFixture('corridra_restore');
  const document = await (await fetch('http://127.0.0.1:3200/')).text();
  const cssPaths = [
    ...new Set([...document.matchAll(/href="(\/_next\/static\/[^"?]+\.css)/g)].map((m) => m[1])),
  ];
  expect(cssPaths.length).toBeGreaterThan(0);
  const css = (
    await Promise.all(
      cssPaths.map(async (path) => (await fetch('http://127.0.0.1:3200' + path)).text()),
    )
  ).join('\n');
  const directory = resolve('work/real-use/network-browser');
  await mkdir(directory, { recursive: true });
  const require = createRequire(import.meta.url);
  const apiFile = resolve(directory, 'api.mjs');
  await build({
    stdin: {
      contents: `import{GET as setupGet,POST as setupPost}from ${JSON.stringify(resolve('apps/web/app/api/operator-setup/route.ts'))};
    import{GET as workGet,POST as workPost}from ${JSON.stringify(resolve('apps/web/app/api/workspace/[action]/route.ts'))};
    import{GET as taskGet,POST as taskPost}from ${JSON.stringify(resolve('apps/web/app/api/network/tasks/route.ts'))};
    export function handle(request){const path=new URL(request.url).pathname;return path.startsWith('/api/workspace/')?(request.method==='GET'?workGet:workPost)(request,{params:Promise.resolve({action:path.split('/').at(-1)})}):path.startsWith('/api/network/')?(request.method==='GET'?taskGet:taskPost)(request):(request.method==='GET'?setupGet:setupPost)(request)}`,
      resolveDir: resolve('.'),
      loader: 'ts',
    },
    outfile: apiFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    plugins: [
      {
        name: 'request-provider-fixture',
        setup(b) {
          b.onResolve({ filter: /^workflow(?:\/.*)?$/ }, (args) => ({
            path: require.resolve(args.path, { paths: [resolve('apps/web')] }),
            external: true,
          }));
          b.onResolve({ filter: /^pg$/ }, () => ({
            path: resolve(
              require.resolve('pg/package.json', { paths: [resolve('packages/db')] }),
              '..',
              'esm/index.mjs',
            ),
            external: true,
          }));
          b.onResolve({ filter: /^@corridra\// }, (args) => ({
            path: require.resolve(args.path, { paths: [resolve('apps/web')] }),
          }));
          b.onResolve({ filter: /server-only$|\/foundations$|\/neon-auth$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents:
              args.path === 'server-only'
                ? ''
                : args.path.endsWith('/neon-auth')
                  ? 'export function neonAuth(){return{getSession:async()=>({data:{user:{email:"invited-contributor@business.test",emailVerified:true}},error:null})}}'
                  : 'export function foundations(){return globalThis.__networkFixtureServices}',
          }));
        },
      },
    ],
  });
  const api = await import(pathToFileURL(apiFile).href);
  const browser = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
    import{ContributorInvitations}from ${JSON.stringify(resolve('apps/web/app/operator/contributor-invitations.tsx'))};
    import{ExecutionNetwork}from ${JSON.stringify(resolve('apps/web/app/operator/network.tsx'))};
    import{SetupForm}from ${JSON.stringify(resolve('apps/web/app/operator/setup/setup-form.tsx'))};
    import{OperatorSignin}from ${JSON.stringify(resolve('apps/web/app/operator/signin/signin-form.tsx'))};
    import{TaskBoard}from ${JSON.stringify(resolve('apps/web/app/contributor/task-board.tsx'))};
    const workspace=new URLSearchParams(location.search).get('workspace');
    const fixtureTenant=__NETWORK_TEST_TENANT__;
    const contributorReturnTo='/contributor?workspace='+encodeURIComponent(fixtureTenant);
    createRoot(document.getElementById('fixture')).render(location.pathname==='/network-owner'?<ExecutionNetwork tenant={fixtureTenant} role="owner" workspaceName="Reviewed test workspace" onChooseWorkspace={()=>document.getElementById('fixture-workspace')?.focus()}/>:location.pathname==='/owner'?<ContributorInvitations tenant={fixtureTenant}/>:location.pathname==='/contributor/setup'?<SetupForm kind="contributor"/>:location.pathname==='/operator/signin'?<OperatorSignin returnTo={contributorReturnTo}/>:<TaskBoard workspace={workspace}/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env': '{}',
      __NETWORK_TEST_TENANT__: JSON.stringify(f.realTenant),
    },
    plugins: [
      {
        name: 'next-navigation-fixture',
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link(props){return <a {...props}/>}'
                : 'const router={replace:path=>location.assign(path),refresh:()=>{}};export function useRouter(){return router}',
          }));
        },
      },
    ],
  });
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url!, origin).pathname;
      if (path === '/fixture.js') {
        res.setHeader('content-type', 'text/javascript');
        res.end(browser.outputFiles[0].text);
        return;
      }
      if (path === '/fixture.css') {
        res.setHeader('content-type', 'text/css');
        res.end(css);
        return;
      }
      if (path.startsWith('/api/')) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = new Request(origin + req.url, {
          method: req.method,
          headers: req.headers as HeadersInit,
          body: req.method === 'GET' ? undefined : new Uint8Array(Buffer.concat(chunks)),
        });
        const response: Response = path.startsWith('/api/operator-auth/')
          ? await identity.handler(request)
          : await api.handle(request);
        const headers: Record<string, string | string[]> = {};
        response.headers.forEach((v, k) => {
          if (k !== 'set-cookie') headers[k] = v;
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) headers['set-cookie'] = cookies;
        res.writeHead(response.status, headers);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(
        `<!doctype html><html lang="en"><head><title>Invited Network work</title><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="stylesheet" href="/fixture.css"/></head><body><main class="ux-workspace ux-workspace-body"><h1>Invited Network work</h1>${path === '/owner' ? '<h2>Commercial execution work</h2>' : path === '/network-owner' ? '<label>Workspace<select id="fixture-workspace"><option>Reviewed test workspace</option></select></label>' : ''}<div class="workspace-section workspace-panel" id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
      );
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : 'Fixture failure');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
  const identity = createIdentity({
    pool: f.auth,
    secret: randomBytes(32).toString('hex'),
    baseURL: origin,
    basePath: '/api/operator-auth',
  });
  Object.assign(globalThis, {
    __networkFixtureServices: {
      ready: Promise.resolve(),
      config: { APP_ORIGIN: origin },
      access: new AccessService(f.runtime, f.auth),
      operatorSetup: f.setup,
      network: f.network,
      networkInvitations: f.invitations,
      provider: {
        getSession: async (headers: Headers) =>
          headers.get('cookie')?.includes('fixture_owner=authorized')
            ? { token: f.users.owner.token }
            : identity.provider.getSession(headers),
      },
    },
  });
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await f?.close();
  if (savedReal === undefined) delete process.env.CORRIDRA_REAL_USE_ENABLED;
  else process.env.CORRIDRA_REAL_USE_ENABLED = savedReal;
  Reflect.deleteProperty(globalThis, '__networkFixtureServices');
});
async function inspect(page: Page, name: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      name + ' overflow ' + width,
    ).toBe(false);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations,
      name + ' accessibility ' + width,
    ).toEqual([]);
    await page.screenshot({
      path: `work/real-use/network-browser/${name}-${width}.png`,
      fullPage: true,
    });
  }
}
test('reviewed invitation, real password/TOTP setup and non-member task submission work together', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await page.context().addCookies([{ name: 'fixture_owner', value: 'authorized', url: origin }]);
  await page.goto(origin + '/owner');
  await expect(page.getByRole('button', { name: 'Prepare contributor invitation' })).toBeEnabled();
  await inspect(page, 'owner-empty');
  await page.getByLabel('Contributor name', { exact: true }).fill('Invited research contributor');
  await page.getByLabel('Contributor email', { exact: true }).fill(email);
  await page
    .getByRole('combobox', { name: 'Contributor operating country', exact: true })
    .selectOption('DE');
  await page.getByRole('button', { name: 'Prepare contributor invitation' }).click();
  await expect(page.getByRole('status')).toContainText('Invitation prepared');
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await inspect(page, 'owner-invited');
  const workerContext = await browser.newContext();
  const worker = await workerContext.newPage();
  expect(
    (await worker.request.get(origin + '/api/network/tasks?workspace=' + f.realTenant)).status(),
  ).toBe(401);
  await worker.goto(origin + '/contributor/setup');
  await expect(worker.getByLabel('New contributor password', { exact: true })).toBeVisible();
  await inspect(worker, 'contributor-setup');
  await worker.getByLabel('New contributor password', { exact: true }).fill(password);
  await worker.getByLabel('Confirm contributor password', { exact: true }).fill(password);
  await worker.getByRole('button', { name: 'Set contributor password', exact: true }).click();
  await worker.getByRole('link', { name: 'Sign in and set up authenticator' }).click();
  await worker.getByLabel('Email', { exact: true }).fill(email);
  await worker.getByLabel('Password', { exact: true }).fill(password);
  await worker.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(worker.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  expect(
    (await worker.request.get(origin + '/api/network/tasks?workspace=' + f.realTenant)).status(),
  ).toBe(403);
  await worker.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  const secret = await worker.getByLabel('Authenticator setup key').inputValue();
  await worker.getByLabel('Six-digit code').fill(totp(secret));
  await worker.getByRole('button', { name: 'Verify and open workspace' }).click();
  await expect(worker).toHaveURL(origin + '/contributor?workspace=' + f.realTenant);
  await expect(
    worker.getByText('No current reviewed assignment is available.', { exact: true }),
  ).toBeVisible();
  await inspect(worker, 'contributor-empty');
  const principal = (
    await f.owner.query(
      'SELECT p.id FROM identity.principal p JOIN identity."user" u ON u.id=p.identity_id WHERE u.email=$1',
      [email],
    )
  ).rows[0].id;
  const task = await prepareRealNetworkTask(f, async () => ({
    principalId: principal,
    ctx: {
      token: 'unused by preparation',
      tenantId: f.realTenant,
      purpose: 'commercial_qualification',
    },
  }));
  await worker.reload();
  await expect(worker.getByRole('button', { name: 'Accept the disclosed task' })).toBeVisible();
  await inspect(worker, 'contributor-assigned');
  expect(await worker.locator('body').innerText()).not.toContain(
    'network-request-owner@business.test',
  );
  await worker
    .getByLabel('Acceptance and relationship confirmation')
    .fill('Reviewed disclosure and no conflicting relationship');
  await worker.getByRole('button', { name: 'Accept the disclosed task' }).click();
  await worker
    .getByLabel('Original work and evidence statement')
    .fill('Source-reported equipment finding. Availability remains unverified.');
  await worker.getByLabel('Submission context').fill('Only the scoped task disclosure was used');
  await worker.getByRole('button', { name: 'Submit for evidence review' }).click();
  await expect(worker.getByText('SUBMIT · ES · work country DE', { exact: true })).toBeVisible();
  await inspect(worker, 'contributor-submitted');
  const events = await f.owner.query(
    'SELECT action FROM app.network_event WHERE task_id=$1 ORDER BY version',
    [task.id],
  );
  expect(events.rows.map((r) => r.action)).toEqual(['ASSIGN', 'ACCEPT', 'SUBMIT']);
  expect(
    (
      await f.owner.query('SELECT count(*)::int AS n FROM app.membership WHERE user_id=$1', [
        principal,
      ])
    ).rows[0].n,
  ).toBe(0);
  await workerContext.close();
});

test('Network invitation form supports scoped submission and an editable paused draft with clear recovery', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.context().addCookies([{ name: 'fixture_owner', value: 'authorized', url: origin }]);
  await page.goto(origin + '/network-owner');
  const invitations = page.getByRole('region', { name: 'Contributor invitations', exact: true });
  await expect(
    invitations.getByRole('button', { name: 'Prepare contributor invitation' }),
  ).toBeEnabled();
  await invitations
    .getByLabel('Contributor name', { exact: true })
    .fill('Network usability contributor');
  await invitations
    .getByLabel('Contributor email', { exact: true })
    .fill('network-usability@business.test');
  await invitations
    .getByRole('combobox', { name: 'Contributor operating country', exact: true })
    .selectOption('DE');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(invitations.getByLabel('Contributor name', { exact: true })).toHaveValue(
      'Network usability contributor',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      scrollTo(0, 0);
    });
    await page.screenshot({
      path: `work/real-use/network-browser/network-ready-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `work/real-use/network-browser/network-ready-viewport-${width}.png`,
    });
  }
  await invitations.getByRole('button', { name: 'Prepare contributor invitation' }).click();
  await expect(invitations.getByRole('status')).toContainText('Invitation prepared');
  await expect(
    invitations.getByText('network-usability@business.test', { exact: true }),
  ).toBeVisible();
  await expect(invitations.getByLabel('Contributor email', { exact: true })).toHaveValue('');
  await configureNetworkRealUse(f.owner, {
    enabled: false,
    reason: 'Test paused workspace readiness without changing authority',
  });
  try {
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Network is paused in Reviewed test workspace.' }),
    ).toBeVisible();
    await expect(
      invitations.getByText('Invitations are paused in this workspace.', { exact: false }),
    ).toBeVisible();
    await invitations.getByLabel('Contributor name', { exact: true }).fill('Retained paused draft');
    await invitations
      .getByLabel('Contributor email', { exact: true })
      .fill('paused-draft@business.test');
    await invitations
      .getByRole('combobox', { name: 'Contributor operating country', exact: true })
      .selectOption('DE');
    await expect(
      invitations.getByRole('button', { name: 'Prepare contributor invitation' }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toBeFocused();
    await expect(invitations.getByLabel('Contributor name', { exact: true })).toHaveValue(
      'Retained paused draft',
    );
    const response = await page.request.post(
      origin + '/api/workspace/network-invitation?tenant=' + f.realTenant,
      {
        headers: { origin },
        data: {
          action: 'invite',
          commandId: crypto.randomUUID(),
          name: 'Blocked invitation',
          email: 'must-stay-blocked@business.test',
          operatingCountry: 'DE',
        },
      },
    );
    expect(response.ok()).toBe(false);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM app.network_invitation i JOIN identity.principal p ON p.id=i.principal_id JOIN identity."user" u ON u.id=p.identity_id WHERE u.email=$1',
          ['must-stay-blocked@business.test'],
        )
      ).rows[0].n,
    ).toBe(0);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        scrollTo(0, 0);
      });
      await page.screenshot({
        path: `work/real-use/network-browser/network-paused-${width}.png`,
        fullPage: true,
      });
    }
  } finally {
    await configureNetworkRealUse(f.owner, {
      enabled: true,
      reason: 'Restore isolated Network fixture after paused-workspace acceptance',
    });
  }
  // A read denial keeps entry closed and offers the existing MFA recovery path.
  await page.route('**/api/workspace/network-invitations?*', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Owner or admin with current authenticator required.' }),
    }),
  );
  await page.reload();
  await expect(invitations.getByRole('alert')).toContainText(
    'Verify your access, then refresh invitations.',
  );
  await expect(
    invitations.getByRole('link', { name: 'Verify invitation access', exact: true }),
  ).toHaveAttribute('href', '#workspace-authenticator');
  await expect(invitations.getByLabel('Contributor name', { exact: true })).toBeDisabled();
  await page.unroute('**/api/workspace/network-invitations?*');
  await invitations.getByRole('button', { name: 'Refresh invitations', exact: true }).click();
  await expect(
    invitations.getByRole('button', { name: 'Prepare contributor invitation' }),
  ).toBeEnabled();
});
