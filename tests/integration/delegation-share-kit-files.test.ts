import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import jsQR from 'jsqr';
import { makeQr, qrPath, qrViewBox, quietZone } from '../../apps/web/lib/programme-qr';
import { foldLine, icsText, programmeCalendar } from '../../apps/web/lib/programme-ics';

// ADR-084 slice S1, the share kit: the files it makes, without a database. The QR code is proven by DECODING it back
// to the exact address (not by comparing pictures), the calendar file by its exact bytes, the preview image by the
// words it can contain. No network call is made by any of it.
// React lives in the web application, not at the root: load it from there, the way the component itself does. The .tsx files
// are loaded with a dynamic import because the root typecheck has no jsx setting (the other component tests do the same).
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { createElement } = webRequire('react') as {
  createElement: (type: unknown, props: unknown) => unknown;
};
const { renderToStaticMarkup } = webRequire('react-dom/server') as {
  renderToStaticMarkup: (element: unknown) => string;
};
const loadTsx = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const { QrCode } = (await loadTsx('app/delegations/[address]/qr-code.tsx')) as {
  QrCode: unknown;
};
const { previewImage } = (await loadTsx('lib/programme-preview-image.tsx')) as {
  previewImage: (
    input: {
      title: string;
      destination: string;
      dates: string;
      organiser: string;
      sample: boolean;
      mark: string | null;
    },
    covers: (codePoint: number) => boolean,
  ) => unknown;
};
// Any ASCII letter, digit and punctuation: what the bundled font certainly draws (the font itself is proven in the preview test).
const ascii = (codePoint: number) => codePoint >= 0x20 && codePoint < 0x7f;
const read = (path: string) => readFileSync(path, 'utf8');
const address = 'synthetic-china-agricultural-machinery-delegation-k3x9q2m7ab';
const urls = [
  `https://www.example.invalid/delegations/${address}`,
  `http://127.0.0.1:3200/delegations/${address}`,
  `https://a.example.invalid/delegations/${'a'.repeat(69)}-0123456789`,
  'https://x.example/delegations/ab-cdefghijkl',
];

/** Paints the module path of a drawn code into pixels (dark = black, light = white) and returns the RGBA image. */
function raster(path: string, viewBox: string, scale: number) {
  const side = Number(viewBox.split(' ')[2]);
  const px = side * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let row = y * scale; row < (y + 1) * scale; row++)
      for (let col = x * scale; col < (x + w) * scale; col++) {
        const at = (row * px + col) * 4;
        data[at] = data[at + 1] = data[at + 2] = 0;
      }
  }
  return { data, px };
}

