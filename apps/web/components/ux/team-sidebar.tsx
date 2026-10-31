'use client';
// The Team shell sidebar (D14): Today, Missions, Companies, Meetings, Quotes and billing, Reports,
// Network, Evidence and Settings. Every other workspace section and the Owner page sit under
// Settings, so nothing that existed before is more than two clicks away. Convenience only: each
// section still checks the role and the server decides every action. Owner: WS-E.
import './shells.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { OperatorIcon } from '../operator-icon';
import { useT } from '../language-provider';
import { subscribeToHash } from '../../lib/address-store';
import { sectionForSlug } from '../../lib/operator-urls';
import {
  currentTeamItem,
  currentTeamSection,
  sectionAllowedFor,
  sectionLabel,
  teamNavigation,
  teamSectionHref,
  teamSettingsSections,
} from '../../lib/ux/shells';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';

export function TeamSidebar({ urls, ownerPage }: { urls: boolean; ownerPage: boolean }) {
  const t = useT();
  const pathname = usePathname() ?? '/operator';
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => '',
  );
  const { tenant, role } = useSyncExternalStore(
    subscribeTeamContext,
    readTeamContext,
    readServerTeamContext,
  );
  const section = currentTeamSection(pathname, hash, sectionForSlug);
  const current = currentTeamItem(section);
  const settings = useRef<HTMLDetailsElement>(null);
  // Settings opens by itself while one of its pages is in view, so the current page is visible.
  useEffect(() => {
    if (current === 'settings' && settings.current) settings.current.open = true;
  }, [current]);
  const href = (id?: string) => teamSectionHref(id, urls, tenant);
  // A section word on a mission page, the owner page or a `#` link is a full page change: the
  // workspace reads the address once, so a soft change could show the old section.
  const plain = pathname !== '/operator' && !sectionForSlug(pathname.split('/')[2] ?? '');
  const settingsItems = teamSettingsSections.filter((id) => sectionAllowedFor(id, role));
  const showOwner = ownerPage && (role === null || role === 'owner' || role === 'admin');
  function item(key: string, label: string, icon: string, target: string, active: boolean) {
    const content = (
      <>
        <OperatorIcon name={icon} />
        <span>{label}</span>
      </>
    );
    return plain || target.includes('#') ? (
      <a key={key} href={target} aria-current={active ? 'page' : undefined}>
        {content}
      </a>
    ) : (
      <Link key={key} prefetch={false} href={target} aria-current={active ? 'page' : undefined}>
        {content}
      </Link>
    );
  }
  return (
    <nav
      id="workspace-navigation"
      tabIndex={-1}
      className="ux-team-sidebar"
      aria-label={t('wse.team.nav')}
    >
      <ul>
        {teamNavigation
          .filter((entry) => !entry.section || sectionAllowedFor(entry.section, role))
          .map((entry) => (
            <li key={entry.key}>
              {item(
                entry.key,
                t(entry.label),
                entry.icon,
                href(entry.section),
                current === entry.key,
              )}
            </li>
          ))}
        <li>
          <details ref={settings} className="ux-team-settings">
            <summary aria-current={current === 'settings' ? 'true' : undefined}>
              <OperatorIcon name="settings" />
              <span>{t('wse.team.settings')}</span>
              <OperatorIcon name="chevron" className="ux-team-chevron" />
            </summary>
            <ul>
              {settingsItems.map((id) => (
                <li key={id}>{item(id, sectionLabel(id), 'chevron', href(id), section === id)}</li>
              ))}
              {showOwner ? (
                <li>
                  <Link
                    prefetch={false}
                    href="/operator/owner"
                    aria-current={section === 'owner' ? 'page' : undefined}
                  >
                    <OperatorIcon name="shield" />
                    <span>{t('wse.team.owner')}</span>
                  </Link>
                </li>
              ) : null}
            </ul>
          </details>
        </li>
      </ul>
    </nav>
  );
}
