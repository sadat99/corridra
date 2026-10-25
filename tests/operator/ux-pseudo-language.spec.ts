import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The pseudo-language test (Lane 11 of the UX update): every English string is made 40 percent longer
// (with a long unbroken word added to a third of them, as German compounds are) and shown through the
// real Your Move screen, the Road and the first question in the real stylesheets. What is proved: at
// 320, 390, 768 and 1440 px nothing scrolls sideways, every control is still 44 px tall and the
// accessibility scan is clean. A language that runs longer than English cannot break these screens.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider,useLanguage}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{MoveView}from ${JSON.stringify(resolve('apps/web/app/account/move/move-view.tsx'))};
      import{Road}from ${JSON.stringify(resolve('apps/web/components/mr/road.tsx'))};
      import{FirstQuestion}from ${JSON.stringify(resolve('apps/web/components/mr/first-question.tsx'))};
      import{mrLabelsFor}from ${JSON.stringify(resolve('apps/web/components/mr/labels.ts'))};
      import{catalogs,en}from ${JSON.stringify(resolve('apps/web/lib/i18n/messages.ts'))};
      import{buildMoveModel}from ${JSON.stringify(resolve('apps/web/lib/move-cards.ts'))};
      let n=0;
      for(const key of Object.keys(en)){
        const text=en[key]; const extra=Math.ceil(text.length*0.4);
        const filler=' lorem ipsum dolor sit amet consectetur adipiscing'.repeat(3).slice(0,extra).trimEnd();
        const word=(n++%3===0)?' Arbeitsbereichsverwaltungsberechtigung':'';
        catalogs.de[key]=text+' '+filler+word;
      }
      try{localStorage.setItem('corridra.language','de')}catch{}
      const owner={id:'11111111-1111-4111-8111-111111111111',name:'Atelier Rahman',role:'owner'};
      const input={workspaces:[owner],
        drafts:[{id:'d1',workspaceId:owner.id,title:'Fabric cutting machine',updatedAt:'2026-10-01T00:00:00Z'}],
        quotes:[{id:'q1',workspaceId:owner.id,title:'Interpreter in Guangzhou',contextLabel:'M'}],
        companyLinks:[{workspaceId:owner.id,organisationName:'Atelier Rahman Ltd'}],
        requests:[{id:'r1',workspaceId:owner.id,createdAt:'2026-10-02T00:00:00Z',
          progress:{status:'OUTREACH',receivedAt:'2026-10-02T09:00:00Z',replies:[{createdAt:'2026-10-09T10:00:00Z'}]}}]};
      function Screen(){
        const {locale}=useLanguage(); const labels=mrLabelsFor(locale);
        return <main className="operator-page ux-workspace">
          <h1>Pseudo language</h1>
          <MoveView model={buildMoveModel(input)} startHref="/plan"/>
          <Road status="MEETINGS" labels={labels.road}/>
          <FirstQuestion value="buy-machine" onChoose={()=>{}}/>
        </main>;
      }
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false},{code:'de',draft:true}]}><Screen/></LanguageProvider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [
      {
        name: 'next-fixture',
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
                ? 'export default function Link({prefetch,...props}){return <a {...props}/>}'
                : 'const router={replace:()=>{},refresh:()=>{}};export function useRouter(){return router}',
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pseudo fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

test('the pseudo language is really longer than English and is the language shown', async ({
  page,
}) => {
  await page.goto(origin);
  await expect(page.locator('.move-view')).toHaveAttribute('lang', 'de');
  await expect(page.getByText(/lorem ipsum/).first()).toBeVisible();
  await expect(page.getByText('Arbeitsbereichsverwaltungsberechtigung').first()).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`fits at ${width} wide with every string 40 percent longer: no sideways scroll, 44 pixel targets, no accessibility violation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await expect(page.locator('.move-view')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    for (const control of await page
      .locator('.move-view a, .move-view button, .mr-fq-card')
      .all()) {
      const box = await control.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    if (width === 320)
      await page.screenshot({
        path: 'docs/design-system/evidence/lane11-languages/pseudo-320.png',
        fullPage: true,
      });
  });
}
