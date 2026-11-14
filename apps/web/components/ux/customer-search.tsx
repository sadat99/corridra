'use client';
// The customer search (docs/revamp/specs/navigation-v1/customer-search.md): a Search button first in the customer top
// bar and the dialog it opens. Requests and Companies come from one POST to /api/customer-search, which reads them
// through the services the person already uses; Pages are built here from the shell's own navigation model and send
// nothing. Ctrl K or Command K opens it. Up and Down move, Enter opens, Tab changes scope, Escape closes and clears.
// A scope that is partial, denied, unavailable, archived, closed, signed out or failed says so and is never shown as
// "No match". The typed words go only in the body of one request and on screen: no address, no storage, no recents,
// and nothing here imports a staff file. A row is a real link, so a click or Enter is a full page load. Owner: PR B.
import './customer-search.css';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { CorridraIcon } from '../corridra-icon';
import { sessionChanged } from '../session-events';
import { highlightSegments } from '../../lib/palette-rank';
import { formatDate } from '../../lib/ux/format';
import { workspacePage } from '../../lib/ux/workspace-pages';
import {
  factFor,
  parseFound,
  type CustomerFound,
  type CustomerHit,
} from '../../lib/ux/customer-search-facts';
import { customerSearchPages, pagesFor, type PageMatch } from '../../lib/ux/customer-search-pages';
import {
  companyDetailLine,
  currentOutcome,
  customerScopeList,
  customerSearchWords as words,
  describeStatus,
  isShortcut,
  moveSelection,
  nextScope,
  outcomeForStatus,
  phaseOf,
  requestDetailLine,
  scopeSpoken,
  searchable,
  searchDelay,
  selectionIndex,
  settleDelay,
  type CustomerScopeId,
  type SearchOutcome,
} from '../../lib/ux/customer-search-status';
import {
  readCustomerBilling,
  readCustomerIdentity,
  readCustomerCompanies,
  readCustomerMove,
  readCustomerNotificationSettings,
  readCustomerOrganisationProfiles,
  readCustomerProblemReports,
  readServerCustomerBilling,
  readServerCustomerIdentity,
  readServerCustomerCompanies,
  readServerCustomerMove,
  readServerCustomerNotificationSettings,
  readServerCustomerOrganisationProfiles,
  readServerCustomerProblemReports,
  subscribeCustomerNote,
} from './customer-bar-store';
import { useWorkspaces } from './customer-bar';

/** The Search button asks the dialog to open; the dialog lives once beside it. Not the staff event. */
const openEvent = 'corridra:open-customer-search';
/**
 * Ctrl K pressed before the dialog exists. The page's script is evaluated before React hydrates and the dialog is
 * drawn one render after that (it is a portal that waits for the browser), so on a slow first load the key can arrive
 * in a window where nothing listens. It is remembered here, with the element that had focus, and the dialog opens as
 * soon as it exists. A key older than the hold is dropped: a person who pressed it and gave up is not surprised later.
 */
const pendingHoldMs = 5000;
let pendingOpen: { opener: HTMLElement | null; at: number } | null = null;
/** How many dialogs are listening. While one is, it handles the key itself and the early listener stands aside. */
let listening = 0;
function rememberOpen(opener: HTMLElement | null) {
  pendingOpen = { opener, at: Date.now() };
}
function takePendingOpen(): { opener: HTMLElement | null } | null {
  const held = pendingOpen;
  pendingOpen = null;
  return held && Date.now() - held.at <= pendingHoldMs ? held : null;
}
if (typeof window !== 'undefined') {
  // Registered when this file is evaluated, which is before hydration. It keeps the same guard as the dialog's own
  // listener: another open modal keeps the key, and the key is taken only for a shortcut this search will answer.
  window.addEventListener('keydown', (event) => {
    if (listening > 0 || !isShortcut(event)) return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    const active = document.activeElement;
    rememberOpen(active instanceof HTMLElement && active !== document.body ? active : null);
  });
}
type Group = 'Search' | 'Requests' | 'Companies' | 'Pages';
const groupOrder: Group[] = ['Search', 'Requests', 'Companies', 'Pages'];

