import './flag.css';

// Flags beside country names (UI/UX.v3, "Visual grammar and explanations", flag policy decided by the owner on
// 17 November 2026): sovereign states and the EU bloc get a flag beside the name, never a flag alone; contested places
// and regions such as "key Asian markets" show the name only, so they have no code here. The pictures are static files
// in public/flags (national colours are not interface colours, so they stay out of the token layer and the code).
export const flagCodes = ['bd', 'cn', 'eu', 'gb', 'us', 'au', 'es', 'fr', 'it'] as const;
export type FlagCode = (typeof flagCodes)[number];

/** English names for the accessible name of a flag that is not next to its written name. */
const flagNames: Record<FlagCode, string> = {
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

/**
 * One flag. By default it is decorative (the country name is written beside it, so a screen reader hears the name
 * once). Pass `named` only where the name is not written next to it; the picture then says "<country> flag".
 */
export function Flag({ code, named = false }: { code: FlagCode; named?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 30 by 20 static SVG; no optimiser is needed
    <img
      className="cr-flag"
      src={`/flags/${code}.svg`}
      width={22}
      height={15}
      alt={named ? `${flagNames[code]} flag` : ''}
      aria-hidden={named ? undefined : true}
      data-flag={code}
      decoding="async"
    />
  );
}

/** A country name with its flag before it, kept on one line. */
export function Flagged({ code, children }: { code: FlagCode | null; children: React.ReactNode }) {
  return (
    <span className="cr-flagged">
      {code ? <Flag code={code} /> : null}
      <span>{children}</span>
    </span>
  );
}
