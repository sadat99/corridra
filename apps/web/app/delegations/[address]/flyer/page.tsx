import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { pp } from '../../../../lib/i18n/programme-pages';
import { readShareKitPage } from '../../../../lib/programme-share-kit';
import { QrCode } from '../qr-code';
import { PrintButton } from './print-button';
import '../programme-page.css';
import '../share-kit.css';
import './flyer.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The printable flyer of a public programme page (ADR-084 S1). It uses the published words only: title, where, when, who it
// is for, the fee line only exactly as the organiser wrote it (or none), the QR code of the page address and the sentence
// that the organiser states all of it. Nothing is converted, totalled or added. A page that is closed says so, in the page's
// own words, and invites no application. An address that is not a readable page, and the share kit switched off, are not found.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const found = await readShareKitPage((await params).address).catch(() => null);
  return {
    title: found
      ? pp('pp.flyer.title', { title: found.page.programme.title })
      : pp('pp.public.metaTitle'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const found = await readShareKitPage((await params).address);
  if (!found) notFound();
  const { page, origin } = found;
  const p = page.programme;
  const open = page.state === 'OPEN';
  const url = `${origin}/delegations/${page.address}`;
  return (
    <WorkspaceShell
      className="programme-page programme-flyer-page"
      eyebrow={page.sample ? pp('pp.public.eyebrowSample') : pp('pp.public.eyebrow')}
      title={p.title}
    >
      <article className="programme-flyer">
        {page.sample && <p className="programme-public-note">{pp('pp.flyer.sample')}</p>}
        <dl className="programme-flyer-facts">
          <div>
            <dt>{pp('pp.public.fact.where')}</dt>
            <dd>{p.destination}</dd>
          </div>
          <div>
            <dt>{pp('pp.public.fact.when')}</dt>
            <dd>{p.dates}</dd>
          </div>
          <div>
            <dt>{pp('pp.public.who.title')}</dt>
            <dd>{p.audience}</dd>
          </div>
          {p.fee && (
            <div>
              <dt>{pp('pp.flyer.feeStated')}</dt>
              <dd>{p.fee}</dd>
            </div>
          )}
          <div>
            <dt>{pp('pp.public.fact.organiser')}</dt>
            <dd>{p.organiser}</dd>
          </div>
        </dl>
        <div className="programme-flyer-code">
          <QrCode text={url} label={pp('pp.kit.qr.label', { title: p.title })} />
          {!open && <p className="programme-public-note">{pp('pp.public.apply.closedTitle')}</p>}
          <p>{open ? pp('pp.flyer.scan') : pp('pp.flyer.scanClosed')}</p>
          <p className="programme-flyer-address">
            <span>{pp('pp.flyer.addressLabel')}</span> {url}
          </p>
        </div>
        <p className="programme-public-note">{pp('pp.flyer.stated')}</p>
      </article>
      <div className="guide-actions-row programme-flyer-actions">
        <PrintButton />
        <Link prefetch={false} className="text-link" href={`/delegations/${page.address}`}>
          {pp('pp.flyer.back')}
        </Link>
      </div>
    </WorkspaceShell>
  );
}
