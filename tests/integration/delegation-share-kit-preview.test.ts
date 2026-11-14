import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// ADR-084 slice S1, the public share kit routes without a database: the preview image makes no network call and never answers
// a 500, a database that cannot be read answers 503 (never cached) and not the page's single 404, and the flyer of a closed
// page invites no application. The page read is replaced; everything else is the real route code.
const reading = vi.hoisted(() => ({
  read: null as null | ((address: string) => Promise<unknown>),
}));
vi.mock('../../apps/web/lib/programme-share-kit', () => ({
  readShareKitPage: (address: string) => reading.read!(address),
}));

const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { renderToStaticMarkup } = webRequire('react-dom/server') as {
  renderToStaticMarkup: (element: unknown) => string;
};
type Params = { params: Promise<{ address: string }> };
const loadTsx = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const imageRoute = (await loadTsx('app/delegations/[address]/preview-image/route.tsx')) as {
  GET: (request: Request, context: Params) => Promise<Response>;
};
const calendarRoute =
  (await import('../../apps/web/app/delegations/[address]/calendar.ics/route')) as {
    GET: (request: Request, context: Params) => Promise<Response>;
  };
const flyerPage = (await loadTsx('app/delegations/[address]/flyer/page.tsx')) as {
  default: (props: Params) => Promise<unknown>;
};

const fontModule = async () => await import('../../apps/web/lib/programme-preview-font');
const address = 'synthetic-china-agricultural-machinery-delegation-k3x9q2m7ab';
const origin = 'https://corridra.example.invalid';
const params = (value = address) => ({ params: Promise.resolve({ address: value }) });
const found = (words: Record<string, unknown> = {}, state: 'OPEN' | 'CLOSED' = 'OPEN') => ({
  origin,
  kit: true,
  schedule: { version: 1, startsOn: '2027-04-12', endsOn: '2027-04-18' },
  page: {
    state,
    address,
    version: 1,
    sample: false,
    closesAt: '2027-03-01T23:59:00.000000Z',
    publishedAt: '2026-11-14T09:30:15.123456Z',
    programme: {
      title: 'Synthetic China agricultural machinery delegation',
      organiser: 'Synthetic Dhaka Agro Traders Association',
      summary: 'A ten company buying delegation to compare rice transplanters.',
      destination: 'Guangzhou and Foshan, China',
      dates: '12 to 18 April 2027, to be confirmed',
      focus: 'Agricultural machinery',
      audience: 'Owners and buyers of importers and dealers.',
      eligibility: 'A registered business that imports farm machinery.',
      activities: [{ label: 'Factory visits in Foshan', status: 'PLANNED' }],
      included: ['Programme coordination'],
      excluded: ['Flights'],
      ...words,
    },
  },
});

