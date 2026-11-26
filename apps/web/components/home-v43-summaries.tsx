'use client';

import Link from 'next/link';
import { useT } from './language-provider';
import { Eyebrow } from './ux/example-tag';
import { publicPages } from '../content/public-pages';
import { v43 } from '../lib/home-v43-data';
import { sentences } from '../lib/how-trust-v43';

// Home page v4.3 with CORRIDRA_UX_HOW_TRUST_V43 on (owner, 26 Nov 2026, first hand to Guardian G66: "yes to all three,
// build it"). The home does one job: choose a route and start a request. Process and trust are three short lines each,
// with a link to the page that holds the whole of it. The ids `process` and `trust` stay, so the header and footer
// anchors keep working. Every line is an existing sentence: the two sentences of the process lead and the page
// description of /how-it-works, then the three sentences of the trust lead.
function Summary({
  id,
  band,
  eyebrow,
  title,
  lines,
  href,
  action,
}: {
  id: 'process' | 'trust';
  band: string;
  eyebrow: string;
  title: string;
  lines: string[];
  href: '/how-it-works' | '/trust';
  action: string;
}) {
  return (
    <section className={`hv43-band htv43-summary ${band}`} id={id} aria-labelledby={`${id}-title`}>
      <div className="htv43-summary-grid">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <div className="htv43-summary-body">
          <ul className="htv43-lines">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Link prefetch={false} className="text-link" href={href}>
            {action}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function HomeV43ProcessSummary() {
  const t = useT();
  return (
    <Summary
      id="process"
      band="hv43-process"
      eyebrow={t(v43('process.eyebrow'))}
      title={t(v43('process.title'))}
      lines={[...sentences(t(v43('process.lead'))), publicPages['how-it-works']!.description]}
      href="/how-it-works"
      action={t(v43('process.full'))}
    />
  );
}

export function HomeV43TrustSummary() {
  const t = useT();
  return (
    <Summary
      id="trust"
      band="hv43-trust"
      eyebrow={t(v43('trust.eyebrow'))}
      title={t(v43('trust.title'))}
      lines={sentences(t(v43('trust.lead')))}
      href="/trust"
      action={t(v43('trust.link'))}
    />
  );
}
