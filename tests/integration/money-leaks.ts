// The privacy detector shared by the money database test. It looks for private figures and key
// names inside any JSON value. Identifiers that are only shaped like numbers (UUIDs, 64-hex
// digests, ISO timestamps) are blanked first, so a random '4321' inside one is not a leak.
// Each blanked match becomes a SPACE, never an empty string, so text on either side cannot join
// into a figure. Every rule needs the exact identifier shape with hex or digit boundaries, so a
// real figure glued to an identifier leaves the pattern unmatched and is still found.
const UUID =
  /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;
const HEX_DIGEST = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/gi;
const ISO_TIMESTAMP =
  /(?<!\d)\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?(?!\d)/g;

export const stripIdentifiers = (text: string) =>
  text.replace(UUID, ' ').replace(HEX_DIGEST, ' ').replace(ISO_TIMESTAMP, ' ');

const escapeForRegex = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// '4321' -> '4,321'. Only plain digit secrets of four or more digits have a grouped form.
const groupedForm = (word: string) =>
  /^\d{4,}$/.test(word) ? word.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : null;

// The grouped literal must not follow a digit, comma or opening bracket, and must not be followed
// by a digit. That keeps the numbers of a JSON array, [4,321] or [1,4,321], from reading as a
// figure, while a formatted string such as "4,321" or "USD 4,321.00" is still found.
const groupedPresent = (text: string, grouped: string) =>
  new RegExp('(?<![\\d,\\[])' + escapeForRegex(grouped) + '(?!\\d)').test(text);

export const findLeaks = (value: unknown, secrets: readonly string[]) => {
  const text = stripIdentifiers(JSON.stringify(value));
  return secrets.filter((word) => {
    if (text.includes(word)) return true;
    const grouped = groupedForm(word);
    return grouped !== null && groupedPresent(text, grouped);
  });
};
