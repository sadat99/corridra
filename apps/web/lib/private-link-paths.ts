// The paste-a-private-link field on /access/link. Pure rules, so the privacy controls are tested without a browser.
//
// A private link is `origin + path + '#' + token`. The token stays in the address fragment, which a browser never sends
// to a server, so this module only ever sees it in the visitor's own browser and never logs, stores or returns it.
// A pasted link opens only when it is exactly one of the links Corridra itself issues:
//   /buyer           packages/communications/src/index.ts:359 (`/buyer#<64 hex>`), read by app/buyer/introduction.tsx
//   /client          packages/delivery/src/index.ts:347 (path), composed with the token at app/operator/delivery.tsx:335,
//   /programme       read by app/delivery-view.tsx through components/private-capability.ts (64 hex)
//   /decision-card   apps/web/lib/decision-card-owner.ts:94 (`/decision-card#<43 base64url>`), read by tokenFromHash
// Mute links are one-click actions with a variable path and are deliberately not on this list.

const hex64 = /^[0-9a-f]{64}$/;
const base64url43 = /^[A-Za-z0-9_-]{43}$/;

/** The closed list: each path with the exact shape of the token Corridra issues for it. */
export const privateLinkPaths: ReadonlyArray<{ path: string; token: RegExp }> = [
  { path: '/buyer', token: hex64 },
  { path: '/client', token: hex64 },
  { path: '/programme', token: hex64 },
  { path: '/decision-card', token: base64url43 },
];

// Whitespace and control characters (a URL parser silently drops tabs and line breaks inside a link, so "/buy<LF>er"
// would otherwise read as "/buyer"), zero-width and bidirectional marks, backslashes (read as a slash) and percent signs
// (no issued link contains one, so an encoded trick has nowhere to hide).
const forbidden =
  /[\s\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff\\%]/;

const longest = 256;

/**
 * The address to open for a pasted link, or null for anything else. `origin` is the site's own origin
 * (window.location.origin). Whitespace around the whole paste is ignored (String.trim, which also covers a byte-order
 * mark and an ideographic space); nothing is ignored inside it.
 * The result is rebuilt only from the origin, a path on the list and a token of the exact shape, and it must equal
 * what was pasted, so no part of the input can reach the address except as the link it already is.
 */
export function parsePrivateLink(input: unknown, origin: unknown): string | null {
  if (typeof input !== 'string' || typeof origin !== 'string') return null;
  const text = input.trim();
  if (text.length === 0 || text.length > longest || forbidden.test(text)) return null;
  let own: URL;
  let url: URL;
  try {
    own = new URL(origin);
    url = new URL(text);
  } catch {
    return null;
  }
  if (own.protocol !== 'https:' && own.protocol !== 'http:') return null;
  if (own.origin !== origin || url.origin !== own.origin) return null;
  if (url.username !== '' || url.password !== '' || text.includes('?')) return null;
  const entry = privateLinkPaths.find((e) => e.path === url.pathname);
  if (!entry || !url.hash.startsWith('#')) return null;
  const token = url.hash.slice(1);
  if (!entry.token.test(token)) return null;
  const href = `${own.origin}${entry.path}#${token}`;
  return href === text ? href : null;
}
