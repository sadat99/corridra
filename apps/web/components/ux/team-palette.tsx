'use client';
// The team command palette (Navigation v1, CommandPalette board; docs/revamp/specs/navigation-v1/command-palette-search.md):
// Ctrl K or the Search button in the top bar opens it. Scopes All, Missions, Companies and Actions; Up and Down move,
// Enter opens, Tab changes scope, Escape closes. Missions and Companies come from one role-checked search route and
// are shown ranked, with the typed words marked, the stage of a mission and the source flag of a company where the
// route sent them. An empty search offers this person's recent items on this device and the places their role may
// open. A scope the role may not search, a partial search, a failed one and a signed-out one each say so and are
// never shown as "No match". People is not offered: no search can answer it yet. "Searches only what your role may
// open" is true because the server reads through the same role-checked services as the workspace lists. Owner: S4.
import './team-nav.css';
import { Fragment, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { OperatorIcon } from '../operator-icon';
import { highlightSegments } from '../../lib/palette-rank';
import { missionHitHref } from '../../lib/ux/palette-paths';
import {
  filterActions,
  isPaletteShortcut,
  moveSelection,
  nextScope,
  paletteActions,
  paletteScopeList,
  type PaletteEntry,
  type PaletteScopeId,
  type RowFacts,
} from '../../lib/ux/palette';
import {
  factFor,
  parseFound,
  sourceChip,
  stageBadge,
  type Found,
} from '../../lib/ux/palette-facts';
import {
  forgetAllRecents,
  forgetOtherRecents,
  forgetRecents,
  readRecents,
  recentsForRole,
  rememberRecent,
  type Recent,
  type RecentsStore,
} from '../../lib/ux/palette-recents';
import {
  currentOutcome,
  describeStatus,
  noRecentsLine,
  outcomeForStatus,
  phaseOf,
  settleDelay,
  type SearchOutcome,
} from '../../lib/ux/palette-status';
import { placeHref } from '../../lib/ux/team-map';
import { operatorSignInPath } from '../../lib/workspace-navigation';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';

/** The header's Search button asks the palette to open; the palette itself lives once in the team frame. */
export const openPaletteEvent = 'corridra:open-palette';

/** The Search button for the top bar. It only asks; the dialog and its Ctrl K shortcut are `TeamPalette`. */
export function PaletteTrigger() {
  return (
    <button
      type="button"
      className="ux-palette-trigger"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      title="Search"
      onClick={(event) =>
        // The trigger is passed along: Safari does not focus a clicked button, so focus could not be returned to it.
        window.dispatchEvent(
          new CustomEvent(openPaletteEvent, { detail: { opener: event.currentTarget } }),
        )
      }
    >
      <OperatorIcon name="search" />
      <span>Search</span>
      <kbd>Ctrl K</kbd>
    </button>
  );
}

type Subject = { kind: 'unknown' } | { kind: 'signedout' } | { kind: 'known'; id: string };
type Group = PaletteEntry['group'];

/** The icon of a place, by the team item it belongs to (the detail of an action). */
const placeIcons: Record<string, string> = {
  Today: 'home',
  Missions: 'mission',
  Companies: 'company',
  Meetings: 'calendar',
  Money: 'progress',
  Admin: 'shield',
  Settings: 'settings',
  Account: 'people',
};
const workspaceId = /^[0-9a-f-]{36}$/i;

function rowIcon(entry: PaletteEntry): string | null {
  if (entry.command === 'retry') return 'refresh';
  if (entry.command === 'clear-recents') return null;
  if (entry.key === 'link:signin') return 'arrow';
  if (entry.remember) return entry.remember.kind === 'mission' ? 'mission' : 'company';
  if (entry.group === 'Missions') return 'mission';
  if (entry.group === 'Companies') return 'company';
  return placeIcons[entry.detail] ?? 'open';
}

/** Names in Chinese or Bengali script say so, so a screen reader pronounces them in the right voice. */
function langOf(value: string): string | undefined {
  if (/\p{Script=Han}/u.test(value)) return 'zh';
  if (/\p{Script=Bengali}/u.test(value)) return 'bn';
  return undefined;
}

function deviceStore(): RecentsStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** The typed words marked inside the text. Marks are React text nodes inside <mark>: nothing here makes HTML. */
function Marked({ text, match }: { text: string; match?: PaletteEntry['match'] }) {
  if (!match || match.query.trim() === '') return <>{text}</>;
  return (
    <>
      {highlightSegments(text, match.query, { close: match.close }).map((piece, index) =>
        piece.hit ? (
          <mark key={index}>{piece.text}</mark>
        ) : (
          <Fragment key={index}>{piece.text}</Fragment>
        ),
      )}
    </>
  );
}

function PaletteRow({
  entry,
  id,
  active,
  onSelect,
  onOpen,
  onRun,
}: {
  entry: PaletteEntry;
  id: string;
  active: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRun: () => void;
}) {
  const icon = rowIcon(entry);
  const facts = entry.facts;
  const content = (
    <>
      <span className="ux-palette-icon" aria-hidden="true">
        {icon ? <OperatorIcon name={icon} /> : null}
      </span>
      <span className="ux-palette-text">
        <strong className="ux-palette-label" lang={langOf(entry.label)}>
          <Marked text={entry.label} match={entry.match} />
        </strong>
        {entry.detail || entry.suffix ? (
          <span className="ux-palette-detail" lang={langOf(entry.detail)}>
            {entry.detail ? <Marked text={entry.detail} match={entry.match} /> : null}
            {entry.suffix ? (entry.detail ? ' · ' : '') + entry.suffix : null}
          </span>
        ) : null}
      </span>
      <span className="ux-palette-trail">
        {facts?.close ? <span className="ux-palette-close-match">Close match</span> : null}
        {facts?.badge ? (
          <span className="ux-palette-badge" data-tone={facts.badge.tone}>
            {facts.badge.text}
          </span>
        ) : null}
        {facts?.chip ? (
          <span className="ux-palette-chip" data-tone={facts.chip.tone}>
            <OperatorIcon name={facts.chip.icon} />
            {facts.chip.text}
          </span>
        ) : null}
        {facts?.kind ? <span className="ux-palette-kind">{facts.kind}</span> : null}
        <kbd className="ux-palette-enter" aria-hidden="true">
          Enter
        </kbd>
      </span>
    </>
  );
  // The field keeps the focus: a press on a row never moves it.
  const common = {
    id,
    role: 'option' as const,
    'aria-selected': active,
    className: 'ux-palette-row',
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onMouseMove: onSelect,
  };
  return entry.command ? (
    <div {...common} onClick={onRun}>
      {content}
    </div>
  ) : (
    <a {...common} href={entry.href} tabIndex={-1} onClick={onOpen}>
      {content}
    </a>
  );
}

const groupOrder: Group[] = ['Search', 'Recent', 'Missions', 'Companies', 'Actions'];

export function TeamPalette({ urls, ownerPage }: { urls: boolean; ownerPage: boolean }) {
  const { tenant, role } = useSyncExternalStore(
    subscribeTeamContext,
    readTeamContext,
    readServerTeamContext,
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<PaletteScopeId>('all');
  // The last answer and the search it answered. What is shown is derived from it, so nothing is set in an effect.
  const [answer, setAnswer] = useState<{ key: string; outcome: SearchOutcome<Found> } | null>(null);
  // Retry sends the same words again: it changes the key of the search, so an older answer cannot be shown for it.
  const [attempt, setAttempt] = useState(0);
  // Whether mission pages are on (CORRIDRA_UX_MISSIONS_V2), read as the Missions list reads it. While it is unknown or
  // off a mission hit opens the Missions section, whose list always works; the mission page would be a 404.
  const [missionPages, setMissionPages] = useState(false);
  // Who is signed in, asked once each time the palette opens. Recents are kept for this person only; with no answer
  // (the request failed) none are shown and nothing is claimed.
  const [subject, setSubject] = useState<Subject>({ kind: 'unknown' });
  const [recents, setRecents] = useState<Recent[]>([]);
  const [cleared, setCleared] = useState(false);
  const [spoken, setSpoken] = useState('');
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const listId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  // Ctrl K (Command K on a Mac) opens it from anywhere in the team shell.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    const onOpen = (event: Event) => {
      const given = (event as CustomEvent<{ opener?: unknown }>).detail?.opener;
      opener.current =
        given instanceof HTMLElement
          ? given
          : document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(openPaletteEvent, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(openPaletteEvent, onOpen);
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch('/api/team-work/flags', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => (response.ok ? response.json() : { missionsV2: false }))
      .then((value: { missionsV2?: boolean }) => setMissionPages(value.missionsV2 === true))
      .catch(() => undefined);
    return () => controller.abort();
  }, [open]);

  // Who is signed in, for this device's recents: the same session read the header makes. Another person's recents
  // are removed from this device, and all are removed when the session has ended.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      let next: Subject = { kind: 'unknown' };
      try {
        const response = await fetch('/api/operator-auth/get-session', {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (response.ok) {
          const data: unknown = await response.json();
          const user =
            typeof data === 'object' && data !== null && 'user' in data
              ? (data as { user?: unknown }).user
              : null;
          if (!user) next = { kind: 'signedout' };
          else {
            const id = typeof user === 'object' ? (user as { id?: unknown }).id : undefined;
            if (typeof id === 'string' && id.length > 0 && id.length <= 128)
              next = { kind: 'known', id };
          }
        }
      } catch {
        next = { kind: 'unknown' };
      }
      if (controller.signal.aborted) return;
      const store = deviceStore();
      if (next.kind === 'known') {
        forgetOtherRecents(store, next.id);
        setRecents(workspaceId.test(tenant) ? readRecents(store, next.id, tenant) : []);
      } else {
        if (next.kind === 'signedout') forgetAllRecents(store);
        setRecents([]);
      }
      setSubject(next);
    })();
    return () => controller.abort();
  }, [open, tenant]);

  // One search at a time: a newer search cancels the older, and an answer for an old search is dropped.
  const text = query.trim();
  const searchable = scope !== 'actions' && text.length >= 2 && workspaceId.test(tenant);
  const key = `${tenant}|${scope}|${text}|${attempt}`;
  useEffect(() => {
    if (!open || !searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      let outcome: SearchOutcome<Found>;
      try {
        const response = await fetch(
          '/api/workspace/search?' + new URLSearchParams({ tenant, q: text, scope }),
          { signal: controller.signal, cache: 'no-store' },
        );
        if (response.ok) {
          const found = parseFound(await response.json());
          outcome = found ? { kind: 'ok', found } : { kind: 'failed' };
        } else outcome = { kind: outcomeForStatus(response.status) };
      } catch {
        outcome = { kind: 'failed' };
      }
      if (controller.signal.aborted) return;
      setAnswer({ key, outcome });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, searchable, key, tenant, scope, text]);
  const outcome = searchable ? currentOutcome(answer, key) : null;
  const found = outcome?.kind === 'ok' ? outcome.found : null;

  const actions = paletteActions(role, urls, tenant, ownerPage);
  const sectionHref = placeHref('workspace-missions', urls, tenant);
  const companiesHref = placeHref('workspace-research', urls, tenant);
  const opensMissions = missionPages ? '' : 'Opens Missions';
  const signedOut =
    scope !== 'actions' &&
    (outcome?.kind === 'signedout' || (text.length < 2 && subject.kind === 'signedout'));
  const phase = signedOut ? 'signedout' : phaseOf(searchable, outcome);
  const mark = text ? { query: text, close: false } : undefined;

  const entries: PaletteEntry[] = [];
  if (phase === 'failed')
    entries.push({
      key: 'command:retry',
      group: 'Search',
      label: 'Retry',
      detail: 'Search again with the same words',
      href: '',
      command: 'retry',
    });
  if (signedOut)
    entries.push({
      key: 'link:signin',
      group: 'Search',
      label: 'Sign In',
      detail: '',
      href: operatorSignInPath(tenant, ''),
    });
  // Recents: this person's, in this workspace, only while nothing is typed, and only for places the role may open.
  let shownRecents: Recent[] = [];
  if (text === '' && scope !== 'actions' && subject.kind === 'known')
    shownRecents = recentsForRole(
      recents,
      actions.map((action) => action.key),
    )
      .filter(
        (item) => scope === 'all' || item.kind === (scope === 'missions' ? 'mission' : 'company'),
      )
      .slice(0, scope === 'all' ? 5 : 8);
  for (const item of shownRecents)
    entries.push({
      key: `recent:${item.kind}:${item.id}`,
      group: 'Recent',
      label: item.label,
      detail: '',
      suffix: item.kind === 'mission' ? opensMissions : 'Opens Companies',
      href:
        item.kind === 'mission'
          ? missionHitHref(missionPages, item.id, tenant, sectionHref)
          : companiesHref,
      facts: { kind: item.kind === 'mission' ? 'Mission' : 'Company' },
      remember: item,
    });
  if (shownRecents.length > 0)
    entries.push({
      key: 'command:clear-recents',
      group: 'Recent',
      label: 'Clear Recents',
      detail: 'Removes them from this device',
      href: '',
      command: 'clear-recents',
    });
  if (scope === 'all' || scope === 'missions')
    for (const hit of found?.missions ?? []) {
      const fact = factFor(found, 'mission:' + hit.id);
      const badge = fact?.status ? stageBadge(fact.status) : undefined;
      const facts: RowFacts = {};
      if (badge) facts.badge = { text: badge.text, tone: badge.tone };
      if (fact?.close) facts.close = true;
      entries.push({
        key: 'mission:' + hit.id,
        group: 'Missions',
        label: hit.label,
        detail: hit.detail,
        suffix: [badge?.stage, opensMissions].filter(Boolean).join(' · ') || undefined,
        href: missionHitHref(missionPages, hit.id, tenant, sectionHref),
        match: { query: text, close: fact?.close === true },
        facts: Object.keys(facts).length > 0 ? facts : undefined,
        remember: { kind: 'mission', id: hit.id, label: hit.label },
      });
    }
  if (scope === 'all' || scope === 'companies')
    for (const hit of found?.companies ?? []) {
      const fact = factFor(found, 'company:' + hit.id);
      const chip = sourceChip(fact?.source);
      const facts: RowFacts = {};
      if (chip) facts.chip = chip;
      if (fact?.close) facts.close = true;
      entries.push({
        key: 'company:' + hit.id,
        group: 'Companies',
        label: hit.label,
        detail: hit.detail,
        suffix: 'Opens Companies',
        href: companiesHref,
        match: { query: text, close: fact?.close === true },
        facts: Object.keys(facts).length > 0 ? facts : undefined,
        remember: { kind: 'company', id: hit.id, label: hit.label },
      });
    }
  if (scope === 'all' || scope === 'actions')
    for (const action of filterActions(actions, query).slice(0, scope === 'actions' ? 20 : 4))
      entries.push({ ...action, match: mark });
  const active = Math.min(selected, entries.length - 1);
  // The keyboard moves the selection while focus stays in the field, so the list is scrolled to keep it in view.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId, entries.length]);

  const resultCount = entries.filter(
    (entry) =>
      entry.group === 'Missions' || entry.group === 'Companies' || entry.group === 'Actions',
  ).length;
  const view = describeStatus({
    scope,
    text,
    phase,
    denied: found?.denied ?? [],
    partial: found?.partial ?? [],
    count: resultCount,
    offline: !online,
  });
  // The screen reader hears the message only after it has stayed the same for a moment, so typing makes one
  // announcement and a fast search never says "Searching".
  const message = cleared ? 'Recent items cleared' : view.spoken;
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setSpoken(message), message === '' ? 0 : settleDelay);
    return () => clearTimeout(timer);
  }, [open, message]);
  const noRecents =
    text === '' &&
    (scope === 'missions' || scope === 'companies') &&
    !signedOut &&
    shownRecents.length === 0;

  function close() {
    setOpen(false);
    setQuery('');
    setScope('all');
    setAnswer(null);
    setAttempt(0);
    setSelected(0);
    setCleared(false);
    setSpoken('');
    setSubject({ kind: 'unknown' });
    setRecents([]);
    const back = opener.current;
    if (back?.isConnected) back.focus();
    opener.current = null;
  }
  function remember(entry: PaletteEntry) {
    if (entry.remember && subject.kind === 'known')
      rememberRecent(deviceStore(), subject.id, tenant, entry.remember);
  }
  function run(entry: PaletteEntry) {
    if (entry.command === 'retry') {
      setAttempt((count) => count + 1);
      setSelected(0);
    } else if (entry.command === 'clear-recents' && subject.kind === 'known') {
      forgetRecents(deviceStore(), subject.id, tenant);
      setRecents([]);
      setCleared(true);
      setSelected(0);
    }
    field.current?.focus();
  }
  function go(entry: PaletteEntry | undefined) {
    if (!entry) return;
    if (entry.command) return run(entry);
    remember(entry);
    // A full page load: the workspace reads the address once, so a soft change could show the old section.
    window.location.assign(entry.href);
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(moveSelection(active, event.key, entries.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(entries[active]);
    } else if (event.key === 'Tab' && !(event.target as HTMLElement).closest('.ux-palette-hint')) {
      event.preventDefault();
      setScope(nextScope(scope, event.shiftKey));
      setSelected(0);
      setCleared(false);
    }
  }
  const groups = groupOrder.filter((name) => entries.some((entry) => entry.group === name));
  const headingFor = (name: Group) =>
    name === 'Recent'
      ? 'Recent on this device'
      : name === 'Actions' && text === '' && scope === 'all'
        ? 'Places you can open'
        : name === 'Search'
          ? 'Search status'
          : name;

  return (
    <>
      {mounted
        ? createPortal(
            <dialog
              ref={dialog}
              className="ux-palette"
              aria-label="Search missions, companies and actions"
              onClose={close}
              onKeyDown={onKeyDown}
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <div className="ux-palette-body">
                <div className="ux-palette-input">
                  <OperatorIcon name="search" />
                  <input
                    ref={field}
                    type="text"
                    role="combobox"
                    aria-expanded="true"
                    aria-autocomplete="list"
                    aria-controls={listId}
                    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                    aria-label="Search missions, companies and actions"
                    placeholder="Search missions, companies and actions"
                    value={query}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={80}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelected(0);
                      setCleared(false);
                    }}
                    autoFocus
                  />
                  <kbd className="ux-palette-esc" aria-hidden="true">
                    Esc
                  </kbd>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="ux-palette-close"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="ux-palette-scopes" role="group" aria-label="Search in">
                  {paletteScopeList.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      tabIndex={-1}
                      aria-pressed={scope === entry.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setScope(entry.id);
                        setSelected(0);
                        setCleared(false);
                      }}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                {scope !== 'actions' ? (
                  <p className="ux-palette-summary" aria-hidden="true">
                    {view.summary}
                  </p>
                ) : null}
                {view.notices.map((notice) => (
                  <div key={notice.text} className="ux-palette-notice" data-tone={notice.tone}>
                    {notice.icon ? <OperatorIcon name={notice.icon} /> : null}
                    <p>
                      {notice.lead ? <strong>{notice.lead} </strong> : null}
                      {notice.text}
                    </p>
                  </div>
                ))}
                <div className="ux-palette-region">
                  {view.block ? (
                    <div className="ux-palette-block" data-kind={view.block.kind}>
                      <OperatorIcon name={view.block.icon} />
                      <p className="ux-palette-block-title">{view.block.heading}</p>
                      {view.block.lines.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  ) : null}
                  {noRecents ? (
                    <div className="ux-palette-block" data-kind="norecent">
                      <p>{noRecentsLine(scope)}</p>
                    </div>
                  ) : null}
                  <div
                    id={listId}
                    role="listbox"
                    aria-label={text === '' ? 'Recent items and places you can open' : 'Results'}
                    className="ux-palette-list"
                  >
                    {groups.map((name) => (
                      <div key={name} role="group" aria-label={headingFor(name)}>
                        {name === 'Search' ? null : (
                          <p className="ux-palette-group" aria-hidden="true">
                            {headingFor(name)}
                          </p>
                        )}
                        {entries.map((entry, index) =>
                          entry.group === name ? (
                            <PaletteRow
                              key={entry.key}
                              entry={entry}
                              id={`${listId}-${index}`}
                              active={index === active}
                              onSelect={() => setSelected(index)}
                              onOpen={() => remember(entry)}
                              onRun={() => run(entry)}
                            />
                          ) : null,
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                  {spoken}
                </p>
                <div className="ux-palette-hint">
                  <span className="ux-palette-keys">
                    <kbd>Up</kbd> <kbd>Down</kbd> Move · <kbd>Enter</kbd> Open · <kbd>Tab</kbd>{' '}
                    Change scope
                  </span>
                  <span>Searches only what your role may open</span>
                </div>
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
