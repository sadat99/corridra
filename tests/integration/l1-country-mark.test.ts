import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MissionExperience } from '../../packages/delivery/src/report';
import { flagCodes, placeMark } from '../../apps/web/components/ux/flag';

// UI/UX.v4.1 L1 (owner lock, 23 November 2026): a place name that stands as a label has its mark before it, by the
// existing flag policy. This file holds the country mark on the buyer pages (/buyer) and in the shared report body
// that /client and /programme draw. The name is always written; a place outside the nine flags shows its name only.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

/** The flag picture as `Flag` draws it at 22 px in a line of text, decorative because the name follows it. */
const flag = (code: string) =>
  `<span class="ux-flagged"><img class="ux-flag" src="/flags/${code}.svg" width="22" height="15" alt="" aria-hidden="true" data-flag="${code}" decoding="async"/>`;

describe('the mark for a stored place', () => {
  it('still reads the codes the forms hold', () => {
    expect(placeMark('BD')).toBe('bd');
    expect(placeMark('eu')).toBe('eu');
    expect(placeMark('JP')).toBeNull();
    expect(placeMark('OTHER')).toBeNull();
    expect(placeMark(null)).toBeNull();
    expect(placeMark(undefined)).toBeNull();
    expect(placeMark('')).toBeNull();
  });
  it('reads the written English name of each of the nine, and nothing else', () => {
    const names: Record<(typeof flagCodes)[number], string> = {
      bd: 'Bangladesh',
      cn: 'China',
      eu: 'European Union',
      gb: 'United Kingdom',
      us: 'United States',
      au: 'Australia',
      es: 'Spain',
      fr: 'France',
      it: 'Italy',
    };
    for (const code of flagCodes) expect(placeMark(names[code])).toBe(code);
    expect(placeMark('  spain ')).toBe('es');
    expect(placeMark('BANGLADESH')).toBe('bd');
    // Never a guess: a longer phrase, a region, a place outside the nine and an object key all show the name only.
    for (const other of [
      'Japan',
      'Key Asian Markets',
      'South China',
      'Spain and France',
      'constructor',
      '__proto__',
      'toString',
    ])
      expect(placeMark(other)).toBeNull();
  });
});

