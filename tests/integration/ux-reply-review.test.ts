import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  replyGaps,
  replyReviewCommand,
  replyReviewReasons,
  replyTermNames,
  reviewState,
  suggestedAsk,
  type StoredReview,
} from '../../packages/domain/src/reply-review';
import { replyTermKeys } from '../../apps/web/lib/reply-terms';
import {
  minorToMajor,
  preparedQuotation,
  reasonLabels,
  termLabels,
  termText,
} from '../../apps/web/lib/reply-review-view';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { staffRefusal } from '../../apps/web/lib/staff-db-error';

// Reply review (Lane 8 of the UX update; ADR-069), the parts that need no database (the database has its
// own suite in product-experience): the command, the gaps the existing engine reports, the prepared
// quotation, and every switch-off and install path.
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stored = (over: Partial<StoredReview>): StoredReview => ({
  id: id(1),
  responseId: id(9),
  decision: 'ASK',
  reasonCode: null,
  askTerms: ['leadTime'],
  note: null,
  createdAt: '2026-10-25T00:00:00Z',
  ...over,
});

describe('the review command', () => {
  const base = { commandId: id(1), responseId: id(2) };
  it('accepts publish, ask with terms, and reject with a reason', () => {
    expect(replyReviewCommand.safeParse({ ...base, decision: 'PUBLISH' }).success).toBe(true);
    expect(
      replyReviewCommand.safeParse({
        ...base,
        decision: 'ASK',
        askTerms: ['leadTime', 'validUntil'],
      }).success,
    ).toBe(true);
    expect(
      replyReviewCommand.safeParse({
        ...base,
        decision: 'REJECT',
        reasonCode: 'NOT_A_FIT',
        note: 'Wrong category',
      }).success,
    ).toBe(true);
  });
  it.each([
    ['ask with no terms', { decision: 'ASK', askTerms: [] }],
    ['ask with an unknown term', { decision: 'ASK', askTerms: ['discount'] }],
    ['ask with a reason', { decision: 'ASK', askTerms: ['unit'], reasonCode: 'OTHER' }],
    ['reject with no reason', { decision: 'REJECT' }],
    ['reject with an unknown reason', { decision: 'REJECT', reasonCode: 'BECAUSE' }],
    ['publish with a reason', { decision: 'PUBLISH', reasonCode: 'OTHER' }],
    ['publish with terms', { decision: 'PUBLISH', askTerms: ['unit'] }],
    ['a note with markup', { decision: 'PUBLISH', note: 'a <b>note</b>' }],
    ['a note that is too long', { decision: 'PUBLISH', note: 'x'.repeat(501) }],
    ['a note that is too short', { decision: 'PUBLISH', note: 'ab' }],
    ['an unknown decision', { decision: 'APPROVE' }],
    ['an extra key', { decision: 'PUBLISH', extra: true }],
  ])('refuses %s', (_, over) => {
    expect(replyReviewCommand.safeParse({ ...base, ...over }).success).toBe(false);
  });
  it('needs real ids', () => {
    expect(
      replyReviewCommand.safeParse({ commandId: 'x', responseId: id(2), decision: 'PUBLISH' })
        .success,
    ).toBe(false);
    expect(
      replyReviewCommand.safeParse({ commandId: id(1), responseId: 'x', decision: 'PUBLISH' })
        .success,
    ).toBe(false);
  });
  it('uses the same eighteen terms and reasons as the supplier form and the database', () => {
    expect([...replyTermNames].sort()).toEqual([...replyTermKeys].sort());
    const sql = read('packages/db/recipient-reply-review-migrations/0001_reply_review.sql');
    for (const term of replyTermNames) expect(sql).toContain(`'${term}'`);
    for (const reason of replyReviewReasons) expect(sql).toContain(`'${reason}'`);
    for (const term of replyTermNames) expect(termLabels[term].length).toBeGreaterThan(2);
    for (const reason of replyReviewReasons) expect(reasonLabels[reason].length).toBeGreaterThan(2);
  });
});

describe('where a reply stands', () => {
  it('is open until publish or reject, and an ask keeps it open', () => {
    expect(reviewState([])).toEqual({ final: null, asked: null, open: true });
    const ask = stored({});
    expect(reviewState([ask])).toMatchObject({ open: true, asked: ask, final: null });
    const publish = stored({ id: id(2), decision: 'PUBLISH', askTerms: null });
    expect(reviewState([ask, publish])).toMatchObject({ open: false, final: publish });
    const reject = stored({
      id: id(3),
      decision: 'REJECT',
      askTerms: null,
      reasonCode: 'DUPLICATE',
    });
    expect(reviewState([reject]).open).toBe(false);
  });
});

