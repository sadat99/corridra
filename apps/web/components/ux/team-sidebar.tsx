'use client';
// The Team shell sidebar (Signal Desk map, docs/revamp/specs/signal-desk.md): Today, Missions,
// Companies, Delivery, Outcomes and All tools and settings. Each of the 18 workspace sections sits in
// exactly one group, so nothing that existed before is more than two clicks away. A group with one
// visible section is a plain link; a group with more opens to list them, and the group holding the
// current page is open. Convenience only: each section still checks the role and the server decides
// every action. Owner: WS-E.
import './shells.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { OperatorIcon } from '../operator-icon';
import { useLanguage } from '../language-provider';
import { subscribeToHash } from '../../lib/address-store';
import { sectionForSlug } from '../../lib/operator-urls';
import { translate } from '../../lib/i18n/messages';
import { workspaceSections } from '../../lib/workspace-navigation';
import {
  currentTeamItem,
  currentTeamSection,
  sectionAllowedFor,
  sectionLabel,
  teamNavigation,
  teamSectionHref,
} from '../../lib/ux/shells';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';

export function TeamSidebar({ urls, ownerPage }: { urls: boolean; ownerPage: boolean }) {
  const { t, locale } = useLanguage();
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
  const groups = useRef(new Map<string, HTMLDetailsElement>());
  // The group holding the current page opens by itself, so a deep link or `#` link lands visibly.
  useEffect(() => {
    const group = groups.current.get(current);
    if (group) group.open = true;
  }, [current]);
  const href = (id?: string) => teamSectionHref(id, urls, tenant);
  // A section word on a mission page, the owner page or a `#` link is a full page change: the
  // workspace reads the address once, so a soft change could show the old section.
  const plain = pathname !== '/operator' && !sectionForSlug(pathname.split('/')[2] ?? '');
  // Until the workspace has loaded the role is unknown. Then only what every role may open is
  // listed, so an owner or admin link never flashes for someone who cannot use it. Presentation
  // only: each section and action still checks the role on the server.
  const allowed = (id: string) =>
    role === null
      ? !!(
          workspaceSections.find((entry) => entry.id === id)?.roles as readonly string[] | undefined
        )?.includes('viewer')
      : sectionAllowedFor(id, role);
  const showOwner = ownerPage && (role === 'owner' || role === 'admin');
  // A word with no text in the chosen language falls back to English; it is then marked as English.
  function word(key: Parameters<typeof t>[0]): ReactNode {
    const text = t(key);
    return locale !== 'en' && text === translate('en', key) ? <span lang="en">{text}</span> : text;
  }
  const english = (text: string): ReactNode =>
    locale !== 'en' ? <span lang="en">{text}</span> : text;
  function item(key: string, label: ReactNode, icon: string, target: string, active: boolean) {
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
        {teamNavigation.map((entry) => {
          if (!entry.sections)
            return (
              <li key={entry.key}>
                {item(entry.key, word(entry.label), entry.icon, href(), current === entry.key)}
              </li>
            );
          const visible = entry.sections.filter(allowed);
          const owner = entry.key === 'tools' && showOwner;
          if (visible.length === 0 && !owner) return null;
          if (visible.length === 1 && entry.key !== 'tools')
            return (
              <li key={entry.key}>
                {item(
                  entry.key,
                  word(entry.label),
                  entry.icon,
                  href(visible[0]),
                  current === entry.key,
                )}
              </li>
            );
          return (
            <li key={entry.key}>
              <details
                ref={(node) => {
                  if (node) groups.current.set(entry.key, node);
                  else groups.current.delete(entry.key);
                }}
                className="ux-team-group"
                open={current === entry.key}
              >
                <summary aria-current={current === entry.key ? 'true' : undefined}>
                  <OperatorIcon name={entry.icon} />
                  <span>{word(entry.label)}</span>
                  <OperatorIcon name="chevron" className="ux-team-chevron" />
                </summary>
                <ul>
                  {visible.map((id) => (
                    <li key={id}>
                      {item(id, english(sectionLabel(id)), 'chevron', href(id), section === id)}
                    </li>
                  ))}
                  {owner ? (
                    <li>
                      <Link
                        prefetch={false}
                        href="/operator/owner"
                        aria-current={section === 'owner' ? 'page' : undefined}
                      >
                        <OperatorIcon name="shield" />
                        <span>{word('wse.team.owner')}</span>
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
