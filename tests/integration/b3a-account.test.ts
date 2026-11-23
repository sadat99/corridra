import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Unit B3a of the commercial-ready run (owner decisions, 23 Nov 2026): the account request, Room, report,
// profile and help request screens say what a customer needs in plain words, in road order, with no internal field,
// no "Synthetic" line in a real workspace and no page title that differs from its heading. Drawn on the server
// without a browser or a database; the live behaviour in a browser is the operator suite.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const source = (path: string) => readFileSync(resolve('apps/web', path), 'utf8');
// Reads the words of our own static markup by walking it once: no tag-stripping pattern (CodeQL flags those).
const text = (html: string) => {
  let out = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
};

const brief = {
  experience: {
    schemaVersion: 1,
    companyCountry: 'BD',
    marketCode: 'CN',
    job: 'sourcing',
    requirements: {
      objective: 'Source suppliers',
      role: 'IMPORTER',
      product: 'Original machinery 工厂 বাংলা requirements',
      quantity: '500',
      budgetMinor: '1234',
      currency: 'BHD',
      budgetBasis: 'Whole order',
      machinery: { application: 'Knitting line' },
    },
  },
  objective: 'Source suppliers',
  market: 'China',
  attendance: 'Not decided',
  startDate: '2026-12-01',
  endDate: '',
  timezone: 'Asia/Dhaka',
  offer: 'Original machinery 工厂 বাংলা requirements',
  website: '',
  outcomes: ['Qualified introductions'],
  notes: '',
  name: 'Rahim (sample)',
  company: 'Sample Knit Ltd',
  email: 'buyer@example.com',
  acknowledged: true,
};

describe('D-017: the request detail shows each fact once, in plain words', () => {
  it('hides internal fields at every depth and shows one Goal', async () => {
    const { requestFacts } = await load('app/account/request-words.ts');
    const groups = requestFacts(brief) as {
      title: string;
      rows: { key: string; label: string; value: string | string[] }[];
    }[];
    const rows = groups.flatMap((group) => group.rows);
    const labels = rows.map((row) => row.label);
    expect(labels.filter((label) => label === 'Goal')).toHaveLength(1);
    for (const hidden of ['Schema version', 'Type of work', 'Role', 'Commercial requirements'])
      expect(labels, hidden).not.toContain(hidden);
    const words = JSON.stringify(rows);
    for (const code of ['schemaVersion', 'IMPORTER', 'sourcing', '"job"', '"role"'])
      expect(words, code).not.toContain(code);
    // The customer's own words are kept exactly, once.
    expect(
      rows.filter((row) => row.value === 'Original machinery 工厂 বাংলা requirements'),
    ).toHaveLength(1);
    expect(rows.find((row) => row.label === 'Time zone')?.value).toBe('Dhaka, UTC+6');
    expect(rows.find((row) => row.label === 'Company country')?.value).toBe('Bangladesh');
    expect(rows.find((row) => row.label === 'Start date')?.value).toBe('1 Dec 2026');
    // The budget is shown once, as exact money in the line above the list.
    expect(labels).not.toContain('Budget');
    expect(labels).not.toContain('Currency');
    expect(groups.map((group) => group.title)).toEqual(['Goal', 'Where', 'Details', 'Contact']);
  });

  it('keeps a requirement goal the customer wrote in other words', async () => {
    const { requestFacts } = await load('app/account/request-words.ts');
    const rows = (
      requestFacts({
        ...brief,
        experience: {
          ...brief.experience,
          requirements: { ...brief.experience.requirements, objective: 'Two knitwear factories' },
        },
      }) as { rows: { label: string; value: unknown }[] }[]
    ).flatMap((group) => group.rows);
    expect(rows.filter((row) => row.label === 'Goal')).toHaveLength(1);
    expect(rows.map((row) => row.value)).toContain('Two knitwear factories');
  });

  it('draws the detail without an internal field', async () => {
    const { RequestDetailView } = await load('app/account/requests/request-detail.tsx');
    const html = text(
      render(
        createElement(RequestDetailView, {
          status: 'ready',
          requestId: '00000000-0000-4000-8000-000000000001',
          detail: {
            id: '00000000-0000-4000-8000-000000000001',
            available: true,
            original: brief,
            progress: { status: 'DRAFT', receivedAt: '2026-10-24T00:08:00Z', replies: [] },
          },
          framed: true,
          onRefresh: () => undefined,
        }),
      ),
    );
    for (const hidden of ['Schema version', 'Type of work', 'IMPORTER', 'Role'])
      expect(html, hidden).not.toContain(hidden);
    expect(html.match(/Goal/g)).toHaveLength(2); // The group heading and its one row.
    expect(html).toContain('Dhaka, UTC+6');
    expect(html).toContain('Original machinery 工厂 বাংলা requirements');
  });
});

