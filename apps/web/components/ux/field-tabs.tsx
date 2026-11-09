'use client';
// The field helper's labelled bottom tabs on a phone or tablet (Navigation v1, FieldHelper board): four tabs that are
// always named, 48 px targets, the current one marked aria-current. A tab for a feature that is not real yet is plain
// text tagged Coming soon and announced as unavailable, never a link. Pure navigation; every page still checks on the
// server. Owner: S4.
import './field-tabs.css';
import Link from 'next/link';
import { CorridraIcon } from '../corridra-icon';
import type { FieldTab, FieldTabKey } from '../../lib/ux/field-helper';

export function FieldTabs({
  tabs,
  current,
}: {
  tabs: readonly FieldTab[];
  current: FieldTabKey | null;
}) {
  return (
    <nav className="ux-field-tabs" aria-label="Helper tabs">
      <ul>
        {tabs.map((tab) => (
          <li key={tab.key}>
            {tab.href ? (
              <Link
                prefetch={false}
                href={tab.href}
                aria-current={tab.key === current ? 'page' : undefined}
              >
                <CorridraIcon name={tab.icon} />
                <span>{tab.label}</span>
              </Link>
            ) : (
              <span className="ux-field-tab-soon" aria-disabled="true">
                <CorridraIcon name={tab.icon} />
                <span>{tab.label}</span>
                <small>Coming soon</small>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
