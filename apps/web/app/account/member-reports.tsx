'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/ux/dialog';
import { RefreshButton } from './refresh-button';
import {
  savedMissionHeaders,
  savedMissionRead,
  uuid,
  type SavedMissionScope,
} from './saved-missions';
import { decisionCardStateWords } from './missions/decision-card-panel';
import { formatDateTime, formatMoment } from '../../lib/ux/format';
import { limitWords } from '../../lib/account-limit';
import {
  cardFromAnswer,
  decisionLabel,
  dueLabel,
  provenanceLabel,
  type CardFields,
} from '../../lib/decision-card-page';
import { contentLang } from '../../lib/work-items/view';
import type {
  MemberAccessWorkspace,
  MemberDecisionCard,
  MemberSavedReport,
} from '../../lib/member-access';
import './library-ac1.css';

// Members' Reports (ADR-087 U5): a workspace owner or admin reads, without changing, the saved reports and decision cards
// of the other members of that workspace. The list of workspaces is not a read of anyone's items and is not recorded;
// every list, card and report read is, so nothing here reads ahead: a workspace's reports load only once its section is
// on screen, its cards only once their disclosure is opened, and a card only when it is chosen.

const endpoint = '/api/customer-member-access';
const helper =
  'Reports saved and decision cards made by other members of workspaces you own or manage. You can read them and download their books. Only the member can remove a report or withdraw a card. Each report or card you open and each book you download is recorded with your name.';
type Failure = 'denied' | 'unavailable' | 'limit' | 'failed';
type Status = 'loading' | 'ready' | Failure;
const failure = (error: unknown): Failure =>
  error instanceof Error && ['denied', 'unavailable', 'limit'].includes(error.message)
    ? (error.message as Failure)
    : 'failed';
const iso = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const label = (value: unknown) => value === null || typeof value === 'string';
const id = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const cardTones: Record<MemberDecisionCard['state'], 'positive' | 'unknown' | 'caution'> = {
  ACTIVE: 'positive',
  EXPIRED: 'unknown',
  UNAVAILABLE: 'caution',
};

function workspace(value: unknown): value is MemberAccessWorkspace {
  const w = value as MemberAccessWorkspace | null;
  return (
    !!w &&
    id(w.workspaceId) &&
    typeof w.name === 'string' &&
    (w.role === 'owner' || w.role === 'admin') &&
    (w.opensAt === null || iso(w.opensAt)) &&
    typeof w.open === 'boolean' &&
    typeof w.cards === 'boolean'
  );
}
function savedReport(value: unknown): value is MemberSavedReport {
  const r = value as MemberSavedReport | null;
  return (
    !!r &&
    id(r.id) &&
    label(r.memberLabel) &&
    (r.available === false ||
      (r.available === true && typeof r.title === 'string' && iso(r.expiresAt)))
  );
}
function decisionCard(value: unknown): value is MemberDecisionCard {
  const c = value as MemberDecisionCard | null;
  return (
    !!c &&
    id(c.id) &&
    c.state in cardTones &&
    iso(c.expiresAt) &&
    label(c.memberLabel) &&
    label(c.company) &&
    label(c.decision) &&
    (c.state !== 'ACTIVE' || (typeof c.company === 'string' && typeof c.decision === 'string'))
  );
}
const post = async (scope: SavedMissionScope, body: unknown, signal: AbortSignal) =>
  savedMissionRead(
    await fetch(endpoint, {
      method: 'POST',
      cache: 'no-store',
      signal,
      headers: savedMissionHeaders(scope),
      body: JSON.stringify(body),
    }),
  );

/** Shown once the tab that holds it is chosen (or at once outside tabs); it stays shown after that. */
function usePanelShown() {
  const [shown, setShown] = useState(false);
  const place = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const panel = element.closest<HTMLElement>('[data-subtab]');
    const check = () => {
      if (!panel?.hidden) setShown(true);
    };
    check();
    if (!panel) return;
    const watch = new MutationObserver(check);
    watch.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    return () => watch.disconnect();
  }, []);
  return [shown, place] as const;
}

