'use client';
// The customer's labelled bottom tabs on phones and tablets (navigation v1, CustomerMobile board): the same five
// destinations as the sidebar, always with their names, 48 px targets, the current one marked aria-current. Since
// the owner's 12 Nov 2026 rule (main navigation on the left for every signed-in user) the full sidebar is also a left
// drawer below 1024 px, and these tabs stay as a shortcut. Pure links: no access is decided here and every page still
// checks on the server.
import './customer-tabs.css';
import Link from 'next/link';
import { CorridraIcon } from '../corridra-icon';
import { T } from '../language-provider';
import type { CustomerTab, CustomerTabKey } from '../../lib/ux/customer-navigation';

export function CustomerTabs({
  tabs,
  current,
  count,
}: {
  tabs: readonly CustomerTab[];
  current: CustomerTabKey | null;
  /** What waits for the person, as a small badge on Home. Shown only above zero; the page says it in words. */
  count?: number;
}) {
  return (
    <nav className="ux-customer-tabs" aria-label="Customer tabs">
      <ul>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              prefetch={false}
              href={tab.href}
              aria-current={tab.key === current ? 'page' : undefined}
            >
              <span className="ux-customer-tab-icon">
                <CorridraIcon name={tab.icon} />
                {tab.key === 'home' && count ? (
                  <span className="ux-customer-tab-count" aria-hidden="true">
                    {count > 9 ? '9+' : count}
                  </span>
                ) : null}
              </span>
              {/* The name follows the chosen language as the sidebar's does; a word with no reviewed translation is marked English. */}
              <span>
                {tab.labelKey ? <T k={tab.labelKey} /> : <span lang="en">{tab.label}</span>}
              </span>
              {tab.key === 'home' && count ? (
                <span className="sr-only">, {count} waiting</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
