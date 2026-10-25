import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offerTerms } from '../../packages/domain/src/commercial-missions';
import {
  buildReplyTerms,
  incoterms,
  noCharge,
  parseReplyFragment,
  replyFields,
  replyGroups,
  replyLinkSuffix,
  replyTermKeys,
  shippingScopes,
} from '../../apps/web/lib/reply-terms';
import { fillReply, replyHtmlLang, replyWords } from '../../apps/web/lib/reply-words';
import { receiptText, termValue } from '../../apps/web/lib/reply-receipt';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// The supplier Reply Page (Lane 8 of the UX update; ADR-069), the parts that need no browser and no
// database: what the form may send, how a link names its language, the receipt and every switch-off path.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const token = 'a'.repeat(64);

describe('what the form may send', () => {
  const sql = read('packages/db/migrations/0025_scoped_product_experience.sql');
  const accepted = [
    ...(/\(b->'quotation'->'terms'\)-ARRAY\[([^\]]+)\]/.exec(sql)?.[1] ?? '').matchAll(
      /'([A-Za-z]+)'/g,
    ),
  ].map((m) => m[1]);

  it('offers exactly the eighteen terms the database function accepts', () => {
    expect(accepted).toHaveLength(18);
    expect([...replyTermKeys].sort()).toEqual([...accepted].sort());
  });
  it('uses the same trade terms and shipping scopes as the database and the staff schema', () => {
    const list = (pattern: RegExp) =>
      [...(pattern.exec(sql)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect([...incoterms]).toEqual(list(/'incoterm' NOT IN \(([^)]+)\)/));
    expect([...shippingScopes]).toEqual(list(/'shipping' NOT IN \(([^)]+)\)/));
  });
  it('puts every term in exactly one of four small steps', () => {
    expect(replyGroups).toEqual(['what', 'price', 'terms', 'included']);
    for (const group of replyGroups)
      expect(replyFields.filter((f) => f.group === group).length).toBeGreaterThan(0);
    expect(new Set(replyFields.map((f) => f.key)).size).toBe(18);
  });

  const everything = {
    specification: 'Polyester curtain track, 4 m, white',
    quantity: '1200',
    moq: '200',
    unit: 'pieces',
    unitPriceMinor: '12.50',
    totalPriceMinor: '15000',
    toolingMinor: noCharge,
    setupMinor: '300',
    packagingMinor: '45.5',
    leadTime: '6 weeks after the deposit',
    validUntil: '2026-12-31',
    incoterm: 'FOB',
    paymentTerms: '30 percent deposit, balance before shipping',
    shipping: 'EXCLUDED',
    warranty: 'Two years on parts',
    installation: 'Not included',
    training: 'One day on site',
    spares: 'Ten percent spare parts shipped free',
  };
  it('turns everything typed into the database form, which the staff schema also accepts', () => {
    const result = buildReplyTerms(everything, 'USD');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.terms).toMatchObject({
      quantity: '1200',
      unitPriceMinor: '1250',
      totalPriceMinor: '1500000',
      toolingMinor: '0',
      setupMinor: '30000',
      packagingMinor: '4550',
      validUntil: '2026-12-31T23:59:59Z',
      incoterm: 'FOB',
      shipping: 'EXCLUDED',
    });
    expect(Object.keys(result.terms).sort()).toEqual([...replyTermKeys].sort());
    // Every value is a string, as the database function requires, and the staff schema takes all of it.
    for (const value of Object.values(result.terms)) expect(typeof value).toBe('string');
    expect(() => offerTerms.parse(result.terms)).not.toThrow();
  });
  it('leaves a blank out: not stated, never zero', () => {
    const result = buildReplyTerms(
      { specification: 'Curtain track', unitPriceMinor: '', toolingMinor: '' },
      'USD',
    );
    expect(result).toEqual({ ok: true, terms: { specification: 'Curtain track' } });
    expect(buildReplyTerms({}, '')).toEqual({ ok: true, terms: {} });
  });
  it('makes a charge zero only when the supplier says no charge, and keeps an explicit zero amount', () => {
    expect(buildReplyTerms({ toolingMinor: noCharge }, '')).toEqual({
      ok: true,
      terms: { toolingMinor: '0' },
    });
    expect(buildReplyTerms({ setupMinor: '0' }, 'USD')).toEqual({
      ok: true,
      terms: { setupMinor: '0' },
    });
  });
  it('respects the places of each currency and rounds nothing', () => {
    expect(buildReplyTerms({ unitPriceMinor: '1200' }, 'JPY')).toEqual({
      ok: true,
      terms: { unitPriceMinor: '1200' },
    });
    expect(buildReplyTerms({ unitPriceMinor: '1.234' }, 'BHD')).toEqual({
      ok: true,
      terms: { unitPriceMinor: '1234' },
    });
    expect(buildReplyTerms({ unitPriceMinor: '1.2345' }, 'BHD').ok).toBe(false);
  });
  it.each([
    [{ unitPriceMinor: '12.345' }, 'USD', 'unitPriceMinor', 'places'],
    [{ unitPriceMinor: '1200.5' }, 'JPY', 'unitPriceMinor', 'places'],
    [{ unitPriceMinor: '12,50' }, 'USD', 'unitPriceMinor', 'amount'],
    [{ unitPriceMinor: '-5' }, 'USD', 'unitPriceMinor', 'amount'],
    [{ totalPriceMinor: '9'.repeat(20) }, 'USD', 'totalPriceMinor', 'range'],
    [{ unitPriceMinor: '5' }, '', 'currency', 'currency'],
    [{ unitPriceMinor: '5' }, 'XXX', 'currency', 'currency'],
    [{ quantity: '0' }, 'USD', 'quantity', 'integer'],
    [{ quantity: '1.5' }, 'USD', 'quantity', 'integer'],
    [{ moq: '1'.repeat(13) }, 'USD', 'moq', 'integer'],
    [{ specification: 'ab' }, 'USD', 'specification', 'text'],
    [{ leadTime: 'x'.repeat(1001) }, 'USD', 'leadTime', 'text'],
    [{ unit: 'x'.repeat(81) }, 'USD', 'unit', 'unit'],
    [{ validUntil: '2026-02-30' }, 'USD', 'validUntil', 'date'],
    [{ validUntil: 'next week' }, 'USD', 'validUntil', 'date'],
    [{ incoterm: 'XYZ' }, 'USD', 'incoterm', 'incoterm'],
    [{ shipping: 'MAYBE' }, 'USD', 'shipping', 'shipping'],
    [{ shipping: 'NOT_SUPPLIED' }, 'USD', null, null],
  ] as const)('checks %j in %s', (values, currency, key, error) => {
    const result = buildReplyTerms(values, currency);
    if (key === null) return expect(result.ok).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.errors as Record<string, string>)[key]).toBe(error);
  });
  it('checks one step at a time when asked to', () => {
    const only = ['quantity'] as const;
    expect(buildReplyTerms({ quantity: '5', moq: 'bad' }, 'USD', only)).toEqual({
      ok: true,
      terms: { quantity: '5' },
    });
    expect(buildReplyTerms({ quantity: 'bad' }, 'USD', only).ok).toBe(false);
  });
});