describe('the buyer pages', () => {
  const introduction = {
    company: 'Example Trims Limited',
    country: 'Bangladesh',
    capability: 'Plain trims',
    fit: 'Spring line',
    uncertainty: 'None stated',
    conversationPurpose: 'Introduction',
  };
  const draw = async (
    country: string,
    more: { steps?: boolean; language?: 'en' | 'zh' } = {},
  ): Promise<string> => {
    const { ReplyJourney } = (await loadWeb('app/buyer/reply-journey')) as {
      ReplyJourney: unknown;
    };
    return render(
      ce(ReplyJourney, {
        data: {
          introduction: { ...introduction, country },
          template: 'An introduction from the team.',
          expiresAt: '2026-12-17T09:00:00.000Z',
          decision: null,
          synthetic: true,
        },
        pending: null,
        declined: false,
        token: 'a'.repeat(64),
        language: more.language ?? 'en',
        beforeSend: false,
        ask: [],
        busy: false,
        optOut: false,
        onOptOut: () => {},
        onRespond: () => {},
        onStop: () => {},
        onAccessDenied: () => {},
        steps: more.steps ?? false,
      }),
    );
  };
  for (const steps of [false, true])
    for (const language of ['en', 'zh'] as const)
      it(`the Reply Page Country row has its flag before the name (steps ${steps ? 'on' : 'off'}, ${language})`, async () => {
        const html = await draw('Bangladesh', { steps, language });
        expect(html).toContain(`<dt>Country</dt><dd>${flag('bd')}<span>Bangladesh</span></span></dd>`);
        expect(html.match(/data-flag=/g)).toHaveLength(1);
      });
  it('reads a stored country code the same way and still writes what is stored', async () => {
    const html = await draw('ES');
    expect(html).toContain(`<dt>Country</dt><dd>${flag('es')}<span>ES</span></span></dd>`);
  });
  it('a country outside the nine flags shows its name only, never a wrong flag', async () => {
    for (const steps of [false, true]) {
      const html = await draw('Japan', { steps });
      expect(html).toContain(
        '<dt>Country</dt><dd><span class="ux-flagged"><span>Japan</span></span></dd>',
      );
      expect(html).not.toContain('data-flag');
      expect(html).not.toContain('ux-region-mark');
    }
  });
  it('the mark sits only on the Country row; the other facts are written as before', async () => {
    const html = await draw('Bangladesh');
    expect(html).toContain('<dt>Company</dt><dd>Example Trims Limited</dd>');
    expect(html).toContain('<dt>Purpose of conversation</dt><dd>Introduction</dd>');
  });
  it('the earlier introduction page marks its Country row with the shared component', () => {
    const page = read('apps/web/app/buyer/introduction.tsx');
    expect(page).toContain("from '../../components/ux/flag'");
    expect(page).toMatch(
      /label === 'Country' \? \(\s*<Flagged code=\{placeMark\(value\)\}>\{value\}<\/Flagged>/,
    );
  });
  it('no buyer file draws a flag of its own', () => {
    for (const file of ['introduction.tsx', 'reply-journey.tsx']) {
      const source = read(`apps/web/app/buyer/${file}`);
      expect(source).not.toContain('/flags/');
      expect(source).not.toContain('<img');
    }
  });
});

describe('the shared report body of /client and /programme', () => {
  const experience = (country: string, company = 'Zhejiang Jingwei'): MissionExperience => ({
    schemaVersion: 1,
    requirements: {
      version: 1,
      fields: { objective: 'Source', role: 'BUYER', product: 'Spinning frames' },
      sourceKind: 'customer',
      claimStatus: 'self_declared',
      current: true,
    },
    shortlist: [
      {
        id: 't1',
        company,
        country,
        fit: 'HIGH',
        rationale: 'Fits',
        uncertainty: 'None',
        gaps: 'None',
        verification: 'Self-declared',
      },
    ],
    quotations: [],
    agenda: [],
    documentAccess: 'None',
  });
  const draw = async (e: MissionExperience): Promise<string> => {
    const { MissionExperienceView } = await loadWeb('app/mission-experience-view');
    return render(ce(MissionExperienceView, { experience: e }));
  };
  const words = (html: string) => html.replace(/<[^>]+>/g, '');

  it('a shortlist country has its flag before the name, inside the same heading', async () => {
    const html = await draw(experience('China'));
    expect(html).toContain(
      `<h4><span lang="zh">Zhejiang Jingwei</span> (${flag('cn')}<span>China</span></span>)</h4>`.replace(
        '<span lang="zh">',
        '<span>',
      ),
    );
    expect(html.match(/data-flag=/g)).toHaveLength(1);
  });
  it('the words of the heading do not change', async () => {
    expect(words(await draw(experience('China')))).toContain('Zhejiang Jingwei (China)');
    expect(words(await draw(experience('BD', '达卡纺织')))).toContain('达卡纺织 (BD)');
  });
  it('a stored code is read the same way and a company name in Chinese keeps its language', async () => {
    const html = await draw(experience('BD', '达卡纺织'));
    expect(html).toContain(
      `<h4><span lang="zh">达卡纺织</span> (${flag('bd')}<span>BD</span></span>)</h4>`,
    );
  });
  it('a country outside the nine flags shows its name only', async () => {
    const html = await draw(experience('Viet Nam'));
    expect(html).toContain(
      '<h4><span>Zhejiang Jingwei</span> (<span class="ux-flagged"><span>Viet Nam</span></span>)</h4>',
    );
    expect(html).not.toContain('data-flag');
  });
  it('the report body uses the shared component and draws no flag of its own', () => {
    const view = read('apps/web/app/mission-experience-view.tsx');
    expect(view).toContain("from '../components/ux/flag'");
    expect(view).not.toContain('/flags/');
  });
});
