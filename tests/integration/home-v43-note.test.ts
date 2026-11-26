import { describe, expect, it } from 'vitest';
import { composeNote, helpHref, requestHref, routeText } from '../../apps/web/lib/home-v43-note';
import {
  homeV43Reducer as reduce,
  initialState,
  type HomeV43Event,
  type HomeV43State,
} from '../../apps/web/lib/home-v43-state';
import { en } from '../../apps/web/lib/i18n/messages';
import type { MessageKey } from '../../apps/web/lib/i18n/messages';

// Home page v4.3: the address the request opens. The notes are the visitor's own answers (route, what they need,
// timing) in the words of the home's request, cut at 1000 whole characters by `briefHref`; the company base and the
// target travel only as a valid pair, and no other parameter carries any text.
const say = (key: MessageKey) => en[key];
const run = (events: HomeV43Event[], from: HomeV43State = initialState) =>
  events.reduce(reduce, from);
const query = (href: string) => new URL(href, 'http://x').searchParams;

describe('the request address', () => {
  it('opens the sourcing job with the route in the notes and the pair Bangladesh to China', () => {
    const href = requestHref(say, initialState);
    expect(href.startsWith('/plan?')).toBe(true);
    const q = query(href);
    expect(q.get('job')).toBe('sourcing');
    expect(q.get('companyCountry')).toBe('BD');
    expect(q.get('marketCode')).toBe('CN');
    expect(q.get('note')).toBe(`Route: ${en['home.b3.br.route.china']}`);
    expect([...q.keys()].sort()).toEqual(['companyCountry', 'job', 'marketCode', 'note']);
  });

  it('carries what the visitor typed and the timing, and names the market for a sell goal', () => {
    const state = run([
      { type: 'door', route: 'sell' },
      { type: 'brief', field: 'need', value: 'Knitwear for retail buyers' },
      { type: 'brief', field: 'timing', value: 2 },
    ]);
    const q = query(requestHref(say, state));
    expect(q.get('job')).toBe('buyers');
    expect(q.get('marketCode')).toBe('EU');
    expect(q.get('note')).toBe(
      [
        `Route: Bangladesh to ${en['home.b3.mkto.eu']}`,
        'What I need: Knitwear for retail buyers',
        `Timing: ${en['home.b3.br.when.2']}`,
      ].join('\n'),
    );
  });

  it('leaves the pair out for Other and Key Asian Markets, and never sends a job for another need', () => {
    const other = run([{ type: 'door', route: 'other' }]);
    const q = query(requestHref(say, other));
    expect(q.has('job')).toBe(false);
    expect(q.has('companyCountry')).toBe(false);
    expect(q.has('marketCode')).toBe(false);
    const asia = run([
      { type: 'door', route: 'sell' },
      { type: 'brief', field: 'target', value: 'REGION' },
    ]);
    const a = query(requestHref(say, asia));
    expect(a.get('job')).toBe('buyers');
    expect(a.has('marketCode')).toBe(false);
    expect(a.get('note')).toContain(en['home.b3.mkto.asia']);
  });

  it('cuts the notes at 1000 whole characters', () => {
    const long = { ...initialState, need: '😀'.repeat(300) };
    const note = query(requestHref(say, long)).get('note')!;
    expect(note.length).toBeLessThanOrEqual(1000);
    expect(note.endsWith('😀')).toBe(true);
    expect(composeNote(say, long).length).toBeGreaterThan(note.length - 1);
  });

  it('puts the help path in no job and no pair, the words only', () => {
    const q = query(helpHref(say, run([{ type: 'door', route: 'sell' }])));
    expect([...q.keys()]).toEqual(['note']);
    expect(q.get('note')).toBe(`Route: ${en['home.b3.br.route.other']}`);
    expect(routeText(say, { goal: 'delegation', target: 'CN' })).toBe(
      en['home.b3.br.route.delegation'],
    );
  });
});
