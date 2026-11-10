'use client';
// Navigation v1, the utility menus (UtilityMenus board), shared by the signed-in shells:
//   NotificationsPanel  the bell with its count and the panel: Needs You, Updates, Earlier, Mark All Read.
//   LanguageMenu        the language code and a menu of languages in their own names.
//   HelpMenu            help and accessibility: what is real is a link, a switch or a choice (Listen, Text Size and
//                       Less Movement), the rest says Coming soon.
//   AvatarMenu          the customer's account menu (identity, workspace, Account and the rest).
// They read only what the signed-in header already reads (the inbox, the workspaces, the person's own session);
// nothing here decides access, and every page and action still checks on the server. A feature that is not real
// yet is plain text tagged Coming soon and announced as unavailable, never a link or a button that does nothing.
import './utility-menus.css';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { CorridraIcon } from '../corridra-icon';
import { useLanguage } from '../language-provider';
import { useSignOut } from '../use-sign-out';
import {
  customerAvatarItems,
  customerHelpGroups,
  manageWorkspacesHref,
  type HelpGroup,
  type MenuEntry,
} from '../../lib/ux/customer-navigation';
import { workspacePage } from '../../lib/ux/workspace-pages';
import {
  readCustomerBilling,
  readCustomerNotificationSettings,
  readCustomerOrganisationProfiles,
  readCustomerNote,
  readServerCustomerBilling,
  readServerCustomerNotificationSettings,
  readServerCustomerOrganisationProfiles,
  readServerCustomerNote,
  subscribeCustomerNote,
} from './customer-bar-store';
import { BarInbox, LanguageMenuGroup, useWorkspaces } from './customer-bar';
import { LessMovementRow, TextSizeRow } from './comfort-controls';
import { MenuLink } from './menu-link';
import { MenuButton, MenuRadio, OverflowMenu } from './overflow-menu';

/** The bell and the grouped panel. `endpoint` is the person's own inbox read. */
export function NotificationsPanel({
  counted,
  endpoint,
  label = 'Inbox',
  bulk = true,
}: {
  counted: boolean;
  endpoint: string;
  /** Whether the inbox endpoint can count every unread item and mark them all read. The team inbox cannot: it marks one item at a time. */
  bulk?: boolean;
  /** The accessible name of the bell. It stays "Inbox", as every existing test and the team header call it; the panel it opens is titled Notifications. */
  label?: string;
}) {
  return <BarInbox counted={counted} endpoint={endpoint} label={label} grouped bulk={bulk} />;
}

/** The language code beside a globe, and the languages offered, each in its own name. */
export function LanguageMenu() {
  const { locale, offered } = useLanguage();
  if (offered.length < 2) return null;
  return (
    <OverflowMenu
      label="Language"
      className="ux-util-language"
      trigger={
        <>
          <CorridraIcon name="globe" />
          <span aria-hidden="true">{locale.toUpperCase()}</span>
        </>
      }
    >
      <LanguageMenuGroup />
    </OverflowMenu>
  );
}

/** A row for a feature that is not real yet: plain text, tagged, and announced as unavailable. */
export function MenuSoon({ children }: { children: string }) {
  return (
    <div role="menuitem" aria-disabled="true" tabIndex={-1} className="ux-menu-row ux-menu-soon">
      <span>{children}</span>
      <span className="ux-soon-tag">Coming soon</span>
    </div>
  );
}

/** Speaks the main region aloud, only where this browser has a voice for the page language (as the corner Help does). */
export function useListen() {
  const supported = useSyncExternalStore(
    (notify) => {
      if (!('speechSynthesis' in window)) return () => undefined;
      window.speechSynthesis.addEventListener('voiceschanged', notify);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', notify);
    },
    () => {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined')
        return false;
      const language = (
        document.getElementById('main')?.lang ||
        document.documentElement.lang ||
        'en'
      )
        .slice(0, 2)
        .toLowerCase();
      const voices = window.speechSynthesis.getVoices();
      return voices.length === 0
        ? language === 'en'
        : voices.some((voice) => voice.lang.toLowerCase().startsWith(language));
    },
    () => false,
  );
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const main = document.getElementById('main');
    const text = main?.innerText.trim();
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = main?.lang || document.documentElement.lang || 'en';
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(utterance);
    setSpeaking(true);
  }
  return { supported, speaking, toggle };
}

