import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// One job per page (owner, 26 Nov 2026, first hand to Guardian G66: "yes to all three, build it"). The home keeps a
// summary of the process and of trust; /how-it-works carries the whole process and /trust the whole proof, behind
// CORRIDRA_UX_HOW_TRUST_V43, off by default, and only while the home page v4.3 is on as well. With the switch off every
// page is what it was: /how-it-works and /trust are compared with the markup they gave before this change
// (tests/integration/fixtures/how-it-works-off.html and trust-off.html, written once from the unchanged components).
// With it on, each word key renders once on its page, nothing of the nothing-dropped table is missing, and each deep
// page holds one Start a Request.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: unknown; href: string }) =>
    createElement('a', { href, ...rest }, children as never),
}));
vi.doMock(web.resolve('next/navigation'), () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const read = (path: string) => readFileSync(resolve(`apps/web/${path}`), 'utf8');

async function provided(node: unknown) {
  const { LanguageProvider } = await load('components/language-provider.tsx');
  return renderToStaticMarkup(
    createElement(
      LanguageProvider,
      { offered: [{ code: 'en', draft: false }], pageLocales: [] },
      node,
    ),
  );
}
const on = () => {
  vi.stubEnv('CORRIDRA_UX_HOME_V43', 'true');
  vi.stubEnv('CORRIDRA_UX_HOW_TRUST_V43', 'true');
};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
/** How many text nodes of the markup are exactly this sentence (a longer line that contains it does not count). */
const nodes = (html: string) =>
  html
    .split(/<[^>]+>/)
    .map((node) =>
      node
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .trim(),
    )
    .filter(Boolean);
const exact = (html: string, value: string) => nodes(html).filter((node) => node === value).length;

describe('the switch', () => {
  it('is named, described for the owner, and on only when exactly "true" and the home v4.3 is on', async () => {
    const { uxSwitchNames } = await load('lib/ux-switches.ts');
    expect(uxSwitchNames).toContain('CORRIDRA_UX_HOW_TRUST_V43');
    const { switchRegistry } = await load('lib/owner-switches.ts');
    const entry = (switchRegistry as { name: string; line: string; kind: string }[]).find(
      (s) => s.name === 'CORRIDRA_UX_HOW_TRUST_V43',
    );
    expect(entry?.kind).toBe('flag');
    expect(entry?.line).toContain('Off by default');
    expect(entry?.line).toContain('removing the setting in Vercel and redeploying');
    const { howTrustV43On } = await load('lib/how-trust-v43.ts');
    const both = { CORRIDRA_UX_HOME_V43: 'true', CORRIDRA_UX_HOW_TRUST_V43: 'true' };
    expect(howTrustV43On(both)).toBe(true);
    expect(howTrustV43On({})).toBe(false);
    expect(howTrustV43On({ CORRIDRA_UX_HOW_TRUST_V43: 'true' })).toBe(false);
    expect(howTrustV43On({ CORRIDRA_UX_HOME_V43: 'true' })).toBe(false);
    for (const value of ['TRUE', 'True', '1', 'yes', '', ' true', 'false', undefined])
      expect(
        howTrustV43On({ CORRIDRA_UX_HOME_V43: 'true', CORRIDRA_UX_HOW_TRUST_V43: value }),
        String(value),
      ).toBe(false);
  });

  it('is set nowhere in the repository: not in a workflow, a config or a Vercel setting', () => {
    for (const path of [
      '.github/workflows',
      'vercel.json',
      'apps/web/vercel.json',
      '.env.example',
    ]) {
      const target = resolve(path);
      if (!existsSync(target)) continue;
      const files = path.endsWith('workflows')
        ? ['ci.yml'].map((f) => resolve(path, f)).filter(existsSync)
        : [target];
      for (const file of files)
        expect(readFileSync(file, 'utf8'), file).not.toContain('CORRIDRA_UX_HOW_TRUST_V43');
    }
  });
});

describe('with the switch off, the pages are what they were', () => {
  for (const [slug, fixture] of [
    ['how-it-works', 'how-it-works-off.html'],
    ['trust', 'trust-off.html'],
  ] as const) {
    it(`/${slug} gives exactly the recorded markup, with no setting and with only one of the two on`, async () => {
      const path = resolve('tests/integration/fixtures', fixture);
      const render = async () => {
        const { default: Page } = await load(`app/${slug}/page.tsx`);
        return await provided(Page());
      };
      const unset = await render();
      if (process.env.HOW_TRUST_WRITE === '1') writeFileSync(path, unset);
      expect(unset).toBe(readFileSync(path, 'utf8'));
      vi.stubEnv('CORRIDRA_UX_HOW_TRUST_V43', 'true');
      expect(await render(), 'the home v4.3 is off').toBe(unset);
      vi.stubEnv('CORRIDRA_UX_HOW_TRUST_V43', '');
      vi.stubEnv('CORRIDRA_UX_HOME_V43', 'true');
      expect(await render(), 'the deep switch is off').toBe(unset);
    });
  }

  it('the home passes no summaries prop until both switches are on', async () => {
    const { default: Home } = await load('app/page.tsx');
    const { HomeV43Page } = await load('components/home-v43-page.tsx');
    const props = () => {
      const page = Home() as { props: { children: { type: unknown; props: object }[] } };
      return page.props.children[1]!;
    };
    vi.stubEnv('CORRIDRA_UX_HOME_V43', 'true');
    expect(props().type).toBe(HomeV43Page);
    expect(Object.keys(props().props)).not.toContain('summaries');
    vi.stubEnv('CORRIDRA_UX_HOW_TRUST_V43', 'true');
    expect(props().props).toMatchObject({ summaries: true });
  });

  it('the new compositions are lazy chunks, never static imports of a page', () => {
    for (const file of ['app/how-it-works/page.tsx', 'app/trust/page.tsx', 'app/page.tsx'])
      expect(read(file), file).not.toMatch(
        /from '[^']*\/(how-it-works-v43|trust-v43|home-v43-summaries)'/,
      );
    const boundary = read('components/how-trust-v43-page.tsx');
    expect(boundary).toContain("dynamic(() => import('./how-it-works-v43')");
    expect(boundary).toContain("dynamic(() => import('./trust-v43')");
    // The home keeps its own module free of the summaries and their stylesheet: they arrive as slots from a lazy chunk.
    const home = read('components/home-v43.tsx');
    expect(home).not.toMatch(/^import .*(home-v43-summar|how-trust-v43)/m);
    const homePage = read('components/home-v43-page.tsx');
    expect(homePage).toContain("import('./home-v43-summarised')");
    expect(homePage).toContain('dynamic(');
    expect(homePage).not.toMatch(/^import .*home-v43-summar/m);
  });
});