export function MemberReports(props: SavedMissionScope) {
  return <PrivateMemberReports key={JSON.stringify([props.issuer, props.subject])} {...props} />;
}
function PrivateMemberReports({ subject, issuer }: SavedMissionScope) {
  const [workspaces, setWorkspaces] = useState<MemberAccessWorkspace[] | null>(null),
    [status, setStatus] = useState<Status>('loading');
  const [shown, place] = usePanelShown();
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(() => {
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    void fetch(endpoint, {
      cache: 'no-store',
      signal: task.signal,
      headers: savedMissionHeaders({ subject, issuer }),
    })
      .then(savedMissionRead)
      .then((value) => {
        const list = (value as { workspaces?: unknown } | null)?.workspaces;
        if (!Array.isArray(list) || !list.every(workspace)) throw new Error('failed');
        if (!task.signal.aborted) {
          setWorkspaces(list);
          setStatus('ready');
        }
      })
      .catch((error) => {
        if (!task.signal.aborted) {
          setWorkspaces(null);
          setStatus(failure(error));
        }
      });
  }, [subject, issuer]);
  useEffect(() => {
    // Nothing read is kept on a page the person has left or hidden; the lists that were open are read again on return.
    function clear() {
      controller.current?.abort();
      setWorkspaces(null);
      setStatus('loading');
    }
    function visible() {
      if (document.hidden) clear();
      else load();
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) {
        clear();
        load();
      }
    }
    load();
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  // A person who owns or manages no workspace has nothing here.
  if (status === 'ready' && workspaces?.length === 0) return null;
  const firstOpen = workspaces?.find((w) => w.open)?.workspaceId;
  const refresh = (
    <RefreshButton
      label="members' reports"
      onClick={() => {
        setStatus('loading');
        load();
      }}
    />
  );
  return (
    <div ref={place} className="member-reports">
      <p>{helper}</p>
      {status === 'loading' && <p role="status">Loading members&apos; reports…</p>}
      {status === 'denied' && (
        <p role="alert">
          Your access to members&apos; reports could not be confirmed. Sign in again or check your
          role in the workspace.
        </p>
      )}
      {status === 'unavailable' && (
        <p role="status">Members&apos; reports are not available right now.</p>
      )}
      {status === 'failed' && (
        <>
          <p role="alert">Members&apos; reports could not be loaded. Try again.</p>
          {refresh}
        </>
      )}
      {status === 'limit' && (
        <>
          <p role="alert">{limitWords}</p>
          {refresh}
        </>
      )}
      {status === 'ready' &&
        workspaces?.map((w) => (
          <WorkspaceItems
            key={w.workspaceId}
            workspace={w}
            expanded={w.workspaceId === firstOpen}
            shown={shown}
            scope={{ subject, issuer }}
          />
        ))}
    </div>
  );
}

function WorkspaceItems({
  workspace: w,
  expanded,
  shown,
  scope,
}: {
  workspace: MemberAccessWorkspace;
  expanded: boolean;
  shown: boolean;
  scope: SavedMissionScope;
}) {
  const headingId = useId();
  const [opened, setOpened] = useState(expanded);
  const heading = (
    <h2 id={headingId} dir="auto">
      {w.name}
    </h2>
  );
  const body = !w.open ? (
    <p>
      {w.opensAt
        ? `Not open yet. Members' items show here from ${formatDateTime(w.opensAt)}.`
        : 'Not open yet. Members of this workspace have not been told about this access yet.'}
    </p>
  ) : (
    <>
      <h3>Saved reports</h3>
      <ReportList workspaceId={w.workspaceId} scope={scope} />
      {w.cards && <CardsDisclosure workspaceId={w.workspaceId} scope={scope} />}
    </>
  );
  return (
    <section
      className="detail-card library-card member-reports-workspace"
      aria-labelledby={headingId}
    >
      {expanded ? (
        <>
          {heading}
          {shown && body}
        </>
      ) : (
        <details
          className="ux-journey-disclosure"
          onToggle={(event) => {
            if (event.currentTarget.open) setOpened(true);
          }}
        >
          <summary>{heading}</summary>
          {opened && shown && body}
        </details>
      )}
    </section>
  );
}

type Page<T> = { items: T[]; nextAfter: string | null };
/**
 * One workspace's list, 25 at a time, read once on mount and then only by Load More. A failed first read replaces the
 * list with its message; a failed Load More keeps the rows and says so. The first new row takes the focus.
 */
function usePagedList<T extends { id: string }>(
  scope: SavedMissionScope,
  body: (after: string | null) => unknown,
  pick: (value: unknown) => Page<T>,
) {
  const [page, setPage] = useState<Page<T> | null>(null),
    [status, setStatus] = useState<Status>('loading'),
    [more, setMore] = useState<'idle' | 'busy' | 'failed'>('idle'),
    [focusId, setFocusId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const list = useCallback((element: HTMLElement | null) => {
    listRef.current = element;
  }, []);
  const { subject, issuer } = scope;
  const read = useRef({ body, pick });
  const load = useCallback(
    (after: string | null) => {
      controller.current?.abort();
      const task = new AbortController();
      controller.current = task;
      void post({ subject, issuer }, read.current.body(after), task.signal)
        .then((value) => {
          const next = read.current.pick(value);
          if (task.signal.aborted) return;
          setPage((old) => ({
            items: after ? [...(old?.items ?? []), ...next.items] : next.items,
            nextAfter: next.nextAfter,
          }));
          setStatus('ready');
          setMore('idle');
          if (after) setFocusId(next.items[0]?.id ?? null);
        })
        .catch((error) => {
          if (task.signal.aborted) return;
          if (after) setMore('failed');
          else {
            setPage(null);
            setStatus(failure(error));
          }
        });
    },
    [subject, issuer],
  );
  useEffect(() => {
    load(null);
    return () => controller.current?.abort();
  }, [load]);
  useEffect(() => {
    if (focusId)
      listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(focusId)}"]`)?.focus();
  }, [focusId]);
  function loadMore() {
    if (!page?.nextAfter) return;
    setMore('busy');
    load(page.nextAfter);
  }
  return { page, status, more, list, loadMore };
}

function pageOf<T>(key: string, check: (value: unknown) => value is T) {
  return (value: unknown): Page<T> => {
    const answer = value as Record<string, unknown> | null;
    const items = answer?.[key];
    const nextAfter = answer?.nextAfter;
    if (!Array.isArray(items) || !items.every(check) || !(nextAfter === null || id(nextAfter)))
      throw new Error('failed');
    return { items, nextAfter };
  };
}
const reportPage = pageOf('missions', savedReport);
const cardPage = pageOf('cards', decisionCard);

function ListState({ status }: { status: Status }) {
  if (status === 'loading') return <p role="status">Loading members&apos; reports…</p>;
  if (status === 'denied')
    return (
      <p role="alert">
        Your access to members&apos; reports could not be confirmed. Sign in again or check your
        role in the workspace.
      </p>
    );
  if (status === 'unavailable')
    return <p role="status">Members&apos; reports are not available right now.</p>;
  if (status === 'limit') return <p role="alert">{limitWords}</p>;
  if (status === 'failed')
    return <p role="alert">Members&apos; reports could not be loaded. Try again.</p>;
  return null;
}
function MoreButton({
  more,
  label: words,
  onClick,
}: {
  more: 'idle' | 'busy' | 'failed';
  label: string;
  onClick: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="text-link"
        disabled={more === 'busy'}
        aria-busy={more === 'busy' || undefined}
        onClick={onClick}
      >
        {more === 'busy' ? 'Loading…' : words}
      </button>
      {more === 'failed' && <p role="alert">More items could not be loaded. Try again.</p>}
    </>
  );
}

function ReportList({ workspaceId, scope }: { workspaceId: string; scope: SavedMissionScope }) {
  const { page, status, more, list, loadMore } = usePagedList(
    scope,
    (after) => ({ action: 'reports', workspaceId, after }),
    reportPage,
  );
  if (status !== 'ready' || !page) return <ListState status={status} />;
  if (page.items.length === 0)
    return <p className="ux-empty">No other member of this workspace has saved a report yet.</p>;
  return (
    <div className="member-reports-list" ref={list}>
      {page.items.map((m) => (
        <article className="detail-card library-card" key={m.id} data-row={m.id} tabIndex={-1}>
          {m.available && m.title && m.expiresAt ? (
            <>
              <h4 dir="auto">{m.title}</h4>
              <p>
                {m.memberLabel
                  ? `Saved by ${m.memberLabel}.`
                  : 'Saved by a member of this workspace.'}
              </p>
              <p>Original access expires {formatMoment(m.expiresAt)}.</p>
              <a
                className="text-link"
                href={`/account/member-reports/${workspaceId}/${m.id}`}
                aria-label={`Open Report, ${m.title}`}
              >
                Open Report
              </a>
            </>
          ) : (
            <>
              <h4>Report not available</h4>
              <p>Its link has expired or was withdrawn. No report content is shown.</p>
            </>
          )}
        </article>
      ))}
      {page.nextAfter && <MoreButton more={more} label="Load More Reports" onClick={loadMore} />}
    </div>
  );
}

function CardsDisclosure({
  workspaceId,
  scope,
}: {
  workspaceId: string;
  scope: SavedMissionScope;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="ux-journey-disclosure"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>Decision cards</summary>
      {opened && <CardList workspaceId={workspaceId} scope={scope} />}
    </details>
  );
}

type Detail =
  | { status: 'loading' | 'unavailable' | 'failed' }
  | { status: 'ready'; fields: CardFields; memberLabel: string | null };
const madeBy = (memberLabel: string | null) =>
  memberLabel ? `Made by ${memberLabel}.` : 'Made by a member of this workspace.';

function CardList({ workspaceId, scope }: { workspaceId: string; scope: SavedMissionScope }) {
  const { page, status, more, list, loadMore } = usePagedList(
    scope,
    (after) => ({ action: 'cards', workspaceId, after }),
    cardPage,
  );
  const [viewing, setViewing] = useState<MemberDecisionCard | null>(null),
    [detail, setDetail] = useState<Detail>({ status: 'loading' });
  const task = useRef<AbortController | null>(null);
  useEffect(() => () => task.current?.abort(), []);
  function open(card: MemberDecisionCard) {
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    setViewing(card);
    setDetail({ status: 'loading' });
    post(scope, { action: 'card', workspaceId, cardId: card.id }, controller.signal)
      .then((value) => {
        const answer = value as { cardId?: unknown; fields?: unknown; memberLabel?: unknown };
        const fields = cardFromAnswer({ state: 'OPEN', card: answer?.fields });
        if (answer?.cardId !== card.id || !fields || !label(answer.memberLabel))
          throw new Error('failed');
        if (!controller.signal.aborted)
          setDetail({ status: 'ready', fields, memberLabel: answer.memberLabel ?? null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setDetail({ status: failure(error) === 'denied' ? 'unavailable' : 'failed' });
      });
  }
  function close() {
    task.current?.abort();
    setViewing(null);
    setDetail({ status: 'loading' });
  }
  if (status !== 'ready' || !page) return <ListState status={status} />;
  if (page.items.length === 0)
    return (
      <p className="ux-empty">No other member of this workspace has made a decision card yet.</p>
    );
  return (
    <>
      <ul className="member-reports-cards" ref={list}>
        {page.items.map((card) => (
          <li key={card.id} data-row={card.id} tabIndex={-1}>
            {card.company && (
              <span dir="auto">
                <span lang={contentLang(card.company)}>{card.company}</span>
                {card.decision && <> · {decisionLabel(card.decision)}</>}
              </span>
            )}
            <span className="ux-status" data-tone={cardTones[card.state]}>
              {decisionCardStateWords[card.state]}
            </span>
            <span>{madeBy(card.memberLabel)}</span>
            <span>Link works until {formatDateTime(card.expiresAt)}.</span>
            {card.state === 'ACTIVE' && (
              <button
                type="button"
                className="text-link"
                aria-label={`View Decision, ${card.company ?? ''}`}
                onClick={() => open(card)}
              >
                View Decision
              </button>
            )}
          </li>
        ))}
      </ul>
      {page.nextAfter && (
        <MoreButton more={more} label="Load More Decision Cards" onClick={loadMore} />
      )}
      <Dialog open={!!viewing} onClose={close} title="Shared decision">
        {viewing && (
          <CardDetail
            detail={detail}
            memberLabel={viewing.memberLabel}
            onRetry={() => open(viewing)}
          />
        )}
      </Dialog>
    </>
  );
}

/** The six fields of one member's card, in the public card page's words, read only. */
export function CardDetail({
  detail,
  memberLabel,
  onRetry,
}: {
  detail: Detail;
  memberLabel: string | null;
  onRetry: () => void;
}) {
  const note = (
    <p>{madeBy(detail.status === 'ready' ? detail.memberLabel : memberLabel)} Read only.</p>
  );
  if (detail.status === 'loading')
    return (
      <>
        {note}
        <p role="status">Opening this decision…</p>
      </>
    );
  if (detail.status === 'unavailable')
    return (
      <>
        {note}
        <p role="alert">
          This decision card is not available. It may have expired or been withdrawn.
        </p>
      </>
    );
  if (detail.status === 'failed')
    return (
      <>
        {note}
        <p role="alert">This decision could not be opened. Try again.</p>
        <button type="button" className="button button-secondary" onClick={onRetry}>
          Try Again
        </button>
      </>
    );
  if (detail.status !== 'ready') return null;
  const { fields } = detail;
  const rows: [string, ReactNode][] = [
    [
      'Company',
      <span key="company" lang={contentLang(fields.company)}>
        {fields.company}
      </span>,
    ],
    ['Decision', decisionLabel(fields.decision)],
    ['Reason', fields.rationale],
    ['Next step', fields.nextAction],
    ['Due', dueLabel(fields.dueAt)],
    ['Source', provenanceLabel(fields.provenance)],
  ];
  return (
    <>
      {note}
      <dl className="member-reports-card">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd dir="auto">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
