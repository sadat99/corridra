import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decisionCardRequest } from '../../packages/auth/src/customer-decision-cards';
import {
  canCreate,
  canPreview,
  cardLink,
  nextCreateCommand,
  countsWords,
  failureWords,
  initialPanel,
  panelReducer,
  requestBodies,
  shareableDecisions,
  withdrawable,
  type Panel,
  type Preview,
} from '../../apps/web/lib/decision-card-owner';

// Revamp Wave 4, docs/revamp/specs/decision-card-ui.md, the owner panel: D-06, D-07, D-08, D-09.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...c: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) =>
    ce('a', { href }, children as never),
}));
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const resourceId = '11111111-1111-4111-8111-111111111111';
const decisionId = '22222222-2222-4222-8222-222222222222';
const cardId = '33333333-3333-4333-8333-333333333333';
const decisions = [
  {
    id: decisionId,
    company: 'Lantern Cutting Works',
    decision: 'SELECT' as const,
    requirementCurrent: true,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    company: 'Green Field Machinery',
    decision: 'DECLINE' as const,
    requirementCurrent: true,
  },
];
const preview: Preview = {
  fields: {
    company: 'Lantern Cutting Works',
    decision: 'SELECT',
    rationale: 'Best fit',
    nextAction: 'Send the order',
    dueAt: '2026-12-01T00:00:00.000Z',
    provenance: { sourceKind: 'self_declaration', claimStatus: 'self_declared' },
  },
  digest: 'a'.repeat(64),
  expiresAt: '2026-11-10T10:00:00.000Z',
};
const ready = (extra: Partial<Panel> = {}): Panel => ({
  ...panelReducer(initialPanel, {
    type: 'stateLoaded',
    canShare: true,
    maxActive: 5,
    cards: [],
  }),
  ...extra,
});

describe('the panel is absent unless the service says the person can share', () => {
  it('starts hidden, shows only when canShare is true, and hides for any failure', () => {
    expect(initialPanel.phase).toBe('loading');
    expect(ready().phase).toBe('ready');
    expect(
      panelReducer(initialPanel, { type: 'stateLoaded', canShare: false, maxActive: 5, cards: [] })
        .phase,
    ).toBe('hidden');
    expect(panelReducer(initialPanel, { type: 'stateFailed' }).phase).toBe('hidden');
  });
});

