import './flag.css';

// Flags beside country names (UI/UX.v3 "Visual grammar and explanations", flag policy decided by the owner on
// 17 November 2026; UI/UX.v4 step 2 board, screen 02). Sovereign states and the EU bloc get a flag beside the name,
// never a flag alone. A region of several countries, such as "Key Asian Markets", gets the neutral compass mark
// (`RegionMark`), never a flag; contested places get neither. The flag pictures are static files in public/flags
// (national colours are not interface colours, so they stay out of the token layer and out of the code); the compass
// mark is painted in the text colour through a mask, so it follows the tokens. Shared by the home and /corridors.
export const flagCodes = ['bd', 'cn', 'eu', 'gb', 'us', 'au', 'es', 'fr', 'it'] as const;
export type FlagCode = (typeof flagCodes)[number];
/** What may stand before a place name: a flag, the region mark, or nothing. */
export type PlaceMark = FlagCode | 'region' | null;

/** English names for the accessible name of a mark that is not next to its written name. */
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

/** The nine written names, lower case, to their flags. A `Map`, so no object key is ever read as a place. */
const flagByName = new Map<string, FlagCode>(
  flagCodes.map((code) => [flagNames[code].toLowerCase(), code]),
);

/**
 * The mark for a place as it is stored: a country code as the forms hold it ("BD", "EU") or the written English
 * name of one of the nine ("Bangladesh"), which older records and team-written introductions carry. Its flag when
 * it is one of the nine, otherwise nothing, so every other place shows its name only. Never a guess: the whole
 * value must be the code or the name.
 */
export function placeMark(code: string | null | undefined): PlaceMark {
  const key = (code ?? '').trim().toLowerCase();
  return (flagCodes as readonly string[]).includes(key)
    ? (key as FlagCode)
    : (flagByName.get(key) ?? null);
}

/**
 * One flag. By default it is decorative (the country name is written beside it, so a screen reader hears the name
 * once). Pass `named` only where the name is not written next to it; the picture then says "<country> flag".
 */
export function Flag({
  code,
  named = false,
  size,
}: {
  code: FlagCode;
  named?: boolean;
  /** UI/UX.v4.1 L1: `row` is the 40 px mark of a route row; left out, the flag is 22 px in the line of text. */
  size?: 'row';
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 30 by 20 static SVG; no optimiser is needed
    <img
      className={size === 'row' ? 'ux-flag is-row' : 'ux-flag'}
      src={`/flags/${code}.svg`}
      width={size === 'row' ? 40 : 22}
      height={size === 'row' ? 27 : 15}
      alt={named ? `${flagNames[code]} flag` : ''}
      aria-hidden={named ? undefined : true}
      data-flag={code}
      decoding="async"
    />
  );
}

/**
 * The neutral compass mark for a region of several countries. It implies no country. Decorative beside the region's
 * written name; with `named` it says "Region of several countries".
 */
export function RegionMark({ named = false, size }: { named?: boolean; size?: 'row' }) {
  const className = size === 'row' ? 'ux-region-mark is-row' : 'ux-region-mark';
  return named ? (
    <span className={className} role="img" aria-label="Region of several countries" />
  ) : (
    <span className={className} aria-hidden="true" />
  );
}

/** A place name with its mark before it, kept on one line. */
export function Flagged({
  code,
  size,
  children,
}: {
  code: PlaceMark;
  /** UI/UX.v4.1 L1: `row` draws the 40 px mark of a route row. */
  size?: 'row';
  children: React.ReactNode;
}) {
  return (
    <span className="ux-flagged">
      {code === 'region' ? (
        <RegionMark size={size} />
      ) : code ? (
        <Flag code={code} size={size} />
      ) : null}
      <span>{children}</span>
    </span>
  );
}

/**
 * A place as it is stored (a code such as "BD" or a written name) shown as its name with its mark before it. The
 * mark comes from the stored value or the written name, so a place outside the nine shows its name only.
 */
export function Place({ value, name }: { value: string; name?: string }) {
  return <Flagged code={placeMark(value) ?? placeMark(name)}>{name ?? value}</Flagged>;
}

/** One place of a route: its written name and its mark. */
export type RoutePlace = { name: string; mark: PlaceMark };

/**
 * A route written as its places: "<from> to <place>, <place> ...", each with its mark. Screen readers hear each
 * name once, with commas between the destinations.
 */
export function RouteLine({
  from,
  to,
  word,
}: {
  from: RoutePlace;
  to: RoutePlace[];
  word: string;
}) {
  return (
    <span className="ux-route-line">
      <Flagged code={from.mark}>{from.name}</Flagged> <span className="ux-route-to">{word}</span>{' '}
      {to.map((place, i) => (
        <span key={place.name} className="ux-route-place">
          <Flagged code={place.mark}>{place.name}</Flagged>
          {i < to.length - 1 ? <span className="sr-only">, </span> : null}{' '}
        </span>
      ))}
    </span>
  );
}
