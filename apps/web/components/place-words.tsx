'use client';

import type { ReactNode } from 'react';
import { fillNodes } from '../lib/i18n/fill';
import { placeFlag, placeName, type PlaceCode } from '../lib/home-v43-data';
import type { MessageKey } from '../lib/i18n/messages';
import { Flagged } from './ux/flag';
import { useT } from './language-provider';

// Home page v4.3: a sentence that names places holds slots, never the names. {bd} {cn} {eu} {gb} {us} {au} {asia} are
// drawn as the place's mark and its written name (UI/UX.v4.1 L1: a mark before every name, the compass for Key Asian
// Markets, never a flag), and the names come from the existing keys (home.country.*, home.tr.mk.*). Other `{name}`
// slots are filled by the caller (`values`) or left as written. The text is split, never parsed as markup.
export const placeSlots = {
  bd: 'BD',
  cn: 'CN',
  eu: 'EU',
  gb: 'GB',
  us: 'US',
  au: 'AU',
  asia: 'REGION',
} as const satisfies Record<string, PlaceCode>;

export function PlaceWords({
  text,
  values = {},
}: {
  text: string;
  values?: Record<string, ReactNode>;
}) {
  const t = useT();
  const places: Record<string, ReactNode> = {};
  for (const [slot, code] of Object.entries(placeSlots))
    if (text.includes(`{${slot}}`))
      places[slot] = <Flagged code={placeFlag[code]}>{t(placeName[code])}</Flagged>;
  return <>{fillNodes(text, { ...values, ...places })}</>;
}

/** The same sentence as plain text, names without marks: for an option, an aria-label or an announcement. */
export function placeText(
  text: string,
  t: (key: MessageKey) => string,
  values: Record<string, string> = {},
): string {
  const names: Record<string, string> = { ...values };
  for (const [slot, code] of Object.entries(placeSlots)) names[slot] = t(placeName[code]);
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(names, name) ? names[name]! : whole,
  );
}
