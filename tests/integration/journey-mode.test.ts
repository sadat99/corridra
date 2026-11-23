import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  elsewhereCount,
  groupsShownInJourney,
  hrefForJourneySwitch,
  journeyCookieString,
  journeyModeCookie,
  journeyModeOfWork,
  journeyModes,
  journeyModeWords,
  journeyScopedHref,
  parseJourneyMode,
  resolveJourneyMode,
  shouldOfferSwitch,
  workFilterOfMode,
} from '../../apps/web/lib/ux/journey-mode';
import { customerTabs } from '../../apps/web/lib/ux/customer-navigation';
import { journeyModesOn, uxSwitchNames } from '../../apps/web/lib/ux-switches';

// Journey modes (docs/revamp/specs/journey-modes.md, owner approved 23 Nov 2026). The pure model: one cookie with a
// closed list of values, one resolution order, one function that says where a switch lands, and the sidebar's
// composition per mode. With the switch off nothing here is used and the sidebar model is exactly today's.
const web = (path: string) => readFileSync(`apps/web/${path}`, 'utf8');

describe('journey mode: the cookie value', () => {
  it('is one cookie with a closed list of four values', () => {
    expect(journeyModeCookie).toBe('corridra_journey');
    expect([...journeyModes]).toEqual(['all', 'source', 'organise', 'sell']);
    for (const mode of journeyModes) expect(parseJourneyMode(mode)).toBe(mode);
  });
  it('reads anything else as Everything', () => {
    for (const value of [
      undefined,
      null,
      '',
      ' ',
      'SOURCE',
      'source ',
      'other',
      'sourcing',
      ['source', 'sell'],
      ['source'],
      { toString: () => 'sell' },
      0,
      'source;Path=/',
      '<script>alert(1)</script>',
      '../../etc/passwd',
      'sell'.repeat(5000),
      '__proto__',
      'constructor',
    ])
      expect(parseJourneyMode(value)).toBe('all');
  });
  it('writes a preference cookie only: the path, a year, Lax, never HttpOnly, Secure on https', () => {
    expect(journeyCookieString('sell', true)).toBe(
      'corridra_journey=sell; Path=/account; Max-Age=31536000; SameSite=Lax; Secure',
    );
    expect(journeyCookieString('all', false)).toBe(
      'corridra_journey=all; Path=/account; Max-Age=31536000; SameSite=Lax',
    );
    expect(journeyCookieString('organise', true)).not.toMatch(/httponly/i);
  });
});

describe('journey mode: resolution order', () => {
  it('is the page, then the cookie, then Everything', () => {
    expect(resolveJourneyMode({ explicit: 'sell', cookie: 'source' })).toBe('sell');
    expect(resolveJourneyMode({ explicit: 'all', cookie: 'source' })).toBe('all');
    expect(resolveJourneyMode({ explicit: null, cookie: 'source' })).toBe('source');
    expect(resolveJourneyMode({ cookie: 'organise' })).toBe('organise');
    expect(resolveJourneyMode({ explicit: undefined, cookie: undefined })).toBe('all');
    expect(resolveJourneyMode({ cookie: 'nonsense' })).toBe('all');
    expect(resolveJourneyMode({})).toBe('all');
  });
  it('reads the Requests filter: a journey is that journey, Other and All are Everything, none is no opinion', () => {
    expect(journeyModeOfWork('source')).toBe('source');
    expect(journeyModeOfWork('sell')).toBe('sell');
    expect(journeyModeOfWork('organise')).toBe('organise');
    expect(journeyModeOfWork('other')).toBe('all');
    expect(journeyModeOfWork('all')).toBe('all');
    expect(journeyModeOfWork(undefined)).toBeNull();
    // A repeated or unknown word is what the Requests page already shows for it: All.
    expect(journeyModeOfWork(['source', 'sell'])).toBe('all');
    expect(journeyModeOfWork('nonsense')).toBe('all');
  });
  it('gives the Requests filter for a mode when the address names none', () => {
    expect(workFilterOfMode('all')).toBe('all');
    expect(workFilterOfMode('source')).toBe('source');
    expect(workFilterOfMode('organise')).toBe('organise');
    expect(workFilterOfMode('sell')).toBe('sell');
  });
});

