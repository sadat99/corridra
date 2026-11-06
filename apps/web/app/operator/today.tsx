'use client';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { OperatorIcon } from '../../components/operator-icon';
import { SegmentedFilter } from '../../components/ux/segmented-filter';
import { formatDate, formatDateTime } from '../../lib/ux/format';
import {
  filterRows,
  filterTotal,
  lateLabel,
  needsSummary,
  needsYouNow,
  type MissionPage,
  type NeedsFilter,
  type NeedsRow,
} from '../../lib/ux/team-today';
import { readFailureKind, readFailureWords, type ReadFailureKind } from './read-failure';
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
type MeetingRead = { meetings: Meeting[]; followups: FollowUp[] };
/** getTeamToday counts (CQ-34, CQ-73). Unread counts are listed in `unavailable`, never zero. */
type TeamCounts = {
  acceptedQuotesNotStarted: number;
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
  } | null;
  /** Why meetings could not be read; null when they were read. */
  workFailure: ReadFailureKind | null;
};

const week = 7 * 24 * 60 * 60 * 1000;
const readLimit = 100;
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

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

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
  href: string;
  link: string;
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
      <a className="text-link ux-week-link" href={href}>
        {link}
      </a>
    </section>
  );
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
  const [filter, setFilter] = useState<NeedsFilter>('all');
  const [all, setAll] = useState(false);
  // Mission pages exist only while CORRIDRA_UX_MISSIONS_V2 is on (the page answers 404 otherwise), so rows
  // open the mission list until the same flag read the Missions panel uses says they are on.
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
              onChange={(value) => {
                setFilter(value);
                setAll(false);
              }}
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

function ThisWeek({ today }: { today: Today }) {
  const { work, team } = today;
  const repliesUnavailable = team?.unavailable?.includes('repliesToReview') ?? false;
  return (
    <section className="ux-week" aria-labelledby="today-week-title">
      <h3 id="today-week-title">This week</h3>
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
            href="#workspace-meetings"
            link="Open Meetings"
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
              Meeting and follow-up counts cover the first {readLimit} records of each kind.
            </p>
          )}
        </>
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
      ) : (
        <p className="ux-week-unread">
          {repliesUnavailable
            ? 'The number of replies to review is not available.'
            : today.teamFailure === 'denied'
              ? 'Replies could not be read for your role.'
              : 'Replies could not be read right now.'}
        </p>
      )}
    </section>
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
}: {
  tenant: string;
  revision: number;
  start?: ReactNode;
}) {
  const [today, setToday] = useState<Today | null>(null);
  // Why the list could not be read: the person's role, too many requests, or anything else (an
  // unavailable service or no connection). Each gets its own words and a retry where one helps.
  const [failure, setFailure] = useState<ReadFailureKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
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
    ])
      .then(([fresh, overdue, open, teamRead, meetingRead]) => {
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
              partial: read.meetings.length >= readLimit || read.followups.length >= readLimit,
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
          observedAt: new Date(now).toISOString(),
        });
        setFailure(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailure(readFailureKind(error));
      });
    return () => controller.abort();
  }, [tenant, revision, attempt]);
  const work = today?.work ?? null;
  const rows = today ? needsYouNow(today.fresh, today.overdue) : [];
  const summary = today ? needsSummary(today.fresh, today.overdue, rows) : null;
  const nothing =
    !!today &&
    today.fresh.total === 0 &&
    today.overdue.total === 0 &&
    (!today.team ||
      (today.team.acceptedQuotesNotStarted === 0 && today.team.repliesToReview === 0)) &&
    (!work ||
      (work.upcoming.length === 0 &&
        work.reschedule.length === 0 &&
        work.lateFollowUps.length === 0));
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
          {today.team && (
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
        </ul>
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
