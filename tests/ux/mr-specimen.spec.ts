import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// UX update, Lane 1 specimen. The teaching-layer components (Road, holder badge, Move card, quote
// card, ghost state, mode label) are rendered with the product stylesheet in every state the plan
// requires: each status, long copy, Bangla, Chinese and Arabic, and a right-to-left sample. The
// fixture is built in the test (no production route imports the components), the way the operator
// specs mount theirs, so nothing ships that a visitor could reach.

const widths = [320, 390, 768, 1440];
const here = dirname(fileURLToPath(import.meta.url));
const shotDir = join(here, '..', '..', 'work', 'ux-specimen');
let script = '';
let styles = '';

const entry = `
import { createRoot } from 'react-dom/client';
import { Road, HolderBadge, MoveCard, QuoteCard, GhostState, ModeLabel, mrLabels } from ${JSON.stringify(
  resolve('apps/web/components/mr/index.ts'),
)};

const long = 'Reference-Corridra-Quotation-Supplier-Bangladesh-Singapore-0000000000000000';
const statuses = ['DRAFT','QUALIFICATION','ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE','CLOSED','ON_HOLD','CANCELLED','IN_REVIEW'];
const arabic = {
  ...mrLabels.road,
  title: 'أين وصل هذا الطلب',
  steps: { define: 'تحديد', find: 'بحث', compare: 'مقارنة', visit: 'زيارة', decide: 'قرار', follow: 'متابعة' },
  states: { done: 'تم', now: 'الآن', later: 'لاحقا', notTracked: 'لم يُتتبع بعد' },
};
const bangla = {
  ...mrLabels.road,
  title: 'আপনার অনুরোধ এখন কোথায়',
  steps: { define: 'নির্ধারণ', find: 'খোঁজ', compare: 'তুলনা', visit: 'সাক্ষাৎ', decide: 'সিদ্ধান্ত', follow: 'পরবর্তী কাজ' },
  states: { done: 'সম্পন্ন', now: 'এখন', later: 'পরে', notTracked: 'এখনো ট্র্যাক হয়নি' },
};
const chinese = {
  ...mrLabels.road,
  title: '您的请求目前进展',
  steps: { define: '明确', find: '寻找', compare: '比较', visit: '拜访', decide: '决定', follow: '跟进' },
  states: { done: '已完成', now: '进行中', later: '稍后', notTracked: '尚未跟踪' },
};
const terms = [
  { label: 'Lead time', value: '45 days' },
  { label: 'Payment terms', value: '30% deposit, 70% before shipping' },
  { label: 'Installation', value: undefined },
  { label: 'Spares', value: '' },
  { label: long, value: long },
];

function App() {
  return (
    <main id="mr-specimen" className="ux-workspace ux-customer">
      <h1>Teaching layer specimen</h1>
      <section aria-labelledby="sp-road"><h2 id="sp-road">The Road</h2>
        {statuses.map((s) => (
          <div key={s} data-status={s} style={{ marginBlock: 'var(--space-4)' }}>
            <h3>{s}</h3>
            <Road status={s} records={{ compare: s === 'MEETINGS' || s === 'FOLLOW_UP', decide: s === 'FOLLOW_UP' }} showLegend={s === 'DRAFT'} />
          </div>
        ))}
      </section>
      <section aria-labelledby="sp-scripts"><h2 id="sp-scripts">Bangla, Chinese, Arabic and right to left</h2>
        <div lang="bn"><Road status="MEETINGS" labels={bangla} showLegend={false} /></div>
        <div lang="zh"><Road status="MEETINGS" labels={chinese} showLegend={false} /></div>
        <div lang="ar" dir="rtl"><Road status="MEETINGS" labels={arabic} showLegend={false} /></div>
      </section>
      <section aria-labelledby="sp-holders"><h2 id="sp-holders">Holder badge</h2>
        <p style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <HolderBadge holder="you" /><HolderBadge holder="team" /><HolderBadge holder="third" />
          <HolderBadge holder="third" labels={{ you: long, team: long, third: long }} />
        </p>
      </section>
      <section aria-labelledby="sp-moves"><h2 id="sp-moves">Move card</h2>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <MoveCard verb="Add" object="your import licence number" holder="you" context="Automatic fabric cutting machine" due="5 November 2026" href="/account" action="Add it" />
          <MoveCard verb="Read" object="the new reply" holder="you" href="/account" action="Open the Room" />
          <MoveCard verb="Confirm" object="your visit dates" holder="team" context="Waiting on the Corridra team" />
          <MoveCard verb="Send" object={long} holder="third" due={long} href="/account" action={long} />
          <div lang="bn"><MoveCard verb="Answer" object="আপনার আমদানি লাইসেন্স নম্বর যোগ করুন, দয়া করে দ্রুত জানান" holder="you" href="/account" action="উত্তর দিন" /></div>
          <div lang="zh"><MoveCard verb="Add" object="您的进口许可证编号，请尽快提供以便继续处理" holder="you" href="/account" action="添加" /></div>
          <div lang="ar" dir="rtl"><MoveCard verb="Add" object="رقم رخصة الاستيراد الخاصة بك" holder="you" href="/account" action="أضف" /></div>
        </div>
      </section>
      <section aria-labelledby="sp-quotes"><h2 id="sp-quotes">Quote card</h2>
        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))' }}>
          <QuoteCard supplier="Lantern Cutting Works" place="Guangzhou, China" revision={2} currency="USD" unitPrice="USD 18,400.00" total="USD 18,400.00" comparable terms={terms.slice(0, 2)} />
          <QuoteCard supplier="绿野机械有限公司" supplierLang="zh" place="Foshan, China" revision={1} currency="CNY" unitPrice="CNY 128,000.00" total="CNY 128,000.00" comparable={false} reason="Missing: Installation, Spares" terms={terms} />
          <QuoteCard supplier={long} revision={3} currency="USD" comparable={false} reason="Quote expired on 15 October 2026" terms={terms} />
        </div>
      </section>
      <section aria-labelledby="sp-ghost"><h2 id="sp-ghost">Ghost state and mode label</h2>
        <GhostState title="Nothing here yet" text="Your offers will appear here when the Corridra team delivers a report.">
          <QuoteCard supplier="Example supplier" revision={1} currency="USD" unitPrice="USD 0.00" comparable={false} terms={terms.slice(0, 2)} />
        </GhostState>
        <p style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}><ModeLabel real={false} /><ModeLabel real /></p>
      </section>
    </main>
  );
}
createRoot(document.getElementById('mount')).render(<App />);
`;