describe('D-034: a refused request shows the refusal and one way back', () => {
  const draw = async (status: string) => {
    const { RequestDetailView } = await load('app/account/requests/request-detail.tsx');
    return render(
      createElement(RequestDetailView, {
        status,
        requestId: '00000000-0000-4000-8000-000000000001',
        detail:
          status === 'ready'
            ? {
                id: '00000000-0000-4000-8000-000000000001',
                available: true,
                original: brief,
                progress: { status: 'DRAFT', receivedAt: '2026-10-24T00:08:00Z', replies: [] },
              }
            : null,
        framed: true,
        roomHref: '/account/rooms/00000000-0000-4000-8000-000000000001',
        nudge: createElement('aside', { 'data-nudge': 'email' }, 'Email is off'),
        onRefresh: () => undefined,
      }),
    );
  };

  it('has no Room link, no email card, no sign-in link and no reference when access is refused', async () => {
    const html = await draw('denied');
    expect(html).not.toContain('/account/rooms/');
    expect(html).not.toContain('Open this request in its Room');
    expect(html).not.toContain('data-nudge');
    expect(html).not.toContain('Sign in again');
    expect(html).not.toContain('00000000-0000-4000-8000-000000000001');
    expect(html).toContain('No request details are shown.');
    expect(html).toContain(
      '<a class="text-link" href="/account#customer-requests">Back to Your Requests</a>',
    );
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it('keeps the Room link and the email card for a request the person may read', async () => {
    const html = await draw('ready');
    expect(html).toContain('Open this request in its Room');
    expect(html).toContain('data-nudge="email"');
  });

  it('leaves both to the detail, so the page never draws them beside a refusal', () => {
    const page = source('app/account/requests/[requestId]/page.tsx');
    expect(page).toContain('roomHref=');
    expect(page).toContain('nudge=');
    expect(page).not.toContain('Open this request in its Room');
  });
});

describe('D-035 and the decision line: a report never says operator, scope or Synthetic', () => {
  it('says who reviewed a decision in every workspace', async () => {
    const { reviewedLine, reportIntro } = await load('app/account/missions/report-words.ts');
    expect(reviewedLine(3)).toBe('Reviewed by the Corridra team · version 3.');
    expect(reportIntro(true)).toBe(
      'Your submitted information. This is what the Corridra team has approved you to see. It is not automatic access to every company, contact, offer or participant record.',
    );
    expect(reportIntro(false)).toBe(
      'Sample data only. This is what the Corridra team has approved you to see. It is not automatic access to every company, contact, offer or participant record.',
    );
  });

  it('has no operator, scope, disclosure, Synthetic or draft word a customer reads in missions', () => {
    for (const file of [
      'app/account/missions/decision-history.tsx',
      'app/account/missions/saved-commercial-report.tsx',
      'app/account/missions/report-words.ts',
    ]) {
      // Words a person reads: JSX text and quoted sentences. Identifiers, class names and props are not copy.
      const copy = source(file)
        .split('\n')
        .filter((line) => !/^\s*(import|\/\/|\*|\/\*)/.test(line))
        .filter(
          (line) => /^\s*[A-Z'"`?:].*[a-z] [a-z]/.test(line) || />[^<{]*[a-z] [a-z]/.test(line),
        );
      for (const line of copy)
        expect(line, `${file}: ${line.trim()}`).not.toMatch(
          /Synthetic|\boperator\b|operator-|\bscope\b|\bdisclosure\b|\bdraft\b/,
        );
    }
  });
});

describe('D-021: a help request page title matches its heading', () => {
  const pages = [
    'app/account/service-requests/page.tsx',
    'app/account/service-requests/new/page.tsx',
    'app/account/service-requests/[workspaceId]/page.tsx',
    'app/account/service-requests/[workspaceId]/[requestId]/page.tsx',
  ];
  it.each(pages)('%s', (path) => {
    const page = source(path);
    const title = /title: '([^']+) \| Corridra'/.exec(page)?.[1];
    const headings = [...page.matchAll(/<CustomerShell[^>]*\btitle="([^"]+)"/g)].map((m) => m[1]);
    expect(title).toBeTruthy();
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) expect(heading).toBe(title);
    expect(page).not.toMatch(/Paid-service|Service requests/);
  });

  it('never says paid-service or service request on a customer help screen', () => {
    for (const file of ['session.tsx', 'service-request-list.tsx', 'service-request-client.ts'])
      expect(source(`app/account/service-requests/${file}`), file).not.toMatch(
        /Paid-service|Service requests/,
      );
  });
});

