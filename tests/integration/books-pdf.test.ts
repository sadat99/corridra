import { describe, expect, it } from 'vitest';
import {
  bookInput,
  bookProjection,
  bookResult,
  type BookRecord,
} from '../../packages/domain/src/books';
import { DomainError } from '../../packages/domain/src/index';
import { bookLines, bookPdf } from '../../packages/delivery/src/report';
import { pdfPages } from './pdf-text';

// The book shapes and the PDF writer (ADR-076 items 1 to 3). The database function that builds a projection
// is proved in customer-books.test.ts; these checks prove what a projection may carry and what a file says.
const id = '3f9a1c0b-7d2e-4a55-9c1a-0a1b2c3d4e5f';
const digest = '3f9a1c0b7d2e4a55' + '0'.repeat(48);
const record = (projection: BookRecord['projection'], kind: BookRecord['kind']): BookRecord => ({
  resourceId: id,
  kind,
  command: id,
  digest,
  generatedAt: '2026-11-03T14:05:00Z',
  expiresAt: '2026-11-10T14:05:00Z',
  replayed: false,
  projection,
});
const trip = record(
  {
    schemaVersion: 1,
    kind: 'TRIP',
    title: 'Dhaka textile buyers',
    company: 'Synthetic Textiles Ltd',
    objective: 'Meet buyers of cotton towels',
    reviewedAt: '2026-11-02T09:30:00.123456Z',
    itinerary: [
      {
        label: 'Factory visit',
        status: 'SCHEDULED',
        changed: false,
        startsAt: '2026-11-09T04:00:00.000000Z',
        endsAt: '2026-11-09T05:00:00.000000Z',
        timezone: 'Asia/Dhaka',
        location: 'Gazipur site',
      },
      { label: 'Undated call', status: 'PROPOSED', changed: false },
      { label: 'Moved lunch', status: 'RESCHEDULE_REQUIRED', changed: true },
    ],
  },
  'TRIP',
);
const supplier = record(
  {
    schemaVersion: 1,
    kind: 'SUPPLIER',
    title: 'Dhaka textile buyers',
    reviewedAt: '2026-11-02T09:30:00.123456Z',
    shortlist: [
      {
        company: 'Synthetic Mills',
        country: 'BD',
        fit: 'POSSIBLE',
        rationale: 'Makes the declared product',
        uncertainty: 'Capacity is not verified',
        gaps: '',
        verification: 'Source-reported; no independent verification asserted',
      },
    ],
  },
  'SUPPLIER',
);
const withItems = (count: number): BookRecord => ({
  ...supplier,
  projection: {
    ...(supplier.projection as Extract<BookRecord['projection'], { kind: 'SUPPLIER' }>),
    shortlist: Array.from({ length: count }, (_, index) => ({
      company: `Company ${index + 1} 中文公司`,
      country: 'CN',
      fit: 'STRONG',
      rationale: 'A long reason. '.repeat(40),
      uncertainty: 'u',
      gaps: 'g',
      verification: 'Source-reported; no independent verification asserted',
    })),
  },
});

describe('book shapes', () => {
  it('accepts the exact Trip and Supplier projections', () => {
    expect(bookProjection.safeParse(trip.projection).success).toBe(true);
    expect(bookProjection.safeParse(supplier.projection).success).toBe(true);
  });
  it('rejects an extra key, so a field the database function did not name never reaches a file', () => {
    for (const extra of ['price', 'brief', 'contact', 'quotations', 'targetId'])
      expect(bookProjection.safeParse({ ...trip.projection, [extra]: 'x' }).success).toBe(false);
    expect(bookProjection.safeParse({ ...supplier.projection, offers: [] }).success).toBe(false);
    const item = (supplier.projection as { shortlist: object[] }).shortlist[0];
    expect(
      bookProjection.safeParse({
        ...supplier.projection,
        shortlist: [{ ...item, targetId: id }],
      }).success,
    ).toBe(false);
  });
  it('rejects a changed schedule that still carries an old time or place', () => {
    const changed = {
      ...trip.projection,
      itinerary: [{ label: 'Lunch', status: 'SCHEDULED', changed: true, location: 'Old room' }],
    };
    expect(bookProjection.safeParse(changed).success).toBe(false);
  });
  it('requires the literal acknowledgement and a known kind, and refuses unknown input keys', () => {
    const input = { resourceId: id, commandId: id, kind: 'TRIP', acknowledged: true };
    expect(bookInput.safeParse(input).success).toBe(true);
    expect(bookInput.safeParse({ ...input, acknowledged: false }).success).toBe(false);
    expect(bookInput.safeParse({ ...input, kind: 'CSV' }).success).toBe(false);
    expect(bookInput.safeParse({ ...input, tenantId: id }).success).toBe(false);
  });
  it('treats an empty book as a state and rejects a record without its digest', () => {
    expect(bookResult.safeParse({ state: 'EMPTY' }).success).toBe(true);
    expect(bookResult.safeParse({ ...trip, digest: undefined }).success).toBe(false);
  });
});

