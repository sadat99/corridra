import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The helper sign-in door (/contributor/signin): the work-account sign-in a helper already used through the
// team page, with helper words and a return to the task page. It adds no sign-in method (ADR-020): the form,
// the password and authenticator and /api/operator-auth are the existing ones.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (t: unknown, p?: unknown, ...c: unknown[]) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

describe('the helper sign-in page', () => {
  const page = read('apps/web/app/contributor/signin/page.tsx');
  it('reuses the existing work-account form and adds no sign-in method', () => {
    expect(page).toContain("import { OperatorSignin } from '../../operator/signin/signin-form'");
    expect(page).toContain('<OperatorSignin returnTo={returnTo} />');
    expect(page).not.toMatch(/identityClient|neon|customerSignIn|account-form|signIn\.email/i);
    expect(page).not.toMatch(/type="(?:email|password)"|<input/);
  });
  it('fails closed before any form when sign-in is not configured', () => {
    const guard = page.indexOf('if (!foundations())');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(page.indexOf('<OperatorSignin'));
    // The same page as the task page shows, from one component, so the two cannot drift.
    expect(page).toContain('if (!foundations()) return <ContributorUnavailable />;');
    expect(read('apps/web/app/contributor/page.tsx')).toContain(
      'if (!s) return <ContributorUnavailable />;',
    );
    const shared = read('apps/web/components/contributor-unavailable.tsx');
    expect(shared).toContain('title="Your assigned tasks."');
    expect(shared).toContain('Assigned-task access is not configured in this environment.');
    expect(shared).toContain('Keep the invitation supplied by');
    expect(shared).toContain('href="/network"');
    expect(shared).not.toMatch(/<form|<input|OperatorSignin|type="password"/);
    expect(page).not.toContain('Assigned-task access is not configured');
  });
  it('links its recovery option to the operator password reset, as the work account is the same', () => {
    expect(page).toMatch(
      /<Link[^>]*href="\/operator\/forgot-password\?for=helper"[^>]*>\s*Forgot your work password\?\s*<\/Link>/,
    );
  });
  it('is private, uncached and never sends a helper to the staff workspace', () => {
    expect(page).toContain("export const dynamic = 'force-dynamic'");
    expect(page).toContain('robots: { index: false, follow: false }');
    expect(page).toContain('operatorReturnTo(next)');
    expect(page).toContain("isContributorReturn(checked) ? checked : '/contributor'");
    expect(page).not.toMatch(/OPERATOR ACCESS|operator account/);
  });
  it('is covered by the contributor header rule: no-referrer and no-store', () => {
    const config = read('apps/web/next.config.ts');
    const rule = /source:\s*'\/contributor\/:path\*',\s*headers:\s*\[([^\]]*)\]/.exec(config);
    expect(rule, 'the /contributor/:path* header rule').not.toBeNull();
    expect(rule![1]).toContain("key: 'Referrer-Policy', value: 'no-referrer'");
    expect(rule![1]).toContain("key: 'Cache-Control', value: 'no-store'");
    // `:path*` is zero or more segments, so it covers /contributor/signin and the page's own address.
  });
});

describe('the wording follows the helper return, the destination follows the closed list', () => {
  it('takes the helper words from isContributorReturn in the form and the help list', () => {
    for (const file of [
      'apps/web/app/operator/signin/signin-form.tsx',
      'apps/web/lib/access-doors.ts',
    ]) {
      expect(read(file)).toContain('isContributorReturn(returnTo)');
      expect(read(file)).not.toContain("returnTo.startsWith('/contributor?')");
    }
  });
  it('shows the helper setup link for a bare /contributor return and the staff one otherwise', async () => {
    const { AccessOptions } = await load('components/access-options.tsx');
    const { accessHelp } = await load('lib/access-doors.ts');
    const show = (returnTo: string) =>
      render(ce(AccessOptions, accessHelp.operatorSignIn(returnTo)));
    expect(show('/contributor')).toContain('href="/contributor/setup"');
    expect(show('/contributor')).toContain('Set up invited helper access');
    expect(show('/contributor')).not.toContain('/operator/setup');
    expect(show('/operator')).toContain('href="/operator/setup"');
    expect(show('/operator')).not.toContain('helper access');
    expect(show('/operator')).not.toContain('contributor access');
  });
});

