import { describe, expect, it } from 'vitest';
import { replyPrefillReasons, replyTermNames } from '../../packages/domain/src/reply-review';
import {
  isUuid,
  prefillFailureMessage,
  prefillMessage,
  termRows,
} from '../../apps/web/lib/reply-review-view';

// The words and term rows of the offer prepared from a reviewed supplier reply (ADR-081). No database, no browser.
const digitsOnly = (text: string) => text.replace(/[^\d.]/g, '');

describe('isUuid', () => {
  it('accepts an id and refuses anything else before a request is made', () => {
    expect(isUuid('22222222-2222-4222-8222-222222222222')).toBe(true);
    for (const bad of ['', 'x', '2222', "22222222-2222-4222-8222-22222222222'", undefined, 7, null])
      expect(isUuid(bad)).toBe(false);
  });
});

describe('prefillMessage', () => {
  it('has fixed words for every refusal code, each with a way on, and never the supplier text', () => {
    for (const code of replyPrefillReasons) {
      const text = prefillMessage(code);
      expect(text).not.toBe(prefillFailureMessage);
      expect(text).not.toMatch(/—/);
      expect(text).toMatch(/\.$/);
    }
    expect(prefillMessage('NOT_PUBLISHED')).toBe(
      'Publish this reply first. Then you can prepare an offer from it.',
    );
  });
  it('answers an unknown code with the generic message', () => {
    expect(prefillMessage('SOMETHING_ELSE')).toBe(prefillFailureMessage);
    expect(prefillMessage('toString')).toBe(prefillFailureMessage);
  });
});

describe('termRows', () => {
  it('lists the nineteen terms in review order, "Not stated" for a missing one and never zero', () => {
    const rows = termRows({ currency: 'USD', terms: { toolingMinor: '0', quantity: '10' } });
    expect(rows.map((row) => row.key)).toEqual([...replyTermNames]);
    expect(rows.find((row) => row.key === 'commissioning')).toMatchObject({
      text: 'Not stated',
      missing: true,
    });
    const tooling = rows.find((row) => row.key === 'toolingMinor');
    expect(tooling?.missing).toBe(false);
    expect(digitsOnly(tooling?.text ?? '')).toBe('0.00');
  });
  it('shows an amount above 2^53 minor units exactly', () => {
    const rows = termRows({ currency: 'USD', terms: { totalPriceMinor: '9007199254740993123' } });
    expect(digitsOnly(rows.find((row) => row.key === 'totalPriceMinor')?.text ?? '')).toBe(
      '90071992547409931.23',
    );
  });
  it('shows a zero-decimal currency without a decimal point', () => {
    const rows = termRows({ currency: 'JPY', terms: { unitPriceMinor: '123456789012345678' } });
    expect(digitsOnly(rows.find((row) => row.key === 'unitPriceMinor')?.text ?? '')).toBe(
      '123456789012345678',
    );
  });
  it('shows the exact string and the code for a currency this build does not know', () => {
    const rows = termRows({ currency: 'ZZZ' as never, terms: { unitPriceMinor: '1250' } });
    expect(rows.find((row) => row.key === 'unitPriceMinor')?.text).toBe('1250 ZZZ');
  });
});
