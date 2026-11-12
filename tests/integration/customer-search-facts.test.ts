import { describe, expect, test } from 'vitest';
import {
  cutText,
  factFor,
  foundHitLimit,
  parseFound,
  reportHref,
  requestHref,
  textLimit,
} from '../../apps/web/lib/ux/customer-search-facts';
import { highlightSegments, queryWords, rankFields } from '../../apps/web/lib/palette-rank';

// The check of a customer search answer on the client (docs/revamp/specs/navigation-v1/customer-search.md, section 3):
// only the addresses and shapes the server can send are accepted, long words are cut without splitting a character,
// and a marked word is always text, never markup.
const requestId = '0b5a0001-0000-4000-8000-000000000001';
const reportId = '0c5a0001-0000-4000-8000-000000000002';
const companyId = 'ab'.repeat(32);
const requestHit = (over: Record<string, unknown> = {}) => ({
  id: requestId,
  label: 'Sell in Spain',
  detail: '',
  href: requestHref(requestId),
  kind: 'request',
  ...over,
});
const companyHit = (over: Record<string, unknown> = {}) => ({
  id: companyId,
  label: 'Acme SL',
  detail: 'Spain',
  href: reportHref(reportId),
  kind: 'company',
  ...over,
});
const answer = (over: Record<string, unknown> = {}) => ({
  hits: [requestHit(), companyHit()],
  scopes: { requests: 'ok', companies: 'partial' },
  facts: {
    [`request:${requestId}`]: { sent: '2026-11-03T09:00:00.000Z', status: 'DEFINE', close: true },
    [`company:${companyId}`]: { reports: 2 },
  },
  ...over,
});

describe('parseFound', () => {
  test('reads a full answer: hits, scope states and facts by kind and id', () => {
    const found = parseFound(answer())!;
    expect(found.hits.map((hit) => hit.kind)).toEqual(['request', 'company']);
    expect(found.scopes).toEqual({ requests: 'ok', companies: 'partial' });
    expect(factFor(found, found.hits[0]!)).toEqual({
      sent: '2026-11-03T09:00:00.000Z',
      status: 'DEFINE',
      close: true,
    });
    expect(factFor(found, found.hits[1]!)).toEqual({ reports: 2 });
    expect(factFor(null, found.hits[0]!)).toBeUndefined();
  });
  test('an answer that is not an answer is null', () => {
    for (const value of [null, 'x', [], {}, { hits: [] }, { hits: {}, scopes: {} }, { scopes: {} }])
      expect(parseFound(value)).toBeNull();
    expect(parseFound({ hits: [], scopes: {} })).toEqual({ hits: [], scopes: {}, facts: {} });
  });
  test('a wrong address or id is dropped, not shown', () => {
    const bad = [
      requestHit({ href: '/account/missions/' + requestId }),
      requestHit({ href: 'https://evil.example.invalid/account/requests/' + requestId }),
      requestHit({ href: '/account/requests/' + requestId + '?x=1' }),
      requestHit({ href: '/account/requests/' + reportId }),
      requestHit({ href: '//evil.example.invalid/' }),
      requestHit({ id: 'not-an-id', href: '/account/requests/not-an-id' }),
      companyHit({ id: 'short' }),
      companyHit({ href: '/account/requests/' + reportId }),
      companyHit({ href: '/account/missions/not-a-uuid' }),
      requestHit({ kind: 'mission' }),
      requestHit({ kind: undefined }),
      { id: requestId },
      'text',
      null,
    ];
    expect(parseFound(answer({ hits: bad }))!.hits).toEqual([]);
  });
  test('the address allow-list is exact for a Request and a Company', () => {
    const found = parseFound(answer())!;
    expect(found.hits.map((hit) => hit.href)).toEqual([
      `/account/requests/${requestId}`,
      `/account/missions/${reportId}`,
    ]);
  });
  test('at most ten hits of each kind are read, and a repeat is read once', () => {
    const many = Array.from({ length: 30 }, (_, n) => {
      const id = `0b5a0001-0000-4000-8000-${String(n).padStart(12, '0')}`;
      return requestHit({ id, href: requestHref(id) });
    });
    const found = parseFound(answer({ hits: [...many, ...many, companyHit(), companyHit()] }))!;
    expect(foundHitLimit).toBe(10);
    expect(found.hits.filter((hit) => hit.kind === 'request')).toHaveLength(10);
    expect(found.hits.filter((hit) => hit.kind === 'company')).toHaveLength(1);
  });
  test('an id in capitals matches its facts', () => {
    const upper = requestId.toUpperCase();
    const found = parseFound(
      answer({
        hits: [requestHit({ id: upper, href: requestHref(upper) })],
        facts: { [`request:${upper}`]: { sent: '2026-11-03T09:00:00.000Z' } },
      }),
    )!;
    expect(factFor(found, found.hits[0]!)).toEqual({ sent: '2026-11-03T09:00:00.000Z' });
  });
  test('unknown scope names and states are ignored', () => {
    const found = parseFound(
      answer({ scopes: { requests: 'bogus', pages: 'ok', companies: 'denied' } }),
    )!;
    expect(found.scopes).toEqual({ companies: 'denied' });
  });
  test('facts are checked by kind: a Request needs a date, a Company a small count', () => {
    const found = parseFound(
      answer({
        hits: [requestHit(), companyHit()],
        facts: {
          [`request:${requestId}`]: { sent: 'yesterday-ish', status: 'DEFINE' },
          [`company:${companyId}`]: { reports: 100000 },
        },
      }),
    )!;
    expect(found.facts).toEqual({});
    const other = parseFound(
      answer({
        facts: {
          [`request:${requestId}`]: { sent: '2026-11-03', status: 'lowercase', withdrawn: 'yes' },
          [`company:${companyId}`]: { reports: 1.5 },
        },
      }),
    )!;
    expect(other.facts[`request:${requestId}`]).toEqual({ sent: '2026-11-03' });
    expect(other.facts[`company:${companyId}`]).toBeUndefined();
  });
  test('a hit from sample data keeps sample: true; anything else is not sample', () => {
    const found = parseFound(
      answer({
        hits: [requestHit({ sample: true }), companyHit({ sample: 'yes' })],
        facts: {},
      }),
    )!;
    expect(found.hits[0]!.sample).toBe(true);
    expect(found.hits[1]).not.toHaveProperty('sample');
    expect(parseFound(answer({ scopes: { requests: 'limited' } }))!.scopes).toEqual({
      requests: 'limited',
    });
  });
  test('a withdrawn Request keeps its flag', () => {
    const found = parseFound(
      answer({ facts: { [`request:${requestId}`]: { sent: '2026-11-03', withdrawn: true } } }),
    )!;
    expect(factFor(found, found.hits[0]!)).toEqual({ sent: '2026-11-03', withdrawn: true });
  });
  test('a fact for a hit that is not listed is not kept', () => {
    const found = parseFound(
      answer({ hits: [], facts: { [`request:${requestId}`]: { sent: '2026-11-03' } } }),
    )!;
    expect(found.facts).toEqual({});
  });
});

