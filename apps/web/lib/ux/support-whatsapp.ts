// The support WhatsApp link behind the Help menus. Pure and server-side: it reads the owner's setting from the
// environment it is given, returns a wa.me address or null, and never logs the value. Unset, blank or not a usable
// number all mean null, and the menus then say Coming soon exactly as before. The link carries no prefilled text.
// Owner setting: CORRIDRA_SUPPORT_WHATSAPP_NUMBER (docs/revamp/specs/workflow-intelligence.md, W9).

// Digits with an optional leading +, 8 to 15 digits, the first digit not 0 (the shape of an international number).
const usableNumber = /^\+?([1-9][0-9]{7,14})$/;

export function supportWhatsappHref(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env.CORRIDRA_SUPPORT_WHATSAPP_NUMBER;
  if (typeof value !== 'string') return null;
  const match = usableNumber.exec(value.trim());
  return match ? `https://wa.me/${match[1]}` : null;
}