describe('journey mode: where a switch lands', () => {
  it('Home goes to the journey on Home', () => {
    expect(hrefForJourneySwitch('/account/move', '', 'sell')).toBe('/account/move?journey=sell');
    expect(hrefForJourneySwitch('/account/move', '?journey=source', 'organise')).toBe(
      '/account/move?journey=organise',
    );
    expect(hrefForJourneySwitch('/account/move', '?journey=source', 'all')).toBe('/account/move');
    expect(hrefForJourneySwitch('/account/move', '?journey=source&x=1#top', 'all')).toBe(
      '/account/move?x=1#top',
    );
  });
  it('Requests keeps its other words and changes only the filter', () => {
    expect(hrefForJourneySwitch('/account', '?view=work', 'source')).toBe(
      '/account?view=work&work=source',
    );
    expect(hrefForJourneySwitch('/account', '?view=work&work=sell&tab=saved', 'organise')).toBe(
      '/account?view=work&work=organise&tab=saved',
    );
    expect(hrefForJourneySwitch('/account', '?view=work&work=other', 'all')).toBe(
      '/account?view=work',
    );
    expect(hrefForJourneySwitch('/account', '?view=work&work=sell#work-list', 'all')).toBe(
      '/account?view=work#work-list',
    );
  });
  it('every other page stays where it is (null: refresh in place)', () => {
    for (const [pathname, search] of [
      ['/account/meetings', ''],
      ['/account', '?view=results'],
      ['/account', '?view=results&tab=shared'],
      ['/account', '?view=more'],
      ['/account', ''],
      ['/account/companies', ''],
      ['/account/billing', ''],
      ['/account/all-tools', ''],
      ['/account/delegations', ''],
      ['/account/delegations/organise', ''],
      ['/account/rooms/00000000-0000-4000-8000-000000000001', '?tab=replies'],
      ['/account/move/elsewhere', ''],
    ] as const)
      for (const mode of journeyModes)
        expect(hrefForJourneySwitch(pathname, search, mode)).toBeNull();
  });
});

