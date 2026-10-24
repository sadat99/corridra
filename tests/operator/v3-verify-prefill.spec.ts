import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The real account form is bundled and mounted with the identity provider calls stubbed in the
// browser. This proves the verify page does not ask for an address it already has, not that the
// provider sent or accepted anything.
let server: Server, origin: string;
let bundle = '';
const stored = 'person@example.invalid';
type Fixture = {
  __navigated?: string;
  __calls?: { name: string; body: { email?: string; otp?: string } }[];
};

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{AccountForm}from ${JSON.stringify(resolve('apps/web/components/account-form.tsx'))};
      const mode=location.pathname.slice(1)||'verify';
      createRoot(document.getElementById('fixture')).render(<AccountForm mode={mode}/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'provider-fixture',
        setup(b) {
          b.onResolve({ filter: /neon-auth-client$|^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link(props){return <a {...props}/>}'
                : args.path === 'next/navigation'
                  ? 'const router={replace:path=>{window.__navigated=path},refresh:()=>{}};export function useRouter(){return router}export function useSearchParams(){return new URLSearchParams(location.search)}'
                  : "const log=(name,body)=>{(window.__calls=window.__calls||[]).push({name,body})};export const accountClient={getSession:async()=>{const as=new URLSearchParams(location.search).get('as');return{data:as?{user:{email:as,emailVerified:false}}:null,error:null}},signUp:{email:async(body)=>{log('signUp',body);return{data:{},error:null}}},emailOtp:{verifyEmail:async(body)=>{log('verify',body);return{data:{},error:null}},sendVerificationOtp:async(body)=>{log('send',body);return{data:{success:true},error:null}}}};",
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify prefill fixture</title></head><body><main id="main"><h1>Account access</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

test('signing up remembers the address for this tab, and the password is not kept', async ({
  page,
}) => {
  await page.goto(`${origin}/signup`);
  await page.getByLabel('Name', { exact: true }).fill('Test Person');
  await page.getByLabel('Email', { exact: true }).fill(stored);
  await page.getByLabel('Password', { exact: true }).fill('A long password for this test');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Fixture).__navigated))
    .toBe('/verify-email');
  const kept = await page.evaluate(() => JSON.stringify({ ...window.sessionStorage }));
  expect(kept).toContain(stored);
  expect(kept).not.toContain('long password');
});

test('the verify page fills in the remembered address, asks only for the code and verifies with it', async ({
  page,
}) => {
  await page.addInitScript(
    (address) => window.sessionStorage.setItem('corridra.verify-email', address),
    stored,
  );
  await page.goto(`${origin}/verify`);
  const email = page.getByLabel('Email', { exact: true });
  const code = page.getByLabel('Verification code', { exact: true });
  await expect(email).toHaveValue(stored);
  await expect(code).toBeFocused();
  await expect(page.getByText('Enter the six-digit code from your email.')).toBeVisible();
  await code.fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Fixture).__navigated))
    .toBe('/signin');
  const calls = await page.evaluate(() => (window as unknown as Fixture).__calls);
  expect(calls).toEqual([{ name: 'verify', body: { email: stored, otp: '123456' } }]);
  expect(await page.evaluate(() => window.sessionStorage.getItem('corridra.verify-email'))).toBe(
    null,
  );
});

test('the address can still be changed before the code is used', async ({ page }) => {
  await page.addInitScript(
    (address) => window.sessionStorage.setItem('corridra.verify-email', address),
    stored,
  );
  await page.goto(`${origin}/verify`);
  await page.getByLabel('Email', { exact: true }).fill('other@example.invalid');
  await page.getByLabel('Verification code', { exact: true }).fill('654321');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Fixture).__navigated))
    .toBe('/signin');
  const calls = await page.evaluate(() => (window as unknown as Fixture).__calls);
  expect(calls?.[0].body.email).toBe('other@example.invalid');
});

test('a signed-in account that is not verified yet has its address filled in', async ({ page }) => {
  await page.goto(`${origin}/verify?as=${encodeURIComponent('signed.in@example.invalid')}`);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('signed.in@example.invalid');
  await expect(page.getByLabel('Verification code', { exact: true })).toBeFocused();
});

test('with nothing remembered the page asks for the address, as before', async ({ page }) => {
  await page.goto(`${origin}/verify`);
  await expect(page.getByLabel('Verification code', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
  await expect(
    page.getByText('Enter the email address you used to sign up and the six-digit code'),
  ).toBeVisible();
});

test('blocked storage changes nothing but the convenience', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  await page.goto(`${origin}/verify`);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
  await page.getByLabel('Email', { exact: true }).fill(stored);
  await page.getByLabel('Verification code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Fixture).__navigated))
    .toBe('/signin');
});

test('the prefilled page has no overflow at 390 and 1440 and passes axe', async ({ page }) => {
  await page.addInitScript(
    (address) => window.sessionStorage.setItem('corridra.verify-email', address),
    stored,
  );
  await page.goto(`${origin}/verify`);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(stored);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
