import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareOffers } from '../../packages/domain/src/commercial-missions';
import { quoteCardsFrom } from '../../apps/web/lib/quote-cards';
import { mrLabelsFor } from '../../apps/web/components/mr/labels';
import type { CommercialArrangement } from '../../packages/domain/src/commercial-arrangements';

// Revamp Wave 4, spec docs/revamp/specs/sourceledger-money.md, cases M-03 to M-07: how a customer sees
// quotes and arrangements. Amounts are exact and in their own currency, an omission is shown on its
// row and never ranks an offer first, and each kind of money keeps its own words.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...c: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const when = '2099-01-01T00:00:00.000Z';
const full = {
  specification: 'Auto cutter 2.5 m bed',
  quantity: '2',
  unit: 'unit',
  unitPriceMinor: '1840000',
  totalPriceMinor: '3680000',
  leadTime: '45 days',
  validUntil: when,
  incoterm: 'FOB' as const,
  shipping: 'EXCLUDED' as const,
  paymentTerms: '30% deposit, 70% before shipping',
  toolingMinor: '0',
  setupMinor: '0',
  packagingMinor: '0',
};
const offer = (
  id: string,
  terms: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  id,
  targetId: id === 'b' ? 't2' : 't1',
  currency: 'USD',
  terms,
  revision: 1,
  uncertainties: 'None stated',
  sourceKind: 'self_declaration',
  claimStatus: 'self_declared',
  superseded: false,
  assignmentCurrent: true,
  ...extra,
});
const target = (id: string, company: string) => ({
  id,
  company,
  country: 'China',
  fit: 'HIGH',
  rationale: '',
  uncertainty: '',
  gaps: '',
  verification: '',
});
const shortlist = [target('t1', 'Lantern Cutting Works'), target('t2', 'Green Field Machinery')];
const verdictsFor = (offers: { id: string; currency: string; terms: unknown }[]) =>
  compareOffers(
    offers.map((o) => ({
      id: o.id,
      currency: o.currency,
      terms: o.terms as never,
      requirementId: '1',
      uncertainties: '',
      evidenceCurrent: true,
    })),
  );
const cardsFor = (offers: ReturnType<typeof offer>[]) =>
  quoteCardsFrom({
    offers: offers as never[],
    verdicts: verdictsFor(offers),
    shortlist: shortlist as never,
  });
async function renderCards(offers: ReturnType<typeof offer>[]) {
  const { QuoteCard } = await loadWeb('components/mr/quote-card');
  const labels = mrLabelsFor('en').quote;
  return cardsFor(offers)
    .map((card) =>
      render(
        ce(QuoteCard, {
          supplier: card.supplier,
          supplierLang: card.supplierLang,
          place: card.place,
          revision: card.revision,
          currency: card.currency,
          unitPrice: card.unitPrice,
          total: card.total,
          comparable: card.comparable,
          reason: card.reason,
          terms: card.terms,
          trust: card.trust,
          provenance: card.provenance,
          labels,
        }),
      ),
    )
    .join('\n');
}
const plain = (html: string) => html.replace(/ /g, ' ');

describe('M-03 quotes in different currencies stay separate', () => {
  const usd = offer('a', full);
  const eur = offer(
    'b',
    { ...full, unitPriceMinor: '1700000', totalPriceMinor: '3400000' },
    { currency: 'EUR' },
  );
  it('shows each total in its own currency and sums nothing', async () => {
    const { ComparisonMatrix } = await loadWeb('components/comparison-matrix');
    const html = plain(
      render(
        ce(ComparisonMatrix, {
          offers: [usd, eur] as never[],
          shortlist: [{ id: usd.targetId, company: '绿野机械有限公司' }] as never[],
          language: 'en',
        }),
      ),
    );
    // Each column head names its supplier (original script kept); no match shows no name.
    expect(html).toContain('<span lang="zh">绿野机械有限公司</span>');
    expect(html).toContain('USD 36,800.00');
    expect(html).toContain('EUR 34,000.00');
    // 36,800 + 34,000 = 70,800: no figure that adds the two may appear.
    expect(html).not.toMatch(/70,800|7080000/);
    expect(html).not.toMatch(/converted|exchange rate|equivalent|≈|in total/i);
    const cards = plain(await renderCards([usd, eur]));
    expect(cards).toContain('USD 18,400.00');
    expect(cards).toContain('EUR 17,000.00');
    expect(cards).not.toMatch(/70,800|converted|exchange rate|equivalent|≈/i);
  });
  it('treats different currencies as not comparable, with that as the reason', () => {
    const [first, second] = cardsFor([usd, eur]);
    expect([first!.comparable, second!.comparable]).toEqual([false, false]);
    expect(first!.reason).toMatch(/currenc/i);
  });
});