describe('what a link says about language and the terms asked for', () => {
  it('keeps an older link, the bare token, as English with nothing asked', () => {
    expect(parseReplyFragment(token)).toEqual({ token, language: 'en', ask: [] });
  });
  it('reads the language and the terms asked for', () => {
    expect(parseReplyFragment(`t=${token}&l=zh&ask=leadTime,validUntil`)).toEqual({
      token,
      language: 'zh',
      ask: ['leadTime', 'validUntil'],
    });
    expect(parseReplyFragment(`t=${token}`)).toEqual({ token, language: 'en', ask: [] });
  });
  it('allows two languages and eighteen terms and nothing else', () => {
    expect(parseReplyFragment(`t=${token}&l=fr`).language).toBe('en');
    expect(parseReplyFragment(`t=${token}&l=ZH`).language).toBe('en');
    expect(parseReplyFragment(`t=${token}&ask=leadTime,<script>,leadTime,../x,unit`).ask).toEqual([
      'leadTime',
      'unit',
    ]);
  });
  it.each([
    '',
    'short',
    `t=short&l=zh`,
    `x=${token}`,
    `t=${token.toUpperCase()}`,
    `${token}l=zh`,
    `${token}x&l=zh`,
    `${'g'.repeat(64)}&l=zh`,
    `${token}&${'a=b&'.repeat(200)}`,
    `t=${token}&${'a=b&'.repeat(200)}`,
  ])('treats %j as no link', (fragment) => {
    expect(parseReplyFragment(fragment).token).toBe('');
  });
  it('writes the suffix the team adds to a link, and nothing for the defaults', () => {
    expect(replyLinkSuffix('en', [])).toBe('');
    expect(replyLinkSuffix('zh', [])).toBe('&l=zh');
    expect(replyLinkSuffix('en', ['leadTime', 'validUntil'])).toBe('&ask=leadTime,validUntil');
    expect(replyLinkSuffix('zh', ['leadTime'])).toBe('&l=zh&ask=leadTime');
    const suffix = replyLinkSuffix('zh', ['leadTime', 'validUntil', 'leadTime']);
    expect(parseReplyFragment(`t=${token}${suffix}`)).toEqual({
      token,
      language: 'zh',
      ask: ['leadTime', 'validUntil'],
    });
  });
  it('reads the link the system issues with the suffix added to its end, as the team is told to do', () => {
    // The issued link is `/buyer#<token>`; the queue tells the team to add the suffix after it.
    const suffix = replyLinkSuffix('zh', ['leadTime', 'validUntil']);
    expect(parseReplyFragment(`${token}${suffix}`)).toEqual({
      token,
      language: 'zh',
      ask: ['leadTime', 'validUntil'],
    });
    expect(parseReplyFragment(`${token}&ask=unit`)).toEqual({
      token,
      language: 'en',
      ask: ['unit'],
    });
    // A token with nothing meaningful after the ampersand is still that token, in English.
    expect(parseReplyFragment(`${token}&`)).toEqual({ token, language: 'en', ask: [] });
    // Anything not after the token's own ampersand is no link: a token is exactly 64 characters.
    expect(parseReplyFragment(`${token}0&l=zh`).token).toBe('');
  });
});

