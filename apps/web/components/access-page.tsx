import Link from 'next/link';
import type { ReactNode } from 'react';
import { PublicShell } from './public-shell';
import { CorridraIcon } from './corridra-icon';
import { AccessElsewhere } from './access-elsewhere';
import { accessDoor, type AccessDoorId, type AccessIconName } from '../lib/access-doors';
import { uxSwitchOn } from '../lib/ux-switches';
import '../app/access/access.css';

/** Title, description and sharing text from the registry; search engines may index the page only while the switch is on. */
export function accessDoorMetadata(id: AccessDoorId, heading: string, lead: string) {
  const index = uxSwitchOn('CORRIDRA_UX_ACCESS_DOORS');
  return {
    title: `${accessDoor(id).title} | Corridra`,
    description: lead,
    openGraph: { title: heading, description: lead },
    robots: { index, follow: index },
  };
}

/** The frame every access page shares: hero, the page body, then the "Not what you need?" bar. */
export function AccessPage({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: AccessDoorId;
  eyebrow: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <section className="guide-page-hero guide-page-hero--compact access-page-hero">
        <div>
          <nav className="guide-crumb" aria-label="Breadcrumb">
            <Link prefetch={false} href="/">
              Corridra
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{accessDoor(id).title}</span>
          </nav>
          <p className="label">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="guide-lead">{lead}</p>
        </div>
      </section>
      <div className="access-page">
        {children}
        <AccessElsewhere current={id} />
      </div>
    </PublicShell>
  );
}

export function AccessCard({
  icon,
  title,
  level = 3,
  children,
}: {
  icon: AccessIconName;
  title: string;
  level?: 2 | 3;
  children: ReactNode;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <article className="access-card">
      <CorridraIcon name={icon} />
      <Heading>{title}</Heading>
      {children}
    </article>
  );
}
