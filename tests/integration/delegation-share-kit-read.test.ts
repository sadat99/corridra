import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-084 slice S1: with the share kit off, the public page reads the database exactly as it did before the kit, every call on
// its own. A read that failed for the page's metadata must not be handed again to the page, which on main reads again. Only
// with the kit on are the reads of one request shared. React's per-request `cache` is emulated here (outside a request it
// does not remember anything), so what is proven is whether the code asks for sharing at all.
const reads = vi.hoisted(() => ({
  read: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    programmePageReader: reads,
    config: { APP_ORIGIN: 'https://corridra.example.invalid' },
  }),
}));
vi.mock('../../apps/web/node_modules/react', async (original) => {
  const real = await original<Record<string, unknown>>();
  return {
    ...real,
    cache: (work: (...args: string[]) => unknown) => {
      const memo = new Map<string, unknown>();
      return (...args: string[]) => {
        const key = JSON.stringify(args);
        if (!memo.has(key)) memo.set(key, work(...args));
        return memo.get(key);
      };
    },
  };
});
const { readPublishedPage } = await import('../../apps/web/lib/programme-share-kit');

const address = 'synthetic-china-agricultural-machinery-delegation-k3x9q2m7ab';
const page = {
  state: 'OPEN',
  address,
  version: 2,
  sample: false,
  closesAt: '2027-03-01T23:59:00.000000Z',
  publishedAt: '2026-11-14T09:30:15.123456Z',
  programme: { title: 'Synthetic delegation' },
};
const pagesOn = () => {
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_PROGRAMME_PAGES', 'true');
};
beforeEach(() => {
  reads.read.mockReset();
  reads.schedule.mockReset();
  reads.schedule.mockResolvedValue({ version: 2, startsOn: '2027-04-12', endsOn: '2027-04-18' });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the page read with the share kit off is the read of main', () => {
  it('reads on every call, so a metadata read that failed is not handed to the page', async () => {
    pagesOn();
    reads.read.mockRejectedValueOnce(new Error('The database is down')).mockResolvedValue(page);
    // generateMetadata swallows the failure, as on main.
    expect(await readPublishedPage(address).catch(() => 'failed')).toBe('failed');
    // The page then reads again and succeeds.
    expect(await readPublishedPage(address)).toMatchObject({ kit: false, schedule: null });
    expect(reads.read).toHaveBeenCalledTimes(2);
  });
  it('asks for no days and shares nothing between two successful reads', async () => {
    pagesOn();
    reads.read.mockResolvedValue(page);
    await readPublishedPage(address);
    await readPublishedPage(address);
    expect(reads.read).toHaveBeenCalledTimes(2);
    expect(reads.schedule).not.toHaveBeenCalled();
  });
});

describe('the page read with the share kit on', () => {
  it('shares one read between the metadata and the page, and reads the stated days', async () => {
    pagesOn();
    vi.stubEnv('CORRIDRA_PROGRAMME_SHARE_KIT', 'true');
    reads.read.mockResolvedValue(page);
    const first = await readPublishedPage(address);
    const second = await readPublishedPage(address);
    expect(second).toBe(first);
    expect(first).toMatchObject({ kit: true, schedule: { startsOn: '2027-04-12' } });
    expect(reads.read).toHaveBeenCalledTimes(1);
  });
});