describe('the words of the page', () => {
  const flat = (value: unknown, prefix = ''): Record<string, string> =>
    typeof value === 'string'
      ? { [prefix]: value }
      : Object.fromEntries(
          Object.entries(value as object).flatMap(([k, v]) =>
            Object.entries(flat(v, prefix ? `${prefix}.${k}` : k)),
          ),
        );
  const en = flat(replyWords.en);
  const zh = flat(replyWords.zh);
  it('has a Chinese word for every English word and nothing more', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
  it('has a name for all eighteen terms and every error', () => {
    for (const key of replyTermKeys) {
      expect(replyWords.en.fields[key].length).toBeGreaterThan(2);
      expect(replyWords.zh.fields[key].length).toBeGreaterThan(0);
    }
    expect(Object.keys(replyWords.en.errors).sort()).toEqual(
      Object.keys(replyWords.zh.errors).sort(),
    );
  });
  it('uses the same placeholders in both languages, no dash character and no markup', () => {
    for (const key of Object.keys(en)) {
      const names = (text: string) => [...text.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]).sort();
      expect(names(zh[key]), key).toEqual(names(en[key]));
      expect(en[key] + zh[key], key).not.toMatch(/[—–<>]/);
    }
  });
  it('fills placeholders and fails on a missing one', () => {
    expect(fillReply(replyWords.en.step, { n: '2', total: '5' })).toBe('Step 2 of 5');
    expect(fillReply(replyWords.zh.step, { n: '2', total: '5' })).toContain('2');
    expect(() => fillReply(replyWords.en.step, { n: '2' })).toThrow('Missing reply placeholder');
  });
  it('sets its own language and reading direction for each of the two languages', () => {
    expect(replyHtmlLang).toEqual({
      en: { lang: 'en', dir: 'ltr' },
      zh: { lang: 'zh-Hans', dir: 'ltr' },
    });
  });
});