type Row = {
  key: string;
  group: Group;
  label: string;
  detail: string;
  href: string;
  /** Retry re-sends the same words; it has no address. */
  command?: 'retry';
  icon: string;
  kind?: string;
  close?: boolean;
  withdrawn?: boolean;
  /** The hit comes from sample data, which is always labelled. */
  sample?: boolean;
  /** The typed words to mark in the label and detail; absent for the status rows. */
  mark?: { query: string; close: boolean };
};

/** Names in Chinese or Bengali script say so, so a screen reader pronounces them in the right voice. */
function langOf(value: string): string | undefined {
  if (/\p{Script=Han}/u.test(value)) return 'zh';
  if (/\p{Script=Bengali}/u.test(value)) return 'bn';
  return undefined;
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
function Marked({ text, mark }: { text: string; mark?: Row['mark'] }) {
  if (!mark || mark.query.trim() === '') return <>{text}</>;
  return (
    <>
      {highlightSegments(text, mark.query, { close: mark.close }).map((piece, index) =>
        piece.hit ? (
          <mark key={index}>{piece.text}</mark>
        ) : (
          <Fragment key={index}>{piece.text}</Fragment>
        ),
      )}
    </>
  );
}

function SearchRow({
  row,
  id,
  active,
  onSelect,
  onRun,
}: {
  row: Row;
  id: string;
  active: boolean;
  onSelect: () => void;
  onRun: () => void;
}) {
  const content = (
    <>
      <span className="ux-csearch-icon" aria-hidden="true">
        <CorridraIcon name={row.icon} />
      </span>
      <span className="ux-csearch-text">
        <strong className="ux-csearch-label" lang={langOf(row.label)}>
          <Marked text={row.label} mark={row.mark} />
        </strong>
        {row.detail ? (
          <span className="ux-csearch-detail" lang={langOf(row.detail)}>
            <Marked text={row.detail} mark={row.mark} />
          </span>
        ) : null}
      </span>
      <span className="ux-csearch-trail">
        {row.close ? <span className="ux-csearch-close-match">{words.closeMatch}</span> : null}
        {row.withdrawn ? <span className="ux-csearch-chip">{words.withdrawn}</span> : null}
        {row.sample ? <span className="ux-csearch-chip">{words.sample}</span> : null}
        {row.kind ? <span className="ux-csearch-kind">{row.kind}</span> : null}
        <kbd className="ux-csearch-enter" aria-hidden="true">
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
    className: 'ux-csearch-row',
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onMouseMove: onSelect,
  };
  return row.command ? (
    <div {...common} onClick={onRun}>
      {content}
    </div>
  ) : (
    <a {...common} href={row.href} tabIndex={-1}>
      {content}
    </a>
  );
}

function useFlag<T>(read: () => T, server: () => T) {
  return useSyncExternalStore(subscribeCustomerNote, read, server);
}

/** How long company hits stay on screen at most: the Companies page's own minute. */
const companyHoldMs = 60_000;

function SearchDialog({ onAccount, pathname }: { onAccount: boolean; pathname: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<CustomerScopeId>('all');
  // The last answer and the search it answered. What is shown is derived from it, so nothing is set in an effect.
  const [answer, setAnswer] = useState<{
    key: string;
    outcome: SearchOutcome<CustomerFound>;
    /** When company hits in this answer are cleared: the earlier of their scope's expiry and a minute after loading. */
    clearAt?: number;
  } | null>(null);
  // The answer whose company hits the clock has cleared (at its `clearAt`): they go, the Requests and the pages stay. A new
  // answer is another object, so it starts with its company hits shown.
  const [clearedAnswer, setClearedAnswer] = useState<typeof answer>(null);
  // Retry sends the same words again: it changes the key of the search, so an older answer cannot be shown for it.
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(0);
  const [scopeNote, setScopeNote] = useState('');
  const [spoken, setSpoken] = useState('');
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

  // The shell's own flags, the same holders the account and help menus read. Without them the defaults are the narrow
  // side, so the Pages scope can only list less than the shell offers.
  const companies = useFlag(readCustomerCompanies, readServerCustomerCompanies);
  const move = useFlag(readCustomerMove, readServerCustomerMove);
  const billing = useFlag(readCustomerBilling, readServerCustomerBilling);
  const notificationSettings = useFlag(
    readCustomerNotificationSettings,
    readServerCustomerNotificationSettings,
  );
  const organisationProfiles = useFlag(
    readCustomerOrganisationProfiles,
    readServerCustomerOrganisationProfiles,
  );
  const problemReports = useFlag(readCustomerProblemReports, readServerCustomerProblemReports);
  // Who the page was drawn for; sent back as the rejection-only identity headers, never the words.
  const identity = useFlag(readCustomerIdentity, readServerCustomerIdentity);
  const workspaces = useWorkspaces(open && onAccount);
  const pages = useMemo(() => {
    const list = workspaces ?? [];
    const match = workspacePage.exec(pathname);
    const current = match ? list.find((item) => item.id === match[2]) : undefined;
    return customerSearchPages(
      {
        companies,
        move,
        billing,
        notificationSettings,
        organisationProfiles,
        problemReports,
        workspaces: list,
        currentWorkspaceId: (current ?? (list.length === 1 ? list[0] : undefined))?.id,
      },
      pathname || '/account',
    );
  }, [
    workspaces,
    pathname,
    companies,
    move,
    billing,
    notificationSettings,
    organisationProfiles,
    problemReports,
  ]);

  // Every open starts clean: no words, scope All, no answer, nothing selected.
  const reset = useCallback(() => {
    setQuery('');
    setScope('all');
    setAnswer(null);
    setClearedAnswer(null);
    setAttempt(0);
    setSelected(0);
    setScopeNote('');
    setSpoken('');
  }, []);
  // The dialog is opened here, from the key or the event, and not from the open state: a native Escape closes the
  // dialog before React's close handler runs, so the state can still say open and a state-driven open would be lost.
  const openSearch = useCallback(
    (given: HTMLElement | null) => {
      const element = dialog.current;
      if (!element) {
        // The dialog is drawn one render after hydration: keep the request and open when it exists.
        rememberOpen(given);
        return;
      }
      if (element.open) {
        field.current?.focus();
        return;
      }
      opener.current = given;
      reset();
      element.showModal();
      field.current?.focus();
      setOpen(true);
    },
    [reset],
  );
  /** Closes, clears and puts focus back on the opener. Used by Escape, Close and by every cleanup path below. */
  const shut = useCallback(() => {
    setOpen(false);
    reset();
    const element = dialog.current;
    if (element?.open) element.close();
    const back = opener.current;
    if (back?.isConnected) back.focus();
    opener.current = null;
  }, [reset]);

  // Ctrl K (Command K on a Mac) opens it from anywhere in the customer frame, and the Search button asks the same way.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event)) return;
      const own = dialog.current;
      // Another modal (an invitation or an erasure dialog) keeps the key: this one does not open over it.
      if (document.querySelector('dialog[open]') && !own?.open) return;
      event.preventDefault();
      if (own?.open) return;
      const active = document.activeElement;
      openSearch(active instanceof HTMLElement && active !== document.body ? active : null);
    };
    const onOpen = (event: Event) => {
      const given = (event as CustomEvent<{ opener?: unknown }>).detail?.opener;
      openSearch(given instanceof HTMLElement ? given : null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(openEvent, onOpen);
    listening += 1;
    return () => {
      listening -= 1;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(openEvent, onOpen);
    };
  }, [openSearch]);

  // A signed-in state that may have changed, or a page that is leaving or coming back from the back-forward cache: the
  // dialog closes and forgets. A page that only becomes hidden keeps the dialog but forgets the words and the answer.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) shut();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') reset();
    };
    window.addEventListener(sessionChanged, shut);
    window.addEventListener('pagehide', shut);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener(sessionChanged, shut);
      window.removeEventListener('pagehide', shut);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [shut, reset]);

  // Closing from the state (the Close button, the backdrop): the close event then runs shut().
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open && element.open) element.close();
  }, [open, mounted]);

  // A Ctrl K that arrived before the dialog existed opens it now, with the focus it was pressed from. It stays below
  // the effect above: that one reads the state of this render, which still says closed, and would close what this opens.
  useEffect(() => {
    if (!mounted) return;
    const held = takePendingOpen();
    if (held) openSearch(held.opener);
  }, [mounted, openSearch]);

  // One search at a time: a newer search cancels the older, and an answer for an old search is dropped.
  const text = query.trim();
  const sendable = searchable(scope, text);
  const key = `${scope}|${text}|${attempt}`;
  useEffect(() => {
    if (!open || !sendable) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      let outcome: SearchOutcome<CustomerFound>;
      try {
        const response = await fetch('/api/customer-search', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: {
            'Content-Type': 'application/json',
            ...(identity
              ? {
                  'x-corridra-customer-subject': identity.subject,
                  'x-corridra-customer-issuer': identity.issuer,
                }
              : {}),
          },
          body: JSON.stringify({ q: text, scope }),
          signal: controller.signal,
        });
        if (response.ok) {
          const found = parseFound(await response.json());
          outcome = found ? { kind: 'ok', found } : { kind: 'failed' };
        } else {
          // A closed account is a 403 that keeps its code; every other status is told by the number alone.
          let code: unknown;
          if (response.status === 403) {
            try {
              code = ((await response.json()) as { code?: unknown } | null)?.code;
            } catch {
              code = undefined;
            }
          }
          outcome = { kind: outcomeForStatus(response.status, code) };
        }
      } catch {
        outcome = { kind: 'failed' };
      }
      // The Companies page clears what it shows at the earlier of the scope's expiry and 60 seconds after loading.
      const loaded =
        outcome.kind === 'ok' && outcome.found.hits.some((hit) => hit.kind === 'company')
          ? outcome.found
          : null;
      const expires = loaded?.expiresAt ? Date.parse(loaded.expiresAt) : Number.POSITIVE_INFINITY;
      if (controller.signal.aborted) return;
      setAnswer({
        key,
        outcome,
        ...(loaded ? { clearAt: Math.min(expires, Date.now() + companyHoldMs) } : {}),
      });
    }, searchDelay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, sendable, key, scope, text, identity]);
  const clearAt = answer?.clearAt;
  useEffect(() => {
    if (clearAt === undefined) return;
    const timer = setTimeout(() => setClearedAnswer(answer), Math.max(0, clearAt - Date.now()));
    return () => clearTimeout(timer);
  }, [clearAt, answer]);
  const outcome = sendable ? currentOutcome(answer, key) : null;
  // Company hits of the answer on screen have been cleared: the same moment the Companies page clears its rows.
  const companiesCleared =
    clearedAnswer !== null &&
    clearedAnswer === answer &&
    outcome?.kind === 'ok' &&
    clearAt !== undefined;
  const found = outcome?.kind === 'ok' ? outcome.found : null;
  const phase = phaseOf(scope, text, outcome);

  const factsOf = (hit: CustomerHit) => factFor(found, hit);
  const hitRow = (hit: CustomerHit): Row => {
    const facts = factsOf(hit);
    return {
      key: `${hit.kind}:${hit.id}`,
      group: hit.kind === 'request' ? 'Requests' : 'Companies',
      label: hit.label,
      detail:
        hit.kind === 'request'
          ? facts?.sent
            ? requestDetailLine(formatDate(facts.sent), facts)
            : ''
          : companyDetailLine(hit.detail, facts?.reports),
      href: hit.href,
      icon: hit.kind === 'request' ? 'work' : 'company',
      kind: hit.kind === 'request' ? words.kindRequest : words.kindCompany,
      close: facts?.close === true,
      withdrawn: facts?.withdrawn === true,
      sample: hit.sample === true,
      mark: { query: text, close: facts?.close === true },
    };
  };
  // Requests first, then Companies, then Pages: the order the server ranked them in, and the menus' order for pages.
  const content: Row[] = [];
  if (found && (scope === 'all' || scope === 'requests'))
    for (const hit of found.hits) if (hit.kind === 'request') content.push(hitRow(hit));
  if (found && (scope === 'all' || scope === 'companies'))
    for (const hit of found.hits)
      if (hit.kind === 'company' && !companiesCleared) content.push(hitRow(hit));
  const pageRows: PageMatch[] = pagesFor(pages, scope, text);
  for (const page of pageRows)
    content.push({
      key: page.key,
      group: 'Pages',
      label: page.label,
      detail: page.detail,
      href: page.href,
      icon: 'arrow',
      kind: words.kindPage,
      close: page.close,
      mark: text ? { query: text, close: page.close } : undefined,
    });
  const view = describeStatus({
    scope,
    text,
    phase,
    scopes: companiesCleared ? { ...found?.scopes, companies: 'expired' } : (found?.scopes ?? {}),
    // Pages listed here count as results; nothing is called "No match" while a row is shown.
    count: content.length,
    offline: !online,
  });
  // The status rows come first: Retry when the search failed, Sign In when the person's access is in question.
  const status: Row[] = [];
  if (view.retry)
    status.push({
      key: 'command:retry',
      group: 'Search',
      label: words.retry,
      detail: words.retryDetail,
      href: '',
      command: 'retry',
      icon: 'refresh',
    });
  if (view.signIn)
    status.push({
      key: 'link:signin',
      group: 'Search',
      label: words.signIn,
      detail: '',
      // The page the person is on, so they come back to it. Never the typed words.
      href: '/signin?next=' + encodeURIComponent(window.location.pathname + window.location.search),
      icon: 'arrow',
    });
  const rows = [...status, ...content];
  const active = selectionIndex(selected, rows.length);
  // The keyboard moves the selection while focus stays in the field, so the list is scrolled to keep it in view.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId, rows.length]);

  // The screen reader hears the message only after it has stayed the same for a moment, so typing makes one
  // announcement and a fast search never says "Searching".
  const message = scopeNote || view.spoken;
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setSpoken(message), message === '' ? 0 : settleDelay);
    return () => clearTimeout(timer);
  }, [open, message]);

  function run(row: Row) {
    if (row.command === 'retry') {
      setAttempt((count) => count + 1);
      setSelected(0);
    }
    field.current?.focus();
  }
  function go(row: Row | undefined) {
    if (!row) return;
    if (row.command) return run(row);
    // A full page load: the page reads its own address once, so a soft change could show the old section.
    window.location.assign(row.href);
  }
  function chooseScope(next: CustomerScopeId) {
    setScope(next);
    setSelected(0);
    setScopeNote(scopeSpoken(next));
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // With no row listed there is nothing to move to; a stored -1 would outlive the wait for the answer.
      if (rows.length > 0) setSelected(moveSelection(active, event.key, rows.length));
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      // Enter that commits an input method composition (Chinese, Japanese, Korean) is not "open". Safari ends the
      // composition before that Enter arrives, so isComposing is already false there; keyCode 229 still says so.
      event.preventDefault();
      go(rows[active]);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      chooseScope(nextScope(scope, event.shiftKey));
    }
  }
  const groups = groupOrder.filter((name) => rows.some((row) => row.group === name));
  const headingFor = (name: Group) =>
    name === 'Search'
      ? words.statusGroup
      : name === 'Pages' && text === ''
        ? words.emptyHeading
        : name;

  return (
    <>
      {mounted
        ? createPortal(
            <dialog
              ref={dialog}
              className="ux-csearch"
              lang="en"
              aria-label={words.dialogName}
              onClose={() => {
                // A close event that arrives after the dialog was opened again belongs to the earlier close.
                if (dialog.current?.open) return;
                shut();
              }}
              onKeyDown={onKeyDown}
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <div className="ux-csearch-body">
                <div className="ux-csearch-input">
                  <CorridraIcon name="search" />
                  <input
                    ref={field}
                    type="text"
                    role="combobox"
                    aria-expanded="true"
                    aria-autocomplete="list"
                    aria-controls={listId}
                    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                    aria-label={words.dialogName}
                    placeholder={words.placeholder}
                    value={query}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={80}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelected(0);
                      setScopeNote('');
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="ux-csearch-close"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setOpen(false)}
                  >
                    {words.close}
                  </button>
                </div>
                <div className="ux-csearch-scopes" role="group" aria-label={words.scopeGroup}>
                  {customerScopeList.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      tabIndex={-1}
                      aria-pressed={scope === entry.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseScope(entry.id)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                {scope !== 'pages' ? (
                  <p className="ux-csearch-summary" aria-hidden="true">
                    {view.summary}
                  </p>
                ) : null}
                {view.notices.map((notice) => (
                  <div key={notice.text} className="ux-csearch-notice" data-tone={notice.tone}>
                    {notice.icon ? <CorridraIcon name={notice.icon} /> : null}
                    <p>
                      {notice.lead ? <strong>{notice.lead} </strong> : null}
                      {notice.text}
                    </p>
                  </div>
                ))}
                <div className="ux-csearch-region">
                  {view.block ? (
                    <div className="ux-csearch-block" data-kind={view.block.kind}>
                      <CorridraIcon name={view.block.icon} />
                      <p className="ux-csearch-block-title">{view.block.heading}</p>
                      {view.block.lines.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  ) : null}
                  <div
                    id={listId}
                    role="listbox"
                    aria-label={text === '' ? words.emptyHeading : 'Results'}
                    aria-busy={phase === 'searching'}
                    className="ux-csearch-list"
                  >
                    {groups.map((name) => (
                      <div key={name} role="group" aria-label={headingFor(name)}>
                        {name === 'Search' ? null : (
                          <p className="ux-csearch-group" aria-hidden="true">
                            {headingFor(name)}
                          </p>
                        )}
                        {rows.map((row, index) =>
                          row.group === name ? (
                            <SearchRow
                              key={row.key}
                              row={row}
                              id={`${listId}-${index}`}
                              active={index === active}
                              onSelect={() => setSelected(index)}
                              onRun={() => run(row)}
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
                <div className="ux-csearch-hint">
                  <span className="ux-csearch-keys">
                    <kbd>Up</kbd> <kbd>Down</kbd> Move · <kbd>Enter</kbd> Open · <kbd>Tab</kbd>{' '}
                    Change scope
                  </span>
                  <span>{words.footerHonesty}</span>
                </div>
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * The customer's Search button and its dialog. The dialog is keyed by a generation that moves on when the signed-in
 * state may have changed or the page is shown again from the back-forward cache, so nothing typed or found outlives
 * the person who typed it.
 */
export function CustomerSearch() {
  const pathname = usePathname() ?? '';
  const onAccount = pathname === '/account' || pathname.startsWith('/account/');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const next = () => setGeneration((count) => count + 1);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) next();
    };
    window.addEventListener(sessionChanged, next);
    window.addEventListener('pagehide', next);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener(sessionChanged, next);
      window.removeEventListener('pagehide', next);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
  return (
    <>
      <button
        type="button"
        className="ux-csearch-trigger"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        title={words.trigger}
        lang="en"
        onClick={(event) =>
          // The button is passed along: Safari does not focus a clicked button, so focus could not be returned to it.
          window.dispatchEvent(
            new CustomEvent(openEvent, { detail: { opener: event.currentTarget } }),
          )
        }
      >
        <CorridraIcon name="search" />
        <span>{words.trigger}</span>
      </button>
      <SearchDialog key={generation} onAccount={onAccount} pathname={pathname} />
    </>
  );
}