describe('with the switch on', () => {
  it('chooses the deep compositions on both pages', async () => {
    on();
    const { HowItWorksV43Page, TrustV43Page } = await load('components/how-trust-v43-page.tsx');
    for (const [slug, boundary] of [
      ['how-it-works', HowItWorksV43Page],
      ['trust', TrustV43Page],
    ] as const) {
      const { default: Page } = await load(`app/${slug}/page.tsx`);
      const shell = Page() as { props: { children: { type: unknown } } };
      expect(shell.props.children.type, slug).toBe(boundary);
    }
  });
});

// The nothing-dropped table of the mockups README, as keys: every one is on the page that holds it, once.
async function pageText(name: 'how-it-works-v43' | 'trust-v43') {
  on();
  const loaded = await load(`components/${name}.tsx`);
  const html = await provided(
    createElement(name === 'trust-v43' ? loaded.TrustV43 : loaded.HowItWorksV43),
  );
  return { html, flat: text(html) };
}
async function words(keys: string[]) {
  const { en } = await load('lib/i18n/messages.ts');
  return keys.map((key) => {
    const value = (en as Record<string, string>)[key];
    expect(value, key).toBeTruthy();
    return [key, value!] as const;
  });
}
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('/how-it-works with the switch on', () => {
  it('holds the whole process once, with one Start a Request and no tab control', async () => {
    const { html, flat } = await pageText('how-it-works-v43');
    expect(count(html, '<h1')).toBe(1);
    expect(count(html, 'Start a Request')).toBe(1);
    expect(count(html, 'href="/plan"')).toBe(1);
    expect(html).not.toContain('Show More');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    // Two phase cards, six steps; eight role cards; four questions, none open.
    expect(count(html, 'class="htv43-phase"')).toBe(2);
    expect(count(html, 'class="htv43-step"')).toBe(6);
    expect(flat).toContain('Before You Meet');
    expect(flat).toContain('Meet and Follow Up');
    const roles = html.slice(html.indexOf('id="who"'), html.indexOf('id="faq"'));
    expect(count(roles, 'class="htv43-card"')).toBe(8);
    expect(count(html.slice(html.indexOf('id="faq"')), '<details')).toBe(4);
    expect(html).not.toContain('<details open');
    // Every id the page links to is on the page.
    for (const id of [
      'top',
      'page-approach',
      'page-next',
      'process',
      'how',
      'who',
      'faq',
      'start-request',
    ])
      expect(count(html, `id="${id}"`), id).toBe(1);
    // The four stages of each route: sixteen records, each once.
    expect(count(html, 'class="htv43-stage"')).toBe(16);
  });

  it('shows each of its word keys once: fourteen steps, rules, roles, questions, stage words', async () => {
    const { html } = await pageText('how-it-works-v43');
    const keys = [
      'home.tr.ms.eyebrow',
      'home.tr.ms.title',
      'home.tr.ms.lead',
      'home.tr.ms.note',
      ...range(0, 13).map((n) => `home.tr.ms.s${n}`),
      ...range(1, 4).flatMap((n) => [`home.tr.nv.${n}`, `home.tr.nv.${n}.text`]),
      'home.tr.pe.eyebrow',
      'home.tr.pe.title',
      ...range(0, 7).flatMap((n) => [`home.tr.pe.${n}.give`, `home.tr.pe.${n}.get`]),
      ...[8, 3, 4, 5].flatMap((n) => [`home.tr.fq.${n}.q`, `home.tr.fq.${n}.a1`]),
      'home.tr.fq.3.a2',
      'home.v43.process.eyebrow',
      'home.v43.process.title',
      'home.v43.process.lead',
      ...range(1, 4).map((n) => `home.v43.process.step.${n}`),
    ];
    for (const [key, value] of await words(keys)) {
      // Stage words repeat by design (four routes each), a role word may match inside a longer line: whole-line check.
      // The stage names repeat by design, once for each of the four routes; every other key renders once.
      // "A contract is not cash." is also one of the page's three statements (content/public-pages.ts), so it shows twice.
      // The eyebrow "How it works" is also the page's own label, in the breadcrumb and the hero (content/public-pages.ts).
      const times = key.startsWith('home.v43.process.step.')
        ? 4
        : key === 'home.tr.nv.3'
          ? 2
          : key === 'home.v43.process.eyebrow'
            ? 3
            : 1;
      expect(exact(html, value), key).toBe(times);
    }
    // The six route-stage titles of the four routes are all there.
    for (const route of ['china', 'sell', 'delegation', 'other'])
      for (const n of range(1, 4))
        for (const part of ['title', 'line'])
          for (const [key, value] of await words([`home.v43.process.rec.${route}.${n}.${part}`]))
            expect(exact(html, value), key).toBe(1);
  });

  it('keeps what the table says leaves it off the page: no start section, no route choice, no solutions', async () => {
    const { html } = await pageText('how-it-works-v43');
    for (const [key, value] of await words([
      'home.tr.br.eyebrow',
      'home.tr.br.title',
      'home.tr.br.goals',
      'home.tr.br.next',
      'home.tr.rs.title',
      'home.tr.not.title',
      'home.tr.fq.1.q',
      'home.tr.fq.2.q',
      'home.tr.fq.6.q',
      'home.tr.fq.7.q',
    ]))
      expect(exact(html, value), key).toBe(0);
    expect(html).not.toContain('id="start"');
    expect(html).not.toContain('tr-goals');
  });

  it('draws the place in the role "Company entering Bangladesh" with its mark, and changes no words', async () => {
    const { html, flat } = await pageText('how-it-works-v43');
    expect(html).toMatch(/Company entering <span[^>]*flagged[^>]*>.*?Bangladesh/s);
    expect(flat).toContain('Company entering Bangladesh');
  });
});