let fetched: string[];
// The picture's own mark is a data address, which the renderer reads with fetch as well: that call goes nowhere.
const outbound = () => fetched.filter((url) => !url.startsWith('data:'));
beforeEach(() => {
  fetched = [];
  // Any outbound request is recorded and then fails, as it would with no network.
  vi.stubGlobal('fetch', async (input: unknown) => {
    fetched.push(String(input));
    throw new Error('No network in this test');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock(webRequire.resolve('next/og'));
  vi.resetModules();
});

const png = async (response: Response) => {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
};

describe('the preview image makes no network call', () => {
  const titles: [string, string][] = [
    ['ASCII', 'Synthetic China agricultural machinery delegation'],
    ['emoji', 'Spring trade trip \u{1F680}\u{1F1E8}\u{1F1F3} ❤️ \u{1F469}‍\u{1F469}‍\u{1F467}'],
    ['Chinese', '中国农机贸易代表团 Guangzhou'],
    ['Bengali', 'বাংলাদেশ প্রতিনিধিদল'],
    ['only letters the font lacks', '中文\u{1F680}'],
  ];
  for (const [name, title] of titles)
    it(`draws a valid picture for a ${name} title with zero outbound requests`, async () => {
      reading.read = async () =>
        found({
          title,
          destination: `${title} destination`,
          dates: `${title} dates`,
          organiser: `${title} organiser`,
        });
      await png(await imageRoute.GET(new Request(origin), params()));
      expect(outbound()).toEqual([]);
    });

  it('draws every character the font has, in turn, with zero outbound requests', async () => {
    const { previewFont, coveredCodePoints } = await fontModule();
    const font = await previewFont();
    const all = [...coveredCodePoints(font.data)]
      .filter((codePoint) => codePoint >= 0x20)
      .map((codePoint) => String.fromCodePoint(codePoint));
    const chunk = 80;
    for (let at = 0; at < all.length; at += chunk * 4) {
      const piece = (n: number) => all.slice(at + n * chunk, at + (n + 1) * chunk).join('');
      reading.read = async () =>
        found({
          title: piece(0),
          destination: piece(1),
          dates: piece(2),
          organiser: piece(3),
        });
      await png(await imageRoute.GET(new Request(origin), params()));
    }
    expect(outbound()).toEqual([]);
  }, 120000);

  it('answers the same plain 404, never a 500, when drawing fails', async () => {
    reading.read = async () => found();
    vi.resetModules();
    vi.doMock(webRequire.resolve('next/og'), () => ({
      // The real class draws while its body is read, so that is where a failure shows.
      ImageResponse: class extends Response {
        constructor() {
          super(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('Drawing failed'));
              },
            }),
          );
        }
      },
    }));
    const failing = (await loadTsx('app/delegations/[address]/preview-image/route.tsx')) as {
      GET: (request: Request, context: Params) => Promise<Response>;
    };
    const response = await failing.GET(new Request(origin), params());
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });
});

describe('the font and the words it can draw', () => {
  it('reads the same code points from the font file as the font library does', async () => {
    const { coveredCodePoints } = await fontModule();
    const delivery = createRequire(
      new URL('../../packages/delivery/package.json', import.meta.url),
    );
    const fontkit = delivery('fontkit') as {
      create: (data: Buffer) => { characterSet: number[] };
    };
    const file = readFileSync('packages/delivery/assets/NotoSans.ttf');
    expect([...coveredCodePoints(file)].sort((a, b) => a - b)).toEqual(
      // U+FFFF is the closing marker of a character map, not a character.
      [...fontkit.create(file).characterSet].filter((c) => c !== 0xffff).sort((a, b) => a - b),
    );
  });
  it('removes emoji, Chinese and Bengali, keeps Latin text, and makes one clean line', async () => {
    const { printable } = await fontModule();
    const covers = (codePoint: number) => codePoint >= 0x20 && codePoint < 0x7f;
    expect(printable('Trade \u{1F680}  trip\n中文\ttwo', covers)).toBe('Trade trip two');
    expect(printable('\u{1F680}中文', covers)).toBe('');
  });
});

describe('a database that cannot be read is not a page that does not exist', () => {
  const routes = [
    ['preview image', (value?: string) => imageRoute.GET(new Request(origin), params(value))],
    ['calendar file', (value?: string) => calendarRoute.GET(new Request(origin), params(value))],
  ] as const;
  for (const [name, get] of routes) {
    it(`the ${name} answers 503 with no-store when the read fails`, async () => {
      reading.read = async () => {
        throw new Error('The database is down');
      };
      const response = await get();
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('');
    });
    it(`the ${name} keeps its single 404 for a page that cannot be read`, async () => {
      reading.read = async () => null;
      const response = await get('not-a-page-0123456789');
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('');
    });
  }
});

describe('the flyer of a closed page', () => {
  const html = async (state: 'OPEN' | 'CLOSED') => {
    reading.read = async () => found({}, state);
    return renderToStaticMarkup(await flyerPage.default(params()));
  };
  it('says the page is closed, with the page words, and invites no application', async () => {
    const closed = await html('CLOSED');
    expect(closed).toContain('Applications are closed');
    expect(closed).toContain('Scan to read the page.');
    expect(closed).not.toMatch(/apply|Apply/);
    expect(closed).toContain(`${origin}/delegations/${address}`);
    expect(closed).toContain('<img class="programme-qr"');
  });
  it('still invites an application while the page is open', async () => {
    const open = await html('OPEN');
    expect(open).toContain('Scan to read the page and apply.');
    expect(open).not.toContain('Applications are closed');
  });
});