describe('the QR code', () => {
  it('decodes back to the exact page address, from the module matrix and from the drawn path', () => {
    for (const url of urls) {
      const code = makeQr(url);
      const { data, px } = raster(qrPath(code), qrViewBox(code), 6);
      expect(jsQR(data, px, px)?.data, url).toBe(url);
    }
  });

  it('decodes back from the image the server renders, parsed from the markup', () => {
    const url = urls[0]!;
    const markup = renderToStaticMarkup(createElement(QrCode, { text: url, label: 'x' }));
    const source = /<img[^>]* src="([^"]+)"/.exec(markup)![1]!.replaceAll('&amp;', '&');
    // The picture is inside the address itself: nothing is fetched to show it.
    expect(source.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(source.slice(source.indexOf(',') + 1));
    const path = /<path d="([^"]+)"/.exec(svg)![1]!;
    const viewBox = /viewBox="([^"]+)"/.exec(svg)![1]!;
    const { data, px } = raster(path, viewBox, 5);
    expect(jsQR(data, px, px)?.data).toBe(url);
    expect(markup).toContain('alt="x"');
    // Dark on light, in plain black and white, and nothing is loaded by the drawing.
    expect(svg).toContain('fill="white"');
    expect(svg).toContain('fill="black"');
    expect(svg).not.toMatch(
      /<(image|use|a|script|style)\b|href=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/,
    );
    expect(markup).not.toMatch(/<(script|a)\b|href=/);
  });

  it('leaves the four module quiet zone empty, which a scanner needs', () => {
    const code = makeQr(urls[0]!);
    const { data, px } = raster(qrPath(code), qrViewBox(code), 4);
    for (let i = 0; i < quietZone * 4; i++)
      for (let j = 0; j < px; j++) {
        expect(data[(i * px + j) * 4]).toBe(255);
        expect(data[(j * px + i) * 4]).toBe(255);
      }
  });

  it('refuses text that is empty or too long to be an address', () => {
    expect(() => makeQr('')).toThrow();
    expect(() => makeQr('x'.repeat(401))).toThrow();
  });

  it('comes from one exact-pinned library with no dependency, and the library makes no network call', () => {
    const web = JSON.parse(read('apps/web/package.json'));
    expect(web.dependencies['qrcode-generator']).toMatch(/^\d+\.\d+\.\d+$/);
    const root = JSON.parse(read('package.json'));
    expect(root.devDependencies.jsqr).toMatch(/^\d+\.\d+\.\d+$/);
    const library = JSON.parse(read('apps/web/node_modules/qrcode-generator/package.json'));
    expect(library.dependencies ?? {}).toEqual({});
    const code = read('apps/web/node_modules/qrcode-generator/dist/qrcode.mjs');
    expect(code).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|require\(['"]https?['"]\)/,
    );
    // The one module that uses it imports nothing else that could reach a network.
    const ours = read('apps/web/lib/programme-qr.ts');
    expect([...ours.matchAll(/from '([^']+)'/g)].map((m) => m[1])).toEqual(['qrcode-generator']);
  });

  it('makes no call while drawing', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    try {
      renderToStaticMarkup(createElement(QrCode, { text: urls[0]!, label: 'x' }));
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const sample = {
  address,
  version: 2,
  title: 'Synthetic China agricultural machinery delegation',
  destination: 'Guangzhou and Foshan, China',
  startsOn: '2027-04-12',
  endsOn: '2027-04-18',
  publishedAt: '2026-11-14T09:30:15.123Z',
  url: `https://www.example.invalid/delegations/${address}`,
  sample: false,
};

describe('the calendar file', () => {
  it('is one all day event with the last day included, from the stated days only, byte for byte', () => {
    const file = programmeCalendar(sample)!;
    // Unfolded, these are exactly the lines of the file: nothing else is in it.
    expect(file.replace(/\r\n /g, '')).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Corridra//Programme page//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        // The event belongs to the page, not to a version; SEQUENCE is the published version.
        `UID:${address}@www.example.invalid`,
        'SEQUENCE:2',
        'DTSTAMP:20261114T093015Z',
        'DTSTART;VALUE=DATE:20270412',
        'DTEND;VALUE=DATE:20270419',
        'SUMMARY:Synthetic China agricultural machinery delegation',
        'LOCATION:Guangzhou and Foshan\\, China',
        'DESCRIPTION:Stated by the organiser and not checked by Corridra. Details and how to apply: ' +
          sample.url,
        `URL:${sample.url}`,
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
    for (const line of file.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // Same bytes on a second download, so a second import does not make a second event.
    expect(programmeCalendar(sample)).toBe(file);
  });

  it('carries no person, no email and no attendee, and marks a sample', () => {
    const file = programmeCalendar({ ...sample, sample: true })!;
    expect(file).toContain('SUMMARY:Sample: Synthetic China');
    expect(file).not.toMatch(/ATTENDEE|ORGANIZER|mailto:/i);
    // The only at sign is the one inside the event id.
    expect(file.match(/@/g)?.length).toBe(1);
  });

  it('crosses a month end correctly and refuses days that are not a range', () => {
    expect(
      programmeCalendar({ ...sample, startsOn: '2027-04-30', endsOn: '2027-04-30' }),
    ).toContain('DTEND;VALUE=DATE:20270501');
    expect(
      programmeCalendar({ ...sample, startsOn: '2027-12-30', endsOn: '2027-12-31' }),
    ).toContain('DTEND;VALUE=DATE:20280101');
    expect(
      programmeCalendar({ ...sample, startsOn: '2027-04-18', endsOn: '2027-04-12' }),
    ).toBeNull();
    expect(
      programmeCalendar({ ...sample, startsOn: '2027-02-31', endsOn: '2027-03-01' }),
    ).toBeNull();
    expect(programmeCalendar({ ...sample, startsOn: 'soon', endsOn: '2027-03-01' })).toBeNull();
  });

  it('escapes text values and folds long lines at 75 octets without splitting a character', () => {
    expect(icsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
    const folded = foldLine('SUMMARY:' + '中'.repeat(40));
    for (const part of folded.split('\r\n'))
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe('SUMMARY:' + '中'.repeat(40));
    const injected = programmeCalendar({ ...sample, title: 'Title\r\nATTENDEE:mailto:x@y.z' })!;
    expect(injected).not.toMatch(/^ATTENDEE/m);
  });

  it('escapes a semicolon in the title and the destination, so a calendar reads them as text, not as a value separator', () => {
    const file = programmeCalendar({
      ...sample,
      title: 'Machinery; farms and mills',
      destination: 'Guangzhou; Foshan, China',
    })!.replace(/\r\n /g, '');
    expect(file).toContain('SUMMARY:Machinery\\; farms and mills\r\n');
    expect(file).toContain('LOCATION:Guangzhou\\; Foshan\\, China\r\n');
    // No semicolon is left unescaped in a text value.
    for (const line of file.split('\r\n').filter((l) => /^(SUMMARY|LOCATION|DESCRIPTION):/.test(l)))
      expect(line.replace(/\\\\|\\;/g, ''), line).not.toContain(';');
  });

  it('turns the Unicode line separators U+2028, U+2029 and U+0085 into a space, so no calendar splits a line there', () => {
    expect(icsText('a\u2028b\u2029c\u0085d')).toBe('a b c d');
    const file = programmeCalendar({
      ...sample,
      title: 'Title\u2028ATTENDEE:mailto:x@y.z',
      destination: 'Place\u2029SEQUENCE:99\u0085X',
    })!;
    expect(file).not.toMatch(/[\u2028\u2029\u0085]/);
    expect(file).not.toMatch(/^(ATTENDEE|SEQUENCE:99)/m);
    expect(file).toContain('SUMMARY:Title ATTENDEE:mailto:x@y.z');
    expect(file.match(/^SEQUENCE:/gm)).toHaveLength(1);
  });

  it('keeps one event id for the page and counts the published version, so a republish updates the event in a calendar', () => {
    const first = programmeCalendar({ ...sample, version: 1 })!;
    const third = programmeCalendar({
      ...sample,
      version: 3,
      publishedAt: '2026-12-01T10:00:00.000Z',
    })!;
    const line = (file: string, name: string) =>
      file
        .replace(/\r\n /g, '')
        .split('\r\n')
        .find((l) => l.startsWith(name));
    expect(line(first, 'UID:')).toBe(`UID:${address}@www.example.invalid`);
    expect(line(third, 'UID:')).toBe(line(first, 'UID:'));
    expect(line(first, 'SEQUENCE:')).toBe('SEQUENCE:1');
    expect(line(third, 'SEQUENCE:')).toBe('SEQUENCE:3');
  });
});

/** Every string a React element tree would draw. */
function texts(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === 'object' && 'props' in node)
    return texts((node as { props: { children?: unknown } }).props.children);
  return [];
}
describe('the preview image', () => {
  const input = {
    title: 'Synthetic China agricultural machinery delegation',
    destination: 'Guangzhou and Foshan, China',
    dates: '12 to 18 April 2027, to be confirmed',
    organiser: 'Synthetic Dhaka Agro Traders Association',
    sample: false,
    mark: null,
  };
  it('says only the published title, where, when and organiser', () => {
    const all = texts(previewImage(input, ascii)).join(' | ');
    for (const word of [input.title, input.destination, input.dates, input.organiser])
      expect(all).toContain(word);
    expect(all).not.toMatch(/sample/i);
  });
  it('says Sample, in the page words, for a sample workspace', () => {
    expect(texts(previewImage({ ...input, sample: true }, ascii)).join(' ')).toContain('SAMPLE');
  });
  it('has no input that could carry a fee, price, place count, person or payment', () => {
    expect(Object.keys(input).sort()).toEqual(
      ['dates', 'destination', 'mark', 'organiser', 'sample', 'title'].sort(),
    );
  });
  it('clips a very long title instead of overflowing', () => {
    const long = texts(previewImage({ ...input, title: 'x'.repeat(160) }, ascii)).join('');
    expect(long).toContain('…');
  });
  it('draws only what the font can draw: other letters and emoji are removed, and an emptied title is the word Programme', () => {
    const all = texts(
      previewImage(
        {
          ...input,
          title: 'Trip \u{1F680} \u4E2D\u6587 \u09AC\u09BE\u0982\u09B2\u09BE',
          destination: '\u4E2D\u6587',
        },
        ascii,
      ),
    ).join(' | ');
    expect(all).toContain('Trip');
    expect(all).not.toMatch(/[^\x20-\x7e\u00b7\u2026]/);
    expect(all).not.toContain('Where');
    const bare = texts(previewImage({ ...input, title: '\u{1F680}\u{1F680}' }, ascii)).join(' | ');
    expect(bare).toContain('Programme');
  });
});

// The editor: the optional calendar days are kept apart from the page words and judged on their own.
const { copyFrom, emptyDraft, scheduleProblem } = await loadTsx(
  'app/account/delegations/programme-page.tsx',
);
describe('the editor and the calendar days', () => {
  const draft = (startsOn: string, endsOn: string) => ({
    ...emptyDraft('Synthetic delegation'),
    startsOn,
    endsOn,
  });
  it('accepts both days, or neither, and refuses one day, days out of order, or more than a year apart', () => {
    expect(scheduleProblem(draft('', ''))).toBe('');
    expect(scheduleProblem(draft('2027-04-12', '2027-04-18'))).toBe('');
    expect(scheduleProblem(draft('2027-04-12', '2027-04-12'))).toBe('');
    expect(scheduleProblem(draft('2027-01-01', '2028-01-01'))).toBe('');
    for (const [from, to] of [
      ['2027-04-12', ''],
      ['', '2027-04-18'],
      ['2027-04-18', '2027-04-12'],
      ['2027-01-01', '2028-01-02'],
      ['soon', '2027-04-18'],
    ])
      expect(scheduleProblem(draft(from!, to!)), `${from} ${to}`).not.toBe('');
  });
  it('never puts the days into the page words, which the database accepts only with their exact keys', () => {
    const published = copyFrom({
      ...draft('2027-04-12', '2027-04-18'),
      organiser: 'Synthetic Dhaka Agro Traders Association',
    });
    expect(Object.keys(published)).not.toContain('startsOn');
    expect(Object.keys(published)).not.toContain('endsOn');
    expect(JSON.stringify(published)).not.toContain('2027-04-1');
  });
  it('starts with no days; whether the fields show and whether the days are sent is proven in the browser spec (programme-pages-ui.spec.ts)', () => {
    const empty = emptyDraft('Synthetic delegation');
    expect([empty.startsOn, empty.endsOn]).toEqual(['', '']);
  });
});
