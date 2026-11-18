import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { privacyReaders, type PrivacySurface } from '../../apps/web/lib/privacy-label';
import { catalogs, translate } from '../../apps/web/lib/i18n/messages';
import { excludedPages } from '../../apps/web/lib/all-tools';

// ADR-087 U5 (Members' Reports on /account and the read-only member report page) and U6 (the PL1 rows that name the
// workspace's owners and admins, only with CORRIDRA_MEMBER_ACCESS on). Rendered on the server, as the other component
// tests do; the browser behaviour (no read before it is asked for, focus, books) is in
// tests/operator/adr087-member-reports-ui.spec.ts. Fails on the commit before it: none of the member options exist.
// The page imports server modules; their marker package exists only inside Next.
vi.mock('server-only', () => ({}));
vi.mock('../../packages/auth/src/customer-saved-missions.ts', () => ({
  customerSavedMissionsEnabled: () => true,
}));
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => ({ NEON_AUTH_BASE_URL: 'https://auth.example' }),
}));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({
    getSession: async () => ({ data: { user: { id: 'user-1', emailVerified: true } } }),
  }),
}));
vi.mock('../../apps/web/lib/book-availability', () => ({ booksForPage: async () => true }));
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const controls = (html: string) =>
  [...html.matchAll(/<(button|input|select|textarea|a|form)\b([^>]*)>([^<]*)/g)].map(
    (m) => `${m[1]}|${m[2].replace(/\s+/g, ' ').trim()}|${m[3]}`,
  );
// What Next's notFound() throws (node_modules/next/dist/docs, functions/not-found).
const notFoundError = 'NEXT_HTTP_ERROR_FALLBACK;404';
const W = '0b9a6d3e-1c2f-4a5b-8c7d-9e0f1a2b3c4d';
const R = '33333333-3333-4333-8333-333333333333';

// The rows on main before U5, written out: with member access off or absent they must stay exactly these.
const before: Record<'savedReport' | 'decisionCard', [string, string, string | null][]> = {
  decisionCard: [
    [
      'privacy.reader.anyoneWithLink',
      'confirmed',
      'packages/db/customer-decision-card-migrations/0001_decision_cards.sql:app.read_decision_card',
    ],
    [
      'privacy.reader.youMadeLink',
      'confirmed',
      'packages/db/customer-decision-card-migrations/0001_decision_cards.sql:decision_card.principal_id=actor',
    ],
    ['privacy.reader.workspace', 'not_stated', null],
    ['privacy.reader.corridra', 'not_stated', null],
  ],
  savedReport: [
    [
      'privacy.reader.youSaved',
      'confirmed',
      'packages/db/customer-commercial-migrations/0001_saved_mission_invitations.sql:customer.saved_mission_action',
    ],
    [
      'privacy.reader.anyoneWithReportLink',
      'confirmed',
      'packages/db/migrations/0016_scoped_delivery.sql:app.delivery_authorized',
    ],
    ['privacy.reader.workspace', 'not_stated', null],
    ['privacy.reader.corridra', 'not_stated', null],
  ],
};
const rows = (surface: PrivacySurface, options?: { memberAccess?: boolean }) =>
  privacyReaders(surface, options).map((r) => [r.reader, r.status, r.sourceNote]);
/** The label's markup on main, built from the rows above. */
const labelHtml = (surface: 'savedReport' | 'decisionCard') =>
  '<div class="privacy-label" role="group" aria-label="Who can see it" lang="en" dir="ltr"><p class="privacy-label-title" aria-hidden="true">Who can see it</p><ul>' +
  before[surface]
    .map(
      ([reader, status]) =>
        `<li><span>${translate('en', reader as never).replaceAll("'", '&#x27;')}</span> <span class="privacy-label-status" data-status="${status}">${status === 'confirmed' ? 'Can see it' : 'Not stated'}</span></li>`,
    )
    .join('') +
  '</ul></div>';