describe('what a book says', () => {
  it('prints the Trip Book in the designed order with plain words and the zone of each place', () => {
    expect(bookLines(trip)).toEqual([
      'Corridra Trip Book',
      'Dhaka textile buyers',
      'Company: Synthetic Textiles Ltd',
      'Objective: Meet buyers of cotton towels',
      'Reviewed by the Corridra team: 2 Nov 2026, 09:30 UTC',
      'Created: 3 Nov 2026, 14:05 UTC. Content code: 3f9a1c0b7d2e4a55',
      'Important',
      'This file is a copy as of the time above. A copy that has left Corridra cannot be recalled, and later changes or withdrawal do not update it. Check the current status in your account.',
      'Meetings and visits (3)',
      '1. Factory visit',
      'Status: Time confirmed',
      'Starts: 9 Nov 2026, 10:00 (Dhaka, UTC+6)',
      'Ends: 9 Nov 2026, 11:00 (Dhaka, UTC+6)',
      'Place: Gazipur site',
      '2. Undated call',
      'Status: Suggested',
      'No confirmed time yet.',
      'Place: Not shared yet',
      '3. Moved lunch',
      'Status: Date changed',
      'The date or time has changed. The old time is not shown. Ask the Corridra team for the new one.',
      'End of Trip Book. 3 meetings and visits.',
    ]);
  });
  it('prints the Supplier Book with the mission title as its heading and says what is not stated', () => {
    expect(bookLines(supplier)).toEqual([
      'Corridra Supplier Book',
      'Dhaka textile buyers',
      'Reviewed by the Corridra team: 2 Nov 2026, 09:30 UTC',
      'Created: 3 Nov 2026, 14:05 UTC. Content code: 3f9a1c0b7d2e4a55',
      'Important',
      'This file is a copy as of the time above. A copy that has left Corridra cannot be recalled, and later changes or withdrawal do not update it. Check the current status in your account.',
      'Companies reviewed (1)',
      '1. Synthetic Mills (Bangladesh)',
      'Fit: Possible fit',
      'Reason: Makes the declared product',
      'What is uncertain: Capacity is not verified',
      'What is missing: Not stated yet',
      'Verification: Source-reported; no independent verification asserted',
      'End of Supplier Book. 1 company.',
    ]);
  });
  it('never says digest, never uses a dash as a sentence break, and states the no-recall notice', () => {
    for (const book of [trip, supplier]) {
      const text = bookLines(book).join('\n');
      expect(text).not.toMatch(/digest/i);
      expect(text).not.toMatch(/[–—]/);
      expect(text).toContain('cannot be recalled');
    }
  });
  it('prints no old time, zone or place for a changed schedule', () => {
    const lines = bookLines({
      ...trip,
      projection: {
        ...(trip.projection as Extract<BookRecord['projection'], { kind: 'TRIP' }>),
        title: 'Towel buyers',
        itinerary: [{ label: 'Lunch', status: 'SCHEDULED', changed: true }],
      },
    });
    expect(lines.join('\n')).not.toMatch(/Starts|Ends|Place|UTC\+|Dhaka|Gazipur/);
  });
});

describe('the book PDF', () => {
  it('renders the same bytes for the same projection and creation time', async () => {
    for (const book of [trip, supplier]) {
      const a = await bookPdf(book);
      const b = await bookPdf(book);
      expect(a.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(a.equals(b)).toBe(true);
    }
  });
  it('records the creation time and the book name in the file information', async () => {
    const text = (await bookPdf(trip)).toString('latin1');
    expect(text).toContain('(D:20261103140500Z)');
    expect(text).toContain('(Corridra Trip Book)');
  });
  it('refuses text the PDF fonts cannot show with the books message and the UNSUPPORTED_TEXT reason, and never substitutes it', async () => {
    const titled = (title: string): BookRecord => ({
      ...trip,
      projection: {
        ...(trip.projection as Extract<BookRecord['projection'], { kind: 'TRIP' }>),
        title,
      },
    });
    // Emoji, Arabic, Thai and Devanagari are not in the three embedded fonts.
    for (const title of ['Buyers 🛸', 'مرحبا', 'สวัสดี', 'नमस्ते']) {
      const error = await bookPdf(titled(title)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).status).toBe(422);
      expect((error as DomainError).code).toBe('UNSUPPORTED_TEXT');
      expect((error as DomainError).message).toContain('This book cannot be made');
      expect((error as DomainError).message).not.toMatch(/CSV/);
    }
  });
  it('reads a long list with Chinese names back from the file, Latin and CJK names both kept', async () => {
    const pages = pdfPages(await bookPdf(withItems(3)));
    const text = pages.flatMap((page) => page.lines.map((line) => line.text)).join('\n');
    expect(text).toContain('Company 1 ');
    expect(text).toContain('中文公司');
  });
});

