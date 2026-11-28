import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The round map-pin flags of the home and the request page were a constant string written into the page as HTML (which
// the semgrep rule security.corridra-no-raw-html refuses), then SVG elements in a component (national colours in code,
// which the colour guard refuses). They are now static files in apps/web/public/map-flags, the way the flags of
// public/flags are served, and the map draws each as an image. These checks pin each file to the old drawing, shape
// for shape, so the pins look exactly as before. UAE and Singapore are sovereign states, so a flag for each is allowed
// by the flag policy (ui-direction.md, "Flags only for sovereign states and the EU").

/** The markup the component injected before (commit aefdcd1), one flag per line. */
const before = [
  '<clipPath id="hv7-cp-bd"><circle cx="12" cy="12" r="12"/></clipPath><symbol id="hv7-fl-bd" viewBox="0 0 24 24"><g clip-path="url(#hv7-cp-bd)"><rect width="24" height="24" fill="#006A4E"/><circle cx="10.5" cy="12" r="5.5" fill="#F42A41"/></g></symbol>',
  '<clipPath id="hv7-cp-cn"><circle cx="12" cy="12" r="12"/></clipPath><symbol id="hv7-fl-cn" viewBox="0 0 24 24"><g clip-path="url(#hv7-cp-cn)"><rect width="24" height="24" fill="#DE2910"/><polygon points="6.50,3.40 7.35,5.84 9.92,5.89 7.87,7.44 8.62,9.91 6.50,8.44 4.38,9.91 5.13,7.44 3.08,5.89 5.65,5.84" fill="#FFDE00"/><circle cx="12.5" cy="3.2" r=".9" fill="#FFDE00"/><circle cx="14.5" cy="6" r=".9" fill="#FFDE00"/><circle cx="14.5" cy="9.4" r=".9" fill="#FFDE00"/><circle cx="12.5" cy="12.2" r=".9" fill="#FFDE00"/></g></symbol>',
  '<clipPath id="hv7-cp-ae"><circle cx="12" cy="12" r="12"/></clipPath><symbol id="hv7-fl-ae" viewBox="0 0 24 24"><g clip-path="url(#hv7-cp-ae)"><rect width="24" height="8" fill="#00732F"/><rect y="8" width="24" height="8" fill="#fff"/><rect y="16" width="24" height="8" fill="#000"/><rect width="7.5" height="24" fill="#EF3340"/></g></symbol>',
  '<clipPath id="hv7-cp-sg"><circle cx="12" cy="12" r="12"/></clipPath><symbol id="hv7-fl-sg" viewBox="0 0 24 24"><g clip-path="url(#hv7-cp-sg)"><rect width="24" height="12" fill="#EF3340"/><rect y="12" width="24" height="12" fill="#fff"/><circle cx="7.5" cy="6.2" r="3.7" fill="#fff"/><circle cx="9" cy="6.2" r="3.2" fill="#EF3340"/><circle cx="17.90" cy="6.20" r="0.7" fill="#fff"/><circle cx="15.55" cy="9.43" r="0.7" fill="#fff"/><circle cx="11.75" cy="8.20" r="0.7" fill="#fff"/><circle cx="11.75" cy="4.20" r="0.7" fill="#fff"/><circle cx="15.55" cy="2.97" r="0.7" fill="#fff"/></g></symbol>',
  '<clipPath id="hv7-cp-uk"><circle cx="12" cy="12" r="12"/></clipPath><symbol id="hv7-fl-uk" viewBox="0 0 24 24"><g clip-path="url(#hv7-cp-uk)"><rect width="24" height="24" fill="#012169"/><path d="M0 0L24 24M24 0L0 24" stroke="#fff" stroke-width="4.2"/><path d="M0 0L24 24M24 0L0 24" stroke="#C8102E" stroke-width="1.6"/><path d="M12 0V24M0 12H24" stroke="#fff" stroke-width="7"/><path d="M12 0V24M0 12H24" stroke="#C8102E" stroke-width="3.8"/></g></symbol>',
  '<clipPath id="hv7-cp-us"><circle cx="12" cy="12" r="12"/></clipPath><symbol id="hv7-fl-us" viewBox="0 0 24 24"><g clip-path="url(#hv7-cp-us)"><rect y="0.00" width="24" height="3.48" fill="#B22234"/><rect y="3.43" width="24" height="3.48" fill="#fff"/><rect y="6.86" width="24" height="3.48" fill="#B22234"/><rect y="10.29" width="24" height="3.48" fill="#fff"/><rect y="13.71" width="24" height="3.48" fill="#B22234"/><rect y="17.14" width="24" height="3.48" fill="#fff"/><rect y="20.57" width="24" height="3.48" fill="#B22234"/><rect width="12" height="13.7" fill="#3C3B6E"/><circle cx="2.6" cy="2.6" r=".7" fill="#fff"/><circle cx="6.0" cy="2.6" r=".7" fill="#fff"/><circle cx="9.4" cy="2.6" r=".7" fill="#fff"/><circle cx="2.6" cy="6.0" r=".7" fill="#fff"/><circle cx="6.0" cy="6.0" r=".7" fill="#fff"/><circle cx="9.4" cy="6.0" r=".7" fill="#fff"/><circle cx="2.6" cy="9.4" r=".7" fill="#fff"/><circle cx="6.0" cy="9.4" r=".7" fill="#fff"/><circle cx="9.4" cy="9.4" r=".7" fill="#fff"/></g></symbol>',
  '<clipPath id="hv7-cp-au"><circle cx="12" cy="12" r="12"/></clipPath><symbol id="hv7-fl-au" viewBox="0 0 24 24"><g clip-path="url(#hv7-cp-au)"><rect width="24" height="24" fill="#00247D"/><path d="M0 0L12 12M12 0L0 12" stroke="#fff" stroke-width="2.4"/><path d="M6 0V12M0 6H12" stroke="#fff" stroke-width="4"/><path d="M6 0V12M0 6H12" stroke="#CF142B" stroke-width="2"/><circle cx="6" cy="18.5" r="1.9" fill="#fff"/><circle cx="17" cy="5" r="1.2" fill="#fff"/><circle cx="20" cy="11" r="1.2" fill="#fff"/><circle cx="17" cy="19" r="1.2" fill="#fff"/><circle cx="14" cy="12" r="1.2" fill="#fff"/></g></symbol>',
  '<clipPath id="hv7-cp-eu"><circle cx="12" cy="12" r="12"/></clipPath><symbol id="hv7-fl-eu" viewBox="0 0 24 24"><g clip-path="url(#hv7-cp-eu)"><rect width="24" height="24" fill="#003399"/><circle cx="19.00" cy="12.00" r="1.1" fill="#FFCC00"/><circle cx="18.06" cy="15.50" r="1.1" fill="#FFCC00"/><circle cx="15.50" cy="18.06" r="1.1" fill="#FFCC00"/><circle cx="12.00" cy="19.00" r="1.1" fill="#FFCC00"/><circle cx="8.50" cy="18.06" r="1.1" fill="#FFCC00"/><circle cx="5.94" cy="15.50" r="1.1" fill="#FFCC00"/><circle cx="5.00" cy="12.00" r="1.1" fill="#FFCC00"/><circle cx="5.94" cy="8.50" r="1.1" fill="#FFCC00"/><circle cx="8.50" cy="5.94" r="1.1" fill="#FFCC00"/><circle cx="12.00" cy="5.00" r="1.1" fill="#FFCC00"/><circle cx="15.50" cy="5.94" r="1.1" fill="#FFCC00"/><circle cx="18.06" cy="8.50" r="1.1" fill="#FFCC00"/></g></symbol>',
].join('');

const flagsDir = resolve('apps/web/public/map-flags');
const codes = ['bd', 'cn', 'ae', 'sg', 'uk', 'us', 'au', 'eu'];
const shapes = (markup: string) =>
  markup
    .replace(/clip-path="url\(#[\w-]+\)"/g, 'clip-path="url(#c)"')
    .replace(/ \/>/g, '/>')
    .replace(/<(\w+)([^<>]*?)\/>/g, '<$1$2></$1>');

describe('home map-pin flags', () => {
  for (const [index, code] of codes.entries()) {
    it(`${code} draws the same shapes as the old string`, () => {
      const file = readFileSync(resolve(flagsDir, `${code}.svg`), 'utf8');
      const old = before.split('</symbol>')[index]!;
      const inner = old.slice(old.indexOf('<g '));
      expect(shapes(file)).toContain(shapes(inner));
      expect(file).toContain('viewBox="0 0 24 24"');
    });
  }
  it('are exactly the eight places the pins use, and no more', () => {
    expect(readdirSync(flagsDir).sort()).toEqual(codes.map((code) => `${code}.svg`).sort());
  });
  it('inject no HTML and keep national colours out of the code', () => {
    for (const file of ['components/home-v44-dotmap.tsx', 'app/plan/plan-side.tsx']) {
      const source = readFileSync(resolve('apps/web', file), 'utf8');
      expect(source).not.toContain('dangerouslySetInnerHTML');
      expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
    expect(readFileSync(resolve('apps/web/components/home-v44-dotmap.tsx'), 'utf8')).toContain(
      '/map-flags/',
    );
  });
});
