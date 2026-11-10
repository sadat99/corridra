import { describe, expect, it } from 'vitest';
import { supportWhatsappHref } from '../../apps/web/lib/ux/support-whatsapp';

// The support WhatsApp link (docs/revamp/specs/workflow-intelligence.md, W9). Only a made-up number is used here.
const key = 'CORRIDRA_SUPPORT_WHATSAPP_NUMBER';
const href = (value: string | undefined) => supportWhatsappHref({ [key]: value });

describe('supportWhatsappHref', () => {
  it('turns a usable number into a wa.me address of its digits', () => {
    expect(href('+6500000000')).toBe('https://wa.me/6500000000');
    expect(href('6500000000')).toBe('https://wa.me/6500000000');
  });
  it('ignores whitespace around the value only', () => {
    for (const value of [' +6500000000', '6500000000 ', '\t+6500000000\n', '  6500000000  '])
      expect(href(value)).toBe('https://wa.me/6500000000');
  });
  it('accepts the 8 digit and 15 digit limits', () => {
    expect(href('12345678')).toBe('https://wa.me/12345678');
    expect(href('+123456789012345')).toBe('https://wa.me/123456789012345');
  });
  it('treats an absent, blank or non-string value as unset', () => {
    expect(supportWhatsappHref({})).toBeNull();
    expect(href(undefined)).toBeNull();
    expect(href('')).toBeNull();
    expect(href('   \t\n')).toBeNull();
    expect(supportWhatsappHref({ [key]: 6500000000 as unknown as string })).toBeNull();
    expect(supportWhatsappHref({ [key]: null as unknown as string })).toBeNull();
  });
  it('rejects a value that is not an international number, so the menus stay on Coming soon', () => {
    for (const value of [
      '1234567',
      '1234567890123456',
      '+1234567',
      '0065000000',
      '+0065000000',
      '++6500000000',
      '65+00000000',
      '+65 0000 0000',
      '65 0000 0000',
      '+65-0000-0000',
      '(650) 000 0000',
      '+65 (0) 000',
      '65000000ab',
      'call us',
      'https://wa.me/6500000000',
      'wa.me/6500000000',
      '٦٥٠٠٠٠٠٠',
      '6500000000\nextra',
      '6500000000?text=hi',
    ])
      expect(href(value), JSON.stringify(value)).toBeNull();
  });
  it('never puts a plus sign or a query in the address', () => {
    for (const value of ['+6500000000', '6500000000', '+12345678']) {
      const link = href(value)!;
      expect(link).not.toContain('+');
      expect(link).not.toContain('?');
      expect(link).toMatch(/^https:\/\/wa\.me\/[1-9][0-9]{7,14}$/);
    }
  });
  it('reads the process environment when none is given, and is unset by default', () => {
    const before = process.env[key];
    try {
      delete process.env[key];
      expect(supportWhatsappHref()).toBeNull();
      process.env[key] = '+6500000000';
      expect(supportWhatsappHref()).toBe('https://wa.me/6500000000');
    } finally {
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    }
  });
});
