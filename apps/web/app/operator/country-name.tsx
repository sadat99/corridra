'use client';
// A stored country code as a person reads it (UI/UX.v4.1 L1, team desk v4.1): its mark, then its name. A flag
// for one of the nine places that have one, the name only for every other place (a contested place never gets a
// mark), and never a mark alone. With CORRIDRA_UX_TEAM_DESK_V41 off the code is shown exactly as it was. The
// names come from the browser's own data, so this is for values drawn after the page has loaded its records.
import { Flagged, placeMark } from '../../components/ux/flag';
import { useOperatorFlags } from './operator-flags';

/**
 * The written English name of a stored market or country code ("BD", "EU"); the code itself when it has none. The
 * legacy code "OTHER" (a market not yet classified) reads "Other", never the bare code.
 */
export function countryName(code: string): string {
  if (code === 'OTHER') return 'Other';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function CountryName({
  code,
  size,
  off,
}: {
  code: string;
  size?: 'row';
  /** What the switch-off screen shows instead of the code, for a sample that always wrote the name. */
  off?: string;
}) {
  const { teamDeskV41 } = useOperatorFlags();
  if (!teamDeskV41) return off ?? code;
  return (
    <Flagged code={placeMark(code)} size={size}>
      {countryName(code)}
    </Flagged>
  );
}
