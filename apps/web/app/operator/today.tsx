'use client';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { OperatorIcon } from '../../components/operator-icon';
import { SegmentedFilter } from '../../components/ux/segmented-filter';
import { formatDate, formatDateTime } from '../../lib/ux/format';
import {
  filterRows,
  filterTotal,
  needsFilterFromSearch,
  searchWithNeedsFilter,
  lateLabel,
  needsSummary,
  needsYouNow,
  deskFilter,
  deskRows,
  deskSentence,
  deskTotals,
  deskHeadline,
  shortReference,
  shownLine,
  waitingMissions,
  type MissionPage,
  type NeedsFilter,
  type DeskRow,
  type NeedsRow,
} from '../../lib/ux/team-today';
import {
  alsoWaitingReads,
  capOverdue,
  erasureTile,
  overdueChip,
  problemReportsTile,
  type ErasureTile,
  type ProblemReportsTile,
} from '../../lib/ux/also-waiting';
import { ageWords } from '../../lib/problem-report-queue';
import { readFailureKind, readFailureWords, type ReadFailureKind } from './read-failure';
import { STEP_UP_REQUIRED, requestStepUp } from '../../lib/ux/step-up';
import { clearPinCounts, publishPinCounts } from '../../lib/ux/team-pin-counts';
import {
  DeskChip,
  DeskFold,
  DeskTable,
  CodeCheckLine,
  PartFailure,
  PartFailures,
  RegionTable,
  type DeskRowView,
  type RegionRowView,
} from './today-desk-parts';
import { useOperatorFlags } from './operator-flags';
import { Flagged, placeMark } from '../../components/ux/flag';
import { missionHref, stageLabel } from './[section]/[missionId]/mission-labels';

type Meeting = {
  id: string;
  title: string;
  status: string;
  starts_at: string | null;
  due_at: string;
  location: string | null;
};
type FollowUp = { id: string; status: string; due_at: string; next_action: string };
type MeetingRead = {
  meetings: Meeting[];
  followups: FollowUp[];
  next?: string | null;
  followupsNext?: string | null;
};
/** getTeamToday counts (CQ-34, CQ-73). Unread counts are listed in `unavailable`, never zero. */
type TeamCounts = {
  acceptedQuotesNotStarted: number;
  /** The customer asked for paid help and the team has not sent a quote. */
  serviceRequestsToQuote: number;
  repliesToReview: number;
  unavailable?: string[];
};
/** An optional read: what it returned, or why it could not be read (so the page can say so honestly). */
type Optional<T> = { value: T } | { failure: ReadFailureKind };
type Today = {
  observedAt: string;
  team: TeamCounts | null;
  /** Why the counts of accepted quotes and replies could not be read; null when they were read. */
  teamFailure: ReadFailureKind | null;
  fresh: MissionPage;
  overdue: MissionPage;
  open: MissionPage;
  /** Null when the person's role cannot read meetings or the read failed. */
  work: {
    upcoming: Meeting[];
    reschedule: Meeting[];
    lateFollowUps: FollowUp[];
    partial: boolean;
    /** The meetings read, and the follow-ups read, each stopped at one page: its counts are a lower bound. */
    meetingsPartial: boolean;
    followupsPartial: boolean;
  } | null;
  /** Why meetings could not be read; null when they were read. */
  workFailure: ReadFailureKind | null;
  /** Null when the role may not see the queue, the module is not installed or the read failed: no tile, never zero. */
  problemReports: ProblemReportsTile | null;
  erasure: ErasureTile | null;
  /** The role reads the erasure queue (so a null `erasure` means the read failed, not that it was not asked). */
  erasureRead: boolean;
  /** The role reads the problem report queue (so a null `problemReports` means the read failed). */
  problemReportsRead: boolean;
  /**
   * These lists were refused only because the authenticator check is no longer fresh (decision 5). That is not a
   * failed read: nothing is wrong and Try Again cannot help, so the page asks for the code in one quiet line.
   */
  needsCode: { erasure: boolean; problemReports: boolean };
};

/** Answered in place of a list when it needs a fresh authenticator check. */
const needsCode = 'needs-code' as const;
/** True for the refusal a stale authenticator check gets: HTTP 401 with the step-up code. */
async function refusedForCode(response: Response) {
  if (response.status !== 401) return false;
  const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
  return body?.code === STEP_UP_REQUIRED;
}

const week = 7 * 24 * 60 * 60 * 1000;
/** One server page (CRUD G12): the meetings read is ordered by date, earliest first. */
const readLimit = 50;
/** Rows shown in "Needs you now" before "Show N More", and rows per group in "This week". */
const firstRows = 5;
const weekRows = 3;

/** Existing, role-checked reads. Nothing here writes, and no new server route is used. */
async function get(tenant: string, action: string, query: string, signal: AbortSignal) {
  const response = await fetch(
    `/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}&${query}view=today`,
    { signal, cache: 'no-store' },
  );
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(body.error ?? 'Request failed'), { status: response.status });
  return body;
}
async function missions(tenant: string, query: string, signal: AbortSignal): Promise<MissionPage> {
  const body = await get(tenant, 'missions', `${query}&offset=0&`, signal);
  return { missions: body.missions as MissionPage['missions'], total: body.total as number };
}
/** A failed optional read only hides its part of the page; an aborted one stops the whole load. */
function optional(error: unknown): { failure: ReadFailureKind } {
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  return { failure: readFailureKind(error) };
}

