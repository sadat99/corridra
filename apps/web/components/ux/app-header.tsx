'use client';
// The header of a signed-in shell (D14): no public marketing links, only what the person needs
// where they are. Brand back to their own home, the shell name, the service status for the team
// ("Live" or "Preview", CQ-47), the inbox when notifications are on, the language and Help.
// The page language and direction come from the chosen language (CQ-10). Owner: WS-E.
import './shells.css';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CornerDock } from '../corner-dock';
import { shellWords } from '../site-header';
import { LanguageSwitcher } from '../language-switcher';
import { useLanguage, useT } from '../language-provider';
import { localeMeta } from '../../lib/i18n/locales';
import type { SignedInShell } from '../../lib/ux/shells';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';
import { CorridraIcon } from '../corridra-icon';
import { BarInbox, LanguageMenuGroup } from './customer-bar';
import { CustomerBar } from './customer-header';
import { LeftNavMenuButton } from './left-nav';
import { MenuLink } from './menu-link';
import { NotificationInbox } from './notification-inbox';
import { OverflowMenu } from './overflow-menu';

const homes: Record<SignedInShell, string> = {
  team: '/operator',
  customer: '/account',
  contributor: '/contributor',
};
const names = shellWords.names;

function InboxButton({ endpoint }: { endpoint: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-inbox`;
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      className="ux-app-inbox"
      ref={wrapper}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="ux-app-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {t(shellWords.inbox)}
      </button>
      <div id={panelId} className="ux-app-popover" hidden={!open}>
        {open ? <NotificationInbox endpoint={endpoint} /> : null}
      </div>
    </div>
  );
}

export function AppHeader({
  kind,
  live,
  notifications,
  brandMark,
}: {
  kind: SignedInShell;
  /** The wordmark drawing, passed in so the brand is drawn in one place (site-header.tsx). */
  brandMark?: ReactNode;
  /** True on the production service; the team then sees "Live", elsewhere "Preview". */
  live: boolean;
  /** CORRIDRA_NOTIFICATIONS_V2: the inbox is shown only when it is on. */
  notifications: boolean;
}) {
  const t = useT();
  const { locale } = useLanguage();
  const { tenant } = useSyncExternalStore(
    subscribeTeamContext,
    readTeamContext,
    readServerTeamContext,
  );
  const meta = localeMeta[locale];
  const inboxEndpoint =
    kind === 'customer'
      ? '/api/customer-inbox'
      : kind === 'contributor'
        ? '/api/notifications'
        : tenant
          ? `/api/notifications?tenant=${encodeURIComponent(tenant)}`
          : null;
  // The customer header is one slim row (the menu button of the left bar, the brand and the customer bar).
  // The team header uses the same quiet tools: the inbox as an icon with its unread count, and the language
  // and the website in an account menu (owner, 6 Nov 2026). Contributor output is unchanged, byte for byte
  // (tests/integration/revamp-app-header-guard.test.ts pins the team and contributor output).
  const customer = kind === 'customer';
  return (
    <header
      className={
        customer
          ? 'site-header ux-app-header ux-customer-header'
          : kind === 'team'
            ? 'site-header ux-app-header ux-team-header'
            : 'site-header ux-app-header'
      }
      data-shell={kind}
      lang={meta.html}
      dir={meta.dir}
    >
      {/* The menu button of the left navigation: nothing renders unless a left bar is on the page. */}
      <LeftNavMenuButton />
      <Link prefetch={false} className="brand" href={homes[kind]} aria-label={t(names[kind])}>
        {brandMark}
        <span>Corridra</span>
      </Link>
      {customer ? null : <span className="ux-app-name">{t(names[kind])}</span>}
      {kind === 'team' ? (
        <span className="ux-app-status" data-live={live ? 'true' : 'false'}>
          <span className="sr-only">{t(shellWords.statusLabel)}: </span>
          {live ? t(shellWords.live) : t(shellWords.preview)}
        </span>
      ) : null}
      {customer ? (
        <CustomerBar notifications={notifications} />
      ) : kind === 'team' ? (
        <div className="ux-app-tools ux-team-tools">
          {notifications && inboxEndpoint ? (
            <BarInbox
              key={inboxEndpoint}
              counted
              endpoint={inboxEndpoint}
              label={t(shellWords.inbox)}
            />
          ) : null}
          <OverflowMenu
            label="Account menu"
            trigger={<CorridraIcon name="people" />}
            className="ux-bar-account"
          >
            <LanguageMenuGroup />
            <MenuLink href="/">Corridra Website</MenuLink>
          </OverflowMenu>
          <CornerDock variant="header" />
        </div>
      ) : (
        <div className="ux-app-tools">
          {notifications && inboxEndpoint ? (
            <InboxButton key={`${kind}:${inboxEndpoint}`} endpoint={inboxEndpoint} />
          ) : null}
          <LanguageSwitcher />
          <Link prefetch={false} className="ux-app-link" href="/">
            {t(shellWords.website)}
          </Link>
          <CornerDock variant="header" />
        </div>
      )}
    </header>
  );
}
