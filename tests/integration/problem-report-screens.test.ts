import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The customer screens of Report a Problem (ADR-078 decisions 4, 6 and 8, docs/revamp/specs/problem-reports.md sections 3
// to 6), drawn on the server without a browser or a database: the two probe states, the closed-account frame, what each
// page says, and ADR-032 (the customer's screens never lead to the team's addresses). What a person reads for each
// status is in problem-report-client.test.ts; the live behaviour in a browser is the operator suite.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;

type Element = { type: unknown; props: Record<string, unknown> };
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const person = { subject: 'synthetic-person', issuer: 'https://issuer.invalid/auth' };

let offered = true;
let session: unknown = { ok: true, ...person, name: null };

beforeEach(() => {
  offered = true;
  session = { ok: true, ...person, name: null };
  vi.resetModules();
  vi.doMock(web.resolve('next/navigation'), () => ({
    useRouter: () => ({
      push: () => undefined,
      replace: () => undefined,
      refresh: () => undefined,
    }),
    usePathname: () => '/account/problem-reports',
    useSearchParams: () => new URLSearchParams(),
  }));
  vi.doMock(web.resolve('next/link'), () => ({
    default: ({ children, href }: Record<string, unknown>) =>
      createElement('a', { href }, children),
  }));
  vi.doMock(resolve('apps/web/lib/problem-reports-offered.ts'), () => ({
    problemReportsOffered: async () => offered,
  }));
  vi.doMock(resolve('apps/web/lib/customer-page-session.ts'), () => ({
    customerPageSession: async () => session,
    customerIdentity: async () => person,
  }));
  vi.doMock(resolve('apps/web/components/customer-shell.tsx'), () => ({
    CustomerShell: (props: Record<string, unknown>) =>
      createElement(
        'main',
        {
          'data-tab': props.tab,
          'data-title': props.title,
          'data-closed-reads': String(props.closedAccountReads === true),
        },
        props.children,
      ),
  }));
});
afterEach(() => vi.resetModules());

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
/** Draws a server page: the page function, then the shared frame it hands the session to. */
async function drawPage(path: string, props: Record<string, unknown> = {}) {
  const { default: Page } = await load(path);
  const element = (await Page(props)) as Element;
  const frame = await (element.type as (p: unknown) => Promise<unknown>)(element.props);
  return renderToStaticMarkup(frame);
}
const pages = [
  { name: 'the list', path: 'app/account/problem-reports/page.tsx', props: {}, filing: false },
  {
    name: 'the form',
    path: 'app/account/problem-reports/new/page.tsx',
    props: { searchParams: Promise.resolve({ from: '/account/requests' }) },
    filing: true,
  },
  {
    name: 'the detail',
    path: 'app/account/problem-reports/[reference]/page.tsx',
    props: { params: Promise.resolve({ reference: 'RP-000123' }) },
    filing: false,
  },
] as const;

describe('while problem reports are not offered (a probe is false)', () => {
  test.each(pages)(
    '$name says so in the words of the 503, and draws nothing that could send',
    async (p) => {
      offered = false;
      const html = await drawPage(p.path, p.props);
      expect(html).toContain('Problem reports are not available yet.');
      expect(html).toContain('role="status"');
      expect(html.includes('You cannot report a problem here yet. Nothing was sent.')).toBe(
        p.filing,
      );
      for (const live of [
        '<form',
        '<textarea',
        'Send Problem Report',
        'Remove the Words',
        'Loading',
      ]) {
        expect(html, live).not.toContain(live);
      }
    },
  );
  test('the filing page adds the second sentence and the others do not', async () => {
    offered = false;
    expect(await drawPage(pages[1].path, pages[1].props)).toContain('Nothing was sent.');
    expect(await drawPage(pages[0].path, pages[0].props)).not.toContain('Nothing was sent.');
  });
});

describe('while problem reports are offered (both probes hold)', () => {
  test('the list draws its own reports and the removal of the words, in the customer frame', async () => {
    const html = await drawPage(pages[0].path, pages[0].props);
    expect(html).toContain('data-tab="more"');
    expect(html).toContain('data-title="Your problem reports"');
    expect(html).toContain('Loading…');
    expect(html).toContain('Remove the words of my reports');
    expect(html).toContain('Remove the Words of My Reports');
    expect(html).not.toContain('not available yet');
  });
  test('the form opens on step 1 with the three fields, and "This page" is the one the person came from', async () => {
    const html = await drawPage(pages[1].path, pages[1].props);
    expect(html).toContain('What went wrong?');
    expect(html).toContain('Step 1 of 2 · About 1 minute');
    for (const label of [
      'Something did not work',
      'I could not find something',
      'Words or information are wrong',
      'Something else',
      'Where did it happen?',
      'Tell us more',
    ])
      expect(html, label).toContain(label);
    expect(html).toContain('<code id=');
    expect(html).toContain('/account/requests');
    expect(html).toContain('0 of 1000 characters');
    expect(html).toContain('>Continue<');
    expect(html).toContain('>Not Now<');
    expect(html).not.toContain('Send Problem Report');
  });
  test('the detail asks for the reference in the address and nothing else', async () => {
    const html = await drawPage(pages[2].path, pages[2].props);
    expect(html).toContain('data-title="Your problem report"');
    expect(html).toContain('Loading…');
  });
  test.each(pages)(
    '$name opts out of the closed-account screen, so a closed account can read and remove',
    async (p) => {
      const html = await drawPage(p.path, p.props);
      expect(html).toContain('data-closed-reads="true"');
    },
  );
  test.each(pages)(
    '$name is for a signed-in person only: signed out gives sign-in words and no screen',
    async (p) => {
      session = {
        ok: false,
        message: 'Your account could not be checked. Please try again in a moment.',
      };
      const html = await drawPage(p.path, p.props);
      expect(html).toContain('Your account could not be checked. Please try again in a moment.');
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('data-tab=');
      expect(html).not.toContain('<form');
    },
  );
});

describe('the form without a page to report', () => {
  test('only the text field shows, with its hint, and the "This page" choice is not offered', async () => {
    const { CustomerProblemReportForm } = await load(
      'components/problem-reports/customer-problem-reports.tsx',
    );
    const html = renderToStaticMarkup(
      createElement(CustomerProblemReportForm, { ...person, from: null }),
    );
    expect(html).toContain('Which page or screen?');
    expect(html).toContain('For example: Requests, or the Meetings page.');
    expect(html).not.toContain('This page');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain('maxLength="1000"');
  });
  test('with a page, both choices show and the details are marked Optional until Something else is chosen', async () => {
    const { CustomerProblemReportForm } = await load(
      'components/problem-reports/customer-problem-reports.tsx',
    );
    const html = renderToStaticMarkup(
      createElement(CustomerProblemReportForm, {
        ...person,
        from: { masked: '/account/requests/:id', returnTo: '/account/requests/1' },
      }),
    );
    expect(html).toContain('This page');
    expect(html).toContain('Another page');
    expect(html).toContain('/account/requests/:id');
    expect(html).toContain('Optional');
    expect(html).not.toContain('Which page or screen?');
    // The words are never kept in the browser: no storage of any kind in the form.
    expect(html).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe('the detail of a reference that could not exist', () => {
  test.each(['', 'x'.repeat(65), 'RP-1\u0000'])(
    'says the one not found sentence without asking: %j',
    async (reference) => {
      const { CustomerProblemReportDetail } = await load(
        'components/problem-reports/customer-problem-reports.tsx',
      );
      const html = renderToStaticMarkup(
        createElement(CustomerProblemReportDetail, { ...person, reference }),
      );
      expect(html).toContain('We could not find this problem report.');
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('Try Again');
      expect(html).toContain('href="/account/problem-reports"');
    },
  );
});

describe('removing the words', () => {
  test('nothing is said about a count before the action, and the confirmation says it cannot be undone', async () => {
    const { RemoveMyWords } = await load('components/problem-reports/remove-my-words.tsx');
    const { customerReportLinks } = await load('lib/problem-report-links.ts');
    const html = renderToStaticMarkup(
      createElement(RemoveMyWords, {
        headers: {},
        links: customerReportLinks,
        onRemoved: () => undefined,
      }),
    );
    expect(html).toContain('<details>');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Remove the words of your reports?');
    expect(html).not.toMatch(/Words removed from|no words left/);
    // The dialog body is drawn only once it is open.
    expect(html).not.toContain('This cannot be undone.');
  });
});

describe('ADR-032: the customer screens lead only to customer addresses', () => {
  test('every link on every customer screen stays out of /operator, offered or not', async () => {
    const { customerReportLinks } = await load('lib/problem-report-links.ts');
    const drawn: string[] = [];
    for (const value of [true, false]) {
      offered = value;
      for (const p of pages) drawn.push(...hrefs(await drawPage(p.path, p.props)));
    }
    const fixed = [
      customerReportLinks.signIn,
      customerReportLinks.home,
      customerReportLinks.list,
      customerReportLinks.form,
      customerReportLinks.detail('RP-000123'),
    ];
    for (const href of [...drawn, ...fixed]) expect(href, href).not.toMatch(/operator/);
    expect(customerReportLinks.list).toBe('/account/problem-reports');
    expect(customerReportLinks.form).toBe('/account/problem-reports/new');
    expect(customerReportLinks.home).toBe('/account');
    expect(customerReportLinks.detail('RP-000123')).toBe('/account/problem-reports/RP-000123');
  });
  test('no customer component names a team route, and none reads a person or a workspace of its own', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = resolve('apps/web/components/problem-reports');
    for (const name of readdirSync(dir).filter((file) =>
      /customer-problem-reports|remove-my-words/.test(file),
    ))
      expect(readFileSync(resolve(dir, name), 'utf8'), name).not.toMatch(
        /\/operator|workspace\/problem/,
      );
  });
});

describe('the account layout carries the flag the header menu reads', () => {
  test.each([true, false])(
    'offered %s is handed to the flag and the page is drawn unchanged',
    async (value) => {
      offered = value;
      const { default: AccountLayout } = await load('app/account/layout.tsx');
      const { CustomerProblemReportsFlag } = await load('components/ux/problem-reports-flag.tsx');
      const layout = (await AccountLayout({ children: 'the page' })) as {
        props: { children: [Element, string] };
      };
      const [flag, page] = layout.props.children;
      expect(flag.type).toBe(CustomerProblemReportsFlag);
      expect(flag.props.offered).toBe(value);
      expect(page).toBe('the page');
      // The flag draws nothing at all.
      expect(renderToStaticMarkup(flag)).toBe('');
    },
  );
});