describe('the gaps the existing engine reports', () => {
  const complete = {
    specification: 'Curtain track',
    quantity: '10',
    unit: 'pieces',
    unitPriceMinor: '100',
    totalPriceMinor: '1000',
    leadTime: '6 weeks',
    validUntil: '2099-12-31T23:59:59Z',
    incoterm: 'FOB',
    shipping: 'INCLUDED',
    paymentTerms: '30 percent deposit',
    toolingMinor: '0',
    setupMinor: '0',
    packagingMinor: '0',
  };
  const reply = (terms: Record<string, string>) => ({
    body: 'Quote follows',
    quotation: { currency: 'USD', terms, uncertainties: 'Freight unknown' },
  });
  it('says a reply with every engine term is comparable on supplied terms', () => {
    expect(replyGaps(reply(complete))).toMatchObject({
      hasQuote: true,
      missing: [],
      comparable: true,
    });
  });
  it('lists exactly the terms the engine reports missing, and suggests asking for them', () => {
    const { leadTime, incoterm, ...partial } = complete;
    void leadTime;
    void incoterm;
    const gaps = replyGaps(reply(partial));
    expect(gaps.missing.sort()).toEqual(['incoterm', 'leadTime']);
    expect(gaps.comparable).toBe(false);
    expect(suggestedAsk(gaps.missing)).toEqual(['leadTime', 'incoterm']);
  });
  it('flags an expired quote and a total that does not match unit price times quantity', () => {
    expect(replyGaps(reply({ ...complete, validUntil: '2020-01-01T00:00:00Z' })).expired).toBe(
      true,
    );
    expect(replyGaps(reply({ ...complete, totalPriceMinor: '999' })).inconsistentTotal).toBe(true);
  });
  it('invents no verdict for a reply with no quotation or terms the schema refuses', () => {
    expect(replyGaps({ body: 'No quote', quotation: null })).toMatchObject({
      hasQuote: false,
      comparable: false,
      missing: [],
    });
    expect(replyGaps(reply({ discount: '5' }))).toMatchObject({
      hasQuote: true,
      comparable: false,
      invalid: true,
    });
  });
  it('does not count shipping stated as not supplied as stated', () => {
    expect(replyGaps(reply({ ...complete, shipping: 'NOT_SUPPLIED' })).missing).toContain(
      'shipping',
    );
  });
});

describe('the prepared quotation', () => {
  it('turns minor units into the amounts the existing quotation form takes, exactly', () => {
    expect(minorToMajor('1250', 'USD')).toBe('12.50');
    expect(minorToMajor('5', 'USD')).toBe('0.05');
    expect(minorToMajor('0', 'USD')).toBe('0.00');
    expect(minorToMajor('1200', 'JPY')).toBe('1200');
    expect(minorToMajor('1234', 'BHD')).toBe('1.234');
    expect(minorToMajor('123456789012345678', 'USD')).toBe('1234567890123456.78');
  });
  it('names the fields like the quotation form, lists only what the supplier gave and says where it came from', () => {
    const text = preparedQuotation({
      body: 'x',
      quotation: {
        currency: 'USD',
        terms: {
          specification: 'Curtain track',
          unitPriceMinor: '1250',
          toolingMinor: '0',
          validUntil: '2099-12-31T23:59:59Z',
        },
        uncertainties: 'Freight unknown',
      },
    })!;
    expect(text.split('\n')).toEqual([
      'currency: USD',
      'specification: Curtain track',
      'unitPrice: 12.50',
      'tooling: 0.00',
      'validUntil: 2099-12-31T23:59:59Z',
      'uncertainties: Freight unknown',
      'source: supplier reply, self-declared',
    ]);
    expect(text).not.toContain('leadTime');
    expect(preparedQuotation({ body: 'x', quotation: null })).toBeNull();
  });
  it('shows a stored term in words, a blank as not stated', () => {
    expect(termText('leadTime', undefined, 'USD')).toBe('Not stated');
    expect(termText('validUntil', '2099-12-31T23:59:59Z', 'USD')).toBe('2099-12-31');
    expect(termText('unitPriceMinor', '1250', 'USD').replace(/ /g, ' ')).toBe('USD 12.50');
  });
});