describe('help request failures and dates', () => {
  it('never tells a customer to start a field with Synthetic', async () => {
    const { problemText } = await load('app/account/service-requests/service-request-client.ts');
    expect(problemText(400, 'send the request')).toBe(
      'Some details need another look. Check each field and try again.',
    );
    for (const status of [400, 401, 403, 409, 429, 500, 503, 'network', 'malformed'])
      expect(problemText(status, 'send the request')).not.toMatch(/Synthetic|Paid-service/);
  });

  it('writes help request dates the one way, with the time zone on a time', async () => {
    const { helpDayText, helpDateTimeText, dayText, dateTimeText } = await load(
      'app/account/service-requests/service-request-client.ts',
    );
    const { formatDateTime } = await load('lib/ux/format.ts');
    expect(helpDayText('2026-10-24')).toBe('24 Oct 2026');
    expect(helpDayText(null)).toBeNull();
    expect(helpDayText('soon')).toBe('soon');
    expect(helpDateTimeText('2026-10-24T00:08:00Z')).toBe(formatDateTime('2026-10-24T00:08:00Z'));
    expect(helpDateTimeText('2026-10-24T00:08:00Z')).toMatch(/^24 Oct 2026, \d{2}:\d{2} \(/);
    expect(helpDateTimeText('soon')).toBe('soon');
    // Billing and invoices reuse these two and are outside this unit: their wording does not move.
    expect(dayText('2026-10-23')).toBe('23 October 2026');
    expect(dateTimeText('2026-10-24T00:08:00Z')).toBe('24 October 2026 at 00:08 UTC');
    for (const file of ['service-request-detail.tsx', 'service-request-list.tsx'])
      expect(source(`app/account/service-requests/${file}`)).not.toMatch(
        /[^p]dayText|[^p]dateTimeText|\bdayText|\bdateTimeText/,
      );
  });
});

describe('D-022 and D-023: the company profile', () => {
  it('does not repeat the page title on its first tab', () => {
    const page = source('app/account/profile/[workspaceId]/page.tsx');
    const title = /<CustomerShell[\s\S]*?title="([^"]+)"/.exec(page)?.[1];
    expect(title).toBe('Company profile');
    const labels = [...page.matchAll(/label: (?:[^,\n]*\? )?'([^']+)'(?: : '([^']+)')?/g)].flatMap(
      (m) => [m[1], m[2]].filter(Boolean),
    );
    expect(labels).toContain('About');
    expect(labels).not.toContain(title);
  });

  it('lists what was entered in steps 1 and 2 on the Confirm step, with an Edit action for each', async () => {
    const { ProfileReview } = await load('app/account/profile/organisation-profile.tsx');
    const html = render(
      createElement(ProfileReview, {
        draft: {
          legalName: 'Sample Knit Ltd',
          countryCode: 'bd',
          website: '',
          commercialRoles: ['MANUFACTURER', 'ORGANISER'],
          sectors: 'Knitwear, Denim',
          sizeBand: '51-200',
          summary: '',
          reason: '',
        },
        onEdit: () => undefined,
      }),
    );
    const words = text(html);
    for (const value of [
      'Sample Knit Ltd',
      'Bangladesh',
      'Not provided',
      'Manufacturer, Delegation organiser',
      'Knitwear, Denim',
      '51-200 people',
    ])
      expect(words, value).toContain(value);
    expect(html).not.toMatch(/<input|<select|<textarea/);
    expect(
      [...html.matchAll(/<button type="button"[^>]*>(.*?)<\/button>/g)].map((m) => m[1]),
    ).toEqual(['Edit Company', 'Edit Profile']);
  });

  it('draws the review on the Confirm step, before the confirmation', () => {
    const form = source('app/account/profile/organisation-profile.tsx');
    const review = form.indexOf('{steps && shown === lastStep && <ProfileReview');
    expect(review).toBeGreaterThan(-1);
    expect(form.indexOf('<Step n={2}')).toBeGreaterThan(review);
    expect(form.indexOf('checked={ack}')).toBeGreaterThan(review);
  });

  it('writes the company link date the one way', () => {
    const link = source('app/account/profile/company-link.tsx');
    expect(link).not.toContain('toISOString().slice(0, 10)');
    expect(link).toContain('formatDate(');
  });
});

