import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { countryCodes } from '../../packages/domain/src/countries';

// Team desk D2b: the country choices are sorted by the name shown, the stored codes are unchanged, and the
// server and the first browser draw agree (UI direction, "Maps and the atlas", rule 5: long country lists show
// codes until the page has hydrated). The real component is drawn the way the server draws it, then hydrated.
let server: Server, origin: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{renderToString}from'react-dom/server';
      import{hydrateRoot}from'react-dom/client';
      import{CountryOptions}from ${JSON.stringify(resolve('apps/web/app/operator/country-options.tsx'))};
      const view=<select id="country" name="country" defaultValue="BD"><CountryOptions/></select>;
      const host=document.getElementById('fixture');
      const html=renderToString(view);
      host.innerHTML=html;
      window.serverHtml=html;
      window.serverOptions=[...host.querySelectorAll('option')].map(o=>[o.value,o.textContent]);
      window.hydrationErrors=[];
      const note=(e)=>window.hydrationErrors.push(String(e&&e.message||e));
      const error=console.error;
      console.error=(...a)=>{note(a.join(' '));error(...a)};
      window.hydrate=()=>hydrateRoot(host,view,{onRecoverableError:note});`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    // The development build of React, so a difference between the server and the browser draw is reported.
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  });
  const bundle = result.outputFiles[0]!.text;
  server = createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><title>Country</title></head><body><label for="country">Country</label><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

test('D2b country choices: codes on the server, then names sorted by name, values intact, no hydration mismatch', async ({
  page,
}) => {
  await page.goto(origin);
  await page.waitForFunction(() => 'hydrate' in window);
  // Before hydration the choices are the stored codes, in the stored order, so no server can draw a name the
  // browser would draw differently.
  const drawn = await page.evaluate(
    () => (window as unknown as { serverOptions: [string, string][] }).serverOptions,
  );
  expect(drawn, 'server draw shows codes only').toEqual(countryCodes.map((code) => [code, code]));
  await expect(page.locator('#country')).toHaveValue('BD');

  await page.evaluate(() => (window as unknown as { hydrate: () => void }).hydrate());
  const options = page.locator('#country option');
  await expect(options.first()).not.toHaveText(/^[A-Z]{2}$/);
  const shown = await options.evaluateAll((nodes) =>
    nodes.map((node) => [(node as HTMLOptionElement).value, node.textContent ?? '']),
  );
  const names = shown.map(([, name]) => name!);
  // Sorted by the name a person reads, in the browser that drew the names.
  expect(names, 'sorted by shown name').toEqual(
    await page.evaluate((list) => [...list].sort((a, b) => a.localeCompare(b, 'en')), names),
  );
  expect(names.indexOf('Bangladesh')).toBeLessThan(names.indexOf('China'));
  expect(names.indexOf('Åland Islands')).toBeLessThan(names.indexOf('Albania'));
  // Every stored code is still offered once, each under its own name, and the chosen value is kept.
  expect(shown.map(([code]) => code).sort()).toEqual([...countryCodes].sort());
  const english = new Intl.DisplayNames(['en'], { type: 'region' });
  expect(shown.find(([code]) => code === 'BD')).toEqual(['BD', english.of('BD')]);
  expect(names.every((name) => !/^[A-Z]{2}$/.test(name))).toBe(true);
  await expect(page.locator('#country')).toHaveValue('BD');
  expect(
    await page.evaluate(() => (window as unknown as { hydrationErrors: string[] }).hydrationErrors),
    'no hydration mismatch',
  ).toEqual([]);
});