describe('M-04 an omitted cost or obligation is shown and never makes an offer look better', () => {
  const cheapNoInstall = offer('a', {
    ...full,
    unitPriceMinor: '900000',
    totalPriceMinor: '1800000',
  });
  const dearComplete = offer('b', {
    ...full,
    unitPriceMinor: '1840000',
    totalPriceMinor: '3680000',
    installation: 'Included, 5 days on site',
    warranty: '24 months',
    spares: '2 years of common parts',
    training: '2 days',
  });
  it('shows installation, warranty, spares and training as not stated on the cheaper offer', async () => {
    const [cheap, dear] = cardsFor([cheapNoInstall, dearComplete]);
    for (const label of ['Installation', 'Warranty', 'Spares', 'Training']) {
      expect(
        cheap!.terms.find((t) => t.label === label),
        label,
      ).toMatchObject({ value: null });
      expect(dear!.terms.find((t) => t.label === label)?.value, label).toBeTruthy();
    }
    const html = await renderCards([cheapNoInstall, dearComplete]);
    expect(html.match(/Not stated/g)!.length).toBeGreaterThanOrEqual(4);
  });
  it('does not order, rank or highlight by price', async () => {
    const cards = cardsFor([cheapNoInstall, dearComplete]);
    expect(cards.map((c) => c.id)).toEqual(['a', 'b']);
    const html = await renderCards([cheapNoInstall, dearComplete]);
    expect(html).not.toMatch(/best|cheapest|lowest|recommended|rank|winner|saves?\b/i);
    expect(html).not.toMatch(/data-(best|rank|recommended)/i);
  });
});

describe('M-05 different specifications are not comparable, with the reason, and not ranked', () => {
  const small = offer('a', full);
  const large = offer('b', { ...full, specification: 'Auto cutter 3.2 m bed, 18 kW' });
  it('names the specification as the reason on both cards', async () => {
    const [first, second] = cardsFor([small, large]);
    expect(first!.comparable).toBe(false);
    expect(second!.comparable).toBe(false);
    expect(first!.reason).toMatch(/Quoted specification/);
    expect(second!.reason).toMatch(/Quoted specification/);
    const html = await renderCards([small, large]);
    expect(html.match(/Not comparable yet/g)).toHaveLength(2);
    expect(html).not.toContain('✓');
    expect(html).not.toMatch(/best|cheapest|lowest|recommended|rank/i);
  });
});

const arrangement = (
  seller: string,
  mode: CommercialArrangement['mode'] = 'HYBRID',
): CommercialArrangement => ({
  version: 1,
  mode,
  parties: {
    buyer: 'Synthetic Rahman Knit Ltd',
    seller,
    supplier: 'Synthetic Lantern Cutting Works',
    serviceProvider: 'Synthetic Corridra service team',
    serviceFeePayer: 'Synthetic Rahman Knit Ltd',
    serviceInvoiceIssuer: 'Synthetic Corridra invoice issuer',
    servicePaymentRecipient: 'Synthetic Corridra fee recipient',
    operatingPartner: null,
    invoiceIssuer: seller,
    paymentRecipient: seller,
    deliveryResponsible: seller,
    warrantyResponsible: 'Synthetic Lantern Cutting Works',
    importerOfRecord: null,
  },
  supplyPrice: {
    currency: 'USD',
    amountMinor: '12000',
    includedServices: 'Synthetic Cutter and set-up',
    exclusions: 'Synthetic International freight',
  },
  fixedFeePositions: [1],
  commission: {
    payer: seller,
    recipient: 'Synthetic Corridra service team',
    trigger: 'Synthetic Executed sale and evidenced collection',
    baseDescription: 'Synthetic Net product value',
    baseMinor: '10000',
    currency: 'USD',
    rateBasisPoints: 2000,
    evidenceRequired: 'Synthetic Signed contract and collection evidence',
    rounding: 'HALF_UP',
    fixedFeeTreatment: 'CREDIT_FIXED_FEE',
  },
  sourceTerms: 'Synthetic Original agreed scope',
  principalStatus: 'CORRIDRA_SERVICE_PROVIDER',
});
const summary = async (terms: CommercialArrangement) => {
  const { CommercialArrangementSummary } = await loadWeb('components/commercial-arrangement');
  return plain(render(ce(CommercialArrangementSummary, { terms })));
};
const row = (html: string, label: string) =>
  html.match(new RegExp(`<dt>${label}</dt><dd>([^<]*)</dd>`))?.[1];