describe('/trust with the switch on', () => {
  it('holds the whole proof once, with one Start a Request', async () => {
    const { html } = await pageText('trust-v43');
    expect(count(html, '<h1')).toBe(1);
    expect(count(html, 'Start a Request')).toBe(1);
    expect(count(html, 'href="/plan"')).toBe(1);
    expect(html).not.toContain('Show More');
    expect(count(html.slice(html.indexOf('id="faq"')), '<details')).toBe(4);
    expect(html).not.toContain('<details open');
    for (const id of [
      'top',
      'page-approach',
      'trust',
      'outcomes',
      'page-next',
      'routes',
      'limits',
      'faq',
      'start-request',
    ])
      expect(count(html, `id="${id}"`), id).toBe(1);
    // Five long label cards, five one-line labels, eleven outcome stages, six readiness statuses, eight limits.
    expect(
      count(
        html.slice(html.indexOf('id="page-approach"'), html.indexOf('id="trust"')),
        'htv43-label-card',
      ),
    ).toBe(5);
    expect(count(html, 'class="htv43-outcomes"')).toBe(1);
    expect(count(html, 'tr-ready-chip')).toBe(6);
    expect(count(html, 'hv42-nots')).toBeGreaterThanOrEqual(1);
    for (const [key, value] of await words([
      'home.tr.tr.eyebrow',
      'home.tr.tr.title',
      'home.tr.tr.lead',
      'home.v43.trust.line.self',
      'home.v43.trust.line.evidence',
      'home.v43.trust.line.verified',
      'home.v43.trust.line.derived',
      'home.v43.trust.line.outcome',
      'home.v43.trust.ledger',
      'home.v43.trust.day.1',
      'home.v43.trust.day.6',
      'home.v43.trust.d1',
      'home.v43.trust.d11.summary',
      'home.v43.trust.new',
      'home.v43.ex.sample',
      'home.tr.rs.eyebrow',
      'home.tr.rs.title',
      'home.tr.rs.china.text',
      'home.tr.rs.sell.text',
      'home.tr.rs.rev',
      'home.tr.rs.rev.text',
      'home.tr.rs.other',
      'home.tr.rs.other.text',
      'home.tr.rs.ready',
      'home.tr.rs.ready.end',
      'home.v42.not.eyebrow',
      'home.tr.not.title',
      ...range(1, 8).flatMap((n) => [`home.tr.not.${n}`, `home.tr.not.${n}.text`]),
      ...[6, 1, 2, 7].flatMap((n) => [`home.tr.fq.${n}.q`, `home.tr.fq.${n}.a1`]),
    ]))
      expect(exact(html, value), key).toBe(1);
    // The Explore Every Route link is on the page once.
    expect(count(html, 'href="/corridors"')).toBe(1);
  });

  it('uses one set of words: the retired label lines and the second ledger are not on the page', async () => {
    // home.tr.tr.derived and .outcome read the same as the v4.3 lines (home.v43.trust.line.derived and .outcome), so
    // those two show once, as the v4.3 keys.
    const { html } = await pageText('trust-v43');
    for (const [key, value] of await words([
      'home.fact.selfDeclared',
      'home.fact.evidence',
      'home.fact.verified',
      'home.tr.tr.ledger',
      'home.tr.tr.ledger.title',
      'home.tr.tr.day6.text',
      'home.tr.tr.day11.text',
      'home.tr.tr.day11.kept',
      'home.tr.q.example',
      'home.tr.fq.3.q',
      'home.tr.fq.4.q',
      'home.tr.fq.5.q',
      'home.tr.fq.8.q',
    ]))
      expect(exact(html, value), key).toBe(0);
  });

  it('keeps the correction as a new entry with the original quote visible as revision 1', async () => {
    const { flat } = await pageText('trust-v43');
    expect(flat).toContain('USD 36,800');
    expect(flat).toContain('USD 37,400');
    expect(flat).toContain('The original quote remains visible as revision 1.');
  });
});

describe('the home summaries', () => {
  it('are three lines each, link to the pages and keep the ids the header and footer use', async () => {
    on();
    const { HomeV43ProcessSummary, HomeV43TrustSummary } = await load(
      'components/home-v43-summaries.tsx',
    );
    const process = await provided(createElement(HomeV43ProcessSummary));
    const trust = await provided(createElement(HomeV43TrustSummary));
    expect(count(process, '<li>')).toBe(3);
    expect(count(trust, '<li>')).toBe(3);
    expect(process).toContain('id="process"');
    expect(process).toContain('href="/how-it-works"');
    expect(trust).toContain('id="trust"');
    expect(trust).toContain('href="/trust"');
    expect(text(process)).toContain(
      'How a request moves from your first goal to a recorded result, in six steps.',
    );
    expect(text(trust)).toContain('Corrections sit alongside the original record.');
    expect(text(process)).toContain('See the Full Process');
    expect(text(trust)).toContain("Read Corridra's Trust Principles");
  });
});
