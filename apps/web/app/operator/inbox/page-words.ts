// Team desk v4.1, Inbox: the place a problem report was filed from, in the words of the menu instead of the
// address ("/operator/missions/..." reads "Missions"). Presentation only: the stored address is not changed and
// nothing here reads or sends anything. A place this list does not know reads "Another team page", never the address.
const places = new Map<string, string>([
  ['', 'Today'],
  ['missions', 'Missions'],
  ['research', 'Companies'],
  ['sources', 'Sources and claims'],
  ['evidence', 'Evidence review'],
  ['meetings', 'Meetings'],
  ['commercial', 'Money'],
  ['delivery', 'Reports'],
  ['network', 'Helpers'],
  ['settings', 'Settings'],
  ['inbox', 'Inbox'],
  ['supply', 'Supply Sources'],
]);

/** The menu word for the place an address belongs to, or null for an address that is not a team page. */
export function reportedPlaceWords(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = /^\/operator(?:\/([^/?#]*))?/.exec(address);
  if (!match) return null;
  return places.get(match[1] ?? '') ?? 'Another team page';
}
