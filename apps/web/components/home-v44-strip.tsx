'use client';

import { useT } from './language-provider';
import { placeName } from '../lib/home-v43-data';

// Home page v4.4: the route statuses as one still row under the route choice. Words are the existing route-status
// words ("Open now", "Selective", "Ask us"); it claims nothing the long status block does not, and nothing moves.
export function HomeV44Strip() {
  const t = useT();
  const rows: Array<[string, string]> = [
    [`${t(placeName.BD)} → ${t(placeName.CN)}`, t('home.tr.rs.open')],
    [
      `${t(placeName.BD)} → ${[placeName.EU, placeName.GB, placeName.US, placeName.AU].map((key) => t(key)).join(', ')}`,
      t('home.tr.rs.open'),
    ],
    [t('home.tr.rs.rev'), t('home.tr.rs.selective')],
    [t('home.tr.rs.other'), t('home.tr.rs.ask')],
  ];
  return (
    <ul className="hv44-strip" aria-label={t('home.tr.rs.rev')}>
      {rows.map(([name, status]) => (
        <li key={name}>
          <span>{name}</span>
          <strong>{status}</strong>
        </li>
      ))}
    </ul>
  );
}
