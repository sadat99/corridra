import { programmeCalendar } from '../../../../lib/programme-ics';
import { readShareKitPage } from '../../../../lib/programme-share-kit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The calendar file of a public programme page (ADR-084 S1). Every address that is not a readable page, a page whose latest
// version has no stated days, and the share kit switched off all answer the same single 404. It writes nothing and
// records nothing about the person who downloads it.
const nothing = () =>
  new Response(null, {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const found = await readShareKitPage(address).catch(() => null);
  if (!found?.schedule) return nothing();
  const { page, origin, schedule } = found;
  const file = programmeCalendar({
    address: page.address,
    version: page.version,
    title: page.programme.title,
    destination: page.programme.destination,
    startsOn: schedule.startsOn,
    endsOn: schedule.endsOn,
    publishedAt: page.publishedAt.replace(/(\.\d{3})\d*Z$/, '$1Z'),
    url: `${origin}/delegations/${page.address}`,
    sample: page.sample,
  });
  if (!file) return nothing();
  return new Response(file, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${page.address}.ics"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