describe('M-06 each kind of money keeps its own words', () => {
  it('labels the supply price as the seller’s, the commission as an estimate, and claims no payment', async () => {
    const html = await summary(arrangement('Synthetic Lantern Cutting Works'));
    expect(html).toMatch(/Seller&#x27;s quoted supply price|Seller's quoted supply price/);
    expect(html).toContain('USD 120.00');
    expect(html).toMatch(/belongs\s+to the contracting seller/);
    expect(html).toContain('Conditional commission');
    expect(row(html, 'Estimated commission')).toMatch(
      /USD 20\.00\. Not earned, invoiced or collected\./,
    );
    expect(row(html, 'Trigger')).toBe('Synthetic Executed sale and evidenced collection');
    expect(html).toMatch(/No payment is taken here/);
    expect(html).toMatch(/not recorded as\s+Corridra earned revenue/);
    // The commission is never described as earned, collected or paid, except in the denial itself.
    const outsideDenial = html.replace(/Not earned, invoiced or collected\./g, '');
    expect(outsideDenial).not.toMatch(
      /commission (was|is|has been) (earned|paid|collected|invoiced)/i,
    );
  });
  it('never presents the supply price as a Corridra fee', async () => {
    const html = await summary(arrangement('Synthetic Lantern Cutting Works'));
    const supply = html.slice(
      html.indexOf('quoted supply price'),
      html.indexOf('Fixed service fees'),
    );
    expect(supply).not.toMatch(/Corridra/);
  });
});

describe('M-07 Corridra is the seller only when the arrangement names it', () => {
  it('shows the named seller and never Corridra for a third-party seller', async () => {
    const html = await summary(arrangement('Synthetic Lantern Cutting Works'));
    expect(row(html, 'Contracting seller')).toBe('Synthetic Lantern Cutting Works');
    expect(row(html, 'Supply invoice issuer')).toBe('Synthetic Lantern Cutting Works');
    expect(row(html, 'Supply payment recipient')).toBe('Synthetic Lantern Cutting Works');
    expect(row(html, 'Contracting seller')).not.toMatch(/Corridra/);
  });
  it('shows Corridra as the seller when, and only when, the arrangement says so', async () => {
    const html = await summary(arrangement('Synthetic Corridra Trading Ltd'));
    expect(row(html, 'Contracting seller')).toBe('Synthetic Corridra Trading Ltd');
  });
});

describe('M-10 no new export, and a book carries no price, quote, markup or contact', () => {
  it('pins the routes that can produce a file, so a new export has to be reviewed', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (name === 'route.ts') found.push(path.replace('apps/web/', ''));
      }
    };
    walk('apps/web/app/api');
    const { readFileSync } = await import('node:fs');
    const files = found.filter((path) =>
      /text\/csv|application\/pdf|text\/calendar|content-disposition/i.test(
        readFileSync(`apps/web/${path}`, 'utf8'),
      ),
    );
    expect(files.sort()).toEqual([
      'app/api/customer-books/route.ts',
      'app/api/customer-programme-exports/route.ts',
      'app/api/delivery/route.ts',
      'app/api/workspace/[action]/route.ts',
      'app/api/workspace/delivery/route.ts',
    ]);
  });
  it('refuses a book record that carries any money, quote, markup or contact field', async () => {
    const { bookProjection } = await import('../../packages/domain/src/books');
    const supplier = {
      schemaVersion: 1,
      kind: 'SUPPLIER',
      title: 'Cutter suppliers',
      reviewedAt: '2026-11-02T09:30:00.000Z',
      shortlist: [
        {
          company: 'Lantern Cutting Works',
          country: 'CN',
          fit: 'POSSIBLE',
          rationale: 'Makes the declared product',
          uncertainty: 'Capacity is not verified',
          gaps: '',
          verification: 'Source-reported; no independent verification asserted',
        },
      ],
    };
    expect(bookProjection.safeParse(supplier).success).toBe(true);
    const bad = [
      'price',
      'unitPriceMinor',
      'totalPriceMinor',
      'currency',
      'quote',
      'quotations',
      'offers',
      'markup',
      'markupBasisPoints',
      'acquisitionCostMinor',
      'relationshipNote',
      'email',
      'phone',
      'contact',
    ];
    for (const key of bad) {
      expect(bookProjection.safeParse({ ...supplier, [key]: 'x' }).success, key).toBe(false);
      expect(
        bookProjection.safeParse({
          ...supplier,
          shortlist: [{ ...supplier.shortlist[0], [key]: 'x' }],
        }).success,
        `item ${key}`,
      ).toBe(false);
    }
  });
});
