import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  anchorRoute,
  anchorRoutes,
  hashId,
  buyerRows,
  deliveryCodes,
  ledgerAmounts,
  offerAmounts,
  explorerMarkets,
  faqIds,
  intentKeys,
  marketLine,
  offerIds,
  phaseIds,
  placeName,
  questionIds,
  roleIds,
  routeRecord,
  stageIds,
  v43,
} from '../../apps/web/lib/home-v43-data';
import { faqRow, solutionRows } from '../../apps/web/lib/home-v43-nav';
import { languageWords } from '../../apps/web/lib/i18n/lang';
import { catalogs, en } from '../../apps/web/lib/i18n/messages';
import { localeCodes as locales } from '../../apps/web/lib/i18n/locales';
import { homeV43En } from '../../apps/web/lib/i18n/home-v43-words';
import { homeV43MoreEn } from '../../apps/web/lib/i18n/home-v43-words-more';
import { briefGoals } from '../../apps/web/lib/home-routes-data';

// Home page v4.3 words (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly"). New words are
// English-only keys under `home.v43.`: every other language shows English, never blank (ADR-066, ADR-074); native
// review is NOT done and no translation is claimed. Words follow the pack with the deviations recorded in
// docs/revamp/specs/ui-ux-v4-3.md: Title Case actions, slots for places, no brief or draft word.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const own = { ...homeV43En, ...homeV43MoreEn } as Record<string, string>;
const ownKeys = Object.keys(own);
const slotNames = new Set([
  'bd',
  'cn',
  'eu',
  'gb',
  'us',
  'au',
  'asia',
  'amount',
  'code',
  'route',
  'item',
  'name',
  'timing',
]);
const small = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'by', 'at']);
// The repo's Title Case rule for actions (tests/browser/title-case-actions.spec.ts), slots read as a capital.
const isTitleCase = (label: string) =>
  label
    .replace(/\{\w+\}/g, 'X')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .every((word, index) => {
      const letters = word.replace(/^[^A-Za-z]+/, '');
      if (!letters || !/^[A-Za-z]/.test(letters)) return true;
      if (index > 0 && small.has(letters.toLowerCase())) return true;
      return /^[A-Z]/.test(letters) || /^[a-z]*[A-Z]/.test(letters);
    });

