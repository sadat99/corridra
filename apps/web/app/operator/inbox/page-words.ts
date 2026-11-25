// Team desk v4.1, Inbox: the place a problem report was filed from, in the words of the menu instead of the
// address ("/operator/missions/..." reads "Missions"). Presentation only: the stored address is not changed and
// nothing here reads or sends anything. The words come from the same two lists the menu itself is built from (the
// section addresses in lib/operator-urls.ts and the labels of menu v3 in lib/ux/team-map.ts), so a new page needs no
// entry here. A place this does not know reads "Another team page"; the caller always keeps the stored address beside
// the words.
import { operatorSlugs } from '../../../lib/operator-urls';
import { menuV3, teamAccountPlaces } from '../../../lib/ux/team-map';

/** Section id to the menu word: the label of the place in menu v3, then the avatar menu (the Authenticator). */
const labelBySection = new Map<string, string>();
for (const group of menuV3)
  for (const item of group.items)
    for (const place of item.places) labelBySection.set(place.id, place.label);
for (const place of teamAccountPlaces('owner'))
  if (!labelBySection.has(place.id)) labelBySection.set(place.id, place.label);

const places = new Map<string, string>();
for (const [section, slug] of Object.entries(operatorSlugs)) {
  const label = labelBySection.get(section);
  if (label) places.set(slug, label);
}
// Pages that are not workspace sections: the Inbox and Supply pages carry their menu item's word.
for (const group of menuV3)
  for (const item of group.items) if (item.special) places.set(item.special, item.label);
places.set('owner', 'Owner page');

/**
 * The menu word for the place an address belongs to, or null for an address that is not a team page. The bare
 * workspace address (`/operator`) is also null: the query and the part after `#` are not stored, so it can be any
 * section of the workspace home, and the caller shows the stored address instead of a guess.
 */
export function reportedPlaceWords(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = /^\/operator(?:\/([^/?#]*))?/.exec(address);
  if (!match) return null;
  const slug = match[1] ?? '';
  if (slug === '') return null;
  return places.get(slug) ?? 'Another team page';
}
