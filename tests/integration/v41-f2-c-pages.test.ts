import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// UI/UX.v4.1 audit of the public and helper pages (rows public-customer-13, -14, -18 and -20): one link per
// destination and one primary inside main, no Back-to links, and a real way on from a page with nothing to show.
const read = (file: string) => readFileSync(resolve(file), 'utf8');

describe('/contributor/me without a workspace link', () => {
  const page = read('apps/web/app/contributor/me/page.tsx');
  const start = page.indexOf('if (!s || !workspace.success)');
  const branch = page.slice(start, page.indexOf('await s.ready;', start));
  it('has no Back-to link and gives a signed-in helper Sign Out, anyone else the helper sign-in', () => {
    expect(page).not.toMatch(/Back to/);
    expect(branch).toContain('<ContributorSignout />');
    expect(branch).toContain('href="/contributor/signin"');
    expect(branch).toContain('Helper Sign-In');
    // The page still says a customer account does not grant task access (L9).
    expect(branch.replace(/\s+/g, ' ')).toContain(
      'A customer account does not grant assigned-task access.',
    );
  });
  it('reads nothing but the session the page already checks', () => {
    expect(page.match(/provider\.getSession\(/g)).toHaveLength(2);
    expect(page).not.toMatch(/fetch\(|\.query\(/);
  });
});

describe('the helper pages write no Back-to link', () => {
  it('names the destination on the signed-out helper page', () => {
    const page = read('apps/web/app/contributor/page.tsx');
    expect(page).not.toMatch(/Back to/);
    expect(page.replace(/\s+/g, ' ')).toContain('href="/"> Corridra Home </Link>');
  });
});

describe('/corridors: the Another Route block', () => {
  const page = read('apps/web/app/corridors/page.tsx');
  it('links the request form once and holds no primary of its own', () => {
    expect(page.match(/href="\/plan"/g)).toHaveLength(1);
    expect(page).not.toContain('className="primary-link"');
    expect(page).toContain('Plan a Mission on Another Route');
    expect(page).toContain('href="#mission-example"');
  });
});

describe('the helper task words', () => {
  const board = read('apps/web/app/contributor/task-board.tsx');
  it('never prints the reviewer id and keeps the form field names', () => {
    expect(board).not.toContain('{task.reviewer}');
    expect(board).toContain('<dd>Someone other than you checks your work</dd>');
    expect(board).not.toContain('Independent reviewer');
    expect(board.match(/name="reason"/g)).toHaveLength(3);
    expect(board.match(/name="body"/g)).toHaveLength(1);
    // The live words stay (no owner approval for new wording); only the layout changed.
    for (const kept of [
      'EXACT ASSIGNMENT',
      'Accept the Disclosed Task',
      'Acceptance and relationship confirmation',
    ])
      expect(board).toContain(kept);
  });
});

describe('round 2: the remaining repeats and Back-to links', () => {
  const flat = (file: string) => read(file).replace(/\s+/g, ' ');
  it('no access page asks for a saved request where real intake is closed (row 23)', () => {
    expect(read('apps/web/app/signup/signup-access.tsx')).toContain(
      '<PendingRequestNotice where="signup" enabled={realUseEnabled()} />',
    );
    expect(read('apps/web/components/account-access.tsx')).toContain(
      '<PendingRequestNotice where={mode} enabled={realUseEnabled()} />',
    );
  });
  it('the team reset page and the helper unavailable page name the destination (row 13)', () => {
    const reset = flat('apps/web/app/operator/reset-password/page.tsx');
    expect(reset).not.toMatch(/Back to/);
    expect(reset).toContain('href={operatorSignInPage}> Operator Sign-In </a>');
    const helper = flat('apps/web/components/contributor-unavailable.tsx');
    expect(helper).not.toMatch(/Back to/);
    expect(helper).toContain('href="/"> Corridra Home </Link>');
  });
  it('the route picker links nothing the page around it already links (row 14)', () => {
    const picker = flat('apps/web/components/discovery-experience.tsx');
    expect(picker).toContain(
      'route.slug && !linkedOnPage.includes(`/corridors/${route.slug}`) && (',
    );
    // The request link of the chosen route is written once: the primary action.
    expect(picker.match(/href=\{briefUrl\}/g)).toHaveLength(1);
    expect(picker).not.toContain('Start a request on this route');
    expect(flat('apps/web/app/corridors/page.tsx')).toContain(
      "linkedOnPage={[...destinationRows.map((row) => row.href), '/corridors/bangladesh-spain']}",
    );
  });
  it('a public page links a route page once (row 14)', () => {
    const page = flat('apps/web/components/public-page.tsx');
    expect(page).toContain('{content.reverse.scopeHref !== content.route?.href && (');
  });
  it('the people on /how-it-works are choices, so the page has one tab row; the home keeps its tabs (row 25)', () => {
    const more = flat('apps/web/components/home-more.tsx');
    expect(more).toContain('<People choices />');
    expect(more).toContain("role={choices ? 'group' : 'tablist'}");
    expect(more).toContain('{t(key(`home.tr.pe.${i}`))}');
    expect(flat('apps/web/components/home-routes.tsx')).not.toContain('<People choices');
  });
  it('a fair keeps its one link to the list, which no menu gives (row 27)', () => {
    const view = read('apps/web/components/fairs-view.tsx');
    expect(view.match(/href="\/fairs"/g)).toHaveLength(1);
    expect(view).not.toMatch(/Back to/);
  });
});

describe('the new help request page keeps a way out of its error state', () => {
  const page = read('apps/web/app/account/service-requests/service-request-new.tsx');
  it('offers Try Again and Return to your account, as the detail page does', () => {
    expect(page).toContain('Try Again');
    expect(page).toContain('Return to your account');
    expect(page).toContain('setAttempt((n) => n + 1)');
  });
});