function SignOutRow({ label }: { label: string }) {
  const { busy, message, signOut } = useSignOut();
  return (
    <>
      <MenuButton disabled={busy} onClick={signOut}>
        {busy ? 'Signing Out…' : label}
      </MenuButton>
      {message ? (
        <p role="alert" className="ux-menu-note">
          {message}
        </p>
      ) : null}
    </>
  );
}

export function Entry({
  entry,
  listen,
}: {
  entry: MenuEntry;
  listen?: ReturnType<typeof useListen>;
}) {
  if (entry.kind === 'link') return <MenuLink href={entry.href}>{entry.label}</MenuLink>;
  if (entry.kind === 'soon') return <MenuSoon>{entry.label}</MenuSoon>;
  if (entry.kind === 'textsize') return <TextSizeRow label={entry.label} />;
  if (entry.kind === 'lessmovement') return <LessMovementRow label={entry.label} />;
  if (entry.kind === 'listen')
    // Hidden, never broken: where the browser cannot speak this page it is left out.
    return listen?.supported ? (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={listen.speaking}
        tabIndex={-1}
        className="ux-menu-row"
        data-menu-close=""
        onClick={listen.toggle}
      >
        {listen.speaking ? 'Stop Reading' : entry.label}
      </button>
    ) : null;
  if (entry.kind === 'external')
    // Leaves Corridra, so it opens a new tab and says so in words; the visible label comes first in the name.
    return (
      <a
        role="menuitem"
        tabIndex={-1}
        className="ux-menu-row ux-menu-external"
        href={entry.href}
        target="_blank"
        rel="noopener noreferrer"
        lang="en"
      >
        <span>{entry.label}</span>
        <CorridraIcon name="open" className="ux-menu-external-icon" />
        <span className="sr-only"> (opens WhatsApp outside Corridra, in a new tab)</span>
      </a>
    );
  return <SignOutRow label={entry.label} />;
}

/** Help and accessibility: groups of at most four, Get Help, Make It Easier to Read, About Corridra. */
export function HelpMenu({ groups = customerHelpGroups() }: { groups?: HelpGroup[] }) {
  const listen = useListen();
  return (
    <OverflowMenu
      label="Help and accessibility"
      className="ux-util-help"
      trigger={<CorridraIcon name="help" />}
    >
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="ux-menu-group">
          <p className="ux-menu-heading" aria-hidden="true">
            {group.label}
          </p>
          {group.items.map((entry) => (
            <Entry key={entry.label} entry={entry} listen={listen} />
          ))}
        </div>
      ))}
    </OverflowMenu>
  );
}

const initials = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('') || '?';

/** The workspace choices on a page that belongs to one workspace: choosing one keeps the person in the same section. */
function WorkspaceRadios({
  list,
  current,
  section,
}: {
  list: readonly { id: string; name: string }[];
  current: { id: string };
  section: string;
}) {
  // The router is read only here, on a workspace page, so the rest of the header never needs it.
  const router = useRouter();
  return (
    <>
      {list.map((w) => (
        <MenuRadio
          key={w.id}
          checked={w.id === current.id}
          onClick={() => router.push(`/account/${section}/${w.id}`)}
          data-menu-close=""
        >
          {w.name}
        </MenuRadio>
      ))}
    </>
  );
}

/**
 * The customer's account menu behind the avatar: who is signed in, the workspace (the one switcher, which keeps
 * the person in the same section of the chosen workspace), then Account, Company Profile, Plan and Billing,
 * Notification Settings and Sign Out. The privacy or preview line of the page stays here as a quiet note. Off a
 * workspace page each workspace links to its company profile only where the profiles module is on; otherwise the
 * names are plain text that describes Manage Workspaces, never a link to a profile that is unavailable.
 */