describe('the v4.3 words', () => {
  it('are the pack words with the recorded changes', () => {
    expect(en['home.v43.hero.title.a']).toBe('Find the right');
    expect(en['home.v43.hero.title.b']).toBe('business partners.');
    expect(en['home.v43.hero.lead']).toBe(
      'Source products or machinery from {cn}, meet buyers abroad, or organise a business delegation. Corridra helps you check who fits, set up the right meetings and follow through.',
    );
    expect(en['home.v43.hero.start']).toBe('Start a Request');
    expect(en['home.v43.hero.example']).toBe('See a Worked Example');
    expect(en['home.v43.q.sub']).toBe(
      'Choose what you need. The example and request will update to match.',
    );
    expect(en['home.v43.q.note']).toBe('Explore freely. Review your request before you send it.');
    // The nine substitutions of the record
    expect(en['home.v43.brief.go']).toBe('Build My Request');
    expect(en['home.v43.mk.use']).toBe('Use This Route in the Request');
    expect(en['home.v43.inbound.go']).toBe('Build an Inbound Request');
    expect(en['home.v43.process.step.1']).toBe('Set the Request');
    expect(en['home.v43.brief.review']).toBe('Review Request');
    expect(en['home.v43.brief.card']).toBe('Your request');
    expect(en['home.v43.dialog.copy']).toBe('Copy Request Details');
    expect(en['home.v43.dialog.copied']).toBe('Request details copied');
    expect(en['home.v43.brief.note.line']).toBe(
      "Review the summary, then open Corridra's request form. You can copy your timing and notes to bring with you.",
    );
    expect(en['home.v43.ex.delegation.desc']).toContain('from the original request');
    // Amounts and delivery codes are data, as the pack has them: USD, never converted, never in the catalogue
    expect(offerIds.map((id) => offerAmounts[id])).toEqual([
      'USD 36,800',
      'USD 34,200',
      'USD 39,100',
    ]);
    expect(ledgerAmounts).toEqual({ original: 'USD 36,800', correction: 'USD 37,400' });
    expect(deliveryCodes).toEqual({ a: 'FOB Ningbo', c: 'CIF Chattogram' });
    expect(en['home.v43.ex.china.offer.a.terms']).toBe('{code} · Installation included');
    expect(en['home.v43.ex.fallback.a']).toBe(
      '{amount} excludes installation and leaves delivery terms open.',
    );
    expect(Object.values(own).join('\n')).not.toMatch(/USD \d/);
    expect(en['home.v43.ex.china.offer.b.detail']).toContain('lowest figure on the page');
    expect(en['home.v43.ex.china.offer.b.detail']).toContain('before it can be ranked');
    expect(en['home.v43.process.step.2']).toBe('Check the Fit');
    expect(en['home.v43.ex.sell.row.2.status']).toBe('Outside the request');
  });

  it('are English only: no other language holds one, and every language shows the English', () => {
    expect(ownKeys.length).toBeGreaterThan(300);
    for (const key of ownKeys) expect(en[key as keyof typeof en], key).toBe(own[key]);
    for (const locale of locales.filter((l) => l !== 'en')) {
      const words = languageWords[locale as keyof typeof languageWords] as Record<string, string>;
      for (const key of ownKeys) {
        expect(Object.hasOwn(words, key), `${locale} ${key}`).toBe(false);
        const shown = (catalogs[locale] as Record<string, string>)[key];
        expect(shown, `${locale} ${key}`).toBe(own[key]);
        expect(shown!.trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('hold no empty value, no dash, no curly quote and no word the vocabulary rule bans', () => {
    for (const [key, value] of Object.entries(own)) {
      expect(value.trim(), key).not.toBe('');
      expect(value, key).not.toMatch(/[–—‘’“”]/);
      expect(value, key).not.toMatch(
        /\b(brief|briefs|draft|drafts|synthetic|contributor|operator)\b/i,
      );
    }
  });

  it('write no place: every place is a slot, and the five trust names are not written here', () => {
    for (const [key, value] of Object.entries(own)) {
      expect(value, key).not.toMatch(
        /\b(China|Bangladesh|Australia|United Kingdom|United States|European Union|Spain|France|Italy|EU|UK|US)\b/,
      );
      expect(value, key).not.toMatch(/\bKey Asian\b/i);
      for (const [, name] of value.matchAll(/\{(\w+)\}/g))
        expect(slotNames.has(name!), `${key} {${name}}`).toBe(true);
      expect(value.replace(/\{\w+\}/g, ''), key).not.toMatch(/[{}]/);
    }
    for (const name of [
      'Self-declared',
      'Evidence available',
      'Verified',
      'Derived',
      'Outcome observed',
    ])
      expect(Object.values(own)).not.toContain(name);
    // The one place that is not a country has no mark: its key is a plain name
    expect(en[placeName.OTHER]).toBe('Other or undecided');
  });

  it('keep Title Case on everything a person presses', () => {
    const actions = [
      'hero.start',
      'hero.example',
      'brief.go',
      'sol.source.go',
      'sol.sell.go',
      'sol.delegation.go',
      'sol.delegation.walk',
      'ex.cta',
      'ex.full',
      'ex.sell.view.fair',
      'ex.sell.view.short',
      'ex.dl.phase.1.label',
      'ex.dl.phase.2.label',
      'ex.dl.phase.3.label',
      'ex.other.q.1.label',
      'ex.other.q.2.label',
      'ex.other.q.3.label',
      'process.full',
      'process.step.1',
      'process.step.2',
      'process.step.3',
      'process.step.4',
      'mk.dir.out',
      'mk.dir.in',
      'mk.use',
      'mk.all',
      'mk.dossier',
      'inbound.go',
      'trust.d11.summary',
      'trust.link',
      'faq.more',
      'brief.review',
      'brief.help',
      'dialog.close',
      'dialog.go',
      'dialog.go.help',
      'dialog.copy',
      'menu.solutions',
      'menu.more',
      'menu.faqs',
      'menu.sol.source.title',
      'menu.sol.sell.title',
      'menu.sol.delegation.title',
      'menu.sol.inbound.title',
      'foot.customer',
      'foot.team',
      'foot.helper',
      'foot.guide',
      ...roleIds.map((id) => `people.role.${id}.name`),
    ];
    for (const name of actions) expect(isTitleCase(en[v43(name)]), name).toBe(true);
    for (const id of offerIds) expect(isTitleCase(en[v43(`ex.china.offer.${id}.name`)])).toBe(true);
  });

  it('have every key the data tables and the nav rows read', () => {
    const keys: string[] = [
      ...Object.values(placeName),
      ...solutionRows.flatMap((row) => [row.title, row.line]),
      faqRow.title,
    ];
    for (const route of intentKeys)
      keys.push(
        v43(`door.${route}.title`),
        v43(`door.${route}.line`),
        v43(`ex.${route}.title`),
        v43(`ex.${route}.desc`),
        v43(`ex.${route}.console`),
        ...stageIds.flatMap((n) => [
          v43(`process.rec.${route}.${n}.title`),
          v43(`process.rec.${route}.${n}.line`),
        ]),
      );
    for (const market of explorerMarkets)
      for (const direction of ['out', 'in'] as const) {
        const record = routeRecord(market, direction);
        keys.push(marketLine(market, direction), record.status, record.detail);
      }
    for (const id of offerIds)
      for (const part of ['name', 'terms', 'detail'])
        keys.push(v43(`ex.china.offer.${id}.${part}`));
    for (const { id } of buyerRows)
      for (const part of ['name', 'status', 'line']) keys.push(v43(`ex.sell.row.${id}.${part}`));
    for (const id of phaseIds)
      for (const part of ['label', 'title', 'line']) keys.push(v43(`ex.dl.phase.${id}.${part}`));
    for (const id of questionIds)
      for (const part of ['label', 'title', 'line']) keys.push(v43(`ex.other.q.${id}.${part}`));
    for (const id of roleIds)
      for (const part of ['name', 'bring', 'get']) keys.push(v43(`people.role.${id}.${part}`));
    for (const id of faqIds) keys.push(v43(`faq.${id}.q`), v43(`faq.${id}.a`));
    for (const goal of briefGoals)
      keys.push(v43(`brief.job.${goal}.label`), v43(`brief.job.${goal}.hint`));
    for (const fit of ['selective', 'sourcing', 'sales', 'ask']) keys.push(v43(`brief.fit.${fit}`));
    for (const key of keys) expect(en[key as keyof typeof en], String(key)).toBeTruthy();
    // And no key sits in the words without a reader named here or in a component (the families are all listed)
    const families = ownKeys.filter((key) =>
      /^home\.v43\.(ex\.china\.offer|process\.rec|people\.role|faq\.\d)/.test(key),
    );
    // 9 offer lines, 32 stage lines, 24 role lines, 16 question lines and the privacy link
    expect(families.length).toBe(9 + 32 + 24 + 16 + 1);
  });

  it('give the one route block of each anchor the shipped route blocks own', () => {
    expect(new Set(Object.values(anchorRoutes))).toEqual(new Set(intentKeys));
    expect(anchorRoute('route-delegation')).toBe('delegation');
    expect(anchorRoute('quote-b')).toBe('china');
    expect(anchorRoute('faircost-title')).toBe('sell');
  });

  it('read a prototype name or a broken escape as no anchor, never as an error', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])
      expect(anchorRoute(name), name).toBeUndefined();
    expect(anchorRoute('')).toBeUndefined();
    expect(hashId('#constructor')).toBe('constructor');
    expect(hashId('#route-china')).toBe('route-china');
    expect(hashId('#%E0%A4%A')).toBe('');
    expect(anchorRoute(hashId('#%E0%A4%A'))).toBeUndefined();
  });
});

describe('the place slots', () => {
  it('are drawn with their mark and a name from the existing keys; Key Asian Markets gets the compass, never a flag', async () => {
    const { PlaceWords, placeText } = await load('components/place-words.tsx');
    const html = renderToStaticMarkup(createElement(PlaceWords, { text: en['home.v43.faq.2.a'] }));
    for (const name of ['Bangladesh', 'China', 'EU', 'UK', 'US', 'Australia'])
      expect(html).toContain(`<span>${name}</span>`);
    expect(html).toContain('data-flag="bd"');
    expect(html).not.toMatch(/\{\w+\}/);
    const region = renderToStaticMarkup(createElement(PlaceWords, { text: '{asia} and {cn}' }));
    expect(region).toContain('ux-region-mark');
    expect(region).toContain('<span>Key Asian Markets</span>');
    expect(region).not.toContain('region.svg');
    const t = (key: string) => en[key as keyof typeof en];
    expect(placeText('Source From {cn}', t as never)).toBe('Source From China');
    expect(placeText('{route} chosen.', t as never, { route: 'Sell abroad' })).toBe(
      'Sell abroad chosen.',
    );
    // A slot the helper does not know is left as written for the caller to fill
    expect(placeText('{amount} left', t as never)).toBe('{amount} left');
  });
});