describe('the receipt', () => {
  const recorded = {
    body: '原始答复：可以报价。',
    meetingInterest: true,
    quotation: {
      currency: 'USD',
      terms: {
        specification: 'Curtain track',
        unitPriceMinor: '1250',
        toolingMinor: '0',
        shipping: 'INCLUDED',
        validUntil: '2026-12-31T23:59:59Z',
      },
      uncertainties: 'Freight not yet known',
    },
  };
  it('shows what was recorded in the page language and says not stated for a blank', () => {
    // Money is written with a no-break space; compare it as a plain space.
    const text = receiptText(recorded, replyWords.en, new Date('2026-10-25T01:00:00Z')).replace(
      /\u00a0/g,
      ' ',
    );
    expect(text).toContain('Corridra receipt');
    expect(text).toContain('原始答复：可以报价。');
    expect(text).toContain('Price for one unit: USD 12.50');
    expect(text).toContain('Tooling: USD 0.00');
    expect(text).toContain('Shipping: Included in the price');
    expect(text).toContain('This quote is valid until: 2026-12-31');
    expect(text).toContain('Lead time: Not stated');
    expect(text).toContain('Freight not yet known');
    expect(text).toContain('No meeting');
    const chinese = receiptText(recorded, replyWords.zh, new Date('2026-10-25T01:00:00Z'));
    expect(chinese).toContain('Corridra 回执');
    expect(chinese).toContain('未说明');
  });
  it('says there is no quote when there is none, and holds nothing the supplier did not type', () => {
    const text = receiptText(
      { body: 'Please send details', meetingInterest: false, quotation: null },
      replyWords.en,
      new Date(),
    );
    expect(text).toContain('No quote is included.');
    expect(text).not.toContain('Price');
    expect(termValue('leadTime', undefined, 'USD', replyWords.en)).toBe('Not stated');
    expect(termValue('leadTime', '', 'USD', replyWords.en)).toBe('Not stated');
  });
});

describe('every switch-off path', () => {
  it('is a real owner switch, off by default', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_REPLY_PAGE')).toBeTruthy();
  });
  it('the buyer page reads the switch on the server and passes it down', () => {
    expect(read('apps/web/app/buyer/page.tsx')).toContain(
      "replyPage={uxSwitchOn('CORRIDRA_REPLY_PAGE')}",
    );
  });
  it('with the switch off the whole fragment is the token and the older form is what renders', () => {
    const intro = read('apps/web/app/buyer/introduction.tsx');
    expect(intro).toContain('const parsed = replyPage ? parseReplyFragment(capability) : null;');
    expect(intro).toContain('const linkToken = fragment ? fragment.token : capability;');
    expect(intro).toContain('if (replyPage && data && fragment)');
    expect(intro).toContain('<RecipientResponse');
    // The older form, its text and its command are untouched.
    const older = read('apps/web/app/buyer/recipient-response.tsx');
    expect(older).toContain('Reply or request clarification');
    expect(older).toContain("action: 'detail-response'");
  });
  it('shows Chinese only once zh is offered by the language release setting, otherwise English', () => {
    const page = read('apps/web/app/buyer/page.tsx');
    expect(page).toContain(
      "chineseReleased={offeredLanguages().some((language) => language.code === 'zh')}",
    );
    const intro = read('apps/web/app/buyer/introduction.tsx');
    expect(intro).toContain("parsed.language === 'zh' && !chineseReleased");
    // The safe default: nothing releases Chinese unless the page says so.
    expect(intro).toContain('chineseReleased = false');
  });
  it('sends the same command the older form sent, so the database and its rules are unchanged', () => {
    const journey = read('apps/web/app/buyer/reply-journey.tsx');
    expect(journey).toContain("action: 'detail-response'");
    expect(journey).toContain("fetch('/api/buyer'");
    expect(journey).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    expect(journey).not.toContain('<svg');
    expect(read('apps/web/app/buyer/reply-journey.css')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
