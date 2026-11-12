import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  companyDetailLine,
  customerScopeList,
  customerSearchWords,
  describeStatus,
  requestDetailLine,
  type CustomerScopeId,
  type SearchPhase,
} from '../../apps/web/lib/ux/customer-search-status';
import type { ScopeState } from '../../apps/web/lib/ux/customer-search-facts';
import { customerSearchPages } from '../../apps/web/lib/ux/customer-search-pages';
import { isTitleCase } from '../../apps/web/lib/ux/title-case';

// The words of the customer search (docs/revamp/specs/navigation-v1/customer-search.md, section 8), read from the pure
// modules that hold them. A customer screen says Request and Company, never Mission; there is no em dash; and no word
// claims what the search cannot promise. The component's own text and its Title Case buttons are read by the UI stage.
const modules = [
  'apps/web/lib/ux/customer-search-status.ts',
  'apps/web/lib/ux/customer-search-pages.ts',
  'apps/web/lib/ux/customer-search-facts.ts',
].map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const forbidden: [string, RegExp][] = [
  ['Mission', /\bmissions?\b/i],
  ['verified', /\bverif(?:ied|y|ication)\b/i],
  ['evidence', /\bevidence\b/i],
  ['enabled', /\benabled\b/i],
  ['live', /\blive\b/i],
  ['complete search', /\bcomplete search\b/i],
  ['total', /\btotals?\b/i],
  ['em dash', /—/],
  ['en dash', /–/],
];

describe('the words never say what the search cannot promise', () => {
  test('the modules carry no em dash and, outside addresses and comments, no forbidden word', () => {
    for (const { path, text } of modules) {
      expect(text, path).not.toMatch(/—/);
      const code = text
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n')
        // The report page address is /account/missions/<id>: an address, not a word on screen.
        .replaceAll('/account/missions/', '/account/reports/');
      for (const [name, pattern] of forbidden) expect(code, `${path} ${name}`).not.toMatch(pattern);
    }
  });
  test('every fixed word, every page and every state the status module can produce is clean', () => {
    const phases: SearchPhase[] = [
      'idle',
      'searching',
      'ok',
      'signedout',
      'denied',
      'closed',
      'unavailable',
      'failed',
    ];
    const states: ScopeState[] = ['ok', 'partial', 'unavailable', 'denied', 'archived'];
    const scopes: CustomerScopeId[] = ['all', 'requests', 'companies', 'pages'];
    const said: string[] = Object.values(customerSearchWords);
    for (const phase of phases)
      for (const scope of scopes)
        for (const requests of states)
          for (const companies of states)
            for (const count of [0, 2]) {
              const view = describeStatus({
                scope,
                text: 'spain',
                phase,
                count,
                offline: count === 0,
                scopes: { requests, companies },
              });
              said.push(
                view.summary,
                view.spoken,
                view.block?.heading ?? '',
                ...(view.block?.lines ?? []),
                ...view.notices.flatMap((notice) => [notice.lead ?? '', notice.text]),
              );
            }
    said.push(
      requestDetailLine('3 Nov 2026', { sent: 'x', withdrawn: true }),
      requestDetailLine('3 Nov 2026', { sent: 'x', status: 'ACTIVE' }),
      companyDetailLine('Spain', 2),
    );
    const pages = customerSearchPages({
      companies: true,
      move: true,
      billing: true,
      notificationSettings: true,
      organisationProfiles: true,
      problemReports: true,
      workspaces: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Acme' }],
    });
    for (const page of pages) said.push(page.label, page.detail);
    for (const sentence of said)
      for (const [name, pattern] of forbidden) expect(sentence, name).not.toMatch(pattern);
  });
  test('the dialog and trigger names are the ones in the specification', () => {
    expect(customerSearchWords.trigger).toBe('Search');
    expect(customerSearchWords.dialogName).toBe('Search Requests, Companies and pages');
    expect(customerSearchWords.placeholder).toBe('Search Requests and Companies');
    expect(customerSearchWords.footerHonesty).toBe('Only your own Requests and Companies');
  });
});

describe('buttons are in Title Case', () => {
  test('the trigger, the scope chips, Close, Retry and Sign In', () => {
    const buttons = [
      customerSearchWords.trigger,
      customerSearchWords.close,
      customerSearchWords.retry,
      customerSearchWords.signIn,
      ...customerScopeList.map((scope) => scope.label),
    ];
    for (const word of buttons) expect(isTitleCase(word), word).toBe(true);
  });
  test('every page label is as the menus write it (Title Case where the menus use it)', () => {
    const pages = customerSearchPages({
      companies: true,
      move: false,
      billing: true,
      notificationSettings: true,
      organisationProfiles: true,
      problemReports: true,
      workspaces: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Acme' }],
    });
    for (const page of pages) expect(isTitleCase(page.label), page.label).toBe(true);
  });
});