describe('long and awkward words', () => {
  test('a label is cut to 200 units and a pair is not split', () => {
    expect(cutText('a'.repeat(200))).toHaveLength(200);
    expect(cutText('a'.repeat(300))).toHaveLength(textLimit);
    const pair = '\u{1F600}';
    const cut = cutText('a'.repeat(199) + pair + 'tail');
    expect(cut).toBe('a'.repeat(199));
    expect([...cutText(pair.repeat(150))].every((char) => char === pair)).toBe(true);
    const found = parseFound(
      answer({ hits: [requestHit({ label: 'b'.repeat(500), detail: 'c'.repeat(500) })] }),
    )!;
    expect(found.hits[0]!.label).toHaveLength(200);
    expect(found.hits[0]!.detail).toHaveLength(200);
  });
  test('KI-56: Bengali vowel signs stay, are ranked and are marked with their letter', () => {
    const label = 'ঢাকা Traders';
    expect(queryWords('ঢাকা')).toEqual(['ঢাকা']);
    expect(rankFields(queryWords('ঢাকা'), [{ value: label, label: true }])).not.toBeNull();
    expect(rankFields(queryWords('ঢুকি'), [{ value: label, label: true }])).toBeNull();
    const marked = highlightSegments(label, 'কা');
    expect(marked.filter((piece) => piece.hit)).toEqual([{ text: 'কা', hit: true }]);
    expect(marked.map((piece) => piece.text).join('')).toBe(label);
    const found = parseFound(answer({ hits: [requestHit({ label })] }))!;
    expect(found.hits[0]!.label).toBe(label);
  });
  test('markup in a label stays text: it is kept whole and the marked pieces rejoin it', () => {
    const label = '<img src=x onerror=alert(1)> Spain';
    const found = parseFound(answer({ hits: [requestHit({ label })] }))!;
    expect(found.hits[0]!.label).toBe(label);
    const pieces = highlightSegments(found.hits[0]!.label, 'spain');
    expect(pieces.map((piece) => piece.text).join('')).toBe(label);
    expect(pieces.filter((piece) => piece.hit).map((piece) => piece.text)).toEqual(['Spain']);
  });
});
