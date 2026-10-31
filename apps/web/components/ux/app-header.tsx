'use client';
// The header of a signed-in shell (D14): no public marketing links, only what the person needs
// where they are. Brand back to their own home, the shell name, the service status for the team
// ("Live" or "Preview", CQ-47), the inbox when notifications are on, the language and Help.
// The page language and direction come from the chosen language (CQ-10). Owner: WS-E.
import './shells.css';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CornerDock } from '../corner-dock';
import { LanguageSwitcher } from '../language-switcher';
import { useLanguage, useT } from '../language-provider';
import { localeMeta } from '../../lib/i18n/locales';
import type { SignedInShell } from '../../lib/ux/shells';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';
import { NotificationInbox } from './notification-inbox';

const homes: Record<SignedInShell, string> = {
  team: '/operator',
  customer: '/account',
  contributor: '/contributor',
};
const names = {
  team: 'wse.shell.team',
  customer: 'wse.shell.customer',
  contributor: 'wse.shell.contributor',
} as const;

function InboxButton({ tenant }: { tenant: string }) {
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
        {t('wse.shell.inbox')}
      </button>
      <div id={panelId} className="ux-app-popover" hidden={!open}>
        {open ? <NotificationInbox tenant={tenant} /> : null}
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
  return (
    <header className="site-header ux-app-header" data-shell={kind} lang={meta.html} dir={meta.dir}>
      <Link prefetch={false} className="brand" href={homes[kind]} aria-label={t(names[kind])}>
        {brandMark}
        <span>Corridra</span>
      </Link>
      <span className="ux-app-name">{t(names[kind])}</span>
      {kind === 'team' ? (
        <span className="ux-app-status" data-live={live ? 'true' : 'false'}>
          <span className="sr-only">{t('wse.shell.statusLabel')}: </span>
          {live ? t('wse.shell.live') : t('wse.shell.preview')}
        </span>
      ) : null}
      <div className="ux-app-tools">
        {notifications && kind === 'team' && tenant ? <InboxButton tenant={tenant} /> : null}
        <LanguageSwitcher />
        <Link prefetch={false} className="ux-app-link" href="/">
          {t('wse.shell.website')}
        </Link>
        <CornerDock variant="header" />
      </div>
    </header>
  );
}
