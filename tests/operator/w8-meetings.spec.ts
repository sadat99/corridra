import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import {
  fontCss,
  fontFile,
  longChineseState,
  longName,
  longPlace,
  realPageUrl,
  serveRealMeetingsPage,
  typicalState,
  type RealPage,
  type RealPageState,
} from './w8-meetings-real-page';
import { screensOf, viewports } from '../ux/page-length-lib';

// W8, the Meetings page (docs/revamp/specs/workflow-intelligence.md). The real tabs, list component and card
// builder are mounted with the real stylesheets in a small page, as ux-room.spec.ts mounts the Room. The real page
// itself is mounted in the real shell further down, for the page length and the notices. The server's
// reads are covered in tests/integration/w8-meetings.test.ts; what is proved here is what a person sees: the
// groups and their order, a row's facts, the words, the changed schedule, the link names, the toggles and the
// layout from a phone to a desktop. Every name, date and company is invented. The browser zone is set to one that
// differs from every zone used below: a time must be written in the zone of its place.
test.use({ locale: 'en-US', timezoneId: 'America/New_York' });
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
let real: RealPage;
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

const now = '2026-11-10T12:00:00Z';
const requestIds = [1, 2, 3, 4, 5, 6, 7].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const savedIds = [1, 2, 3, 4, 5, 6, 7].map((n) => `00000000-0000-4000-8000-00000000010${n}`);

type Row = {
  requestId: string;
  requestTitle: string | null;
  savedResourceId: string;
  label: string;
  changed: boolean;
  status?: string;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  location?: string;
};
const row = (label: string, over: Partial<Row> = {}, request = 0): Row => ({
  requestId: requestIds[request]!,
  requestTitle: request === 0 ? 'Sell in Spain' : `Request ${request + 1}`,
  savedResourceId: savedIds[request]!,
  label,
  changed: false,
  status: 'SCHEDULED',
  ...over,
});
const switchesOn = { trip: true, road: true, lenses: true };
type Switches = typeof switchesOn;

/** Two requests, six meetings: two coming up, two past, one with no time, one changed. */
const sixRows = (): Row[] => [
  row('Late visit', {
    startsAt: '2026-11-13T04:00:00Z',
    timezone: 'Asia/Dhaka',
    location: 'Gazipur factory',
  }),
  row(
    'Soon visit',
    {
      startsAt: '2026-11-11T04:00:00Z',
      endsAt: '2026-11-11T06:30:00Z',
      timezone: 'Asia/Dhaka',
      location: 'Dhaka Chamber of Commerce',
    },
    1,
  ),
  row('Old visit', {
    startsAt: '2026-10-01T04:00:00Z',
    timezone: 'Asia/Dhaka',
    status: 'HELD',
    location: 'Chattogram port',
  }),
  row(
    'Recent visit',
    {
      startsAt: '2026-11-09T04:00:00Z',
      timezone: 'Asia/Dhaka',
      status: 'NO_SHOW',
      location: 'Narayanganj yard',
    },
    1,
  ),
  row('Undated call', { status: 'PROPOSED' }),
  row('Moved visit', {
    changed: true,
    status: undefined,
  }),
];
const requestLinks = (count: number) =>
  requestIds.slice(0, count).map((id, index) => ({
    key: `request:${id}`,
    title: index === 0 ? 'Sell in Spain' : `Request ${index + 1}`,
    href: `/account/rooms/${id}`,
  }));