export function AvatarMenu({
  active,
  whatsappHref,
}: {
  active: boolean;
  /** The support WhatsApp link, when the owner has set a number; the phone copy of the help groups uses it. */
  whatsappHref?: string | null;
}) {
  const listen = useListen();
  const pathname = usePathname() ?? '';
  const workspaces = useWorkspaces(active);
  const workspaceNamesId = useId();
  const billing = useSyncExternalStore(
    subscribeCustomerNote,
    readCustomerBilling,
    readServerCustomerBilling,
  );
  const notificationSettings = useSyncExternalStore(
    subscribeCustomerNote,
    readCustomerNotificationSettings,
    readServerCustomerNotificationSettings,
  );
  const organisationProfiles = useSyncExternalStore(
    subscribeCustomerNote,
    readCustomerOrganisationProfiles,
    readServerCustomerOrganisationProfiles,
  );
  const note = useSyncExternalStore(
    subscribeCustomerNote,
    readCustomerNote,
    readServerCustomerNote,
  );
  const [who, setWho] = useState<{ name: string; email: string } | null>(null);
  useEffect(() => {
    // Like the workspaces, the person's own session is read only on the customer account pages. Elsewhere the
    // avatar is the plain person icon and the header makes no calls but its inbox.
    if (!active) return;
    const controller = new AbortController();
    fetch('/api/auth/get-session', { cache: 'no-store', signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { user?: { name?: unknown; email?: unknown } } | null) => {
        const user = body?.user;
        if (!controller.signal.aborted && user && typeof user.email === 'string')
          setWho({ name: typeof user.name === 'string' ? user.name : '', email: user.email });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [active]);

  const list = workspaces ?? [];
  const match = workspacePage.exec(pathname);
  const section = match?.[1];
  const current = match ? list.find((w) => w.id === match[2]) : undefined;
  const shown = current ?? (list.length === 1 ? list[0] : undefined);
  // Off a workspace page with the profiles module off, the workspace names are plain text, not links.
  const plainNames = !(current && section) && !organisationProfiles;
  const items = customerAvatarItems({
    billing,
    notificationSettings,
    organisationProfiles,
    workspaces: list,
    currentWorkspaceId: shown?.id,
  });
  return (
    <OverflowMenu
      label="Account menu"
      className="ux-util-avatar"
      trigger={
        <span className="ux-avatar-face" aria-hidden="true">
          {who ? initials(who.name || who.email) : <CorridraIcon name="people" />}
        </span>
      }
    >
      {who ? (
        <div role="group" aria-label="Signed in as" className="ux-menu-who">
          {who.name ? <strong>{who.name}</strong> : null}
          <span>{who.email}</span>
          {shown ? <span>{shown.name}</span> : null}
        </div>
      ) : null}
      {note ? <p className="ux-menu-note">{note}</p> : null}
      {list.length > 0 ? (
        <div role="group" aria-label="Workspace" className="ux-menu-group">
          {current && section ? (
            <WorkspaceRadios list={list} current={current} section={section} />
          ) : organisationProfiles ? (
            list.map((w) => (
              <MenuLink key={w.id} href={`/account/profile/${w.id}`}>
                {w.name}
              </MenuLink>
            ))
          ) : (
            <div id={workspaceNamesId} className="ux-menu-who">
              {list.map((w) => (
                <span key={w.id}>{w.name}</span>
              ))}
            </div>
          )}
          <MenuLink
            href={manageWorkspacesHref}
            describedBy={plainNames ? workspaceNamesId : undefined}
          >
            Manage Workspaces
          </MenuLink>
        </div>
      ) : null}
      {items
        .filter((entry) => entry.kind !== 'signout')
        .map((entry) => (
          <Entry key={entry.label} entry={entry} />
        ))}
      {/* Below 640 px the language and help menus are not in the header row; they are here, so nothing is lost. */}
      <div className="ux-phone-only">
        <div className="ux-menu-group">
          <p className="ux-menu-heading" aria-hidden="true">
            Language
          </p>
          <LanguageMenuGroup />
        </div>
        {customerHelpGroups(whatsappHref).map((group) => (
          <div key={group.label} role="group" aria-label={group.label} className="ux-menu-group">
            <p className="ux-menu-heading" aria-hidden="true">
              {group.label}
            </p>
            {group.items.map((entry) => (
              <Entry key={entry.label} entry={entry} listen={listen} />
            ))}
          </div>
        ))}
      </div>
      {/* Sign Out is always last, as on the board. */}
      {items
        .filter((entry) => entry.kind === 'signout')
        .map((entry) => (
          <Entry key={entry.label} entry={entry} />
        ))}
    </OverflowMenu>
  );
}