test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: resolve('apps/web') },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  script = result.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
  styles = result.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
});

async function mount(page: Page, width: number) {
  page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('CONSOLE ERROR', message.text());
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/how-it-works');
  await page.evaluate(
    ({ css }) => {
      document.body.innerHTML = '<div id="mount"></div>';
      document.body.className = '';
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    },
    { css: styles },
  );
  // next/link reads a few build-time variables; the browser has no `process`, so give it an empty one.
  await page.addScriptTag({ content: 'window.process = { env: { NODE_ENV: "production" } };' });
  await page.addScriptTag({ content: script, type: 'module' });
  await page.waitForSelector('#mr-specimen');
}

for (const width of widths) {
  test(`UX foundation specimen at ${width}px`, async ({ page }) => {
    await mount(page, width);
    mkdirSync(shotDir, { recursive: true });

    // 1. No horizontal overflow from the page or from any part of the specimen.
    const overflow = await page.evaluate(() => {
      const view = document.documentElement.clientWidth;
      const out: string[] = [];
      if (document.documentElement.scrollWidth > view) out.push('page');
      for (const el of document.querySelectorAll('#mr-specimen *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > view + 1 || r.left < -1))
          out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`);
      }
      return out;
    });
    expect(overflow, 'elements wider than the viewport').toEqual([]);

    // 2. Every action is at least 44 px in both directions.
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('#mr-specimen :is(a[href], button, input)')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ el }) => `${el.tagName.toLowerCase()}:${(el.textContent || '').slice(0, 24)}`),
    );
    expect(small, 'targets under 44 px').toEqual([]);

    // 3. The Road keeps one current step, the word under every step, and four different shapes.
    const roads = await page.evaluate(() =>
      [...document.querySelectorAll('[data-status]')].map((box) => ({
        status: (box as HTMLElement).dataset.status,
        current: box.querySelectorAll('[aria-current="step"]').length,
        steps: box.querySelectorAll('.mr-road > li').length,
        words: [...box.querySelectorAll('.mr-road-state')].every(
          (e) => (e.textContent || '').trim() !== '',
        ),
      })),
    );
    for (const road of roads) {
      expect(road.steps, road.status).toBe(6);
      expect(road.words, road.status).toBe(true);
      expect(road.current, road.status).toBe(
        ['ON_HOLD', 'CANCELLED', 'IN_REVIEW'].includes(road.status!) ? 0 : 1,
      );
    }
    const shapes = await page.evaluate(() => {
      const dot = (state: string) => {
        const el = document.querySelector(`[data-state="${state}"] > .mr-road-dot`) as HTMLElement;
        const s = getComputedStyle(el);
        return `${s.borderTopStyle}|${s.backgroundColor}|${s.boxShadow === 'none'}`;
      };
      return ['done', 'now', 'later', 'notTracked'].map(dot);
    });
    expect(new Set(shapes).size, 'four distinct step shapes').toBe(4);

    // 4. Mixed-script copy keeps a readable line height.
    const copy = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('#mr-specimen :is(b, p, span, h3, a)')) {
        const text = el.textContent || '';
        if (!/[ঀ-৿一-鿿؀-ۿ]/.test(text)) continue;
        const s = getComputedStyle(el);
        const lh =
          s.lineHeight === 'normal' ? 1.2 : parseFloat(s.lineHeight) / parseFloat(s.fontSize);
        if (lh < 1.3) bad.push(`${el.tagName.toLowerCase()} lh ${lh.toFixed(2)}`);
      }
      return bad;
    });
    expect(copy, 'Bangla, Chinese and Arabic line height under 1.3').toEqual([]);

    // 5. The right-to-left sample really lays out right to left.
    const rtl = await page.evaluate(() => {
      const box = document.querySelector('[dir="rtl"] .mr-move') as HTMLElement;
      return getComputedStyle(box).direction;
    });
    expect(rtl).toBe('rtl');

    // 6. Accessibility: contrast, names and roles.
    const axe = await new AxeBuilder({ page }).include('#mr-specimen').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

    await page.screenshot({ path: join(shotDir, `mr-specimen-${width}.png`), fullPage: true });
  });
}
