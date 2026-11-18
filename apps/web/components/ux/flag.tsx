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

/**
 * One flag. By default it is decorative (the country name is written beside it, so a screen reader hears the name
 * once). Pass `named` only where the name is not written next to it; the picture then says "<country> flag".
 */
export function Flag({ code, named = false }: { code: FlagCode; named?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 30 by 20 static SVG; no optimiser is needed
    <img
      className="ux-flag"
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

/**
 * The neutral compass mark for a region of several countries. It implies no country. Decorative beside the region's
 * written name; with `named` it says "Region of several countries".
 */
export function RegionMark({ named = false }: { named?: boolean }) {
  return named ? (
    <span className="ux-region-mark" role="img" aria-label="Region of several countries" />
  ) : (
    <span className="ux-region-mark" aria-hidden="true" />
  );
}

/** A place name with its mark before it, kept on one line. */
export function Flagged({ code, children }: { code: PlaceMark; children: React.ReactNode }) {
  return (
    <span className="ux-flagged">
      {code === 'region' ? <RegionMark /> : code ? <Flag code={code} /> : null}
      <span>{children}</span>
    </span>
  );
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
