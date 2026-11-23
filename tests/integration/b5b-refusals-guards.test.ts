import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgendaItem, MissionExperience } from '../../packages/delivery/src/report';

// Unit B5b of the commercial-ready run. D-053: a private link that no longer opens says one thing on every
// private page, the line the client and programme pages already say. D-058: a status, state, fit or label that
// did not arrive shows plain words in its place; it never stops the page with a TypeError.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const read = (path: string) => readFileSync(resolve(path), 'utf8');

const gone =
  'This private link has expired or was replaced. Ask the person who sent it for a new link.';
/** What an approved report can hold when it was stored before a field existed: the field is simply not there. */
const missing = undefined as unknown as string;

describe('D-053: one refusal line for a private link that no longer opens', () => {
  const delivery = read('apps/web/app/delivery-view.tsx');
  const buyer = read('apps/web/app/buyer/introduction.tsx');

  it('the client and programme view keeps the shared line under its exported name', () => {
    expect(delivery.replace(/\s+/g, ' ')).toContain(`export const linkGone = '${gone}';`);
  });

  it('the buyer page says the shared line and holds no second wording of its own', () => {
    expect(buyer).toMatch(/import \{ linkGone \} from '\.\.\/delivery-view';/);
    expect(buyer).not.toContain('This private link is unavailable');
    expect(buyer).not.toContain('Request a new reviewed link');
    expect(buyer).not.toContain('Open the complete link you received');
    // Each buyer refusal goes through the one place that picks the words.
    expect(buyer.match(/setMessage\(gone\)/g) ?? []).toHaveLength(3);
  });

  it('a refused read or answer on the buyer page says the shared line, not the words of the server', async () => {
    const { refusalWords } = await loadWeb('app/buyer/introduction.tsx');
    const { ParticipantRequestError } = await loadWeb('components/private-capability.ts');
    for (const status of [401, 403, 404, 410])
      expect(
        refusalWords(
          new ParticipantRequestError('This private link is unavailable or expired', status),
          gone,
          'Your response could not be saved. Try again.',
        ),
      ).toBe(gone);
    // Anything else keeps the reason the server gave, and a failure with no reason says what to do next.
    expect(
      refusalWords(
        new ParticipantRequestError('A response was already recorded for this link.', 409),
        gone,
        'Your response could not be saved. Try again.',
      ),
    ).toBe('A response was already recorded for this link.');
    expect(refusalWords('offline', gone, 'Your response could not be saved. Try again.')).toBe(
      'Your response could not be saved. Try again.',
    );
    expect(refusalWords(new Error(''), gone, 'Your response could not be saved. Try again.')).toBe(
      'Your response could not be saved. Try again.',
    );
  });
});

describe('D-058: a missing status, state, fit or label never throws', () => {
  it('lowerWords gives the plain fallback for a value that did not arrive', async () => {
    const { lowerWords } = await loadWeb('app/mission-experience-view.tsx');
    expect(lowerWords('IN_PROGRESS', 'status not supplied')).toBe('in_progress');
    for (const value of [undefined, null, '', 7])
      expect(lowerWords(value, 'status not supplied')).toBe('status not supplied');
  });

  it('an agenda item with no state and a meeting with no status still renders', async () => {
    const { AgendaView } = await loadWeb('app/mission-experience-view.tsx');
    const agenda: AgendaItem[] = [
      {
        id: 'a1',
        itemId: 'i1',
        version: 1,
        label: 'Factory visit',
        state: missing,
        nextAction: 'Confirm the time',
        dueAt: '2026-12-01T00:00:00Z',
        responsibility: 'Corridra team',
        meetings: [{ id: 'm1', status: missing, scheduleChanged: false }],
      },
    ];
    const html = render(ce(AgendaView, { agenda }));
    expect(html).toContain('<strong>Factory visit</strong> · status not supplied');
    expect(html).toContain('status not supplied: No confirmed appointment time supplied.');
    expect(html).not.toContain('undefined');
  });

  it('a shortlist company with no fit still renders', async () => {
    const { MissionExperienceView } = await loadWeb('app/mission-experience-view.tsx');
    const experience: MissionExperience = {
      schemaVersion: 1,
      requirements: null,
      shortlist: [
        {
          id: 't1',
          company: 'Example Mills',
          country: 'Bangladesh',
          fit: missing,
          rationale: 'Makes the yarn count asked for',
          uncertainty: 'Capacity not confirmed',
          gaps: 'No audit report',
          verification: 'Operator-reported',
        },
      ],
      quotations: [],
      agenda: [],
      documentAccess: 'None',
    };
    const html = render(ce(MissionExperienceView, { experience }));
    expect(html).toContain('fit not supplied · Makes the yarn count asked for');
    // A stored fit keeps its lower-case words.
    experience.shortlist[0]!.fit = 'STRONG';
    expect(render(ce(MissionExperienceView, { experience }))).toContain(
      'strong · Makes the yarn count asked for',
    );
  });

  it('a kind of muted email this page has no words for is still named', async () => {
    const { kindWord } = await loadWeb('app/account/notifications/muted-requests.tsx');
    expect(kindWord('request')).toBe('Receipt email');
    expect(kindWord('reminder')).toBe('Reminder emails');
    expect(kindWord('digest')).toBe('Emails');
    expect(kindWord(undefined)).toBe('Emails');
  });

  it('a help request for a kind this page has no words for is still named', async () => {
    const { contextWord } = await loadWeb('app/account/service-requests/service-request-new.tsx');
    expect(contextWord('programme')).toBe('delegation programme');
    expect(contextWord('visit')).toBe('request');
    expect(contextWord(undefined)).toBe('request');
  });

  it('no call site in the unit lowercases a value that can be missing', () => {
    const bare: [string, RegExp][] = [
      ['apps/web/app/delivery-view.tsx', /\b(mt|r)\.status\.toLowerCase\(/],
      [
        'apps/web/app/mission-experience-view.tsx',
        /\b(a\.state|m\.status|t\.fit)\b[^\n]*toLowerCase\(/,
      ],
      ['apps/web/app/account/companies/company-portfolio.tsx', /context\.fit\.toLowerCase\(/],
      ['apps/web/app/account/notifications/muted-requests.tsx', /\]\.toLowerCase\(/],
      ['apps/web/app/account/service-requests/service-request-new.tsx', /\]\.toLowerCase\(/],
    ];
    for (const [path, pattern] of bare) expect(read(path), path).not.toMatch(pattern);
  });
});