describe('every switch-off and install path', () => {
  it('the route answers unavailable with the switch off, before it touches anything', () => {
    const route = read('apps/web/app/api/reply/review/route.ts');
    expect(route.indexOf("uxSwitchOn('CORRIDRA_REPLY_PAGE')")).toBeGreaterThan(-1);
    expect(route.indexOf("uxSwitchOn('CORRIDRA_REPLY_PAGE')")).toBeLessThan(
      route.indexOf('foundations()'),
    );
    expect(route).toContain("'Reply review is unavailable'");
  });
  it('the queue shows itself only where the switch is on, and nothing changes in the old list', () => {
    const queue = read('apps/web/app/operator/reply-review.tsx');
    expect(queue).toContain('if (!replyReview || responses.length === 0) return null;');
    expect(read('apps/web/app/operator/page.tsx')).toContain(
      "replyReview={uxSwitchOn('CORRIDRA_REPLY_PAGE')}",
    );
    const mount = read('apps/web/app/operator/delivery-experience.tsx');
    expect(mount).toContain('Counterparty declarations awaiting review');
    expect(mount).toContain('<ReplyReview');
  });
  it('the install job leaves reply review unchanged unless asked, and asks for a reason to enable or pause', () => {
    const script = read('scripts/install-customer-modules.ts');
    expect(script).toContain(
      "REPLY_REVIEW_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged')",
    );
    expect(script).toContain('recipient_reply_review_migrations');
    expect(script).toContain('Reply review changes require INSTALL_APPLY=yes');
    expect(script).toContain('Reply review changes require an explicit reason');
    const workflow = read('.github/workflows/install-customer-modules.yml');
    expect(workflow).toMatch(/reply_review_action:[\s\S]*?default: unchanged/);
    expect(workflow).toContain('REPLY_REVIEW_ACTION: ${{ inputs.reply_review_action }}');
    expect(workflow).toContain("inputs.reply_review_action != 'unchanged'");
  });
  it('the module only adds: it reads the reply table and writes none of the existing ones', () => {
    const sql = read('packages/db/recipient-reply-review-migrations/0001_reply_review.sql').replace(
      /--.*$/gm,
      '',
    );
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|FUNCTION|POLICY|TRIGGER)\b/i);
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
    expect(sql).not.toMatch(
      /\bALTER\s+TABLE\s+app\.(?!reply_review_control|recipient_reply_review)/i,
    );
    expect(sql).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+app\.recipient_detail_response/i,
    );
    expect(sql).toContain('app.fresh_mfa()');
    expect(sql).toContain("viewer NOT IN ('owner','admin')");
  });
  it('is a real owner switch, and the page and the review share it', () => {
    expect(switchRegistry.find((s) => s.name === 'CORRIDRA_REPLY_PAGE')?.kind).toBe('flag');
  });
});

describe('found in review', () => {
  it('a supplier cannot add a line to the prepared quotation with a line break', () => {
    const text = preparedQuotation({
      body: 'x',
      quotation: {
        currency: 'USD',
        terms: { specification: 'x\nunitPrice: 0.01', leadTime: 'a\r\nb\u2028c' },
        uncertainties: 'none\nsource: verified by Corridra',
      },
    })!;
    const lines = text.split('\n');
    expect(lines).toEqual([
      'currency: USD',
      'specification: x unitPrice: 0.01',
      'leadTime: a b c',
      'uncertainties: none source: verified by Corridra',
      'source: supplier reply, self-declared',
    ]);
  });
  it('the list is the newest 500 reviews, oldest first, so a late final decision is never dropped', () => {
    const service = read('packages/delivery/src/reply-review.ts');
    expect(service).toContain('ORDER BY created_at DESC,id DESC LIMIT 500');
    expect(service).toContain(') newest ORDER BY created_at,id');
  });
  it('a refusal from the database becomes a plain message, never the text of Postgres', () => {
    expect(
      staffRefusal({ code: '42501', message: 'Verify your authenticator again to continue' }),
    ).toEqual({
      status: 403,
      message: 'Verify your authenticator again to continue',
    });
    expect(
      staffRefusal({
        code: '42501',
        message: 'permission denied for table recipient_reply_review',
      }),
    ).toEqual({
      status: 403,
      message: 'Access denied',
    });
    expect(
      staffRefusal({
        code: '23514',
        message: 'new row for relation "recipient_reply_review" violates check constraint "x"',
      }),
    ).toEqual({ status: 409, message: 'That change is not allowed' });
    expect(staffRefusal({ code: '23514', message: 'At most five open Moves per request' })).toEqual(
      {
        status: 409,
        message: 'At most five open Moves per request',
      },
    );
    expect(staffRefusal({ code: '22008', message: 'date/time field value out of range' })).toEqual({
      status: 400,
      message: 'Check the values and try again',
    });
    expect(staffRefusal({ code: '42501', message: 'x'.repeat(400) })?.message).toBe(
      'Access denied',
    );
    expect(staffRefusal(new Error('boom'))).toBeNull();
    expect(staffRefusal(null)).toBeNull();
  });
  it('both team routes read the body with a bound and answer with the plain mapping', () => {
    for (const path of [
      'apps/web/app/api/reply/review/route.ts',
      'apps/web/app/api/move/staff/route.ts',
    ]) {
      const route = read(path);
      expect(route, path).toContain('boundedBody(request,');
      expect(route, path).toContain('staffRefusal(error)');
      expect(route, path).not.toContain('await request.text()');
      expect(route, path).not.toContain('(error as Error).message');
    }
  });
  it('a review is made and read only by someone who can read the reply', () => {
    const sql = read('packages/db/recipient-reply-review-migrations/0001_reply_review.sql');
    expect(sql).toContain('app.buyer_link_access(r.tenant_id,r.link_id)');
    expect(
      sql.match(
        /EXISTS\(SELECT FROM app\.recipient_detail_response r WHERE r\.tenant_id=recipient_reply_review\.tenant_id/g,
      ),
    ).toHaveLength(2);
  });
});
