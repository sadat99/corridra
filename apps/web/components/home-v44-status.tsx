'use client';

import Link from 'next/link';
import { CorridraIcon } from './corridra-icon';
import { DotMap } from './home-v44-dotmap';
import { useT } from './language-provider';
import { Eyebrow } from './ux/example-tag';
import { placeName } from '../lib/home-v43-data';

// Home page v4.4 route statuses: a map that colours each place by its plain status, beside the four routes as one list.
// Every word is an existing route-status word; "Open now" is never read as "legally approved" (the note says so, as
// the long status block does). Each row opens the routes page; nothing is sent.
export function HomeV44Status() {
  const t = useT();
  const all = [placeName.EU, placeName.GB, placeName.US, placeName.AU]
    .map((key) => t(key))
    .join(', ');
  const rows: Array<[string, string, string]> = [
    [`${t(placeName.BD)} → ${t(placeName.CN)}`, t('home.tr.rs.open'), 'open'],
    [`${t(placeName.BD)} → ${all}`, t('home.tr.rs.open'), 'open'],
    [t('home.tr.rs.rev'), t('home.tr.rs.selective'), 'selective'],
    [t('home.tr.rs.other'), t('home.tr.rs.ask'), 'ask'],
  ];
  const steps = [1, 2, 3, 4, 5, 6]
    .map((n) => t(`home.tr.rs.ready.${n}` as 'home.tr.rs.ready.1'))
    .join(' · ');
  return (
    <section className="hv43-band hv44-status" id="routes" aria-labelledby="hv44-status-title">
      <div className="hv44-status-grid">
        <div className="hv44-status-map" aria-hidden="true">
          <DotMap
            view="300 20 380 220"
            fill
            routes={['CN', 'EU', 'US', 'AU']}
            pins={['CN', 'EU', 'US', 'AU', 'AE', 'SG']}
            tones={{ CN: 'open', EU: 'open', US: 'open', AU: 'open', AE: 'ask', SG: 'ask' }}
          />
        </div>
        <div className="hv44-status-card">
          <Eyebrow>{t('home.tr.rs.eyebrow')}</Eyebrow>
          <h2 id="hv44-status-title">{t('home.tr.rs.title')}</h2>
          <ul className="hv44-status-list">
            {rows.map(([name, status, tone]) => (
              <li key={name}>
                <Link prefetch={false} href="/corridors">
                  <span className="hv44-status-name">{name}</span>
                  <span className="hv44-status-tag" data-tone={tone}>
                    {status}
                  </span>
                  <CorridraIcon name="arrow" size={16} />
                </Link>
              </li>
            ))}
          </ul>
          <p className="hv44-status-note">
            {t('home.tr.rs.ready')} {steps}. {t('home.tr.rs.ready.end')}
          </p>
        </div>
      </div>
    </section>
  );
}
