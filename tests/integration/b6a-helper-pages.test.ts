import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wsE, wsEEn } from '../../apps/web/lib/i18n/ws/ws-e';
import { isContributorReturn, operatorReturnTo } from '../../apps/web/lib/workspace-navigation';

// Commercial-ready run, unit B6a (helper pages): D-054 a signed-out helper lands on the helper sign-in and
// never on the staff one, D-055 the helper pages carry a plain label and the Me page a real heading, D-056
// a helper reads "helper", "Corridra team" and "assigned work", never contributor, operator or execution.
// Routes, ids, role checks and the staff words are unchanged; only what a helper reads and where a signed-out
// helper is sent.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const taskPage = 'apps/web/app/contributor/page.tsx';
const mePage = 'apps/web/app/contributor/me/page.tsx';
const meBody = 'apps/web/app/contributor/me/helper-me.tsx';
const errorPage = 'apps/web/app/contributor/error.tsx';
const signInPage = 'apps/web/app/contributor/signin/page.tsx';
const setupPage = 'apps/web/app/contributor/setup/page.tsx';
const unavailable = 'apps/web/components/contributor-unavailable.tsx';
const form = 'apps/web/app/operator/signin/signin-form.tsx';
const workspace = '11111111-2222-4333-8444-555555555555';