type Mount = {
  rows: Row[];
  requests?: number;
  switches?: Switches;
  empty?: boolean;
  /** The ?tab= word in the address. */
  tab?: string;
};
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{WorkspaceShell}from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
      import{MeetingsList,RequestsSection}from ${JSON.stringify(resolve('apps/web/app/account/meetings/meetings-list.tsx'))};
      import{MeetingsTabs}from ${JSON.stringify(resolve('apps/web/app/account/meetings/meetings-tabs.tsx'))};
      import{meetingCard}from ${JSON.stringify(resolve('apps/web/lib/meetings/cards.ts'))};
      import{groupMeetings}from ${JSON.stringify(resolve('apps/web/lib/meetings/group.ts'))};
      import ${JSON.stringify(resolve('apps/web/app/account/rooms/[requestId]/room-view.css'))};
      const q=new URLSearchParams(location.search);
      const props=JSON.parse(q.get('props'));
      const grouped=groupMeetings(props.rows,Date.parse(props.now));
      const groups=['upcoming','past','undated','changed'].map(key=>({key,cards:grouped[key].map((r,i)=>meetingCard(r,i,props.switches))}));
      createRoot(document.getElementById('fixture')).render(
        <LanguageProvider offered={[{code:'en',draft:false}]}>
          <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Meetings">
            <div className="room">
              <MeetingsTabs
                meetings={<div className="room">
                  {props.empty ? <p className="ux-empty">No meetings or visits are ready to show yet.</p> : null}
                  {props.rows.length>0 ? <MeetingsList groups={groups}/> : null}
                </div>}
                requests={props.requests.length>0 ? <RequestsSection requests={props.requests} withMeetings={props.rows.length>0}/> : null}/>
            </div>
          </WorkspaceShell>
        </LanguageProvider>);`,
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
      res.end(`${css}\n${componentCss}\n${fontCss}`);
      return;
    }
    if (path.startsWith('/fonts/')) {
      res.setHeader('content-type', 'font/woff2');
      res.end(fontFile(path));
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meetings fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
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

async function open(page: Page, mount: Mount) {
  const props = {
    rows: mount.rows,
    requests: requestLinks(mount.requests ?? 2),
    switches: mount.switches ?? switchesOn,
    now,
    empty: mount.empty ?? false,
  };
  const tab = mount.tab ? `&tab=${encodeURIComponent(mount.tab)}` : '';
  await page.goto(`${origin}/?props=${encodeURIComponent(JSON.stringify(props))}${tab}`);
  await expect(page.locator('main h1')).toHaveText('Meetings');
}
const tabNamed = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const items = (page: Page) => page.locator('.room-trip-list > li');
const showAll = (page: Page) =>
  page.getByRole('button', { name: /^Show All \d+ Meetings and Visits$/ });

test('groups meetings under their own headings, in order, and shows the first one until Show All', async ({
  page,
}) => {
  await open(page, { rows: sixRows() });
  // The count and Show All share one row.
  const actions = page.locator('.room-actions').last();
  await expect(actions.getByText('Showing 1 of 6 meetings and visits.')).toBeVisible();
  await expect(
    actions.getByRole('button', { name: 'Show All 6 Meetings and Visits' }),
  ).toBeVisible();
  // Only groups with a visible row have a heading; the first one is the soonest of those coming up. The requests
  // heading is in the other tab, which is hidden but in the page.
  await expect(page.locator('main h2')).toHaveText(['Coming up', 'Your requests']);
  await expect(items(page).locator('h3')).toHaveText(['Soon visit']);
  await showAll(page).click();
  await expect(page.getByText('6 meetings or visits')).toBeVisible();
  await expect(page.locator('main h2')).toHaveText([
    'Coming up',
    'Done and past',
    'Time not confirmed yet',
    'Date changed',
    'Your requests',
  ]);
  await expect(items(page).locator('h3')).toHaveText([
    'Soon visit',
    'Late visit',
    'Recent visit',
    'Old visit',
    'Undated call',
    'Moved visit',
  ]);
  // Each group is a labelled section holding one ordered list.
  for (const group of await page.locator('main section').all()) {
    const label = await group.getAttribute('aria-labelledby');
    expect(label).toBeTruthy();
    await expect(page.locator(`[id="${label}"]`)).toHaveCount(1);
  }
});

test('the toggle names what it controls, keeps focus, and goes back', async ({ page }) => {
  await open(page, { rows: sixRows() });
  const toggle = showAll(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const controlled = await toggle.getAttribute('aria-controls');
  expect(controlled).toBeTruthy();
  await toggle.focus();
  await page.keyboard.press('Enter');
  const fewer = page.getByRole('button', { name: 'Show Fewer', exact: true }).first();
  await expect(fewer).toHaveAttribute('aria-expanded', 'true');
  await expect(fewer).toBeFocused();
  await expect(page.locator(`[id="${controlled}"] .room-trip-list > li`)).toHaveCount(6);
  await page.keyboard.press('Enter');
  await expect(items(page)).toHaveCount(1);
  await expect(showAll(page)).toBeFocused();
});

test('a row shows the name, the time in the zone of its place, the place and the request', async ({
  page,
}) => {
  await open(page, { rows: sixRows() });
  const soon = items(page).filter({ hasText: 'Soon visit' });
  await expect(soon.locator('.ux-status')).toHaveText('Time confirmed');
  const facts = soon.locator('.room-trip-facts > div');
  await expect(facts.locator('dt')).toHaveText(['Starts', 'Ends', 'Place', 'Request']);
  const starts = soon.locator('dd').nth(0).locator('time');
  await expect(starts).toHaveAttribute('datetime', '2026-11-11T04:00:00Z');
  await expect(starts).toHaveAttribute('dir', 'ltr');
  // 04:00 UTC is 10:00 in Dhaka. The browser's own zone (New York) must never be the one shown.
  await expect(starts).toContainText('10:00');
  await expect(starts).not.toContainText('23:00');
  await expect(soon.locator('dd').nth(1).locator('time')).toContainText('12:30');
  await expect(soon.locator('dd').nth(2)).toHaveText('Dhaka Chamber of Commerce');
  await expect(soon.locator('dd').nth(3)).toHaveText('Request 2');
  // A place is text, never a link or a map.
  await expect(soon.locator('dd').nth(2).locator('a, button')).toHaveCount(0);
});

test('a meeting with no place says "Not shared yet" and one with no time has no time facts', async ({
  page,
}) => {
  await open(page, { rows: [row('Undated call', { status: 'PROPOSED' })] });
  const only = items(page).first();
  await expect(only.locator('.ux-status')).toHaveText('Suggested');
  await expect(only.locator('dt')).toHaveText(['Place', 'Request']);
  await expect(only.locator('dd').first()).toHaveText('Not shared yet');
  await expect(only.locator('time')).toHaveCount(0);
});

test('every status has its own word, and an unknown status is shown as supplied', async ({
  page,
}) => {
  const statuses = [
    'PROPOSED',
    'ACCEPTED',
    'SCHEDULED',
    'HELD',
    'DECLINED',
    'CANCELLED',
    'NO_SHOW',
    'RESCHEDULE_REQUIRED',
  ];
  const rows = [...statuses, 'ON_HOLD'].map((status, index) =>
    row(
      `Visit ${index}`,
      status === 'RESCHEDULE_REQUIRED' ? { changed: true, status: undefined } : { status },
    ),
  );
  await open(page, { rows });
  await showAll(page).click();
  const words = (await items(page).locator('.ux-status').allTextContents()).sort();
  expect(words).toEqual(
    [
      'Suggested',
      'Accepted',
      'Time confirmed',
      'Done',
      'Declined',
      'Cancelled',
      'Missed',
      'Date changed',
      'ON_HOLD',
    ].sort(),
  );
});

test('Chinese names, places and request titles are marked as Chinese and read in their own direction', async ({
  page,
}) => {
  await open(page, {
    rows: [
      row('达卡工厂访问', {
        startsAt: '2026-11-12T04:00:00Z',
        timezone: 'Asia/Dhaka',
        location: '达卡商会',
      }),
      row('Plain visit', {
        startsAt: '2026-11-13T04:00:00Z',
        timezone: 'Asia/Dhaka',
        location: 'Dhaka',
      }),
    ],
  });
  await showAll(page).click();
  const chinese = items(page).nth(0);
  await expect(chinese.locator('h3')).toHaveAttribute('lang', 'zh');
  await expect(chinese.locator('h3')).toHaveAttribute('dir', 'auto');
  await expect(chinese.locator('dd[lang="zh"]')).toHaveText('达卡商会');
  const plain = items(page).nth(1);
  await expect(plain.locator('h3')).not.toHaveAttribute('lang', /.+/);
  await expect(plain.locator('[lang="zh"]')).toHaveCount(0);
});

test('a changed schedule shows its name, the Date changed badge and the notice, and nothing old anywhere', async ({
  page,
}) => {
  await open(page, { rows: [row('Moved visit', { changed: true, status: undefined })] });
  const changed = items(page).first();
  await expect(changed.locator('h3')).toHaveText('Moved visit');
  await expect(changed.locator('.ux-status')).toHaveText('Date changed');
  await expect(changed).toContainText('The date or time has changed. We do not show the old time.');
  await expect(changed.locator('dt')).toHaveText(['Request']);
  await expect(changed.locator('time')).toHaveCount(0);
  const html = await changed.innerHTML();
  for (const old of ['Starts', 'Ends', 'Place', 'datetime', 'SCHEDULED', 'Not shared yet'])
    expect(html, old).not.toContain(old);
  await expect(page.locator('main')).not.toContainText('Dhaka');
});

test('every link has its own name, and opens the Room on Meetings or the saved report by the switches', async ({
  page,
}) => {
  const rows = sixRows();
  const cases: [Switches, (i: number) => string][] = [
    [switchesOn, (i) => `/account/rooms/${requestIds[i]}?view=meetings`],
    // The Trip lens needs the lenses, so without them the report is where the times are.
    [{ trip: true, road: true, lenses: false }, (i) => `/account/missions/${savedIds[i]}`],
    [{ trip: false, road: true, lenses: true }, (i) => `/account/missions/${savedIds[i]}`],
    [{ trip: true, road: false, lenses: true }, (i) => `/account/missions/${savedIds[i]}`],
  ];
  for (const [switches, expected] of cases) {
    await open(page, { rows, switches });
    await showAll(page).click();
    const links = items(page).getByRole('link');
    await expect(links).toHaveCount(6);
    const names = await links.evaluateAll((all) => all.map((a) => a.textContent ?? ''));
    expect(new Set(names).size).toBe(6);
    expect(names.every((name) => name.startsWith('Open in the Request: '))).toBe(true);
    const hrefs = await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')));
    // In page order: Soon visit (request 2), Late visit (1), Recent visit (2), Old visit (1), Undated call (1), Moved visit (1).
    expect(hrefs).toEqual([1, 0, 1, 0, 0, 0].map((request) => expected(request)));
    expect(hrefs.some((href) => /view=/.test(href ?? '') && !switches.lenses)).toBe(false);
  }
  await open(page, { rows });
  await expect(
    page.getByRole('link', { name: /^Open in the Request ?: Soon visit, Request 2, item 1 of 6$/ }),
  ).toHaveCount(1);
});

test('shows no price, offer, contact, export or share control', async ({ page }) => {
  await open(page, { rows: sixRows() });
  await showAll(page).click();
  const main = page.locator('main');
  for (const absent of [
    /price/i,
    /offer/i,
    /quote/i,
    /@/,
    /\.ics/i,
    /calendar/i,
    /\bshare\b/i,
    /download/i,
    /book now/i,
  ])
    await expect(main, String(absent)).not.toContainText(absent);
  await expect(main.locator('input, textarea, form, svg, img, iframe')).toHaveCount(0);
});

test('the requests tab keeps every request link and shows five until Show All', async ({
  page,
}) => {
  await open(page, { rows: sixRows(), requests: 7 });
  // The requests are in the second tab: hidden until it is chosen, then five rows and the toggle.
  await expect(page.locator('.ux-meeting-list')).toBeHidden();
  await tabNamed(page, 'Your Requests').click();
  const list = page.locator('.ux-meeting-list');
  await expect(list).toBeVisible();
  await expect(list.locator('li')).toHaveCount(5);
  await expect(list.getByRole('link').first()).toHaveAccessibleName(
    /^Sell in Spain ?: meetings and visits$/,
  );
  const toggle = page.getByRole('button', { name: 'Show All 7 Requests' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(list.locator('li')).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'Show Fewer' }).last()).toBeFocused();
  await open(page, { rows: sixRows(), requests: 5, tab: 'requests' });
  await expect(page.locator('.ux-meeting-list li')).toHaveCount(5);
  await expect(page.getByRole('button', { name: /Show All \d+ Requests/ })).toHaveCount(0);
});

test('the requests line says where meetings come from only when a meeting is shown', async ({
  page,
}) => {
  await open(page, { rows: sixRows(), requests: 3, tab: 'requests' });
  const section = page.getByRole('region', { name: 'Your requests' });
  await expect(section).toContainText('Meetings come from the reports you have saved.');
  await expect(section).toContainText(
    'Open any request to see all of it, including requests with no meetings yet.',
  );
  await open(page, { rows: [], requests: 3, empty: true, tab: 'requests' });
  await expect(section).not.toContainText('Meetings come from');
  await expect(section).toContainText('Open any request to see all of it.');
  // The list of requests itself is the same either way.
  await expect(page.locator('.ux-meeting-list li')).toHaveCount(3);
});

test('the group cards sit one room gap apart, as the rest of the page does', async ({ page }) => {
  await open(page, { rows: sixRows() });
  await showAll(page).click();
  // The customer kit adds margins to headings and lists; the gap is measured under it, as in the real page.
  await toCustomerFrame(page);
  const gaps = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('.room section'))
      .filter((el) => el.querySelector('.room-trip-list'))
      .map((el) => el.getBoundingClientRect());
    const room = getComputedStyle(document.querySelector('.room')!).rowGap;
    return {
      room,
      between: sections.slice(1).map((box, i) => Math.round(box.top - sections[i]!.bottom)),
    };
  });
  expect(gaps.between.length).toBeGreaterThan(1);
  for (const gap of gaps.between) expect(gap).toBe(parseFloat(gaps.room));
});

const twelve = (): Row[] =>
  Array.from({ length: 12 }, (_, n) =>
    row(
      longName(n),
      {
        startsAt: `2026-11-${11 + (n % 9)}T04:00:00Z`,
        endsAt: `2026-11-${11 + (n % 9)}T06:00:00Z`,
        timezone: 'Asia/Dhaka',
        location: longPlace(n),
      },
      n % 3,
    ),
  );

for (const width of [320, 390, 768, 1440]) {
  const cases = [
    ['twelve meetings', 'meetings'],
    ['no meetings', 'meetings'],
    ['seven requests', 'requests'],
  ] as const;
  for (const [state, tab] of cases) {
    test(`no sideways scroll, large targets and no axe violation at ${width} px with ${state} on the ${tab} tab`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const data = state === 'twelve meetings';
      await open(page, {
        rows: state === 'no meetings' ? [] : twelve(),
        requests: state === 'seven requests' ? 7 : 3,
        empty: state === 'no meetings',
        tab,
      });
      await expect(
        tabNamed(page, tab === 'meetings' ? 'Meetings' : 'Your Requests'),
      ).toHaveAttribute('aria-selected', 'true');
      if (data) await showAll(page).click();
      if (tab === 'requests')
        await page.getByRole('button', { name: 'Show All 7 Requests' }).click();
      const label = `${state} at ${width}`;
      if (data) await expect(items(page)).toHaveCount(12);
      const wide = await page.evaluate((limit) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('main *'))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > limit + 1)
            out.push(
              `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} ${Math.round(r.right)}`,
            );
        }
        return out.slice(0, 6);
      }, width);
      expect(wide, label).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        label,
      ).toBeLessThanOrEqual(width);
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll('main :is(a[href], button, summary)'))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.height < 43.5)
          .map(
            ({ el }) => `${el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 30)}`,
          ),
      );
      expect(small, label).toEqual([]);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
        `axe ${label}`,
      ).toEqual([]);
    });
  }
}

/** The customer frame around the page, as ux-room.spec.ts builds it, so the length is of a page and not of a list. */
async function toCustomerFrame(page: Page) {
  await expect(page.locator('#fixture > main > .ux-page-heading')).toHaveCount(1);
  await page.evaluate(() => {
    const main = document.querySelector('main')!;
    main.classList.add('ux-customer');
    const fixture = document.getElementById('fixture')!;
    main.style.cssText = '';
    const note = document.createElement('p');
    note.className = 'ux-testmode';
    note.textContent = 'Preview workspace: use made-up names and details here.';
    const nav = document.createElement('nav');
    nav.className = 'guide-tabs';
    nav.innerHTML = ['Home', 'Requests', 'Meetings', 'Reports']
      .map((name) => `<a href="#">${name}</a>`)
      .join('');
    main.querySelector('.ux-page-heading')!.after(note, nav);
    fixture.replaceWith(...Array.from(fixture.childNodes));
  });
}

// The tabs (layout-budget.md section 1: role=tablist, ?tab=<key>, keyboard, no capsule shape).
test('has a labelled tablist of exactly two tabs, Meetings first, and the other panel is hidden', async ({
  page,
}) => {
  await open(page, { rows: sixRows() });
  const list = page.getByRole('tablist', { name: 'Meetings sections' });
  await expect(list.getByRole('tab')).toHaveText(['Meetings', 'Your Requests']);
  await expect(tabNamed(page, 'Meetings')).toHaveAttribute('aria-selected', 'true');
  await expect(tabNamed(page, 'Your Requests')).toHaveAttribute('aria-selected', 'false');
  // Each tab controls a panel that exists and is named by the tab; only the chosen one shows.
  for (const name of ['Meetings', 'Your Requests']) {
    const controls = await tabNamed(page, name).getAttribute('aria-controls');
    const panel = page.locator(`[id="${controls}"]`);
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toHaveAttribute(
      'aria-labelledby',
      (await tabNamed(page, name).getAttribute('id'))!,
    );
  }
  await expect(page.getByRole('tabpanel', { name: 'Meetings' })).toBeVisible();
  await expect(
    page.getByRole('tabpanel', { name: 'Your Requests', includeHidden: true }),
  ).toBeHidden();
  // A tab is a flat tab, not a capsule.
  const radius = await tabNamed(page, 'Meetings').evaluate(
    (el) => getComputedStyle(el).borderBottomLeftRadius,
  );
  expect(parseFloat(radius)).toBeLessThan(12);
  // Tabs are large enough to touch.
  for (const name of ['Meetings', 'Your Requests'])
    expect((await tabNamed(page, name).boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
});

test('opens Your Requests from ?tab=requests, and Meetings for no tab or an unknown one', async ({
  page,
}) => {
  await open(page, { rows: sixRows(), tab: 'requests' });
  await expect(tabNamed(page, 'Your Requests')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Your Requests' })).toBeVisible();
  await expect(page.locator('.room-trip-list')).toBeHidden();
  for (const tab of ['junk', '', 'meetings']) {
    await open(page, { rows: sixRows(), tab });
    await expect(tabNamed(page, 'Meetings')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Meetings' })).toBeVisible();
    await expect(page.locator('.ux-meeting-list')).toBeHidden();
  }
});

test('shows no tablist when there is only the Meetings panel', async ({ page }) => {
  await open(page, { rows: sixRows(), requests: 0 });
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await expect(items(page)).toHaveCount(1);
  // The unknown or requests word changes nothing when there is nothing to switch to.
  await open(page, { rows: sixRows(), requests: 0, tab: 'requests' });
  await expect(items(page)).toHaveCount(1);
});

test('arrow keys, Home and End move between the tabs, with one tab stop and the address kept', async ({
  page,
}) => {
  await open(page, { rows: sixRows() });
  const meetings = tabNamed(page, 'Meetings');
  const requests = tabNamed(page, 'Your Requests');
  // One tab stop: only the chosen tab is in the tab order.
  await expect(meetings).toHaveAttribute('tabindex', '0');
  await expect(requests).toHaveAttribute('tabindex', '-1');
  await meetings.focus();
  await page.keyboard.press('ArrowRight');
  await expect(requests).toBeFocused();
  await expect(requests).toHaveAttribute('aria-selected', 'true');
  await expect(requests).toHaveAttribute('tabindex', '0');
  await expect(meetings).toHaveAttribute('tabindex', '-1');
  await expect(page.getByRole('tabpanel', { name: 'Your Requests' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('tab')).toBe('requests');
  await page.keyboard.press('Home');
  await expect(meetings).toBeFocused();
  await expect(meetings).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('meetings');
  await page.keyboard.press('End');
  await expect(requests).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(meetings).toBeFocused();
  // The other words in the address stay, and the page is not loaded again.
  expect(new URL(page.url()).searchParams.get('props')).toBeTruthy();
  // The chosen tab shows a visible focus ring.
  await expect(meetings).toBeFocused();
  const outline = await meetings.evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(parseFloat(outline)).toBeGreaterThanOrEqual(3);
});

test('Show All stays open and keeps focus when the tab is switched away and back', async ({
  page,
}) => {
  await open(page, { rows: sixRows() });
  await showAll(page).click();
  await expect(items(page)).toHaveCount(6);
  const fewer = page.getByRole('button', { name: 'Show Fewer', exact: true }).first();
  await expect(fewer).toBeFocused();
  await tabNamed(page, 'Your Requests').click();
  await expect(page.getByRole('tabpanel', { name: 'Meetings', includeHidden: true })).toBeHidden();
  await tabNamed(page, 'Meetings').click();
  await expect(items(page)).toHaveCount(6);
  await expect(fewer).toHaveAttribute('aria-expanded', 'true');
});

// The real page, in the real shell. Only the session, the two loads and the module switches are stood in; the
// header, footer, fonts, stylesheets, language provider and page are the real ones (w8-meetings-real-page.ts).
test.describe('the real page', () => {
  test.beforeAll(async () => {
    real = await serveRealMeetingsPage();
  });
  test.afterAll(async () => {
    await real.close();
  });
  const openReal = async (page: Page, state: RealPageState, tab?: string) => {
    await page.goto(realPageUrl(real, state, tab));
    await expect(page.locator('main h1')).toHaveText('Meetings');
    await page.evaluate(() => document.fonts.ready);
  };
  const withMeetings = (state: RealPageState, over: Partial<RealPageState['meetings']>) => ({
    ...state,
    meetings: { ...state.meetings, ...over },
  });

  // The layout-budget limits for a signed-in page (docs/revamp/specs/layout-budget.md section 2, owner, 5 November
  // 2026): at most 2.0 screens at 390 x 844 and 1.0 at 1440 x 900, as the full document height (header, content and
  // footer) over the viewport height. A hard rule, not a target: the figures are recorded and may not pass them.
  const limits = viewports;
  // Seen but not held to a limit: the widths the budget does not name.
  const recorded = [
    { ...viewports[0]!, width: 320, height: 568 },
    { ...viewports[0]!, width: 768, height: 1024 },
  ];
  const heightOf = (page: Page) =>
    page.evaluate(() =>
      Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
      ),
    );
  // Where the footer ends. A page shorter than the window still measures 1.0 screen, so this shows the room left.
  const endsAt = (page: Page) =>
    page.evaluate(() =>
      Math.round(document.querySelector('footer')!.getBoundingClientRect().bottom + window.scrollY),
    );
  const states: [string, () => RealPageState][] = [
    ['typical: 3 meetings, 2 requests', typicalState],
    ['12 long Chinese meetings, 3 requests', longChineseState],
    ['typical with the partial notice', () => withMeetings(typicalState(), { partial: true })],
    [
      '12 long Chinese meetings with the cap notice',
      () => withMeetings(longChineseState(), { capped: true }),
    ],
    ['typical with the not saved note', () => withMeetings(typicalState(), { notSaved: 1 })],
  ];

  for (const [name, state] of states)
    test(`${name}, with Show All and What Happens Next closed, fits the page budget at 390 and 1440`, async ({
      page,
    }, info) => {
      const figures: Record<string, number> = {};
      const ends: Record<string, number> = {};
      for (const viewport of limits) {
        const { width, height, hard } = viewport;
        await page.setViewportSize({ width, height });
        await openReal(page, state());
        await expect(items(page)).toHaveCount(1);
        await expect(page.locator('details.ux-journey-disclosure')).not.toHaveAttribute(
          'open',
          /.*/,
        );
        await expect(page.locator('footer')).toBeVisible();
        const screens = screensOf(await heightOf(page), viewport);
        figures[String(width)] = screens;
        ends[String(width)] = await endsAt(page);
        expect(screens, `${name} at ${width}`).toBeLessThanOrEqual(hard);
      }
      for (const viewport of recorded) {
        const { width, height } = viewport;
        await page.setViewportSize({ width, height });
        await openReal(page, state());
        figures[String(width)] = screensOf(await heightOf(page), viewport);
        ends[String(width)] = await endsAt(page);
      }
      info.annotations.push({
        type: 'page-length',
        description: JSON.stringify({ figures, ends }),
      });
      console.log(
        `page length, real page and shell, ${name}: screens ${JSON.stringify(figures)}, footer ends at px ${JSON.stringify(ends)}`,
      );
    });

  test('the Your Requests tab fits the page budget at 390 and 1440, with every request link in it', async ({
    page,
  }, info) => {
    const figures: Record<string, number> = {};
    for (const viewport of limits) {
      const { width, height, hard } = viewport;
      await page.setViewportSize({ width, height });
      await openReal(page, longChineseState(), 'requests');
      await expect(page.getByRole('tabpanel', { name: 'Your Requests' })).toBeVisible();
      await expect(page.locator('.ux-meeting-list').getByRole('link')).toHaveCount(3);
      const screens = screensOf(await heightOf(page), viewport);
      figures[String(width)] = screens;
      expect(screens, `Your Requests at ${width}`).toBeLessThanOrEqual(hard);
    }
    info.annotations.push({ type: 'page-length', description: JSON.stringify(figures) });
    console.log(`page length, real page and shell, Your Requests tab: ${JSON.stringify(figures)}`);
  });

  test('the partial notice is above the tabs and shows on both tabs, with Try Again', async ({
    page,
  }) => {
    await openReal(page, withMeetings(typicalState(), { partial: true }));
    const notice = page
      .getByRole('status')
      .filter({ hasText: 'We could not check all your requests just now.' });
    await expect(notice).toHaveCount(1);
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('link', { name: 'Try Again' })).toHaveAttribute(
      'href',
      '/account/meetings',
    );
    const above = async () =>
      page.evaluate(
        () =>
          document.querySelector('[role=status]')!.getBoundingClientRect().bottom <=
          document.querySelector('[role=tablist]')!.getBoundingClientRect().top + 1,
      );
    expect(await above()).toBe(true);
    await tabNamed(page, 'Your Requests').click();
    await expect(notice).toBeVisible();
    expect(await above()).toBe(true);
  });

  test('the cap notice and the not saved note are in the Meetings tab only', async ({ page }) => {
    await openReal(page, withMeetings(typicalState(), { capped: true, notSaved: 2 }));
    const cap = page.getByText(
      'We show meetings from the first 12 reports only. Some meetings may be missing. Open a request in the Your Requests tab to see all of its meetings.',
    );
    const saved = page.getByText('2 of your requests have a report that is not saved yet.');
    await expect(cap).toBeVisible();
    await expect(saved).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Library' })).toBeVisible();
    // Both come after the tablist, inside the Meetings panel.
    await expect(
      page.getByRole('tabpanel', { name: 'Meetings' }).getByText(/first 12 reports/),
    ).toHaveCount(1);
    await expect(
      page.getByRole('tabpanel', { name: 'Meetings' }).getByText(/not saved yet/),
    ).toHaveCount(1);
    await tabNamed(page, 'Your Requests').click();
    await expect(cap).toBeHidden();
    await expect(saved).toBeHidden();
  });

  test('opens on Your Requests from ?tab=requests and on Meetings otherwise, in the real page', async ({
    page,
  }) => {
    await openReal(page, typicalState(), 'requests');
    await expect(tabNamed(page, 'Your Requests')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Your requests', level: 2 })).toBeVisible();
    await openReal(page, typicalState(), 'junk');
    await expect(tabNamed(page, 'Meetings')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Coming up', level: 2 })).toBeVisible();
  });

  test('has no tablist where the requests list is not available, and no heading', async ({
    page,
  }) => {
    await openReal(page, { ...typicalState(), readable: false, items: [] });
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.locator('main h2')).toHaveCount(0);
    await expect(page.getByText('Your requests list is not available here yet.')).toBeVisible();
  });
});

test('moves nothing: no animation, and no transition except the design system link hover', async ({
  page,
}) => {
  await open(page, { rows: sixRows() });
  await showAll(page).click();
  const moving = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('.room-trip-list, .room-trip-list *')).filter((el) => {
        const style = getComputedStyle(el);
        // A link's hover change is the design system's own, and it respects reduced motion.
        const link = el.matches('a.text-link');
        return (
          style.animationName !== 'none' || (parseFloat(style.transitionDuration) > 0.01 && !link)
        );
      }).length,
  );
  expect(moving).toBe(0);
});
