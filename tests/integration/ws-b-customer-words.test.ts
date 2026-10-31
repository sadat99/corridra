import { describe, expect, it } from 'vitest';
import { groupFields, placeName, requestTitle } from '../../apps/web/app/account/request-words';
import { buildMoveModel, type MoveInput } from '../../apps/web/lib/move-cards';
import { customerRoad, customerStatusLabel } from '../../apps/web/lib/ux/customer-road';
import { mrLabelsFor } from '../../apps/web/components/mr/labels';
import { cleanReports } from '../../packages/auth/src/customer-delivered-reports';
import { translate } from '../../apps/web/lib/i18n/messages';
import { localeCodes, localeMeta } from '../../apps/web/lib/i18n/locales';
import { wsB, wsBEn } from '../../apps/web/lib/i18n/ws/ws-b';

// WS-B (commercial readiness program, 6.B): the customer words and the Your Move rules, without a
// browser or a database. Every name here is made up.
const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Atelier (madeup)',
  role: 'owner' as const,
};
const empty: MoveInput = {
  workspaces: [owner],
  drafts: [],
  quotes: [],
  companyLinks: [],
  requests: [],
};
const received = (status: string) => ({
  id: 'r1',
  workspaceId: owner.id,
  createdAt: '2026-10-02T00:00:00Z',
  progress: { status, receivedAt: '2026-10-02T09:00:00Z', replies: [] },
});

describe('D6: a sent request is never a draft', () => {
  it('labels a DRAFT or QUALIFICATION mission the customer sent as received, waiting for review', () => {
    expect(customerStatusLabel('DRAFT', true).label).toBe('Received, waiting for review');
    expect(customerStatusLabel('QUALIFICATION', true).label).toBe('Received, waiting for review');
    expect(customerStatusLabel('DRAFT', false).label).toBe('Draft');
    expect(customerRoad({ status: 'DRAFT', submitted: true }).status.label).toBe(
      'Received, waiting for review',
    );
  });
  it('the Road line for a DRAFT mission says received, in every language', () => {
    expect(mrLabelsFor('en').road.sublines.DRAFT).toBe('Received, waiting for review.');
    for (const locale of localeCodes)
      expect(mrLabelsFor(locale).road.sublines.DRAFT).not.toMatch(/draft/i);
  });
  it('CQ-21: Your Move lists a received request under waiting on the team, not "nothing is waiting"', () => {
    const model = buildMoveModel({ ...empty, requests: [received('DRAFT')] });
    expect(model.waiting).toHaveLength(1);
    expect(model.waiting[0]).toMatchObject({ holder: 'team', kind: 'request', status: 'DRAFT' });
    expect(model.cards).toHaveLength(0);
  });
  it('an unsent draft is a card for the person', () => {
    const model = buildMoveModel({
      ...empty,
      drafts: [
        {
          id: 'd1',
          workspaceId: owner.id,
          title: 'Knit fabric',
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ],
    });
    expect(model.cards[0]).toMatchObject({ kind: 'draft', holder: 'you' });
    expect(translate('en', 'wsb.move.draft.action')).toBe('Finish and send');
  });
});

describe('CQ-77: a published report reaches Your Move', () => {
  it('turns a delivered report into a Read card, newest first', () => {
    const model = buildMoveModel({
      ...empty,
      reports: [
        {
          id: 'a',
          title: 'Old (madeup)',
          requestId: 'r1',
          publishedAt: '2026-10-01T00:00:00Z',
          href: '/a',
        },
        {
          id: 'b',
          title: 'New (madeup)',
          requestId: 'r1',
          publishedAt: '2026-10-05T00:00:00Z',
          href: '/b',
        },
      ],
    });
    expect(model.cards.map((c) => [c.kind, c.verb, c.context])).toEqual([
      ['report', 'Read', 'New (madeup)'],
      ['report', 'Read', 'Old (madeup)'],
    ]);
  });
  it('keeps only well-formed reports with a same-site link', () => {
    const rows = cleanReports([
      {
        id: 'a',
        title: 'Fine (madeup)',
        requestId: 'r',
        publishedAt: '2026-10-01T00:00:00Z',
        href: '/x',
      },
      {
        id: 'b',
        title: 'Off site',
        requestId: 'r',
        publishedAt: '2026-10-01T00:00:00Z',
        href: 'https://evil.example',
      },
      {
        id: 'c',
        title: 'Protocol relative',
        requestId: 'r',
        publishedAt: '2026-10-01T00:00:00Z',
        href: '//evil.example',
      },
      { id: 'd', title: '', requestId: 'r', publishedAt: '2026-10-01T00:00:00Z', href: '/y' },
      { id: 'e', title: 'Bad date', requestId: 'r', publishedAt: 'soon', href: '/z' },
      null,
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a']);
    expect(cleanReports('not a list')).toEqual([]);
  });
});

describe('CQ-23 and CQ-24: plain request titles and grouped details', () => {
  it('titles a request by objective and market', () => {
    expect(requestTitle({ objective: 'Sell in a new market', market: 'Spain' })).toBe(
      'Sell in Spain',
    );
    expect(requestTitle({ objective: 'Source suppliers', market: 'CN' })).toBe(
      'Source suppliers in China',
    );
    expect(requestTitle({ objective: 'Something else', marketCode: 'AZ' })).toBe(
      'Request for Azerbaijan',
    );
    expect(requestTitle({ objective: 'Sell in a new market' })).toBe('Sell in a new market');
    expect(requestTitle(null)).toBeNull();
  });
  it('shows country names, never raw codes', () => {
    expect(placeName('AZ')).toBe('Azerbaijan');
    expect(placeName('Northern Spain')).toBe('Northern Spain');
    expect(placeName('OTHER')).toBe('Another market');
  });
  it('groups fields in order, hides internal fields, empty values and duplicates', () => {
    const groups = groupFields({
      schemaVersion: 2,
      acknowledged: true,
      email: 'buyer@example.com',
      objective: 'Sell in a new market',
      market: 'Spain',
      marketCode: 'ES',
      offer: 'Knitwear for retail chains',
      notes: '',
      deliveryWindow: 'Spring',
      name: 'Rahim (madeup)',
    });
    expect(groups.map((g) => g.title)).toEqual(['Goal', 'Where', 'Details', 'Contact']);
    expect(groups.flatMap((g) => g.keys)).toEqual([
      'objective',
      'market',
      'offer',
      'deliveryWindow',
      'name',
      'email',
    ]);
  });
});

describe('D16: every WS-B message exists in all seven languages', () => {
  it('has the same keys in every language and no empty text', () => {
    const keys = Object.keys(wsBEn).sort();
    for (const locale of Object.keys(wsB) as (keyof typeof wsB)[]) {
      expect(Object.keys(wsB[locale]).sort()).toEqual(keys);
      for (const key of keys) expect(wsB[locale][key as keyof typeof wsBEn].trim()).not.toBe('');
    }
    for (const value of Object.values(wsBEn)) expect(value).not.toMatch(/—/);
  });
});

describe('B-4: Arabic customer words read right to left', () => {
  it('marks Arabic right to left and draws the WS-B words in Arabic', () => {
    expect(localeMeta.ar.dir).toBe('rtl');
    expect(translate('ar', 'wsb.status.received')).toBe(wsB.ar['wsb.status.received']);
    expect(mrLabelsFor('ar').road.sublines.DRAFT).toBe(wsB.ar['wsb.status.received']);
  });
});
