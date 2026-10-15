'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { displayDate } from '@corridra/domain/locale';

type Mission = {
  id: string;
  status: string;
  due_at: string;
  brief: { company: string; objective: string; market: string };
};
type Meeting = {
  id: string;
  title: string;
  status: string;
  starts_at: string | null;
  due_at: string;
  location: string | null;
};
type FollowUp = { id: string; status: string; due_at: string; next_action: string };
type Page = { missions: Mission[]; total: number };
type MeetingRead = { meetings: Meeting[]; followups: FollowUp[] };
type Today = {
  fresh: Page;
  overdue: Page;
  open: Page;
  /** Null when the person's role cannot read meetings or the read failed. */
  work: {
    upcoming: Meeting[];
    reschedule: Meeting[];
    lateFollowUps: FollowUp[];
    partial: boolean;
  } | null;
};

const week = 7 * 24 * 60 * 60 * 1000;
const readLimit = 100;

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
async function missions(tenant: string, query: string, signal: AbortSignal): Promise<Page> {
  const body = await get(tenant, 'missions', `${query}&offset=0&`, signal);
  return { missions: body.missions as Mission[], total: body.total as number };
}

function Item({ lead, detail, when }: { lead: string; detail: string; when: ReactNode }) {
  return (
    <li>
      <strong>{lead}</strong>
      <span>{detail}</span>
      <span>{when}</span>
    </li>
  );
}
function Group({
  title,
  total,
  shown,
  children,
}: {
  title: string;
  total: number;
  shown: number;
  children: ReactNode;
}) {
  return (
    <section className="ux-today-list" aria-label={title}>
      <h3>{title}</h3>
      <ul>{children}</ul>
      {total > shown && (
        <p className="ux-today-more">
          Showing {shown} of {total}. The full list is below.
        </p>
      )}
    </section>
  );
}
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const state = (value: string) => value.replaceAll('_', ' ').toLowerCase();

/**
 * The first thing an operator sees: what needs a person now, taken from the same lists that are
 * mounted below. It never blocks the workspace if a read fails.
 */