describe('the helper door on the team page', () => {
  it('opens helper sign-in as a full page load and keeps the invitation link', async () => {
    const { teamDoorPage } = await load('lib/access-doors.ts');
    const helper = teamDoorPage.cards.find((c: { id: string }) => c.id === 'helper');
    expect(helper.action).toMatchObject({
      text: 'Open Helper Tasks',
      href: '/contributor/signin',
      plainAnchor: true,
    });
    expect(helper.textLink).toMatchObject({ href: '/contributor/setup' });
    const team = teamDoorPage.cards.find((c: { id: string }) => c.id === 'team');
    expect(team.action).toMatchObject({ href: '/operator/signin', plainAnchor: true });
  });
  it('keeps the invitation-bound sign-in links on the task page, now through the helper sign-in', () => {
    const task = read('apps/web/app/contributor/page.tsx');
    // B6a (D-054): both links carry the same workspace return and open the helper sign-in, not the staff one.
    expect(task.match(/'\/contributor\/signin\?next=' \+\s+encodeURIComponent\(/g)).toHaveLength(2);
    expect(task).not.toContain('/operator/signin');
    // The new link is a plain anchor (a full page load, KI-30), kept beside the invitation links.
    expect(task).toContain('<a className="text-link" href="/contributor/signin">');
    expect(task).toContain('href="/contributor/setup"');
  });
});

describe('the recovery page reached from the helper door', () => {
  it('is told by ?for=helper, so the page says work account and goes back to the helper sign-in', async () => {
    const page = read('apps/web/app/operator/forgot-password/page.tsx');
    expect(page).toContain("(await searchParams).for === 'helper'");
    expect(page).toContain('Reset your work password.');
    expect(page).toContain('<OperatorRecoveryForm mode="request" helper={helper} />');
    // Words and links only: it reads no session and adds no sign-in call of its own.
    expect(page).not.toMatch(/getSession|identityClient|headers\(\)|cookies\(\)/);
    const operatorPage = page.slice(page.indexOf(": 'OPERATOR ACCESS'"));
    expect(operatorPage).toContain('Reset your operator password.');
  });
  it('lists helper links only, with the way back on the helper sign-in', async () => {
    const { AccessOptions } = await load('components/access-options.tsx');
    const { accessHelp } = await load('lib/access-doors.ts');
    const html = render(ce(AccessOptions, accessHelp.helperForgotPassword));
    expect(html).toContain('href="/contributor/signin"');
    expect(html).toContain('Helper Sign-In');
    expect(html).toContain('href="/contributor/setup"');
    expect(html).not.toMatch(/operator/i);
    // The operator page keeps its own list.
    const staff = render(ce(AccessOptions, accessHelp.operatorForgotPassword('/operator/signin')));
    expect(staff).toContain('Operator Sign-In');
    expect(staff).toContain('href="/operator/signin"');
  });
  it('keeps the operator words for the operator and says "work account" in the request form for a helper', () => {
    const form = read('apps/web/app/operator/recovery-form.tsx');
    expect(form).toContain("'Operator email'");
    expect(form).toContain("'Work account email'");
    expect(form).toContain("'Request Operator Reset Email'");
    expect(form).toContain("'Request Reset Email'");
    expect(form).toContain('Return to Helper Sign-in');
    expect(form).toContain('href="/contributor/signin"');
    expect(form).toContain('If this address has an active work account');
    // No auth change: the same request call and redirect, whoever asks.
    expect(form).toContain('redirectTo: `${window.location.origin}/operator/reset-password`');
  });
});