describe('D-024: removing the text of problem reports', () => {
  it('names the action by what it removes', async () => {
    const { removalWords } = await load('lib/problem-report-words.ts');
    expect(removalWords.summary).toBe('Remove the text of my problem reports');
    expect(removalWords.button).toBe('Remove the Text of My Problem Reports');
    expect(removalWords.title).toBe('Remove the text of your problem reports?');
    expect(removalWords.confirm).toBe('Remove Text');
    expect(removalWords.keep).toBe('Keep Text');
  });
});

describe('D-025: the route chip in the Room keeps to one or two lines', () => {
  // The measured proof at the largest Text Size is in tests/operator/ux-room.spec.ts; this keeps the rules in place.
  const css = source('app/account/rooms/[requestId]/room-frame.css');
  it('gives the chip the full row before it wraps and keeps the icon square', () => {
    const rules = [...css.matchAll(/\.room\[data-room='request'\] \.room-route \{([^}]*)\}/g)]
      .map((rule) => rule[1])
      .join('\n');
    expect(rules).toMatch(/flex:\s*0 1 auto/);
    expect(rules).toMatch(/max-inline-size:\s*100%/);
    expect(css).toMatch(
      /\.room\[data-room='request'\] \.room-route \.corridra-icon \{[^}]*flex:\s*none/,
    );
  });

  it('keeps a readable column for the tags, title and date beside the stage timeline', () => {
    expect(css).toMatch(
      /\.room\[data-room='request'\] > \.room-head \{\s*grid-template-columns:\s*minmax\(min\(100%, 22rem\), 1fr\) minmax\(0, 32rem\)/,
    );
  });
});

describe('D-019: a problem report time is written the one way, in the time zone of the reader', () => {
  it.each(['problem-report-list.tsx', 'problem-report-detail.tsx'])('%s', (file) => {
    const code = source(`components/problem-reports/${file}`);
    expect(code).not.toContain('whenWords');
    expect(code).toMatch(/formatDateTime\((item\.filedAt|entry\.createdAt)\)/);
  });
});