export function TodayPanel({ tenant, revision }: { tenant: string; revision: number }) {
  const [today, setToday] = useState<Today | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      missions(tenant, 'filter=open&stage=DRAFT', signal),
      missions(tenant, 'filter=overdue', signal),
      missions(tenant, 'filter=open', signal),
      // Meetings are optional here: a role without access, or a failed read, only hides this part.
      get(tenant, 'meetings', '', signal)
        .then((body: MeetingRead) => body)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          return null;
        }),
    ])
      .then(([fresh, overdue, open, meetingRead]) => {
        const now = Date.now();
        const work = meetingRead
          ? {
              upcoming: meetingRead.meetings.filter(
                (m) =>
                  m.status === 'SCHEDULED' &&
                  m.starts_at !== null &&
                  Date.parse(m.starts_at) >= now &&
                  Date.parse(m.starts_at) <= now + week,
              ),
              reschedule: meetingRead.meetings.filter(
                (m) => m.status === 'RESCHEDULE_REQUIRED' || m.status === 'NO_SHOW',
              ),
              lateFollowUps: meetingRead.followups.filter(
                (f) => f.status === 'OPEN' && Date.parse(f.due_at) < now,
              ),
              partial:
                meetingRead.meetings.length >= readLimit ||
                meetingRead.followups.length >= readLimit,
            }
          : null;
        setToday({ fresh, overdue, open, work });
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [tenant, revision]);
  const work = today?.work ?? null;
  const nothing =
    !!today &&
    today.fresh.total === 0 &&
    today.overdue.total === 0 &&
    (!work ||
      (work.upcoming.length === 0 &&
        work.reschedule.length === 0 &&
        work.lateFollowUps.length === 0));
  return (
    <section className="ux-today" aria-labelledby="today-title">
      <h2 id="today-title">Today</h2>
      {failed ? (
        <p role="status">
          Today&apos;s list could not be loaded. The mission list below still works.
        </p>
      ) : !today ? (
        <p role="status" aria-live="polite">
          Loading today&apos;s list.
        </p>
      ) : (
        <>
          <ul className="ux-today-tiles" aria-label="Counts">
            <li>
              <strong>{today.fresh.total}</strong>
              <span>
                {plural(today.fresh.total, 'new request to review', 'new requests to review')}
              </span>
            </li>
            <li>
              <strong>{today.overdue.total}</strong>
              <span>
                {plural(
                  today.overdue.total,
                  'mission past its due date',
                  'missions past their due date',
                )}
              </span>
            </li>
            {work && (
              <>
                <li>
                  <strong>{work.lateFollowUps.length}</strong>
                  <span>
                    {plural(
                      work.lateFollowUps.length,
                      'follow-up past its due date',
                      'follow-ups past their due date',
                    )}
                  </span>
                </li>
                <li>
                  <strong>{work.upcoming.length}</strong>
                  <span>
                    {plural(
                      work.upcoming.length,
                      'meeting in the next 7 days',
                      'meetings in the next 7 days',
                    )}
                  </span>
                </li>
              </>
            )}
            <li>
              <strong>{today.open.total}</strong>
              <span>{plural(today.open.total, 'open mission', 'open missions')}</span>
            </li>
          </ul>
          {nothing ? (
            <p className="ux-today-empty">
              Nothing is waiting. New requests, late work and upcoming meetings appear here.
            </p>
          ) : (
            <div className="ux-today-lists">
              {today.fresh.missions.length > 0 && (
                <Group
                  title="New requests to review"
                  total={today.fresh.total}
                  shown={Math.min(5, today.fresh.missions.length)}
                >
                  {today.fresh.missions.slice(0, 5).map((m) => (
                    <Item
                      key={m.id}
                      lead={m.brief.company}
                      detail={`${m.brief.objective} · ${m.brief.market}`}
                      when={
                        <>
                          due <time dateTime={m.due_at}>{displayDate(m.due_at)}</time>
                        </>
                      }
                    />
                  ))}
                </Group>
              )}
              {today.overdue.missions.length > 0 && (
                <Group
                  title="Past their due date"
                  total={today.overdue.total}
                  shown={Math.min(5, today.overdue.missions.length)}
                >
                  {today.overdue.missions.slice(0, 5).map((m) => (
                    <Item
                      key={m.id}
                      lead={m.brief.company}
                      detail={`${m.brief.objective} · ${m.brief.market}`}
                      when={
                        <>
                          {state(m.status)} · due{' '}
                          <time dateTime={m.due_at}>{displayDate(m.due_at)}</time>
                        </>
                      }
                    />
                  ))}
                </Group>
              )}
              {work && work.lateFollowUps.length > 0 && (
                <Group
                  title="Follow-ups past their due date"
                  total={work.lateFollowUps.length}
                  shown={Math.min(5, work.lateFollowUps.length)}
                >
                  {work.lateFollowUps.slice(0, 5).map((f) => (
                    <Item
                      key={f.id}
                      lead={f.next_action}
                      detail="Follow-up after a meeting"
                      when={
                        <>
                          due <time dateTime={f.due_at}>{displayDate(f.due_at)}</time>
                        </>
                      }
                    />
                  ))}
                </Group>
              )}
              {work && work.reschedule.length > 0 && (
                <Group
                  title="Meetings that need a new time"
                  total={work.reschedule.length}
                  shown={Math.min(5, work.reschedule.length)}
                >
                  {work.reschedule.slice(0, 5).map((m) => (
                    <Item
                      key={m.id}
                      lead={m.title}
                      detail={state(m.status)}
                      when="Agree a new time"
                    />
                  ))}
                </Group>
              )}
              {work && work.upcoming.length > 0 && (
                <Group
                  title="Meetings in the next 7 days"
                  total={work.upcoming.length}
                  shown={Math.min(5, work.upcoming.length)}
                >
                  {work.upcoming
                    .slice()
                    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!))
                    .slice(0, 5)
                    .map((m) => (
                      <Item
                        key={m.id}
                        lead={m.title}
                        detail={m.location ?? 'Location not supplied'}
                        when={<time dateTime={m.starts_at!}>{displayDate(m.starts_at!)}</time>}
                      />
                    ))}
                </Group>
              )}
            </div>
          )}
          {work?.partial && (
            <p className="ux-today-more">
              Meeting and follow-up counts cover the first {readLimit} records of each kind.
            </p>
          )}
          <a className="text-link" href="#workspace-missions">
            Open the mission list
          </a>
        </>
      )}
    </section>
  );
}