describe('the book PDF layout, read back from the file', () => {
  it('puts the footer with the book name, content code and page count on every page', async () => {
    for (const book of [withItems(40), trip]) {
      const pages = pdfPages(await bookPdf(book));
      const name = book.projection.kind === 'TRIP' ? 'Trip Book' : 'Supplier Book';
      if (book.projection.kind === 'SUPPLIER') expect(pages.length).toBeGreaterThan(3);
      pages.forEach((page, index) => {
        const footer = page.lines.filter((line) => line.size === 8);
        expect(footer.map((line) => line.text)).toEqual([
          `Corridra ${name} | Content code 3f9a1c0b7d2e4a55 | Page ${index + 1} of ${pages.length}`,
        ]);
      });
    }
  });
  it('wraps an unbroken run at the margin with every character kept and no line wider than the text area', async () => {
    const run = 'https://' + 'a1b2c3d4e5'.repeat(30);
    const long = withItems(1);
    const projection = long.projection as Extract<BookRecord['projection'], { kind: 'SUPPLIER' }>;
    const book: BookRecord = {
      ...long,
      projection: { ...projection, shortlist: [{ ...projection.shortlist[0]!, rationale: run }] },
    };
    const lines = pdfPages(await bookPdf(book)).flatMap((page) => page.lines);
    const reason = lines.filter(
      (line) => line.text.startsWith('Reason: ') || /^[a-z0-9:/]{20,}$/.test(line.text),
    );
    // The run was cut into several lines, and joined back it is exactly the text that was given.
    expect(reason.length).toBeGreaterThan(2);
    expect(reason.map((line) => line.text).join('')).toBe('Reason: ' + run);
    // A4 is 595.28 points wide with 45 point margins.
    const textWidth = 595.28 - 2 * 45;
    for (const line of lines) {
      expect(line.x).toBeGreaterThanOrEqual(45);
      expect(line.x + line.width).toBeLessThanOrEqual(45 + textWidth + 1);
    }
  });
  it('shows each of the eight meeting statuses in plain words, and a changed one with its own sentence', () => {
    const words: Record<string, string> = {
      PROPOSED: 'Suggested',
      ACCEPTED: 'Accepted',
      SCHEDULED: 'Time confirmed',
      HELD: 'Done',
      DECLINED: 'Declined',
      CANCELLED: 'Cancelled',
      NO_SHOW: 'Missed',
      RESCHEDULE_REQUIRED: 'New time needed',
    };
    for (const [status, word] of Object.entries(words)) {
      const changed = status === 'RESCHEDULE_REQUIRED';
      const lines = bookLines({
        ...trip,
        projection: {
          ...(trip.projection as Extract<BookRecord['projection'], { kind: 'TRIP' }>),
          itinerary: [{ label: 'Visit', status, changed }],
        },
      });
      // The database marks RESCHEDULE_REQUIRED as changed, and a changed item says so instead of the status.
      expect(lines).toContain(changed ? 'Status: Date changed' : `Status: ${word}`);
      expect(
        lines.includes(
          'The date or time has changed. The old time is not shown. Ask the Corridra team for the new one.',
        ),
      ).toBe(changed);
    }
    const unknown = bookLines({
      ...trip,
      projection: {
        ...(trip.projection as Extract<BookRecord['projection'], { kind: 'TRIP' }>),
        itinerary: [{ label: 'Visit', status: 'SOMETHING_NEW', changed: false }],
      },
    });
    expect(unknown).toContain('Status: SOMETHING_NEW');
  });
  it('shows each of the four fit values in plain words and an unknown value as given', () => {
    const fits: Record<string, string> = {
      RESEARCH: 'Still being researched',
      POSSIBLE: 'Possible fit',
      STRONG: 'Strong fit',
      UNSUITABLE: 'Not a fit',
      SOMETHING_NEW: 'SOMETHING_NEW',
    };
    for (const [fit, word] of Object.entries(fits)) {
      const lines = bookLines({
        ...supplier,
        projection: {
          ...(supplier.projection as Extract<BookRecord['projection'], { kind: 'SUPPLIER' }>),
          shortlist: [
            {
              ...(supplier.projection as { shortlist: { company: string }[] }).shortlist[0]!,
              fit,
            } as never,
          ],
        },
      });
      expect(lines).toContain(`Fit: ${word}`);
    }
  });
  it('writes the country as an English name, and the code itself when no name is known', () => {
    const named = (country: string) =>
      bookLines({
        ...supplier,
        projection: {
          ...(supplier.projection as Extract<BookRecord['projection'], { kind: 'SUPPLIER' }>),
          shortlist: [
            { ...(supplier.projection as { shortlist: object[] }).shortlist[0]!, country } as never,
          ],
        },
      }).find((line) => line.startsWith('1. '));
    expect(named('BD')).toBe('1. Synthetic Mills (Bangladesh)');
    expect(named('CN')).toBe('1. Synthetic Mills (China)');
    expect(named('ZZ')).toBe('1. Synthetic Mills (ZZ)');
    expect(named('x1')).toBe('1. Synthetic Mills (x1)');
    expect(named('Bangladesh')).toBe('1. Synthetic Mills (Bangladesh)');
  });
});