describe('journey mode: the prompt on a request page', () => {
  it('is offered only for a journey that differs from a classified family', () => {
    expect(shouldOfferSwitch('sell', 'SOURCE')).toBe('source');
    expect(shouldOfferSwitch('source', 'SELL')).toBe('sell');
    expect(shouldOfferSwitch('source', 'ORGANISE')).toBe('organise');
    for (const family of ['SOURCE', 'SELL', 'ORGANISE', 'UNCLASSIFIED'] as const)
      expect(shouldOfferSwitch('all', family)).toBeNull();
    expect(shouldOfferSwitch('source', 'SOURCE')).toBeNull();
    expect(shouldOfferSwitch('sell', 'SELL')).toBeNull();
    expect(shouldOfferSwitch('organise', 'ORGANISE')).toBeNull();
    for (const mode of journeyModes) expect(shouldOfferSwitch(mode, 'UNCLASSIFIED')).toBeNull();
    // Switch off: no mode, no prompt.
    expect(shouldOfferSwitch(null, 'SOURCE')).toBeNull();
  });

  it('says exactly "This request is in X." and "Switch to X", and never switches by itself', () => {
    const note = web('components/ux/journey-mismatch-note.tsx');
    expect(note).toContain("This {subject} is in {journey}.{' '}");
    expect(note).toMatch(/>\s*Switch to \{journey\}\s*<\/button>/);
    expect(note).toContain("subject = 'request'");
    expect(note).toContain("subject?: 'request' | 'programme'");
    expect(note).toContain('shouldOfferSwitch(useJourneyMode(), family)');
    expect(note).toContain('lang="en"');
    // A quiet line, not an alert, with no dismiss control; the cookie is written only by the press.
    expect(note).not.toMatch(/role="alert"|role="status"|useEffect|router\.push|dismiss/i);
    expect(note).toMatch(
      /onClick=\{\(\) => \{\s*rememberJourneyMode\(offer\);\s*router\.refresh\(\);/,
    );
    expect(journeyModeWords.source).toBe('Sourcing');
    expect(journeyModeWords.sell).toBe('Selling');
    expect(journeyModeWords.organise).toBe('Organising');
  });

  it('is on the Room, the saved request page and the programme room', () => {
    expect(web('app/account/rooms/[requestId]/room-view.tsx')).toContain(
      '<JourneyMismatchNote family={family} />',
    );
    expect(web('app/account/requests/request-detail.tsx')).toContain(
      '<JourneyMismatchNote family={classifyObjective(original?.objective)} />',
    );
    expect(web('app/account/delegations/[workspaceId]/page.tsx')).toContain(
      '<JourneyMismatchNote family="ORGANISE" subject="programme" />',
    );
  });
});

describe('journey mode: the sidebar per mode', () => {
  const today = customerTabs({ companies: true, move: true });
  it('with no journey the five destinations are exactly today’s', () => {
    expect(customerTabs({ companies: true, move: true, journey: undefined })).toEqual(today);
    expect(customerTabs({ companies: true, move: true, journey: 'all' })).toEqual(today);
    expect(today.map((tab) => tab.href)).toEqual([
      '/account/move',
      '/account?view=work',
      '/account/companies',
      '/account/meetings',
      '/account?view=results',
    ]);
  });
  it('in a journey Home and Requests open that journey, and the other three are unchanged', () => {
    for (const journey of ['source', 'organise', 'sell'] as const) {
      const tabs = customerTabs({ companies: true, move: true, journey });
      expect(tabs.map((tab) => tab.key)).toEqual(today.map((tab) => tab.key));
      expect(tabs.map((tab) => tab.href)).toEqual([
        `/account/move?journey=${journey}`,
        `/account?view=work&work=${journey}`,
        '/account/companies',
        '/account/meetings',
        '/account?view=results',
      ]);
      const rest = (list: typeof today) => list.map((tab) => ({ ...tab, href: '' }));
      expect(rest(tabs)).toEqual(rest(today));
    }
    expect(journeyScopedHref('home', 'all')).toBe('/account/move');
    expect(journeyScopedHref('requests', 'all')).toBe('/account?view=work');
  });
  it('Home stays the account page where Your Move is not Home', () => {
    expect(customerTabs({ companies: false, move: false, journey: 'sell' })[0]!.href).toBe(
      '/account',
    );
  });
  it('Groups are drawn in Everything and Organising, and on a Groups page in any mode', () => {
    expect(groupsShownInJourney('all', false)).toBe(true);
    expect(groupsShownInJourney('organise', false)).toBe(true);
    expect(groupsShownInJourney('source', false)).toBe(false);
    expect(groupsShownInJourney('sell', false)).toBe(false);
    expect(groupsShownInJourney('source', true)).toBe(true);
    expect(groupsShownInJourney('sell', true)).toBe(true);
  });
  it('names the four choices in English', () => {
    expect(journeyModeWords).toEqual({
      all: 'Everything',
      source: 'Sourcing',
      organise: 'Organising',
      sell: 'Selling',
    });
  });
});

describe('journey mode: the quiet count of work in other journeys (L16)', () => {
  const counts = {
    source: { n: 2, partial: false },
    organise: { n: 1, partial: false },
    sell: { n: 4, partial: false },
  };
  it('is the sum of the journeys that are not the current one', () => {
    expect(elsewhereCount(counts, 'source')).toEqual({ n: 5, partial: false });
    expect(elsewhereCount(counts, 'sell')).toEqual({ n: 3, partial: false });
    expect(elsewhereCount(counts, 'organise')).toEqual({ n: 6, partial: false });
  });
  it('is nothing in Everything, with no counts, and a zero is not drawn', () => {
    expect(elsewhereCount(counts, 'all')).toBeUndefined();
    expect(elsewhereCount(null, 'source')).toBeUndefined();
    expect(
      elsewhereCount(
        { ...counts, organise: { n: 0, partial: false }, sell: { n: 0, partial: false } },
        'source',
      ),
    ).toEqual({ n: 0, partial: false });
  });
  it('says "or more" when the list was not read in full', () => {
    expect(elsewhereCount({ ...counts, sell: { n: 4, partial: true } }, 'source')).toEqual({
      n: 5,
      partial: true,
    });
  });
});

describe('journey mode: the switch', () => {
  it('is named, off by default, and needs the shells and Your Move switches', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_UX_JOURNEY_MODES');
    const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
    expect(journeyModesOn(env({}))).toBe(false);
    expect(journeyModesOn(env({ CORRIDRA_UX_JOURNEY_MODES: 'true' }))).toBe(false);
    expect(
      journeyModesOn(env({ CORRIDRA_UX_JOURNEY_MODES: 'true', CORRIDRA_UX_SHELLS_V2: 'true' })),
    ).toBe(false);
    expect(
      journeyModesOn(
        env({
          CORRIDRA_UX_JOURNEY_MODES: 'true',
          CORRIDRA_UX_SHELLS_V2: 'true',
          CORRIDRA_UX_MOVE: 'true',
        }),
      ),
    ).toBe(true);
    expect(
      journeyModesOn(
        env({
          CORRIDRA_UX_JOURNEY_MODES: '1',
          CORRIDRA_UX_SHELLS_V2: 'true',
          CORRIDRA_UX_MOVE: 'true',
        }),
      ),
    ).toBe(false);
  });
});

describe('journey mode: source and structure', () => {
  it('the pure model imports nothing from the server', () => {
    const source = web('lib/ux/journey-mode.ts');
    expect(source).not.toMatch(/from 'next\//);
    expect(source).not.toMatch(/server-only|@corridra\/auth|customer-page-session/);
    expect(source).not.toMatch(/document\.|window\./);
  });
  it('the cookie is read on the server in one place, and awaited', () => {
    const source = web('lib/ux/journey-mode-server.ts');
    expect(source).toMatch(/await cookies\(\)/);
    expect(source).toMatch(/parseJourneyMode/);
    // No server write: the cookie is written by the browser only.
    expect(source).not.toMatch(/\.set\(/);
  });
  it('the shell keeps today’s frame when the switch is off', () => {
    const source = web('components/customer-shell.tsx');
    expect(source).toMatch(/journeyModesOn\(\)/);
    // The frame itself stays a plain function: the cookie is read by a small async parent only when the switch is on.
    expect(source).toMatch(/\nfunction CustomerFrame\(/);
    expect(source).not.toMatch(/async function CustomerFrame\(/);
    expect(source).toMatch(/customerJourneyLinks\(move\)/);
  });
  it('the switcher is an inline disclosure, named Journey, never workspace or module', () => {
    const source = web('components/ux/journey-switch.tsx');
    expect(source).toMatch(/<details/);
    expect(source).toMatch(/<summary/);
    expect(source).toMatch(/className="ux-journey-switch"/);
    expect(source).toMatch(/aria-current=\{[^}]*'true'/);
    expect(source).not.toMatch(/workspace|module/i);
    expect(source).not.toMatch(/role="menu"|popover/i);
    // L16: the quiet badge and its spoken words, a zero not drawn (journeyCountText gives '' for zero).
    expect(source).toMatch(/journeyCountText/);
    expect(source).toMatch(/journeyCountWords/);
    expect(source).toMatch(/in other journeys/);
    expect(source).toMatch(/className="sr-only"/);
  });
  it('the new stylesheets use tokens only: no raw colour, no px, no text-transform', () => {
    for (const file of ['components/ux/journey-switch.css', 'components/ux/journey-note.css']) {
      if (!existsSync(`apps/web/${file}`)) continue;
      const css = web(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/i);
      expect(css).not.toMatch(/\d+px\b/);
      expect(css).not.toMatch(/text-transform/);
      expect(css).not.toMatch(/transition|animation/);
    }
    expect(existsSync('apps/web/components/ux/journey-switch.css')).toBe(true);
  });
  it('the sidebar draws the switcher instead of Your Journeys only when it is given a mode', () => {
    const source = web('components/ux/customer-rail.tsx');
    expect(source).toMatch(/journeyMode \?/);
    expect(source).toMatch(/groupsShownInJourney/);
    // The switch-off group is untouched.
    expect(source).toMatch(/label="Your Journeys"/);
  });
  it('Home and the Requests chips write the same cookie the sidebar reads', () => {
    expect(web('app/account/move/move-view.tsx')).toMatch(/rememberJourneyMode/);
    expect(web('app/account/work-filter.tsx')).toMatch(/rememberJourneyMode/);
    expect(web('components/ux/journey-switch.tsx')).toMatch(/rememberJourneyMode/);
    // One writer, in one file.
    const writers = [
      'app/account/move/move-view.tsx',
      'app/account/work-filter.tsx',
      'components/ux/journey-switch.tsx',
      'components/ux/journey-note.tsx',
    ].filter((file) => /document\.cookie/.test(web(file)));
    expect(writers).toEqual([]);
    expect(web('components/ux/journey-mode-context.tsx')).toMatch(/document\.cookie = /);
  });
  it('the quiet lines say what the owner approved', () => {
    const source = web('components/ux/journey-note.tsx');
    expect(source).toMatch(/Showing \{journeyModeWords\[mode\]\}\./);
    expect(source).toMatch(/Show Everything/);
    expect(source).toMatch(/Companies are shared across all your journeys\./);
    expect(source).not.toMatch(/role="alert"/);
  });
});