describe('PL1 with member access off or absent: byte for byte what it was', () => {
  for (const surface of ['savedReport', 'decisionCard'] as const) {
    it(`${surface}: the readers are the rows on main, whatever the option says when it is not on`, () => {
      expect(rows(surface)).toEqual(before[surface]);
      expect(rows(surface, {})).toEqual(before[surface]);
      expect(rows(surface, { memberAccess: false })).toEqual(before[surface]);
      expect(privacyReaders(surface, { memberAccess: false })).toBe(privacyReaders(surface));
    });
    it(`${surface}: the label renders the same markup with no option, false, or a scope that is off`, async () => {
      const { PrivacyLabel, PrivacyLabelScope } = await loadWeb('components/privacy-label.tsx');
      const plain = render(ce(PrivacyLabel, { surface }));
      expect(plain).toBe(labelHtml(surface));
      expect(render(ce(PrivacyLabel, { surface, memberAccess: false }))).toBe(plain);
      expect(
        render(
          ce(PrivacyLabelScope, { value: { memberAccess: false } }, ce(PrivacyLabel, { surface })),
        ),
      ).toBe(plain);
    });
  }
  it('every place that draws them today is unchanged: the saved report line and the card panel', async () => {
    // The saved report keeps the same element in the same place (tests/integration/pl1-privacy-label.test.ts pins it).
    expect(read('apps/web/app/account/missions/saved-commercial-report.tsx')).toMatch(
      /Original access expires \{formatMoment\(data\.expiresAt\)\}\s*\.\s*<\/p>\s*<PrivacyLabel surface="savedReport" \/>/,
    );
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel.tsx');
    const panel = {
      phase: 'ready',
      chosen: null,
      acknowledged: false,
      busy: false,
      preview: null,
      link: null,
      cards: [],
      notice: null,
      maxActive: 5,
    };
    const decisions = [{ id: 'd1', company: 'A', decision: 'SELECT', requirementCurrent: true }];
    const plain = render(ce(DecisionCardPanelView, { panel, decisions }));
    expect(plain).toContain(labelHtml('decisionCard'));
    expect(render(ce(DecisionCardPanelView, { panel, decisions, memberAccess: false }))).toBe(
      plain,
    );
    // The pages that pass the switch pass it only from the server, read from CORRIDRA_MEMBER_ACCESS.
    expect(read('apps/web/app/account/missions/[resourceId]/page.tsx')).toContain(
      'memberAccess={memberAccessOn()}',
    );
  });
});