/** The existing queue routes, read only for the roles that already see them. Any failure means no tile. */
async function readProblemReports(tenant: string, signal: AbortSignal) {
  try {
    const r = await fetch(
      `/api/workspace/problem-reports?${new URLSearchParams({ tenant, view: 'queue' })}`,
      { signal, cache: 'no-store' },
    );
    if (await refusedForCode(r.clone())) return needsCode;
    return r.ok ? problemReportsTile(await r.json(), new Date()) : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
}
async function readErasure(tenant: string, signal: AbortSignal) {
  try {
    const items: unknown[] = [];
    let full = false;
    for (const status of ['received', 'in_progress']) {
      const r = await fetch(
        `/api/workspace/customer-erasure-queue?${new URLSearchParams({ tenant, status, pageSize: '100' })}`,
        { signal, cache: 'no-store' },
      );
      if (await refusedForCode(r.clone())) return needsCode;
      if (!r.ok) return null;
      const body = (await r.json()) as { items?: unknown; nextAfter?: unknown };
      if (!Array.isArray(body.items)) return null;
      items.push(...body.items);
      if (body.nextAfter !== null && body.nextAfter !== undefined) full = true;
    }
    return erasureTile(items, full);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
}

const plural = (n: number | null, one: string, many: string) => (n === 1 ? one : many);

function Item({ lead, detail, when }: { lead: string; detail: string; when: ReactNode }) {
  return (
    <li>
      <strong>{lead}</strong>
      <span>{detail}</span>
      <span>{when}</span>
    </li>
  );
}

/**
 * One group of "This week". With items: up to three rows and the link to its section. Without: one quiet
 * line with a check mark, and the same link.
 */
function WeekGroup({
  title,
  count,
  empty,
  href,
  link,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  /** Left out where an earlier group already links to the same place: one address, one link. */
  href?: string;
  link?: string;
  children?: ReactNode;
}) {
  return (
    <section className="ux-week-group" aria-label={title} data-empty={count === 0}>
      {count === 0 ? (
        <p className="ux-week-line">
          <OperatorIcon name="check" className="ux-week-check" />
          <span>{empty}</span>
        </p>
      ) : (
        <>
          <p className="ux-week-line">
            <span>{title}</span>
            <strong className="ux-week-count">{count}</strong>
          </p>
          {children ? <ul>{children}</ul> : null}
        </>
      )}
      {href && link ? (
        <a className="text-link ux-week-link" href={href}>
          {link}
        </a>
      ) : null}
    </section>
  );
}

/** Overdue erasure requests: reference, days overdue and due date only, never a person or workspace name. */
function ErasureRows({ erasure }: { erasure: ErasureTile }) {
  const { shown, more } = capOverdue(erasure.rows);
  return (
    <ul className="ux-needs-list" aria-label="Overdue erasure requests">
      {shown.map((row) => (
        <li key={row.id}>
          <a href="#workspace-settings">
            <span className="ux-needs-text">
              <strong>Erasure request {row.reference}</strong>
              <span>Answer owed to the person who asked</span>
            </span>
            <span className="ux-needs-chips">
              <span className="ux-needs-chip" data-tone="late">
                {overdueChip(row.daysOverdue)}
              </span>
              <span className="sr-only">
                due <time dateTime={row.dueAt}>{formatDate(row.dueAt)}</time>
              </span>
            </span>
            <OperatorIcon name="chevron" className="ux-needs-arrow" />
          </a>
        </li>
      ))}
      {more > 0 && (
        <li>
          <a className="text-link" href="#workspace-settings">
            and {more} more
          </a>
        </li>
      )}
    </ul>
  );
}

/**
 * The list opens on All; the chosen filter lives in the address (?needs=new|overdue) so reload and back keep it. It is
 * read after mount, so the server render and the first client render agree.
 */
function useNeedsFilter() {
  const [filter, setFilter] = useState<NeedsFilter>('all');
  const [all, setAll] = useState(false);
  useEffect(() => {
    const read = () => {
      setFilter(needsFilterFromSearch(window.location.search));
      setAll(false);
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const choose = (value: NeedsFilter) => {
    setFilter(value);
    setAll(false);
    const search = searchWithNeedsFilter(window.location.search, value);
    if (search !== window.location.search) {
      window.history.pushState(
        null,
        '',
        `${window.location.pathname}${search}${window.location.hash}`,
      );
    }
  };
  return { filter, setFilter, all, setAll, choose };
}
/**
 * Mission pages exist only while CORRIDRA_UX_MISSIONS_V2 is on (the page answers 404 otherwise), so rows open the
 * mission list until the same flag read the Missions panel uses says they are on.
 */
function useMissionPages() {
  const [missionPages, setMissionPages] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/team-work/flags')
      .then(async (r) => (r.ok ? ((await r.json()) as { missionsV2?: boolean }) : null))
      .then((flags) => {
        if (active) setMissionPages(flags?.missionsV2 === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return missionPages;
}

/** "Needs you now": new requests and late missions as one list, with a filter and "Show N More". */
function NeedsYouNow({
  today,
  rows,
  tenant,
  nothing,
}: {
  today: Today;
  rows: NeedsRow[];
  tenant: string;
  nothing: boolean;
}) {
  const { filter, all, setAll, choose } = useNeedsFilter();
  const missionPages = useMissionPages();
  const listId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-needs`;
  const shown = filterRows(rows, filter);
  const total = filterTotal(filter, today.fresh, today.overdue, rows);
  const count = (option: NeedsFilter) => {
    const value = filterTotal(option, today.fresh, today.overdue, rows);
    return value.exact ? value.count : `${value.count}+`;
  };
  const empty =
    filter === 'new'
      ? 'No new requests to review.'
      : filter === 'overdue'
        ? 'No missions past their due date.'
        : 'No new requests and no missions past their due date.';
  return (
    <section className="ux-needs" aria-labelledby="today-needs-title">
      <header className="ux-needs-heading">
        <h3 id="today-needs-title">Needs you now</h3>
        <a className="text-link" href="#workspace-missions">
          Open Missions
        </a>
      </header>
      {nothing ? (
        <div className="ux-today-empty">
          <svg className="operator-landscape" viewBox="0 0 220 85" fill="none" aria-hidden="true">
            <path
              d="M0 57 48 37l55 17 56-31 61 25M0 67l49-15 46 13 58-17 67 13M0 76l62-9 45 8 61-10 52 9M22 80l76-23 64 28M65 84l52-20 66 20"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path
              d="m37 64 5-21 5 21zm13 5 7-30 7 30zm24-8 5-19 5 19z"
              fill="currentColor"
              opacity=".5"
            />
          </svg>
          <p>
            <strong>Nothing is waiting.</strong>
            <span>New requests, late work and upcoming meetings appear here.</span>
          </p>
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <SegmentedFilter<NeedsFilter>
              label="Show"
              value={filter}
              onChange={choose}
              options={[
                { value: 'all', label: 'All', count: count('all') },
                { value: 'new', label: 'New', count: count('new') },
                { value: 'overdue', label: 'Past due', count: count('overdue') },
              ]}
            />
          )}
          {shown.length === 0 ? (
            <p className="ux-needs-empty">{empty}</p>
          ) : (
            <ul id={listId} className="ux-needs-list">
              {shown.map(({ mission, fresh, overdue }, index) => (
                <li key={mission.id} hidden={!all && index >= firstRows}>
                  <a href={missionPages ? missionHref(mission.id, tenant) : '#workspace-missions'}>
                    <span className="ux-needs-text">
                      <strong>{mission.brief.company}</strong>
                      <span>
                        {mission.brief.objective} · {mission.brief.market}
                      </span>
                    </span>
                    <span className="ux-needs-chips">
                      {fresh && (
                        <span className="ux-needs-chip" data-tone="new">
                          New
                        </span>
                      )}
                      {overdue && (
                        <span className="ux-needs-chip" data-tone="late">
                          {lateLabel(mission.due_at, today.observedAt)}
                        </span>
                      )}
                      {mission.status !== 'DRAFT' && (
                        <span className="ux-needs-chip">{stageLabel(mission.status)}</span>
                      )}
                      {/* The due date is always read out; on screen the late chip already says it. */}
                      <span className={overdue ? 'sr-only' : 'ux-needs-due'}>
                        due <time dateTime={mission.due_at}>{formatDate(mission.due_at)}</time>
                      </span>
                    </span>
                    <OperatorIcon name="chevron" className="ux-needs-arrow" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {filter !== 'new' && today.erasure && today.erasure.rows.length > 0 && (
            <ErasureRows erasure={today.erasure} />
          )}
          {shown.length > firstRows && (
            <button
              type="button"
              className="text-link ux-needs-more"
              aria-expanded={all}
              aria-controls={listId}
              onClick={() => setAll((value) => !value)}
            >
              {all ? 'Show Fewer' : `Show ${shown.length - firstRows} More`}
            </button>
          )}
          {shown.length < total.count && (
            <p className="ux-today-more">
              Showing {shown.length} of {total.exact ? '' : 'at least '}
              {total.count}. The full list is in Missions.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Problem reports and erasure requests that wait for an owner or admin; each links to its existing queue. */
function AlsoWaiting({ today }: { today: Today }) {
  const { problemReports: reports, erasure } = today;
  return (
    <section className="ux-also-waiting" aria-labelledby="today-also-title">
      <h3 id="today-also-title">Also waiting</h3>
      <ul className="ux-today-tiles" aria-label="Also waiting">
        {reports && (
          <li data-tone={reports.count === 0 ? 'zero' : undefined}>
            <a href="#problem-report-queue">
              <strong>{reports.count}</strong>
              <span>
                {plural(reports.count, 'problem report open', 'problem reports open')}
                {reports.oldestDays !== null && reports.count > 0
                  ? `, oldest waiting ${ageWords(reports.oldestDays).replace(' ago', '')}`
                  : ''}
              </span>
            </a>
          </li>
        )}
        {erasure && (
          <li data-tone={erasure.count === 0 ? 'zero' : erasure.overdue > 0 ? 'late' : undefined}>
            <a href="#workspace-settings">
              <strong>{erasure.atLeast ? `${erasure.count}+` : erasure.count}</strong>
              <span>
                {plural(erasure.count, 'erasure request open', 'erasure requests open')}
                {erasure.overdue > 0 ? `, ${erasure.overdue} overdue` : ''}
                {erasure.nearestDueAt ? (
                  <>
                    , nearest due{' '}
                    <time dateTime={erasure.nearestDueAt}>{formatDate(erasure.nearestDueAt)}</time>
                  </>
                ) : null}
              </span>
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}

function ThisWeek({
  today,
  desk = false,
  onRetry,
}: {
  today: Today;
  /** Operator desk: the parts that could not be read name "This week" and offer Try Again where it can help. */
  desk?: boolean;
  onRetry?: () => void;
}) {
  const { work, team } = today;
  const repliesUnavailable = team?.unavailable?.includes('repliesToReview') ?? false;
  const body = (
    <>
      {work ? (
        <>
          <WeekGroup
            title="Meetings in the next 7 days"
            count={work.upcoming.length}
            empty="No meetings in the next 7 days"
            href="#workspace-meetings"
            link="Open Meetings"
          >
            {work.upcoming
              .filter((m): m is Meeting & { starts_at: string } => m.starts_at !== null)
              .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
              .slice(0, weekRows)
              .map((m) => (
                <Item
                  key={m.id}
                  lead={m.title}
                  detail={m.location ?? 'Location not supplied'}
                  when={<time dateTime={m.starts_at}>{formatDateTime(m.starts_at)}</time>}
                />
              ))}
          </WeekGroup>
          <WeekGroup
            title="Follow-ups past their due date"
            count={work.lateFollowUps.length}
            empty="No follow-ups past their due date"
            href="#workspace-meetings"
            link="Open Follow-ups"
          >
            {work.lateFollowUps.slice(0, weekRows).map((f) => (
              <Item
                key={f.id}
                lead={f.next_action}
                detail="Follow-up after a meeting"
                when={
                  <>
                    due <time dateTime={f.due_at}>{formatDate(f.due_at)}</time>
                  </>
                }
              />
            ))}
          </WeekGroup>
          <WeekGroup
            title="Meetings that need a new time"
            count={work.reschedule.length}
            empty="No meetings need a new time"
          >
            {work.reschedule.slice(0, weekRows).map((m) => (
              <Item
                key={m.id}
                lead={m.title}
                detail={stageLabel(m.status)}
                when="Agree a new time"
              />
            ))}
          </WeekGroup>
          {work.partial && (
            <p className="ux-today-more">
              Meeting and follow-up counts cover the {readLimit} earliest of each, by date. The
              meetings section lists them all.
            </p>
          )}
        </>
      ) : desk && today.workFailure && onRetry ? (
        <PartFailure part="This week" kind={today.workFailure} onRetry={onRetry} />
      ) : (
        <p className="ux-week-unread">
          {today.workFailure === 'denied'
            ? 'Meetings and follow-ups could not be read for your role.'
            : 'Meetings and follow-ups could not be read right now.'}
        </p>
      )}
      {team && !repliesUnavailable ? (
        <WeekGroup
          title="Replies to review"
          count={team.repliesToReview}
          empty="No replies to review"
          href="#workspace-delivery"
          link="Open Replies"
        />
      ) : desk && !repliesUnavailable && today.teamFailure && !today.workFailure && onRetry ? (
        <PartFailure part="This week" kind={today.teamFailure} onRetry={onRetry} />
      ) : (
        <p className="ux-week-unread">
          {repliesUnavailable
            ? 'The number of replies to review is not available.'
            : today.teamFailure === 'denied'
              ? 'Replies could not be read for your role.'
              : 'Replies could not be read right now.'}
        </p>
      )}
    </>
  );
  // A closed row says when a part could not be read, so the failure is visible without opening it: never blank, never zero.
  const failed = today.workFailure !== null || (!repliesUnavailable && today.teamFailure !== null);
  if (desk)
    return (
      <DeskFold title="This week" summary={failed ? 'Not available' : null}>
        {body}
      </DeskFold>
    );
  return (
    <section className="ux-week" aria-labelledby="today-week-title">
      <h3 id="today-week-title">This week</h3>
      {body}
    </section>
  );
}

/** Today as one table (operator desk): the queue, its filter, Show More and the place line. */
function DeskQueue({
  today,
  list,
  totals,
  tenant,
  openCount,
}: {
  today: Today;
  list: DeskRow[];
  totals: ReturnType<typeof deskTotals>;
  tenant: string;
  openCount: number;
}) {
  const { filter, all, setAll, choose } = useNeedsFilter();
  const missionPages = useMissionPages();
  const [why, setWhy] = useState(false);
  const tableId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-queue`;
  const rows = list;
  const views: DeskRowView[] = deskFilter(list, filter).map((row) => {
    if (row.mission)
      return {
        row,
        what: `${row.mission.brief.objective} · ${row.mission.brief.market}`,
        group: row.mission.brief.company,
        href: missionPages ? missionHref(row.mission.id, tenant) : '#workspace-missions',
      };
    return {
      row,
      what: `Erasure request ${row.reference ?? ''}`.trim(),
      group: 'Erasure Requests',
      href: '#workspace-settings',
    };
  });
  const shown = views;
  const extra = today.erasure?.rows.length ?? 0;
  const counts: Record<NeedsFilter, { count: number; exact: boolean }> = {
    all: { count: totals.count, exact: totals.exact },
    new: { count: today.fresh.total, exact: true },
    overdue: { count: today.overdue.total + extra, exact: true },
  };
  const label = (option: NeedsFilter) =>
    counts[option].exact ? counts[option].count : `${counts[option].count}+`;
  const total = counts[filter];
  const empty =
    filter === 'new'
      ? 'No new requests to review.'
      : filter === 'overdue'
        ? 'No missions past their due date.'
        : 'No new requests and no missions past their due date.';
  // The place line: only when an upcoming meeting has no place entered.
  const meetings = today.work?.upcoming ?? [];
  const without = meetings.filter((m) => !m.location || m.location.trim() === '').length;
  return (
    <section className="ux-needs ux-desk-queue" aria-labelledby="today-needs-title">
      <header className="ux-needs-heading">
        <h3 id="today-needs-title">Needs you now</h3>
        <span className="ux-desk-open-missions">
          <a className="text-link" href="#workspace-missions">
            Open Missions
          </a>
          <span>{openCount} open</span>
        </span>
      </header>
      {rows.length > 0 && (
        <SegmentedFilter<NeedsFilter>
          label="Show"
          value={filter}
          onChange={choose}
          options={[
            { value: 'all', label: 'All', count: label('all') },
            { value: 'new', label: 'New', count: label('new') },
            { value: 'overdue', label: 'Past due', count: label('overdue') },
          ]}
        />
      )}
      {shown.length === 0 ? (
        <p className="ux-needs-empty">{empty}</p>
      ) : (
        <DeskTable
          views={shown}
          observedAt={today.observedAt}
          firstRows={firstRows}
          all={all}
          tableId={tableId}
        />
      )}
      {shown.length > firstRows && (
        <button
          type="button"
          className="text-link ux-desk-toggle ux-needs-more"
          aria-expanded={all}
          aria-controls={tableId}
          onClick={() => setAll((value) => !value)}
        >
          {all ? 'Show Fewer' : `Show ${shown.length - firstRows} More`}
        </button>
      )}
      {shown.length < total.count && (
        <p className="ux-today-more">
          Showing {shown.length} of {total.exact ? '' : 'at least '}
          {total.count}. The full list is in Missions.
        </p>
      )}
      {today.erasureRead && today.erasure === null && !today.needsCode.erasure && (
        <p className="ux-today-more">
          Erasure requests could not be checked just now, so overdue ones may be missing here.
        </p>
      )}
      {without > 0 && (
        <p className="ux-today-more ux-desk-place">
          Place not entered for {without} of {meetings.length} meetings.{' '}
          <button
            type="button"
            className="text-link ux-desk-toggle"
            aria-expanded={why}
            onClick={() => setWhy((value) => !value)}
          >
            Why
          </button>
          {why && <span role="note"> No place was entered when the meeting was booked.</span>}
        </p>
      )}
    </section>
  );
}

/** One tile row of "Also waiting" (operator desk): a number and its words, linking to where it is handled. */
function WaitingItem({
  href,
  value,
  words,
  tone,
}: {
  href: string;
  value: ReactNode;
  words: ReactNode;
  tone?: string;
}) {
  return (
    <li data-tone={tone}>
      <a href={href}>
        <strong>{value}</strong>
        <span>{words}</span>
      </a>
    </li>
  );
}

/** "Also waiting" collapsed row (operator desk). Accepted quotes and paid-service requests join the two queues. */
function DeskAlsoWaiting({
  today,
  role,
  onRetry,
}: {
  today: Today;
  role?: string;
  onRetry: () => void;
}) {
  const { team, teamFailure, problemReports: reports, erasure } = today;
  const unread = (name: 'acceptedQuotesNotStarted' | 'serviceRequestsToQuote') =>
    team?.unavailable?.includes(name) ?? false;
  const quotes = team && !unread('acceptedQuotesNotStarted') ? team.acceptedQuotesNotStarted : null;
  const services = team && !unread('serviceRequestsToQuote') ? team.serviceRequestsToQuote : null;
  // A short line beside the title only when every number behind it was read.
  const all = [quotes, services, reports?.count ?? null, erasure?.count ?? null];
  // A failed read hides only its own numbers: the queues that were read stay visible (never a false zero).
  const erasureFailed = today.erasureRead && erasure === null && !today.needsCode.erasure;
  // A count this role can never read is left out; for an owner or admin a count that failed still says so.
  const mayCount = countsForRole(role);
  const hasTiles =
    (team !== null && (mayCount || quotes !== null || services !== null)) ||
    reports !== null ||
    erasure !== null;
  const summary =
    teamFailure === null &&
    !erasureFailed &&
    all.every((value) => value !== null) &&
    !erasure?.atLeast
      ? `${all.reduce<number>((sum, value) => sum + (value ?? 0), 0)} waiting`
      : teamFailure !== null || erasureFailed
        ? hasTiles
          ? 'Partly not available'
          : 'Not available'
        : null;
  return (
    <DeskFold title="Also waiting" summary={summary}>
      {teamFailure ? (
        <PartFailure part="Also waiting" kind={teamFailure} onRetry={onRetry} />
      ) : null}
      {erasureFailed ? (
        <PartFailure part="Erasure requests" kind="unavailable" onRetry={onRetry} />
      ) : null}
      <CodeCheck today={today} onRetry={onRetry} />
      {hasTiles && (
        <ul className="ux-today-tiles" aria-label="Also waiting">
          {team && (mayCount || quotes !== null) && (
            <WaitingItem
              href="#workspace-commercial"
              value={quotes ?? 'Not available'}
              tone={quotes === 0 ? 'zero' : quotes === null ? 'unavailable' : undefined}
              words={plural(quotes, 'accepted quote not started', 'accepted quotes not started')}
            />
          )}
          {team && (mayCount || services !== null) && (
            <WaitingItem
              /* The request list is the billing hub's first block in the Delivery section; the router maps this address to that section. */
              href="#billing-services"
              value={services ?? 'Not available'}
              tone={services === 0 ? 'zero' : services === null ? 'unavailable' : undefined}
              words={plural(
                services,
                'paid-service request to quote',
                'paid-service requests to quote',
              )}
            />
          )}
          {reports && (
            <WaitingItem
              href="#problem-report-queue"
              value={reports.count}
              tone={reports.count === 0 ? 'zero' : undefined}
              words={
                plural(reports.count, 'problem report open', 'problem reports open') +
                (reports.oldestDays !== null && reports.count > 0
                  ? `, oldest waiting ${ageWords(reports.oldestDays).replace(' ago', '')}`
                  : '')
              }
            />
          )}
          {erasure && (
            <WaitingItem
              href="#workspace-settings"
              value={erasure.atLeast ? `${erasure.count}+` : erasure.count}
              tone={erasure.count === 0 ? 'zero' : erasure.overdue > 0 ? 'late' : undefined}
              words={
                <>
                  {plural(erasure.count, 'erasure request open', 'erasure requests open')}
                  {erasure.overdue > 0 ? `, ${erasure.overdue} overdue` : ''}
                  {erasure.nearestDueAt ? (
                    <>
                      , nearest due{' '}
                      <time dateTime={erasure.nearestDueAt}>
                        {formatDate(erasure.nearestDueAt)}
                      </time>
                    </>
                  ) : null}
                </>
              }
            />
          )}
        </ul>
      )}
    </DeskFold>
  );
}

/** Owner and admin read the paid-service counts; for every other role they can never be read. */
const countsForRole = (role: string | undefined) => role === 'owner' || role === 'admin';

/**
 * The one quiet line for the lists that wait for a fresh authenticator check. Confirm Code opens the check in
 * place; once it passes, Today is read again. Nothing is drawn when no list is waiting for the code.
 */
function CodeCheck({ today, onRetry }: { today: Today; onRetry: () => void }) {
  const { erasure, problemReports } = today.needsCode;
  if (!erasure && !problemReports) return null;
  return (
    <CodeCheckLine
      parts={
        erasure && problemReports
          ? 'erasure requests and problem reports'
          : erasure
            ? 'erasure requests'
            : 'problem reports'
      }
      onConfirm={() =>
        void requestStepUp().then((verified) => {
          if (verified) onRetry();
        })
      }
    />
  );
}

// Team desk v4.1 (CORRIDRA_UX_TEAM_DESK_V41, owner approved 24 Nov 2026): Today as two regions. Every number and row
// comes from the reads above; nothing new is read and nothing is written.

/** A mission's line as drawn: the market keeps its mark before its name (UI/UX.v4.1 L1); other places show the name only. */
function missionShown(mission: MissionPage['missions'][number]) {
  return (
    <>
      {mission.brief.objective} ·{' '}
      <Flagged code={placeMark(mission.brief.market)}>{mission.brief.market}</Flagged>
    </>
  );
}

/** The other queues that need a decision: each number, or null when its read failed or was not made. */
function decisionCounts(today: Today) {
  const { team, work, problemReports: reports, erasure } = today;
  const counted = (name: keyof Omit<TeamCounts, 'unavailable'>) =>
    team ? (team.unavailable?.includes(name) ? null : team[name]) : null;
  return {
    replies: counted('repliesToReview'),
    quotes: counted('acceptedQuotesNotStarted'),
    services: counted('serviceRequestsToQuote'),
    followUps: work ? work.lateFollowUps.length : null,
    reschedule: work ? work.reschedule.length : null,
    reports: reports ? reports.count : null,
    // Overdue erasure requests are rows of the table; the rest of the open ones are counted here.
    erasure: erasure ? Math.max(0, erasure.count - erasure.rows.length) : null,
  };
}

/** The sum behind the headline's "queues below", or null when a queue this role reads could not be read. */
function otherDecisions(today: Today): number | null {
  const counts = decisionCounts(today);
  const unread =
    today.teamFailure !== null ||
    today.workFailure !== null ||
    (today.team?.unavailable?.length ?? 0) > 0 ||
    (today.erasureRead && today.erasure === null) ||
    (today.erasure?.atLeast ?? false) ||
    (today.problemReportsRead && today.problemReports === null) ||
    (today.work?.partial ?? false);
  if (unread) return null;
  return Object.values(counts).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/** "Needs your decision": new requests, late missions and overdue erasure requests, then the other queues. */
function DecisionRegion({
  today,
  list,
  totals,
  tenant,
  role,
  onRetry,
}: {
  today: Today;
  list: DeskRow[];
  totals: ReturnType<typeof deskTotals>;
  tenant: string;
  role?: string;
  onRetry: () => void;
}) {
  const { filter, all, setAll, choose } = useNeedsFilter();
  const missionPages = useMissionPages();
  const tableId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-decide`;
  const views: RegionRowView[] = deskFilter(list, filter).map((row) => {
    const shared = {
      key: row.key,
      chip: <DeskChip row={row} observedAt={today.observedAt} />,
      when: <time dateTime={row.dueAt}>{formatDate(row.dueAt)}</time>,
      whenWord: 'Due',
    };
    if (row.mission)
      return {
        ...shared,
        reference: shortReference(row.mission.reference),
        what: `${row.mission.brief.objective} · ${row.mission.brief.market}`,
        shown: missionShown(row.mission),
        group: row.mission.brief.company,
        href: missionPages ? missionHref(row.mission.id, tenant) : '#workspace-missions',
      };
    return {
      ...shared,
      reference: null,
      what: `Erasure request ${row.reference ?? ''}`.trim(),
      group: 'Erasure requests',
      // No address of its own: the erasure tile below is the one link to the queue.
      href: null,
    };
  });
  const extra = today.erasure?.rows.length ?? 0;
  const counts: Record<NeedsFilter, { count: number; exact: boolean }> = {
    all: { count: totals.count, exact: totals.exact },
    new: { count: today.fresh.total, exact: true },
    overdue: { count: today.overdue.total + extra, exact: true },
  };
  const label = (option: NeedsFilter) =>
    counts[option].exact ? counts[option].count : `${counts[option].count}+`;
  const empty =
    filter === 'new'
      ? 'No new requests to review.'
      : filter === 'overdue'
        ? 'Nothing is past its due date.'
        : 'No new requests and nothing past its due date.';
  const more = shownLine(all ? views.length : Math.min(views.length, firstRows), counts[filter]);
  const queues = decisionCounts(today);
  const erasureFailed = today.erasureRead && today.erasure === null && !today.needsCode.erasure;
  const reportsFailed =
    today.problemReportsRead && today.problemReports === null && !today.needsCode.problemReports;
  // A count this role can never read is left out: "Not available" is only for a read that could have worked.
  const mayCount = countsForRole(role);
  // A capped read gives a lower bound, so its numbers carry a plus sign and never pose as exact.
  const meetingsCapped = today.work?.meetingsPartial ?? false;
  const followUpsCapped = today.work?.followupsPartial ?? false;
  const { problemReports: reports, erasure } = today;
  // A queue is listed when it holds something or could not be counted: a zero is not a decision.
  const queue = (
    key: string,
    value: number | null,
    read: boolean,
    href: string,
    words: ReactNode,
    options: { tone?: string; plus?: boolean } = {},
  ) =>
    read && value !== 0 ? (
      <WaitingItem
        key={key}
        href={href}
        value={value === null ? 'Not available' : options.plus ? `${value}+` : value}
        tone={value === null ? 'unavailable' : options.tone}
        words={words}
      />
    ) : null;
  const items = [
    queue(
      'replies',
      queues.replies,
      today.team !== null,
      '#workspace-delivery',
      plural(queues.replies, 'reply to review', 'replies to review'),
    ),
    queue(
      'services',
      queues.services,
      today.team !== null && (mayCount || queues.services !== null),
      /* The request list is the billing hub's first block in the Delivery section; the router maps this address to that section. */
      '#billing-services',
      plural(queues.services, 'paid-service request to quote', 'paid-service requests to quote'),
    ),
    queue(
      'quotes',
      queues.quotes,
      today.team !== null && (mayCount || queues.quotes !== null),
      '#workspace-commercial',
      plural(queues.quotes, 'accepted quote not started', 'accepted quotes not started'),
    ),
    // Follow-ups and meetings to rebook are handled in one place, so they share one tile and one link.
    today.work !== null && (queues.followUps !== 0 || queues.reschedule !== 0) ? (
      <li key="meetings" data-tone={queues.followUps ? 'late' : undefined}>
        <a className="ux-today41-pairs" href="#workspace-meetings">
          {queues.followUps ? (
            <span className="ux-today41-pair">
              <strong>{followUpsCapped ? `${queues.followUps}+` : queues.followUps}</strong>
              <span>
                {plural(
                  queues.followUps,
                  'follow-up past its due date',
                  'follow-ups past their due date',
                )}
              </span>
            </span>
          ) : null}
          {queues.reschedule ? (
            <span className="ux-today41-pair">
              <strong>{meetingsCapped ? `${queues.reschedule}+` : queues.reschedule}</strong>
              <span>
                {plural(queues.reschedule, 'meeting needs a new time', 'meetings need a new time')}
              </span>
            </span>
          ) : null}
        </a>
      </li>
    ) : null,
    queue(
      'reports',
      reports?.count ?? null,
      reports !== null,
      '#problem-report-queue',
      reports
        ? plural(reports.count, 'problem report open', 'problem reports open') +
            (reports.oldestDays !== null && reports.count > 0
              ? `, oldest waiting ${ageWords(reports.oldestDays).replace(' ago', '')}`
              : '')
        : null,
    ),
    queue(
      'erasure',
      erasure?.count ?? null,
      erasure !== null,
      '#workspace-settings',
      erasure ? (
        <>
          {plural(erasure.count, 'erasure request open', 'erasure requests open')}
          {erasure.overdue > 0 ? `, ${erasure.overdue} overdue` : ''}
          {erasure.nearestDueAt ? (
            <>
              , nearest due{' '}
              <time dateTime={erasure.nearestDueAt}>{formatDate(erasure.nearestDueAt)}</time>
            </>
          ) : null}
        </>
      ) : null,
      { tone: erasure && erasure.overdue > 0 ? 'late' : undefined, plus: erasure?.atLeast },
    ),
  ].filter((item) => item !== null);
  return (
    <section className="ux-needs ux-today41-region" aria-labelledby="today-decide-title">
      <header className="ux-today41-head">
        <h3 id="today-decide-title">Needs your decision</h3>
      </header>
      {list.length > 0 && (
        <SegmentedFilter<NeedsFilter>
          label="Show"
          value={filter}
          onChange={choose}
          options={[
            { value: 'all', label: 'All', count: label('all') },
            { value: 'new', label: 'New', count: label('new') },
            { value: 'overdue', label: 'Past due', count: label('overdue') },
          ]}
        />
      )}
      {views.length === 0 ? (
        <p className="ux-needs-empty">{empty}</p>
      ) : (
        <RegionTable
          views={views}
          firstRows={firstRows}
          all={all}
          tableId={tableId}
          caption="New requests and late work, latest first"
          whenHeading="Due"
          action="Review"
          primary
        />
      )}
      {views.length > firstRows && (
        <button
          type="button"
          className="text-link ux-desk-toggle ux-needs-more"
          aria-expanded={all}
          aria-controls={tableId}
          onClick={() => setAll((value) => !value)}
        >
          {all ? 'Show Fewer' : `Show ${views.length - firstRows} More`}
        </button>
      )}
      {more && <p className="ux-today-more">{more}</p>}
      {/* One message for each cause, naming every part it took: never the same words twice. */}
      <PartFailures
        parts={[
          erasureFailed ? { part: 'Erasure requests', kind: 'unavailable' } : null,
          reportsFailed ? { part: 'Problem reports', kind: 'unavailable' } : null,
          today.teamFailure ? { part: 'Replies and quotes', kind: today.teamFailure } : null,
          today.workFailure ? { part: 'Meetings and follow-ups', kind: today.workFailure } : null,
        ]}
        onRetry={onRetry}
      />
      <CodeCheck today={today} onRetry={onRetry} />
      {items.length > 0 && (
        <ul className="ux-today-tiles ux-today41-queues" aria-label="Also needs your decision">
          {items}
        </ul>
      )}
      {(meetingsCapped || followUpsCapped) && (
        <p className="ux-today-more">
          {meetingsCapped && followUpsCapped
            ? `Follow-ups and meetings that need a new time cover the ${readLimit} earliest of each.`
            : followUpsCapped
              ? `Follow-ups cover the ${readLimit} earliest.`
              : `Meetings that need a new time cover the ${readLimit} earliest.`}
        </p>
      )}
    </section>
  );
}

/** "Waiting on others": open missions that are on time and the meetings of the next 7 days, as one closed row. */
function WaitingRegion({ today, tenant }: { today: Today; tenant: string }) {
  const [all, setAll] = useState(false);
  const [why, setWhy] = useState(false);
  const missionPages = useMissionPages();
  const tableId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-waiting`;
  const meetings = (today.work?.upcoming ?? []).filter(
    (m): m is Meeting & { starts_at: string } => m.starts_at !== null,
  );
  const views = [
    ...waitingMissions(today.open, today.fresh, today.overdue, today.observedAt).map((mission) => ({
      at: Date.parse(mission.due_at),
      view: {
        key: mission.id,
        reference: shortReference(mission.reference),
        what: `${mission.brief.objective} · ${mission.brief.market}`,
        shown: missionShown(mission),
        group: mission.brief.company,
        chip: <span className="ux-desk-chip">{stageLabel(mission.status)}</span>,
        when: <time dateTime={mission.due_at}>{formatDate(mission.due_at)}</time>,
        whenWord: 'Due',
        href: missionPages ? missionHref(mission.id, tenant) : '#workspace-missions',
      } satisfies RegionRowView,
    })),
    ...meetings.map((meeting) => ({
      at: Date.parse(meeting.starts_at),
      view: {
        key: `meeting:${meeting.id}`,
        reference: null,
        what: meeting.title,
        group: 'Meeting',
        chip: null,
        when: (
          <>
            <time dateTime={meeting.starts_at}>{formatDateTime(meeting.starts_at)}</time>
            <span className="ux-today41-place">
              {meeting.location?.trim() ? meeting.location : 'Place not entered'}
            </span>
          </>
        ),
        whenWord: 'Starts',
        // No address of its own: Meetings is in the menu, and the meetings tile links there when work waits.
        href: null,
      } satisfies RegionRowView,
    })),
  ]
    .sort((a, b) => a.at - b.at || (a.view.key < b.view.key ? -1 : 1))
    .map((item) => item.view);
  const without = meetings.filter((m) => !m.location || m.location.trim() === '').length;
  // A meetings read that stopped at one page may hold more: the row then gives no number and never says none.
  const meetingsCapped = today.work?.meetingsPartial ?? false;
  // The closed row says how many are listed, or that a part could not be read: never blank, never a false zero.
  const summary =
    today.workFailure !== null
      ? 'Partly not available'
      : meetingsCapped || today.open.missions.length < today.open.total
        ? 'On time'
        : `${views.length} on time`;
  return (
    <DeskFold title="Waiting on others" summary={summary}>
      <p className="ux-desk-open-missions">{today.open.total} open in total</p>
      {views.length === 0 ? (
        meetingsCapped ? null : (
          <p className="ux-needs-empty">Nothing is waiting on anyone else.</p>
        )
      ) : (
        <>
          <p className="ux-today41-lead">On time. Nothing to decide here yet.</p>
          <RegionTable
            views={views}
            firstRows={firstRows}
            all={all}
            tableId={tableId}
            caption="Open missions that are on time and meetings in the next 7 days, soonest first"
            whenHeading="When"
            action="Open"
          />
        </>
      )}
      {views.length > firstRows && (
        <button
          type="button"
          className="text-link ux-desk-toggle ux-needs-more"
          aria-expanded={all}
          aria-controls={tableId}
          onClick={() => setAll((value) => !value)}
        >
          {all ? 'Show Fewer' : `Show ${views.length - firstRows} More`}
        </button>
      )}
      {today.open.missions.length < today.open.total && (
        <p className="ux-today-more">
          Not every open mission is listed here. The full list is in Missions.
        </p>
      )}
      {meetingsCapped && (
        <p className="ux-today-more">
          Meetings here cover the {readLimit} earliest by date. The meetings section lists them all.
        </p>
      )}
      {today.workFailure && (
        <p className="ux-today-more">Meetings could not be read, so none are listed here.</p>
      )}
      {without > 0 && (
        <p className="ux-today-more ux-desk-place">
          Place not entered for {without} of {meetings.length} meetings.{' '}
          <button
            type="button"
            className="text-link ux-desk-toggle"
            aria-expanded={why}
            onClick={() => setWhy((value) => !value)}
          >
            Why
          </button>
          {why && <span role="note"> No place was entered when the meeting was booked.</span>}
        </p>
      )}
    </DeskFold>
  );
}

/**
 * The first thing an operator sees: what needs a person now, taken from the same lists that are
 * mounted below. It never blocks the workspace if a read fails. `start` is the workspace's own start
 * card, placed in the side column under "This week" so the page reads as one screen.
 */
export function TodayPanel({
  tenant,
  revision,
  start,
  role,
  problemReports = false,
  desk = false,
}: {
  tenant: string;
  revision: number;
  start?: ReactNode;
  /** The signed-in role: only an owner or admin triggers the two "Also waiting" reads. */
  role?: string;
  /** Whether Report a Problem is installed and offered. */
  problemReports?: boolean;
  /** CORRIDRA_UX_OPERATOR_DESK: Today as one table with Also waiting and This week as collapsed rows. */
  desk?: boolean;
}) {
  // Team desk v4.1: read on the server only with the team shell on, and handed down with the other team flags.
  const { teamDeskV41: deskV41 } = useOperatorFlags();
  const [today, setToday] = useState<Today | null>(null);
  // Why the list could not be read: the person's role, too many requests, or anything else (an
  // unavailable service or no connection). Each gets its own words and a retry where one helps.
  const [failure, setFailure] = useState<ReadFailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const reads = alsoWaitingReads(role, problemReports);
    Promise.all([
      missions(tenant, 'filter=open&stage=DRAFT', signal),
      missions(tenant, 'filter=overdue', signal),
      missions(tenant, 'filter=open', signal),
      // Accepted quotes and replies come from getTeamToday; a failed read only hides these tiles.
      fetch(`/api/team-control/today?${new URLSearchParams({ tenant })}`, {
        signal,
        cache: 'no-store',
      })
        .then(async (r): Promise<Optional<TeamCounts>> =>
          r.ok
            ? { value: (await r.json()) as TeamCounts }
            : { failure: readFailureKind({ status: r.status }) },
        )
        .catch(optional),
      // Meetings are optional here: a role without access, or a failed read, only hides this part.
      get(tenant, 'meetings', '', signal)
        .then((body: MeetingRead): Optional<MeetingRead> => ({ value: body }))
        .catch(optional),
      reads.problemReports ? readProblemReports(tenant, signal) : Promise.resolve(null),
      reads.erasure ? readErasure(tenant, signal) : Promise.resolve(null),
    ])
      .then(([fresh, overdue, open, teamRead, meetingRead, reportsTile, erasure]) => {
        const now = Date.now();
        const read = 'value' in meetingRead ? meetingRead.value : null;
        const work = read
          ? {
              upcoming: read.meetings.filter(
                (m) =>
                  m.status === 'SCHEDULED' &&
                  m.starts_at !== null &&
                  Date.parse(m.starts_at) >= now &&
                  Date.parse(m.starts_at) <= now + week,
              ),
              reschedule: read.meetings.filter(
                (m) => m.status === 'RESCHEDULE_REQUIRED' || m.status === 'NO_SHOW',
              ),
              lateFollowUps: read.followups.filter(
                (f) => f.status === 'OPEN' && Date.parse(f.due_at) < now,
              ),
              partial: Boolean(read.next || read.followupsNext),
              meetingsPartial: Boolean(read.next),
              followupsPartial: Boolean(read.followupsNext),
            }
          : null;
        setToday({
          fresh,
          overdue,
          open,
          team: 'value' in teamRead ? teamRead.value : null,
          teamFailure: 'failure' in teamRead ? teamRead.failure : null,
          work,
          workFailure: 'failure' in meetingRead ? meetingRead.failure : null,
          problemReports: reportsTile === needsCode ? null : reportsTile,
          erasure: erasure === needsCode ? null : erasure,
          needsCode: {
            erasure: erasure === needsCode,
            problemReports: reportsTile === needsCode,
          },
          erasureRead: reads.erasure,
          problemReportsRead: reads.problemReports,
          observedAt: new Date(now).toISOString(),
        });
        setFailure(null);
        // The pinned queues in the sidebar show a number only when its read succeeded (null: no number).
        if (desk)
          publishPinCounts({
            problemReports: reportsTile === needsCode ? null : (reportsTile?.count ?? null),
            erasure: erasure === needsCode ? null : (erasure?.count ?? null),
            erasureAtLeast: erasure === needsCode ? false : (erasure?.atLeast ?? false),
          });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // A failed read leaves no number behind in the sidebar.
        clearPinCounts();
        setFailure(readFailureKind(error));
      });
    return () => controller.abort();
  }, [tenant, revision, attempt, role, problemReports, desk]);
  // Closing Today takes its numbers with it: a count is never kept after the page that read it.
  useEffect(() => clearPinCounts, []);
  const retry = () => {
    clearPinCounts();
    setFailure(null);
    setToday(null);
    setAttempt((n) => n + 1);
  };
  const work = today?.work ?? null;
  const rows = today ? needsYouNow(today.fresh, today.overdue) : [];
  const summary = today ? needsSummary(today.fresh, today.overdue, rows) : null;
  const nothing =
    !!today &&
    today.fresh.total === 0 &&
    today.overdue.total === 0 &&
    !(today.erasure && today.erasure.overdue > 0) &&
    (!today.team ||
      (today.team.acceptedQuotesNotStarted === 0 &&
        today.team.serviceRequestsToQuote === 0 &&
        today.team.repliesToReview === 0)) &&
    (!work ||
      (work.upcoming.length === 0 &&
        work.reschedule.length === 0 &&
        work.lateFollowUps.length === 0));
  if (deskV41) {
    const list = today
      ? deskRows(today.fresh, today.overdue, today.erasure?.rows ?? [], today.observedAt)
      : [];
    const erasureUnread = !!today && today.erasureRead && today.erasure === null;
    const totals = today
      ? deskTotals(today.fresh, today.overdue, today.erasure, rows, erasureUnread)
      : null;
    return (
      <section className="ux-today ux-desk ux-today41" aria-labelledby="today-title">
        <header className="operator-today-heading">
          <h2 id="today-title">Today</h2>
          {today && !failure && totals && (
            <p className="ux-desk-sentence">{deskHeadline(totals, otherDecisions(today))}</p>
          )}
        </header>
        {failure ? (
          <div role="status" className="ux-today-state">
            <p>Today&apos;s list could not be loaded. {readFailureWords(failure)}</p>
            {failure !== 'denied' && (
              <button type="button" className="text-link ux-desk-toggle" onClick={retry}>
                Try Again
              </button>
            )}
          </div>
        ) : !today || !totals ? (
          <p role="status" aria-live="polite" className="ux-today-state">
            Loading today&apos;s list.
          </p>
        ) : (
          <>
            <DecisionRegion
              today={today}
              list={list}
              totals={totals}
              tenant={tenant}
              role={role}
              onRetry={retry}
            />
            <WaitingRegion today={today} tenant={tenant} />
          </>
        )}
        {start}
      </section>
    );
  }
  if (desk) {
    const list = today
      ? deskRows(today.fresh, today.overdue, today.erasure?.rows ?? [], today.observedAt)
      : [];
    // A role that reads the erasure queue and got nothing back could not check it: not the same as none waiting.
    const erasureUnread = !!today && today.erasureRead && today.erasure === null;
    const totals = today
      ? deskTotals(today.fresh, today.overdue, today.erasure, rows, erasureUnread)
      : null;
    return (
      <section className="ux-today ux-desk" aria-labelledby="today-title">
        <header className="operator-today-heading">
          <h2 id="today-title">Today</h2>
          {today && !failure && totals && (
            <p className="ux-desk-sentence">{deskSentence(totals)}</p>
          )}
        </header>
        {failure ? (
          <div role="status" className="ux-today-state">
            <p>Today&apos;s list could not be loaded. {readFailureWords(failure)}</p>
            {failure !== 'denied' && (
              <button type="button" className="text-link ux-desk-toggle" onClick={retry}>
                Try Again
              </button>
            )}
          </div>
        ) : !today || !totals ? (
          <p role="status" aria-live="polite" className="ux-today-state">
            Loading today&apos;s list.
          </p>
        ) : (
          <>
            <DeskQueue
              today={today}
              list={list}
              totals={totals}
              tenant={tenant}
              openCount={today.open.total}
            />
            <DeskAlsoWaiting today={today} role={role} onRetry={retry} />
            <ThisWeek today={today} desk onRetry={retry} />
          </>
        )}
        {start}
      </section>
    );
  }
  return (
    <section className="ux-today" aria-labelledby="today-title">
      <header className="operator-today-heading">
        <h2 id="today-title">Today</h2>
        {today && (
          <time dateTime={today.observedAt}>
            {new Intl.DateTimeFormat('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }).format(new Date(today.observedAt))}
          </time>
        )}
        {summary && (
          <p className="ux-today-summary">
            <strong>{summary.lead}</strong>
            {summary.detail ? ` ${summary.detail}` : null}
          </p>
        )}
      </header>
      {failure ? (
        <div role="status" className="ux-today-state">
          <p>Today&apos;s list could not be loaded. {readFailureWords(failure)}</p>
          {failure !== 'denied' && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setFailure(null);
                setToday(null);
                setAttempt((n) => n + 1);
              }}
            >
              Retry Today&apos;s List
            </button>
          )}
        </div>
      ) : !today ? (
        <p role="status" aria-live="polite" className="ux-today-state">
          Loading today&apos;s list.
        </p>
      ) : (
        <ul className="ux-today-tiles" aria-label="Counts">
          <li data-tone={today.fresh.total === 0 ? 'zero' : 'new'}>
            <a href="#workspace-missions">
              <strong>{today.fresh.total}</strong>
              <span>
                {plural(today.fresh.total, 'new request to review', 'new requests to review')}
              </span>
            </a>
          </li>
          <li data-tone={today.overdue.total === 0 ? 'zero' : 'late'}>
            <a href="#workspace-missions">
              <strong>{today.overdue.total}</strong>
              <span>
                {plural(
                  today.overdue.total,
                  'mission past its due date',
                  'missions past their due date',
                )}
              </span>
            </a>
          </li>
          <li data-tone={today.open.total === 0 ? 'zero' : undefined}>
            <a href="#workspace-missions">
              <strong>{today.open.total}</strong>
              <span>{plural(today.open.total, 'open mission', 'open missions')}</span>
            </a>
          </li>
          {today.team && (
            <li
              data-tone={
                today.team.unavailable?.includes('repliesToReview')
                  ? 'unavailable'
                  : today.team.repliesToReview === 0
                    ? 'zero'
                    : undefined
              }
            >
              <a href="#workspace-delivery">
                <strong>
                  {today.team.unavailable?.includes('repliesToReview')
                    ? 'Not available'
                    : today.team.repliesToReview}
                </strong>
                <span>
                  {today.team.repliesToReview === 1 &&
                  !today.team.unavailable?.includes('repliesToReview')
                    ? 'reply to review'
                    : 'replies to review'}
                </span>
              </a>
            </li>
          )}
          {work && (
            <>
              <li data-tone={work.lateFollowUps.length === 0 ? 'zero' : 'late'}>
                <a href="#workspace-meetings">
                  <strong>{work.lateFollowUps.length}</strong>
                  <span>
                    {plural(
                      work.lateFollowUps.length,
                      'follow-up past its due date',
                      'follow-ups past their due date',
                    )}
                  </span>
                </a>
              </li>
              <li data-tone={work.upcoming.length === 0 ? 'zero' : undefined}>
                <a href="#workspace-meetings">
                  <strong>{work.upcoming.length}</strong>
                  <span>
                    {plural(
                      work.upcoming.length,
                      'meeting in the next 7 days',
                      'meetings in the next 7 days',
                    )}
                  </span>
                </a>
              </li>
            </>
          )}
          {today.team &&
            (countsForRole(role) ||
              !today.team.unavailable?.includes('acceptedQuotesNotStarted')) && (
              <li
                data-tone={
                  today.team.unavailable?.includes('acceptedQuotesNotStarted')
                    ? 'unavailable'
                    : today.team.acceptedQuotesNotStarted === 0
                      ? 'zero'
                      : undefined
                }
              >
                <a href="#workspace-commercial">
                  <strong>
                    {today.team.unavailable?.includes('acceptedQuotesNotStarted')
                      ? 'Not available'
                      : today.team.acceptedQuotesNotStarted}
                  </strong>
                  <span>
                    {today.team.acceptedQuotesNotStarted === 1 &&
                    !today.team.unavailable?.includes('acceptedQuotesNotStarted')
                      ? 'accepted quote not started'
                      : 'accepted quotes not started'}
                  </span>
                </a>
              </li>
            )}
          {today.team &&
            (countsForRole(role) ||
              !today.team.unavailable?.includes('serviceRequestsToQuote')) && (
              <li
                data-tone={
                  today.team.unavailable?.includes('serviceRequestsToQuote')
                    ? 'unavailable'
                    : today.team.serviceRequestsToQuote === 0
                      ? 'zero'
                      : undefined
                }
              >
                {/* The request list is the billing hub's first block in the Delivery section; the router maps this address to that section. */}
                <a href="#billing-services">
                  <strong>
                    {today.team.unavailable?.includes('serviceRequestsToQuote')
                      ? 'Not available'
                      : today.team.serviceRequestsToQuote}
                  </strong>
                  <span>
                    {today.team.serviceRequestsToQuote === 1 &&
                    !today.team.unavailable?.includes('serviceRequestsToQuote')
                      ? 'paid-service request to quote'
                      : 'paid-service requests to quote'}
                  </span>
                </a>
              </li>
            )}
        </ul>
      )}
      {today && !failure && (today.problemReports || today.erasure) && (
        <AlsoWaiting today={today} />
      )}
      <div className="ux-today-columns">
        <div className="ux-today-main">
          {today && !failure && (
            <NeedsYouNow today={today} rows={rows} tenant={tenant} nothing={nothing} />
          )}
        </div>
        <div className="ux-today-side">
          {today && !failure && <ThisWeek today={today} />}
          {start}
        </div>
      </div>
    </section>
  );
}
