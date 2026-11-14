import { describe, expect, it } from 'vitest';

// The paste-a-private-link field on /access/link (access doors, Unit E). The validator is the privacy control: it
// accepts only a link Corridra itself issues, on the site's own origin, with the fragment kept, and nothing else.
const load = async () => await import(/* @vite-ignore */ '../../apps/web/lib/private-link-paths');

const origin = 'https://corridra.com';
const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const b64 = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE'.slice(0, 43);
const issued = [
  { path: '/buyer', token: hex },
  { path: '/client', token: hex },
  { path: '/programme', token: hex },
  { path: '/decision-card', token: b64 },
];

describe('the private link validator', () => {
  it('has a token fixture of the right length', () => {
    expect(hex).toHaveLength(64);
    expect(b64).toHaveLength(43);
  });

  it('keeps a closed list of exactly the issued paths', async () => {
    const { privateLinkPaths } = await load();
    expect(privateLinkPaths.map((e: { path: string }) => e.path)).toEqual(
      issued.map((i) => i.path),
    );
  });

  it.each(issued)(
    'accepts $path on its own origin and keeps the fragment',
    async ({ path, token }) => {
      const { parsePrivateLink } = await load();
      expect(parsePrivateLink(`${origin}${path}#${token}`, origin)).toBe(
        `${origin}${path}#${token}`,
      );
    },
  );

  it('ignores spaces and line breaks around the whole paste, never inside it', async () => {
    const { parsePrivateLink } = await load();
    const link = `${origin}/buyer#${hex}`;
    expect(parsePrivateLink(`  ${link}\n`, origin)).toBe(link);
    expect(parsePrivateLink(`\t${link}\r\n`, origin)).toBe(link);
  });

  it('works on a local origin with a port', async () => {
    const { parsePrivateLink } = await load();
    const local = 'http://127.0.0.1:3100';
    expect(parsePrivateLink(`${local}/client#${hex}`, local)).toBe(`${local}/client#${hex}`);
    expect(parsePrivateLink(`http://127.0.0.1:3101/client#${hex}`, local)).toBeNull();
    expect(parsePrivateLink(`https://127.0.0.1:3100/client#${hex}`, local)).toBeNull();
  });

  const refused: Array<[string, string]> = [
    ['an empty paste', ''],
    ['only spaces', '   \n\t '],
    ['not a link', 'hello'],
    ['another host', `https://evil.example/buyer#${hex}`],
    ['a look-alike host (suffix)', `https://corridra.com.evil.example/buyer#${hex}`],
    ['a look-alike host (prefix)', `https://evilcorridra.com/buyer#${hex}`],
    ['a look-alike host (subdomain)', `https://www.corridra.com/buyer#${hex}`],
    ['userinfo that names the real host', `https://corridra.com@evil.example/buyer#${hex}`],
    ['userinfo before the real host', `https://evil.example@corridra.com/buyer#${hex}`],
    ['the wrong scheme', `http://corridra.com/buyer#${hex}`],
    ['the wrong port', `https://corridra.com:8443/buyer#${hex}`],
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: that ends in the link', `javascript://corridra.com/buyer#${hex}%0Aalert(1)`],
    ['data:', `data:text/html,<script>alert(1)</script>#${hex}`],
    ['a protocol-relative link', `//corridra.com/buyer#${hex}`],
    ['a protocol-relative link to another host', `//evil.example/buyer#${hex}`],
    ['a bare path', `/buyer#${hex}`],
    ['a slash-slash path', `${origin}//evil.example/buyer#${hex}`],
    ['a path not on the list', `${origin}/operator#${hex}`],
    ['a sign-in page', `${origin}/account#${hex}`],
    ['a longer path', `${origin}/buyer/extra#${hex}`],
    ['a trailing slash', `${origin}/buyer/#${hex}`],
    ['a path in other case', `${origin}/Buyer#${hex}`],
    ['a dot segment', `${origin}/client/../buyer#${hex}`],
    ['a path with no fragment', `${origin}/buyer`],
    ['an empty fragment', `${origin}/buyer#`],
    ['a query string', `${origin}/buyer?x=1#${hex}`],
    ['a token in the query string', `${origin}/buyer?t=${hex}`],
    ['an empty query', `${origin}/buyer?#${hex}`],
    ['a short token', `${origin}/buyer#${hex.slice(0, 63)}`],
    ['a long token', `${origin}/buyer#${hex}0`],
    ['a token of the wrong kind for the path', `${origin}/buyer#${b64}`],
    ['an upper-case hex token', `${origin}/buyer#${hex.toUpperCase()}`],
    ['a second fragment', `${origin}/buyer#${hex}#${hex}`],
    ['text after the link', `${origin}/buyer#${hex} and more`],
    ['text before the link', `open ${origin}/buyer#${hex}`],
    ['two links', `${origin}/buyer#${hex} ${origin}/client#${hex}`],
    ['a space inside the path', `${origin}/bu yer#${hex}`],
    ['a line break inside the path', `${origin}/bu\nyer#${hex}`],
    ['a tab inside the host', `https://corri\tdra.com/buyer#${hex}`],
    ['a line break inside the scheme', `ht\ntps://corridra.com/buyer#${hex}`],
    ['a line break inside the token', `${origin}/buyer#${hex.slice(0, 20)}\n${hex.slice(20)}`],
    ['a non-breaking space inside', `${origin}/buyer#${hex.slice(0, 10)}\u00a0${hex.slice(10)}`],
    ['a zero-width space inside', `${origin}/bu\u200byer#${hex}`],
    ['a byte-order mark inside', `${origin}/buyer#\ufeff${hex}`],
    ['a right-to-left mark', `${origin}/buyer#${hex}\u200f`],
    ['a leading control character', `\u0000${origin}/buyer#${hex}`],
    ['a backslash', `${origin}\\buyer#${hex}`],
    ['a backslash host trick', `https:\\\\corridra.com\\buyer#${hex}`],
    ['an encoded path', `${origin}/%62uyer#${hex}`],
    ['an encoded slash', `${origin}%2Fbuyer#${hex}`],
    ['an encoded fragment', `${origin}/buyer#%61${hex.slice(1)}`],
    ['an encoded host', `https://corridra%2Ecom/buyer#${hex}`],
    ['an encoded dot segment', `${origin}/%2e%2e/buyer#${hex}`],
    ['a double-encoded path', `${origin}/%2562uyer#${hex}`],
    ['full-width characters', `https://corridra.com/\uff42uyer#${hex}`],
    ['an internationalised look-alike host', `https://corr\u0456dra.com/buyer#${hex}`],
    ['an upper-case path with a token', `${origin}/CLIENT#${hex}`],
    ['a very long paste', `${origin}/buyer#${hex}${'a'.repeat(5000)}`],
  ];

  it.each(refused)('refuses %s', async (_name, input) => {
    const { parsePrivateLink } = await load();
    expect(parsePrivateLink(input, origin)).toBeNull();
  });

  it('refuses every input that is not a string', async () => {
    const { parsePrivateLink } = await load();
    for (const value of [undefined, null, 5, {}, [], [`${origin}/buyer#${hex}`], true]) {
      expect(parsePrivateLink(value, origin)).toBeNull();
    }
  });

  it('refuses when the site origin itself is not a plain web origin', async () => {
    const { parsePrivateLink } = await load();
    const link = `${origin}/buyer#${hex}`;
    for (const bad of [
      undefined,
      null,
      '',
      'null',
      'javascript:alert(1)',
      `${origin}/`,
      `${origin}/x`,
    ]) {
      expect(parsePrivateLink(link, bad)).toBeNull();
    }
  });

  it('returns an address built from the origin, a listed path and the token, and nothing else', async () => {
    const { parsePrivateLink } = await load();
    for (const { path, token } of issued) {
      const href = parsePrivateLink(`${origin}${path}#${token}`, origin) as string;
      const url = new URL(href);
      expect(url.origin).toBe(origin);
      expect(url.pathname).toBe(path);
      expect(url.search).toBe('');
      expect(url.hash).toBe(`#${token}`);
    }
  });
});