describe('D-054: a signed-out helper is sent to the helper sign-in, never the staff one', () => {
  it('the task page redirects to /contributor/signin with the same return', () => {
    const page = read(taskPage);
    expect(page).not.toContain('/operator/signin');
    expect(page).toMatch(
      /redirect\(\s*'\/contributor\/signin\?next=' \+ encodeURIComponent\('\/contributor\?workspace=' \+ workspace\.data\),?\s*\)/,
    );
  });
  it('the Me page redirects to /contributor/signin with the task page of the same workspace as return', () => {
    const page = read(mePage);
    expect(page).not.toContain('/operator/signin');
    expect(page).toMatch(
      /redirect\(\s*'\/contributor\/signin\?next=' \+ encodeURIComponent\('\/contributor\?workspace=' \+ workspace\.data\),?\s*\)/,
    );
  });
  it('the signed-in "verify again" links open the helper sign-in too', () => {
    for (const file of [taskPage, meBody]) {
      const source = read(file);
      expect(source, file).not.toContain('/operator/signin');
      expect(source, file).toMatch(/'\/contributor\/signin\?next=' \+\s+encodeURIComponent\(/);
      expect(source, file).toContain('Verify your authenticator again');
    }
  });
  it('the return these pages ask for is one the helper door already keeps: the closed list is not widened', () => {
    const next = '/contributor?workspace=' + workspace;
    expect(operatorReturnTo(next)).toBe(next);
    expect(isContributorReturn(operatorReturnTo(next))).toBe(true);
    // The Me address is not on the closed list, which is why the Me page asks for the task page instead.
    expect(operatorReturnTo('/contributor/me?workspace=' + workspace)).toBe('/operator');
    // The door itself is unchanged: it checks the return and falls back to the bare task page.
    const door = read(signInPage);
    expect(door).toContain('operatorReturnTo(next)');
    expect(door).toContain("isContributorReturn(checked) ? checked : '/contributor'");
  });
});

describe('D-055: helper pages say "Assigned work" and the Me page has a real heading', () => {
  it('no helper page keeps the old label', () => {
    for (const file of [taskPage, mePage, errorPage, signInPage, unavailable]) {
      const source = read(file);
      expect(source, file).not.toMatch(/ASSIGNED EXECUTION WORK/i);
      expect(source, file).toContain('eyebrow="Assigned work"');
    }
    expect(read(taskPage).match(/eyebrow="Assigned work"/g)).toHaveLength(3);
    expect(read(mePage).match(/eyebrow="Assigned work"/g)).toHaveLength(2);
  });
  it('the Me page is headed My Assigned Work in both states and in the browser tab', () => {
    const page = read(mePage);
    expect(page).not.toMatch(/title="Me\."|'Me \| Corridra'/);
    expect(page.match(/title="My Assigned Work"/g)).toHaveLength(2);
    expect(page).toContain("title: 'My Assigned Work | Corridra'");
  });
  it('the task pages keep their titles', () => {
    expect(read(taskPage).match(/title="Your assigned tasks\."/g)).toHaveLength(2);
    expect(read(taskPage)).toContain("title={today ? 'Today.' : 'Your assigned tasks.'}");
    expect(read(unavailable)).toContain('title="Your assigned tasks."');
    expect(read(signInPage)).toContain('title="Sign in to your assigned tasks."');
  });
});

describe('D-056: a helper reads helper words', () => {
  it('the sign-in form says helper on the helper return and leaves the staff words alone', () => {
    const source = read(form);
    expect(source).toContain("'Use your helper work account'");
    expect(source).toContain("aria-label={contributor ? 'Helper sign-in' : 'Operator sign-in'}");
    expect(source).not.toMatch(/contributor work account|Contributor sign-in/);
    expect(source).toContain("'Use your operator account'");
    expect(source).toContain('const contributor = isContributorReturn(returnTo);');
  });
  it('the setup page says helper access and work password', () => {
    const page = read(setupPage);
    expect(page).toContain('title="Set up your helper access."');
    expect(page).toContain('eyebrow="Invited helper access"');
    expect(page).toContain("title: 'Invited helper setup | Corridra'");
    expect(page).toMatch(/set your separate work password\./);
    expect(page).not.toMatch(/contributor (access|password|setup)/i);
    // The form, its kind and the password rule id are code names and stay.
    expect(page).toContain('<SetupForm kind="contributor" />');
    expect(page).toContain('id="contributor-password-rule"');
  });
  it('the page shown without configuration names the Corridra team', () => {
    const source = read(unavailable);
    expect(source).toMatch(/Keep the invitation supplied by\s+the Corridra team\./);
    expect(source).not.toMatch(/your\s+operator/);
  });
  it('the task page says helper invitation and Corridra Network', () => {
    const page = read(taskPage);
    expect(page).toContain('Accept a Reviewed Helper Invitation');
    expect(page).toContain('The Corridra Network is awaiting activation review.');
    expect(page).not.toMatch(/Contributor Invitation|execution network/i);
  });
  it('the task and error pages say what a helper can see, never disclosed or scope', () => {
    const page = read(taskPage);
    expect(page).toContain('Only the tasks shared with you appear here.');
    expect(page).not.toMatch(/disclosed/i);
    const error = read(errorPage);
    expect(error).toMatch(/what you\s+can see stays the same/);
    expect(error).not.toMatch(/\bscope\b/i);
  });
  it('the words a helper reads on these pages never say contributor, operator or execution', () => {
    for (const file of [
      taskPage,
      mePage,
      meBody,
      errorPage,
      signInPage,
      setupPage,
      unavailable,
      'apps/web/app/contributor/signout.tsx',
      'apps/web/app/contributor/task-board.tsx',
    ]) {
      const source = read(file);
      // What is read: text between tags, and the label, title and name a person sees or hears.
      const text = [...source.matchAll(/>\s*([A-Z’'][^<>{}=;]*?)\s*</g)].map((m) => m[1]);
      const named = [
        ...source.matchAll(
          /\b(?:eyebrow|title|label|aria-label|placeholder)=(?:"([^"]*)"|\{'([^']*)'\})/g,
        ),
      ].map((m) => m[1] ?? m[2]);
      const titles = [...source.matchAll(/\btitle: '([^']*)'/g)].map((m) => m[1]);
      for (const words of [...text, ...named, ...titles])
        expect(words, file).not.toMatch(/\b(contributor|operator|execution)s?\b/i);
    }
  });
  it('the helper menu is named Helper sections in English and in every language placeholder', () => {
    expect(wsEEn['wse.contributor.nav']).toBe('Helper sections');
    for (const locale of Object.keys(wsE) as (keyof typeof wsE)[])
      expect(wsE[locale]['wse.contributor.nav'], locale).toBe('Helper sections');
    expect(read('apps/web/lib/i18n/ws/ws-e.ts')).not.toContain('Contributor sections');
  });
});
