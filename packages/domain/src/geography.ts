import { z } from 'zod';
import { countryCodes } from './countries';
export const countryCode = z.enum(countryCodes);
// OTHER remains an explicit legacy unclassified value, never an inferred country.
export const legacyMarketCode = z.union([countryCode, z.literal('OTHER')]);
export const timeZone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Valid IANA time zone required');
export const locale = z
  .string()
  .max(80)
  .transform((value, ctx) => {
    try {
      return Intl.getCanonicalLocales(value)[0];
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Valid BCP 47 locale required' });
      return z.NEVER;
    }
  });
export const marketScope = z
  .object({
    key: z.string().regex(/^[A-Z0-9:_-]{2,80}$/),
    kind: z.enum(['COUNTRY', 'TRADE_BLOC', 'REGION', 'SUBDIVISION', 'CITY', 'COMMERCIAL_CLUSTER']),
    country: countryCode.optional(),
    name: z.string().trim().min(2).max(160),
  })
  .strict()
  .refine(
    (v) => v.kind !== 'COUNTRY' || v.key === v.country,
    'Country identity must equal ISO code',
  );
