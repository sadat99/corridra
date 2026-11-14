import { cache } from 'react';
import {
  customerProgrammePagesEnabled,
  customerProgrammeShareKitEnabled,
  type PublicProgrammePage,
  type PublicProgrammeSchedule,
} from '@corridra/auth/customer-programme-publication';
import { foundations } from './foundations';

export type PublishedPage = {
  page: PublicProgrammePage;
  origin: string;
  /** True when the share kit is switched on. Off, the page is exactly what it was before the kit. */
  kit: boolean;
  /** The days the organiser stated for this version, or null. Only read when the kit is on. */
  schedule: PublicProgrammeSchedule | null;
};

/**
 * The one way the public page and the share kit routes (preview image, flyer, calendar file) read a programme page. It is
 * the anonymous page read and nothing else: an address that is not a readable page (unknown, malformed, taken down,
 * archived, long closed, the switch off) answers null, the single value the page answers, so no route can tell those
 * apart. The dates are asked for only after the page itself was readable, and only while the share kit is on.
 */
async function load(address: string): Promise<PublishedPage | null> {
  if (!customerProgrammePagesEnabled()) return null;
  const s = foundations();
  if (!s) return null;
  await s.ready;
  const page = await s.programmePageReader.read(address);
  if (page.state === 'unknown') return null;
  const kit = customerProgrammeShareKitEnabled();
  const stated = kit ? await s.programmePageReader.schedule(page.address).catch(() => null) : null;
  // Two reads: use the dates only if they belong to the version of the page just read.
  const schedule = stated && stated.version === page.version ? stated : null;
  return { page, origin: s.config.APP_ORIGIN, kit, schedule };
}
// One read per request while the kit is on, so the page, its metadata and the kit routes do not each ask the database.
const loadOnce = cache(load);

/**
 * With the share kit off this is exactly the page's own read as it was before the kit: every call reads on its own, so a
 * read that fails for the metadata is not reused for the page. Only with the kit on are the reads of one request shared.
 */
export function readPublishedPage(address: string): Promise<PublishedPage | null> {
  return customerProgrammeShareKitEnabled() ? loadOnce(address) : load(address);
}

/** The same read for a share kit route: null as well while the share kit is off, so those routes do not exist then. */
export async function readShareKitPage(address: string): Promise<PublishedPage | null> {
  if (!customerProgrammeShareKitEnabled()) return null;
  const found = await readPublishedPage(address);
  return found?.kit ? found : null;
}