describe('D-06 nothing is created before the acknowledgement', () => {
  it('walks choose, preview, acknowledge, then allows the create', () => {
    let p = ready();
    expect(canPreview(p)).toBe(false);
    expect(canCreate(p)).toBe(false);
    p = panelReducer(p, { type: 'choose', decisionId });
    expect(canPreview(p)).toBe(true);
    expect(canCreate(p)).toBe(false);
    p = panelReducer(p, { type: 'previewLoaded', preview });
    expect(canCreate(p)).toBe(false);
    p = panelReducer(p, { type: 'acknowledge', value: true });
    expect(canCreate(p)).toBe(true);
    p = panelReducer(p, { type: 'acknowledge', value: false });
    expect(canCreate(p)).toBe(false);
  });
  it('D-06 offers only decisions whose requirement is still current', async () => {
    const all = [
      { id: decisionId, company: 'Current Co', decision: 'SELECT', requirementCurrent: true },
      {
        id: '44444444-4444-4444-8444-444444444444',
        company: 'Changed Co',
        decision: 'SELECT',
        requirementCurrent: false,
      },
    ];
    expect(shareableDecisions(all).map((d) => d.company)).toEqual(['Current Co']);
    expect(shareableDecisions([all[1]!])).toEqual([]);
    // The step 1 list shows only the current one, and says so when none is left.
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel');
    const html = render(
      ce(DecisionCardPanelView, { panel: ready(), decisions: all, handlers: {} }),
    );
    expect(html).toContain('Current Co');
    expect(html).not.toContain('Changed Co');
    const none = render(
      ce(DecisionCardPanelView, { panel: ready(), decisions: [all[1]!], handlers: {} }),
    );
    expect(none).not.toContain('Changed Co');
    expect(none).toContain('There is no reviewed decision to share yet.');
    expect(none).not.toContain('type="radio"');
  });
  it('choosing another decision drops the preview and the acknowledgement', () => {
    let p = panelReducer(ready(), { type: 'choose', decisionId });
    p = panelReducer(p, { type: 'previewLoaded', preview });
    p = panelReducer(p, { type: 'acknowledge', value: true });
    p = panelReducer(p, { type: 'choose', decisionId: decisions[1]!.id });
    expect(p.preview).toBeNull();
    expect(p.acknowledged).toBe(false);
    expect(canCreate(p)).toBe(false);
  });
  it('builds requests the service accepts, and the create carries the previewed digest and expiry', () => {
    const bodies = requestBodies({ resourceId, commandId: cardId });
    expect(decisionCardRequest.parse(bodies.state())).toBeTruthy();
    expect(decisionCardRequest.parse(bodies.preview(decisionId))).toBeTruthy();
    const create = bodies.create(decisionId, preview);
    expect(decisionCardRequest.parse(create)).toMatchObject({
      action: 'create',
      digest: preview.digest,
      expiresAt: preview.expiresAt,
      acknowledged: true,
    });
    expect(decisionCardRequest.parse(bodies.withdraw(cardId))).toMatchObject({
      action: 'withdraw',
      cardId,
    });
  });
  it('marks a Chinese company name as Chinese in the list and the preview', async () => {
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel');
    const zh = [
      { id: decisionId, company: '绿野机械有限公司', decision: 'SELECT', requirementCurrent: true },
    ];
    let p = panelReducer(ready(), { type: 'choose', decisionId });
    p = panelReducer(p, {
      type: 'previewLoaded',
      preview: { ...preview, fields: { ...preview.fields, company: '绿野机械有限公司' } },
    });
    const html = render(ce(DecisionCardPanelView, { panel: p, decisions: zh, handlers: {} }));
    expect(html.match(/lang="zh"/g)).toHaveLength(2);
  });
  it('shows exactly the six fields in the preview', async () => {
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel');
    let p = panelReducer(ready(), { type: 'choose', decisionId });
    p = panelReducer(p, { type: 'previewLoaded', preview });
    const html = render(ce(DecisionCardPanelView, { panel: p, decisions, handlers: {} }));
    for (const label of ['Company', 'Decision', 'Reason', 'Next step', 'Due', 'Source'])
      expect(html, label).toContain(`<dt>${label}</dt>`);
    expect(html.match(/<dt>/g)).toHaveLength(6);
    expect(html).toContain('Create link');
    expect(html).not.toContain('lang="zh"');
    expect(html).toContain('type="checkbox"');
    // The create button is disabled until the box is ticked.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create link/);
  });
});

describe('D-06 an uncertain create is retried with the same command', () => {
  const previewed = () => {
    let p = panelReducer(ready(), { type: 'choose', decisionId });
    p = panelReducer(p, { type: 'previewLoaded', preview });
    return panelReducer(p, { type: 'acknowledge', value: true });
  };
  it('reuses the command id when the answer was lost, so the service returns the first card', () => {
    let p = previewed();
    const first = nextCreateCommand(p, 'cmd-1');
    expect(first).toBe('cmd-1');
    p = panelReducer(p, { type: 'createStarted', commandId: first });
    // The answer never came back (network, 500, 503): the same acknowledged preview is still there.
    p = panelReducer(p, { type: 'failed', status: 0 });
    expect(canCreate(p)).toBe(true);
    expect(nextCreateCommand(p, 'cmd-2')).toBe('cmd-1');
    p = panelReducer(p, { type: 'failed', status: 503 });
    expect(nextCreateCommand(p, 'cmd-3')).toBe('cmd-1');
  });
  it('starts a new command for a genuinely new creation', () => {
    let p = previewed();
    p = panelReducer(p, { type: 'createStarted', commandId: 'cmd-1' });
    // A new preview, another decision, a changed decision and a success each end the old command.
    expect(nextCreateCommand(panelReducer(p, { type: 'previewLoaded', preview }), 'cmd-2')).toBe(
      'cmd-2',
    );
    expect(
      nextCreateCommand(panelReducer(p, { type: 'choose', decisionId: decisions[1]!.id }), 'cmd-3'),
    ).toBe('cmd-3');
    expect(
      nextCreateCommand(
        panelReducer(p, { type: 'failed', status: 409, reason: 'CHANGED' }),
        'cmd-4',
      ),
    ).toBe('cmd-4');
    const done = panelReducer(p, {
      type: 'created',
      created: { cardId, state: 'ACTIVE', expiresAt: preview.expiresAt, token: 'T'.repeat(43) },
      origin: 'https://corridra.test',
    });
    expect(nextCreateCommand(done, 'cmd-5')).toBe('cmd-5');
    // A different preview digest never reuses a command made for another one.
    const other = { ...p, preview: { ...preview, digest: 'b'.repeat(64) } };
    expect(nextCreateCommand(other, 'cmd-6')).toBe('cmd-6');
  });
  it('the component takes the command from the panel, not a new random id each click', () => {
    const source = readFileSync('apps/web/app/account/missions/decision-card-panel.tsx', 'utf8');
    expect(source).toContain('nextCreateCommand(');
    expect(source).not.toMatch(/commandId:\s*crypto\.randomUUID\(\)\s*\}\)\.create/);
  });
});