describe('PL1 with member access on (ADR-087 U6)', () => {
  it('saved report: owners and admins can see it, including earlier reports and books; other members not stated', () => {
    expect(rows('savedReport', { memberAccess: true })).toEqual([
      before.savedReport[0],
      before.savedReport[1],
      [
        'privacy.reader.workspaceOwnersReport',
        'confirmed',
        'packages/db/member-access-migrations/0001_member_access.sql:customer.workspace_saved_missions',
      ],
      ['privacy.reader.workspaceMembers', 'not_stated', null],
      before.savedReport[3],
    ]);
  });
  it('decision card: owners and admins can see it, including earlier cards; other members not stated', () => {
    expect(rows('decisionCard', { memberAccess: true })).toEqual([
      before.decisionCard[0],
      before.decisionCard[1],
      [
        'privacy.reader.workspaceOwnersCard',
        'confirmed',
        'packages/db/member-access-migrations/0002_member_decision_cards.sql:customer.workspace_decision_cards',
      ],
      ['privacy.reader.workspaceMembers', 'not_stated', null],
      before.decisionCard[3],
    ]);
  });
  it('the other surfaces do not change', () => {
    for (const surface of ['recipientReply', 'evidenceReply'] as const)
      expect(privacyReaders(surface, { memberAccess: true })).toBe(privacyReaders(surface));
  });
  it('each confirmed row cites a function that exists and reads only for an owner or admin', () => {
    expect(read('packages/db/member-access-migrations/0001_member_access.sql')).toMatch(
      /CREATE FUNCTION customer\.workspace_saved_missions\(/,
    );
    expect(read('packages/db/member-access-migrations/0002_member_decision_cards.sql')).toMatch(
      /CREATE FUNCTION customer\.workspace_decision_cards\(/,
    );
    expect(read('apps/web/lib/member-access.ts')).toContain("w.role IN ('owner','admin')");
  });
  it('says the decided words in English, has a draft in every language, and no em dash', () => {
    expect(translate('en', 'privacy.reader.workspaceOwnersReport' as never)).toBe(
      'Owners and admins of your workspace, including reports saved earlier. They can also download its books.',
    );
    expect(translate('en', 'privacy.reader.workspaceOwnersCard' as never)).toBe(
      'Owners and admins of your workspace, including cards made earlier',
    );
    expect(translate('en', 'privacy.reader.workspaceMembers' as never)).toBe(
      'Other members of your workspace',
    );
    for (const [code, catalog] of Object.entries(catalogs))
      for (const key of [
        'privacy.reader.workspaceOwnersReport',
        'privacy.reader.workspaceOwnersCard',
        'privacy.reader.workspaceMembers',
      ]) {
        const words = (catalog as Record<string, string>)[key];
        expect(words, `${code} ${key}`).toBeTruthy();
        expect(words, `${code} ${key}`).not.toContain('—');
      }
  });
  it('the label draws the new rows when told, by option or by scope, and still holds no control', async () => {
    const { PrivacyLabel, PrivacyLabelScope } = await loadWeb('components/privacy-label.tsx');
    const on = render(ce(PrivacyLabel, { surface: 'savedReport', memberAccess: true }));
    expect(on).toContain(
      '<span>Owners and admins of your workspace, including reports saved earlier. They can also download its books.</span> <span class="privacy-label-status" data-status="confirmed">Can see it</span>',
    );
    expect(on).toContain(
      '<span>Other members of your workspace</span> <span class="privacy-label-status" data-status="not_stated">Not stated</span>',
    );
    expect(on).not.toContain('Other people in your workspace');
    expect(controls(on)).toEqual([]);
    expect(
      render(
        ce(
          PrivacyLabelScope,
          { value: { memberAccess: true } },
          ce(PrivacyLabel, { surface: 'decisionCard' }),
        ),
      ),
    ).toContain('Owners and admins of your workspace, including cards made earlier');
    // An explicit false wins over the scope.
    expect(
      render(
        ce(
          PrivacyLabelScope,
          { value: { memberAccess: true } },
          ce(PrivacyLabel, { surface: 'decisionCard', memberAccess: false }),
        ),
      ),
    ).toBe(labelHtml('decisionCard'));
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel.tsx');
    const panel = {
      phase: 'ready',
      chosen: null,
      acknowledged: false,
      busy: false,
      preview: null,
      link: null,
      cards: [],
      notice: null,
      maxActive: 5,
    };
    const decisions = [{ id: 'd1', company: 'A', decision: 'SELECT', requirementCurrent: true }];
    const plain = render(ce(DecisionCardPanelView, { panel, decisions }));
    const switched = render(ce(DecisionCardPanelView, { panel, decisions, memberAccess: true }));
    expect(switched).toContain('including cards made earlier');
    expect(controls(switched)).toEqual(controls(plain));
  });
});

describe('the missions components: default unchanged, member mode read only', () => {
  const props = { subject: 's', issuer: 'https://example.invalid/auth', resourceId: R };
  it('the saved report: by default the same first screen; as a member read, no back link, no label, its own words', async () => {
    const { SavedCommercialReport } = await loadWeb(
      'app/account/missions/saved-commercial-report.tsx',
    );
    const plain = render(ce(SavedCommercialReport, props));
    expect(plain).toBe(render(ce(SavedCommercialReport, { ...props, memberAccess: false })));
    expect(plain).toContain(
      '<a class="text-link ux-back" href="/account#saved-commercial-missions">Back to my saved commercial missions</a>',
    );
    expect(plain).toContain('<p role="status">Opening your approved commercial report…</p>');
    const member = render(ce(SavedCommercialReport, { ...props, member: { workspaceId: W } }));
    expect(member).not.toContain('Back to my saved commercial missions');
    expect(member).toContain('<p role="status">Opening this report…</p>');
    expect(member).not.toContain('privacy-label');
  });
  it('the saved report: the member read never draws the response form, its retries, decisions, confirmations or the label', () => {
    const report = read('apps/web/app/account/missions/saved-commercial-report.tsx');
    expect(report).toContain('const showDecisions = decisionsEnabled && !member;');
    expect(report).toContain(
      'const showConfirmations = specificationConfirmationsEnabled && !member;',
    );
    expect(report).toMatch(/\{showEvidence && showDecisions && \(\s*<DecisionHistory/);
    expect(report).toMatch(
      /\{showEvidence && showConfirmations && \(\s*<SpecificationConfirmation/,
    );
    expect(report).toMatch(
      /\{!member && \(q\.status === 'OPEN' \|\| pending\?\.requestId === q\.id\) && \(\s*<form/,
    );
    expect(report).toMatch(/\{!member && \(\s*<p>\s*Your original private invitation/);
    expect(report).toContain('"The member\'s self-declared response:"');
    expect(report).toContain('omitted: !!props.member');
    // The member read asks the member access route for this one report, never the member's own route.
    expect(report).toContain("{ action: 'report', workspaceId: memberWorkspace, resourceId }");
    expect(report).toContain("fields: { action: 'book', workspaceId: member.workspaceId }");
  });
  it('the books panel looks the same with a target, and keeps its own route by default', async () => {
    const { BookDownloads, createPendingBooks } = await loadWeb(
      'app/account/missions/book-downloads.tsx',
    );
    const base = {
      ...props,
      tripCount: 3,
      supplierCount: 0,
      pending: createPendingBooks(),
      onDenied: () => {},
      onChanged: () => {},
    };
    const plain = render(ce(BookDownloads, base));
    const targeted = render(
      ce(BookDownloads, {
        ...base,
        target: {
          endpoint: '/api/customer-member-access',
          fields: { action: 'book', workspaceId: W },
        },
      }),
    );
    expect(targeted).toBe(plain);
    const source = read('apps/web/app/account/missions/book-downloads.tsx');
    expect(source).toContain(
      "const ownBooks: BookTarget = { endpoint: '/api/customer-books', fields: {} };",
    );
    // The member's fields go first, so they can never replace the command, kind or acknowledgement.
    expect(source).toContain(
      'body: JSON.stringify({ ...target.fields, resourceId, commandId, kind, acknowledged: true }),',
    );
  });
  it('the decision history passes the switch through and its first screen does not change', async () => {
    const { DecisionHistory } = await loadWeb('app/account/missions/decision-history.tsx');
    const plain = render(ce(DecisionHistory, props));
    expect(render(ce(DecisionHistory, { ...props, memberAccess: false }))).toBe(plain);
    expect(render(ce(DecisionHistory, { ...props, memberAccess: true }))).toBe(plain);
    expect(read('apps/web/app/account/missions/decision-history.tsx')).toContain(
      'memberAccess={memberAccess}',
    );
  });
});

describe("Members' Reports", () => {
  const source = read('apps/web/app/account/member-reports.tsx');
  it('first screen: the helper and the loading line, nothing read yet', async () => {
    const { MemberReports } = await loadWeb('app/account/member-reports.tsx');
    const html = render(
      ce(MemberReports, { subject: 's', issuer: 'https://example.invalid/auth' }),
    );
    expect(html).toContain(
      '<p>Reports saved and decision cards made by other members of workspaces you own or manage. You can read them and download their books. Only the member can remove a report or withdraw a card. Each report or card you open and each book you download is recorded with your name.</p>',
    );
    expect(html).toContain('<p role="status">Loading members&#x27; reports…</p>');
    expect(controls(html)).toEqual([]);
  });
  it('has no remove, withdraw, edit or respond action and asks only for reads', () => {
    expect(source).not.toMatch(/Remove|Withdraw|Edit|Send Response|Save Invitation/);
    const actions = [...source.matchAll(/action: '([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(actions).toEqual(['card', 'cards', 'reports']);
    expect(source).not.toContain('—');
  });
  it('opens a card only from its button, and shows the six fields read only', async () => {
    const { CardDetail } = await loadWeb('app/account/member-reports.tsx');
    const fields = {
      company: '绿野机械有限公司',
      decision: 'SELECT',
      rationale: 'Best lead time',
      nextAction: 'Ask for samples',
      dueAt: '2026-12-01T00:00:00.000Z',
      provenance: { sourceKind: 'self_declaration', claimStatus: 'self_declared' },
    };
    const html = render(
      ce(CardDetail, {
        detail: { status: 'ready', fields, memberLabel: 'Rahim' },
        memberLabel: null,
        onRetry: () => {},
      }),
    );
    expect(html).toContain('<p>Made by Rahim. Read only.</p>');
    for (const term of ['Company', 'Decision', 'Reason', 'Next step', 'Due', 'Source'])
      expect(html).toContain(`<dt>${term}</dt>`);
    expect(html).toContain('<span lang="zh">绿野机械有限公司</span>');
    expect(html).toContain('<dd dir="auto">Selected</dd>');
    expect(controls(html)).toEqual([]);
    const failed = render(
      ce(CardDetail, { detail: { status: 'failed' }, memberLabel: null, onRetry: () => {} }),
    );
    expect(failed).toContain('<p>Made by a member of this workspace. Read only.</p>');
    expect(failed).toContain('<p role="alert">This decision could not be opened. Try again.</p>');
    expect(controls(failed)).toEqual([
      'button|type="button" class="button button-secondary"|Try Again',
    ]);
    expect(
      render(
        ce(CardDetail, { detail: { status: 'unavailable' }, memberLabel: null, onRetry: () => {} }),
      ),
    ).toContain(
      '<p role="alert">This decision card is not available. It may have expired or been withdrawn.</p>',
    );
    // The detail is asked for in the click handler only.
    expect(source).toMatch(/onClick=\{\(\) => open\(card\)\}/);
    expect(source.match(/action: 'card',/g)).toHaveLength(1);
  });
  it('is the last Reports tab, and only while the switch is on', async () => {
    const { ReportsTabs } = await loadWeb('app/account/reports-tabs.tsx');
    expect(render(ce(ReportsTabs, { members: ce('p', null, 'members') }))).toBe('<p>members</p>');
    const tabs = read('apps/web/app/account/reports-tabs.tsx');
    expect(tabs.indexOf("id: 'members'")).toBeGreaterThan(tabs.indexOf("id: 'shared'"));
    expect(tabs).toContain('label: "Members\' Reports"');
    const page = read('apps/web/app/account/page.tsx');
    expect(page).toMatch(
      /members=\{\s*savedMissionIssuer &&\s*memberReportsVisible && \(\s*<MemberReports subject=\{data\.user\.id\} issuer=\{savedMissionIssuer\} \/>/,
    );
    // The tab shows only with the switch on and for someone who owns or manages a workspace: the server asks the member access
    // service for the workspaces (a read of no member item, recorded nowhere) and any failure means no tab.
    expect(page).toMatch(
      /let memberReportsVisible = false;\s*if \(savedMissionIssuer && memberAccessOn\(\)\) \{[\s\S]*?customerMemberAccess\.workspaces\(data\.user\.id, savedMissionIssuer\)\)\s*\?\.workspaces\.length \?\? 0\) > 0;/,
    );
  });
});

describe('the member report page', () => {
  const path = 'apps/web/app/account/member-reports/[workspaceId]/[resourceId]/page.tsx';
  const saved = process.env.CORRIDRA_MEMBER_ACCESS;
  afterEach(() => {
    if (saved === undefined) delete process.env.CORRIDRA_MEMBER_ACCESS;
    else process.env.CORRIDRA_MEMBER_ACCESS = saved;
  });
  it('is not found while CORRIDRA_MEMBER_ACCESS is off, before anything else is read', async () => {
    delete process.env.CORRIDRA_MEMBER_ACCESS;
    const { default: Page } = await loadWeb(
      'app/account/member-reports/[workspaceId]/[resourceId]/page.tsx',
    );
    // A thenable that records whether the page waited for its address before refusing.
    let params = false;
    const answer = Page({
      params: {
        then: () => {
          params = true;
        },
      },
    });
    await expect(answer).rejects.toThrow(notFoundError);
    process.env.CORRIDRA_MEMBER_ACCESS = 'false';
    await expect(
      Page({ params: Promise.resolve({ workspaceId: W, resourceId: R }) }),
    ).rejects.toThrow(notFoundError);
    expect(params).toBe(false);
    const source = read(path);
    expect(source.indexOf('if (!memberAccessOn()) notFound();')).toBeLessThan(
      source.indexOf('await params'),
    );
  });
  it('with the switch on, draws the member read of that report and nothing that acts on it', async () => {
    process.env.CORRIDRA_MEMBER_ACCESS = 'true';
    const { default: Page } = await loadWeb(
      'app/account/member-reports/[workspaceId]/[resourceId]/page.tsx',
    );
    const shell = (await Page({ params: Promise.resolve({ workspaceId: W, resourceId: R }) })) as {
      props: {
        tab: string;
        title: string;
        frame: unknown;
        children: { props: Record<string, unknown> };
      };
    };
    expect(shell.props.tab).toBe('results');
    expect(shell.props.title).toBe("Member's saved report");
    expect(shell.props.frame).toEqual({
      back: { label: "Back to Members' Reports", href: '/account?view=results&tab=members' },
    });
    expect(shell.props.children.props).toMatchObject({
      resourceId: R,
      member: { workspaceId: W },
      subject: 'user-1',
      books: true,
    });
    for (const off of ['decisionsEnabled', 'specificationConfirmationsEnabled', 'decisionCards'])
      expect(shell.props.children.props[off], off).toBeUndefined();
    // A malformed address is not found, not a read.
    await expect(
      Page({ params: Promise.resolve({ workspaceId: 'x', resourceId: R }) }),
    ).rejects.toThrow(notFoundError);
  });
  it('draws the shared report read only, in the customer shell, with the back link to the tab', () => {
    const source = read(path);
    expect(source).toContain('member={{ workspaceId: ids.data.workspaceId }}');
    expect(source).toContain(
      `const back = { label: "Back to Members' Reports", href: '/account?view=results&tab=members' };`,
    );
    expect(source).toMatch(
      /<CustomerShell tab="results" eyebrow="REPORTS" title="Member's saved report"/,
    );
    expect(source).not.toMatch(
      /decisionsEnabled|specificationConfirmationsEnabled|decisionCards|<form|<button/,
    );
    expect(source).toContain('books={await booksForPage()}');
    expect(excludedPages).toContainEqual({
      route: '/account/member-reports/[workspaceId]/[resourceId]',
      why: "Needs one shared item. It opens from Members' Reports.",
    });
  });
});