describe('D-07 every refusal has its exact words', () => {
  it.each([
    [409, 'CHANGED', 'The decision changed since the preview. Preview again.'],
    [409, 'CAP_REACHED', 'Five links are active for this report. Withdraw one first.'],
    [429, undefined, 'Too many new links in the last hour. Try again later.'],
    [503, undefined, 'Not available right now.'],
  ])('%s %s', (status, reason, words) => {
    expect(failureWords(status, reason)).toBe(words);
  });
  it('says plainly when the report is from a real workspace, and never guesses otherwise', async () => {
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel');
    const real = render(ce(DecisionCardPanelView, { real: true }));
    expect(real).toContain('Decision cards are available for sample workspaces only.');
    expect(failureWords(403, undefined)).toBe('You cannot share from this report.');
    expect(failureWords(500, undefined)).toBe('Something went wrong. Try again.');
  });
  it('D-07 real workspace: only the plain line, with no control, link, count or preview', async () => {
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel');
    // Even a panel that is otherwise ready, with cards and a link, shows nothing but the line.
    let p = panelReducer(initialPanel, {
      type: 'stateLoaded',
      canShare: true,
      maxActive: 5,
      cards: [
        {
          id: cardId,
          decisionId,
          state: 'ACTIVE',
          createdAt: '2026-11-04T10:00:00.000Z',
          expiresAt: '2026-11-10T10:00:00.000Z',
          opens: 4,
          lastOpenedAt: null,
        },
      ],
    });
    p = panelReducer(p, { type: 'choose', decisionId });
    p = panelReducer(p, { type: 'previewLoaded', preview });
    const html = render(
      ce(DecisionCardPanelView, { panel: p, decisions, handlers: {}, real: true }),
    );
    expect(html).toContain('Decision cards are available for sample workspaces only.');
    expect(html).not.toMatch(/<(button|input|dl|ul|a )\b/);
    expect(html).not.toMatch(/Preview|Create link|Withdraw|opens|decision-card#/);
  });
  it('a changed decision clears the preview so it must be previewed again', () => {
    let p = panelReducer(ready(), { type: 'choose', decisionId });
    p = panelReducer(p, { type: 'previewLoaded', preview });
    p = panelReducer(p, { type: 'acknowledge', value: true });
    p = panelReducer(p, { type: 'failed', status: 409, reason: 'CHANGED' });
    expect(p.notice).toBe('The decision changed since the preview. Preview again.');
    expect(p.preview).toBeNull();
    expect(p.acknowledged).toBe(false);
    expect(canCreate(p)).toBe(false);
  });
});

describe('after a link is made', () => {
  const created = {
    cardId,
    state: 'ACTIVE' as const,
    expiresAt: '2026-11-10T10:00:00.000Z',
    token: 'T'.repeat(43),
  };
  it('shows the link, the expiry with a time zone, the plain line, the count line and Withdraw', async () => {
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel');
    const p = panelReducer(ready(), { type: 'created', created, origin: 'https://corridra.test' });
    expect(cardLink('https://corridra.test', created.token)).toBe(
      'https://corridra.test/decision-card#' + created.token,
    );
    const html = render(ce(DecisionCardPanelView, { panel: p, decisions, handlers: {} }));
    expect(html).toContain('https://corridra.test/decision-card#' + created.token);
    expect(html).toContain(
      'Anyone with this link can see these six fields until it expires or you withdraw it',
    );
    expect(html).toContain('Counts page loads, including automatic link checks');
    expect(html).toMatch(/Copy link/);
    expect(html).toMatch(/Withdraw/);
    expect(html).toMatch(/UTC|GMT|\(.*UTC[+-]?\d*\)/);
    expect(countsWords(0)).toBe('0 opens. Counts page loads, including automatic link checks.');
    expect(countsWords(1)).toBe('1 open. Counts page loads, including automatic link checks.');
  });
  it('the link is dropped when the page is hidden, and never stored', () => {
    const p = panelReducer(ready(), { type: 'created', created, origin: 'https://corridra.test' });
    expect(p.link).toContain('/decision-card#');
    expect(panelReducer(p, { type: 'clearLink' }).link).toBeNull();
    const source = readFileSync('apps/web/app/account/missions/decision-card-panel.tsx', 'utf8');
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});

describe('D-08 withdraw', () => {
  const card = (state: 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED' | 'UNAVAILABLE') => ({
    id: cardId,
    decisionId,
    state,
    createdAt: '2026-11-04T10:00:00.000Z',
    expiresAt: '2026-11-10T10:00:00.000Z',
    opens: 2,
    lastOpenedAt: '2026-11-05T10:00:00.000Z',
  });
  it('is offered only for an active card, and only the creator’s own cards are ever listed', async () => {
    expect(withdrawable(card('ACTIVE'))).toBe(true);
    // An unavailable card (a source changed) still counts toward the cap of five until it expires, and the
    // creator may withdraw it, so it must be possible to free that slot.
    expect(withdrawable(card('UNAVAILABLE'))).toBe(true);
    for (const state of ['WITHDRAWN', 'EXPIRED'] as const)
      expect(withdrawable(card(state))).toBe(false);
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel');
    const p = panelReducer(initialPanel, {
      type: 'stateLoaded',
      canShare: true,
      maxActive: 5,
      cards: [
        card('ACTIVE'),
        { ...card('WITHDRAWN'), id: decisions[1]!.id },
        { ...card('UNAVAILABLE'), id: '55555555-5555-4555-8555-555555555555' },
        { ...card('EXPIRED'), id: '66666666-6666-4666-8666-666666666666' },
      ],
    });
    const html = render(ce(DecisionCardPanelView, { panel: p, decisions, handlers: {} }));
    expect(html.match(/>Withdraw</g)).toHaveLength(2);
    expect(html).toContain('2 opens');
  });
  it('a withdrawn card leaves the active list', () => {
    let p = panelReducer(initialPanel, {
      type: 'stateLoaded',
      canShare: true,
      maxActive: 5,
      cards: [card('ACTIVE')],
    });
    p = panelReducer(p, { type: 'withdrawn', cardId });
    expect(p.cards[0]!.state).toBe('WITHDRAWN');
    expect(withdrawable(p.cards[0]!)).toBe(false);
  });
});

describe('D-09 with the switch off nothing appears and the saved mission page is as before', () => {
  it('D-09 a sample report whose state answer is denied or failed shows no panel at all', async () => {
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel');
    const states = [
      panelReducer(initialPanel, { type: 'stateFailed' }),
      panelReducer(initialPanel, {
        type: 'stateLoaded',
        canShare: false,
        maxActive: 5,
        cards: [],
      }),
      initialPanel,
    ];
    for (const panel of states) {
      const html = render(ce(DecisionCardPanelView, { panel, decisions, handlers: {} }));
      expect(html).toBe('');
    }
    // The sample panel never says the real-workspace line, and the state read is the only way in.
    const source = readFileSync('apps/web/app/account/missions/decision-card-panel.tsx', 'utf8');
    expect(source).toMatch(/if \(!synthetic\) return;/);
    expect(source).toMatch(
      /\.catch\(\(\) => \{\s*if \(!task\.signal\.aborted\) dispatch\(\{ type: 'stateFailed' \}\);/,
    );
  });

  const read = (path: string) => readFileSync(path, 'utf8');
  it('mounts the panel only behind the switch, from the server page', () => {
    const page = read('apps/web/app/account/missions/[resourceId]/page.tsx');
    expect(page).toContain('customerDecisionCardsEnabled()');
    const history = read('apps/web/app/account/missions/decision-history.tsx');
    expect(history).toMatch(/cards\s*&&\s*data\.synthetic|cards && /);
    const report = read('apps/web/app/account/missions/saved-commercial-report.tsx');
    expect(report).toMatch(/decisionCards\??:\s*boolean/);
  });
  it('keeps every existing id, name and link of the saved mission page', () => {
    const report = read('apps/web/app/account/missions/saved-commercial-report.tsx');
    for (const needle of ['<DecisionHistory', '<BookDownloads', 'decisionsEnabled', 'books'])
      expect(report).toContain(needle);
    const history = read('apps/web/app/account/missions/decision-history.tsx');
    for (const needle of [
      'Load reviewed decisions',
      'Refresh reviewed decisions',
      'aria-label="Reviewed commercial decisions"',
      'Return to your account',
    ])
      expect(history).toContain(needle);
  });
});
