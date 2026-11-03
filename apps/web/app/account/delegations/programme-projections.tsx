'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProgrammeProjection,
  OwnProgrammeProjection,
} from '@corridra/auth/customer-programme-projections';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { DateTimeInput } from '../../../components/ux/date-time-input';

type Identity = { subject: string; issuer: string };
type Query =
  | { view: 'owner'; workspaceId: string; programmeId: string; after?: string }
  | { view: 'own'; registrationId: string; after?: string };
const missingLabels: Record<string, string> = {
  confirmedPlace: 'Confirmed place',
  currentEligibility: 'Current eligibility',
  currentTerms: 'Current terms acceptance',
  currentSharedCompany: 'Current shared company profile',
};
function useProjection<T extends { expiresAt: string }>(identity: Identity, query: Query) {
  const [data, setData] = useState<T | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [canRetry, setCanRetry] = useState(false),
    [visible, setVisible] = useState(false);
  const request = useRef<AbortController | null>(null),
    sequence = useRef(0),
    pending = useRef<{ signature: string; body: Record<string, unknown> } | null>(null),
    mounted = useRef(true);
  const queryText = new URLSearchParams(query).toString();
  const host = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => setVisible(true));
      return;
    }
    const observer = new IntersectionObserver((e) => setVisible(!!e.at(-1)?.isIntersecting), {
      rootMargin: '200px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const headers = {
    'x-corridra-customer-subject': identity.subject,
    'x-corridra-customer-issuer': identity.issuer,
  };
  const load = useCallback(async (): Promise<void> => {
    if (document.hidden) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++sequence.current;
    try {
      const response = await fetch('/api/customer-programme-projections?' + queryText, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'x-corridra-customer-subject': identity.subject,
          'x-corridra-customer-issuer': identity.issuer,
        },
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error(
          response.status === 403
            ? 'This view needs the permitted programme account.'
            : 'Programme data could not be read.',
        );
      const value = (await response.json()) as T & Record<string, unknown>,
        q = new URLSearchParams(queryText);
      if (
        !value ||
        !Number.isFinite(Date.parse(value.expiresAt)) ||
        Date.parse(value.expiresAt) <= Date.now() ||
        (q.get('view') === 'owner'
          ? value.workspaceId !== q.get('workspaceId') ||
            value.programmeId !== q.get('programmeId') ||
            !Array.isArray(value.companies) ||
            !Array.isArray(value.agenda)
          : value.registrationId !== q.get('registrationId') || !Array.isArray(value.missionLinks))
      )
        throw Error('Programme context changed. Refresh this page.');
      if (ticket === sequence.current && mounted.current) {
        setData(value);
        setNotice('');
      }
    } catch (error) {
      if (!controller.signal.aborted && ticket === sequence.current && mounted.current) {
        setData(null);
        setNotice(error instanceof Error ? error.message : 'Programme data is unavailable.');
      }
    }
  }, [queryText, identity.subject, identity.issuer]);
  useEffect(() => {
    mounted.current = true;
    const initial = visible ? setTimeout(() => void load(), 0) : undefined;
    const cancel = () => {
      ++sequence.current;
      request.current?.abort();
    };
    const visibility = () => {
      if (document.hidden) {
        ++sequence.current;
        request.current?.abort();
        setData(null);
      } else if (visible) void load();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      cancel();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load, visible]);
  useEffect(() => {
    if (!data) return;
    const remaining = Date.parse(data.expiresAt) - Date.now();
    const expiry = setTimeout(() => setData(null), Math.max(0, remaining));
    const renew = visible
      ? setTimeout(() => void load(), Math.max(1000, remaining - 5000))
      : undefined;
    return () => {
      clearTimeout(expiry);
      clearTimeout(renew);
    };
  }, [data, visible, load]);
  async function send(input: Record<string, unknown>) {
    if (busy) return false;
    const signature = JSON.stringify(input);
    if (pending.current?.signature !== signature)
      pending.current = {
        signature,
        body: { ...input, commandId: crypto.randomUUID(), acknowledged: true },
      };
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/customer-programme-projections', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(pending.current.body),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw Error(
          typeof body?.error === 'string'
            ? body.error
            : 'Change could not be confirmed. Refresh before trying again.',
        );
      }
      const receipt = (await response.json()) as Record<string, unknown>;
      const expectedResource = input.registrationId ?? input.linkId ?? input.taskId;
      if (
        receipt.commandId !== pending.current.body.commandId ||
        receipt.resourceId !== expectedResource ||
        receipt.version !== Number(input.expectedVersion) + 1 ||
        !Number.isFinite(Date.parse(String(receipt.expiresAt))) ||
        Date.parse(String(receipt.expiresAt)) <= Date.now()
      )
        throw Error('Save could not be confirmed. Retry the same change.');
      if (!mounted.current) return false;
      pending.current = null;
      setCanRetry(false);
      await load();
      return true;
    } catch (error) {
      if (mounted.current) {
        setCanRetry(true);
        setData(null);
        setNotice(
          error instanceof Error
            ? error.message
            : 'Change could not be confirmed. Refresh before trying again.',
        );
      }
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function retry() {
    const body = pending.current?.body;
    if (!body) return;
    const input = { ...body };
    delete input.commandId;
    delete input.acknowledged;
    await send(input);
  }
  return { data, notice, busy, load, send, host, retry, canRetry };
}

export function ProgrammeProjectionPanel(
  props: Identity & { workspaceId: string; programmeId: string; view: 'companies' | 'agenda' },
) {
  return (
    <OwnerPanel
      key={[props.subject, props.issuer, props.workspaceId, props.programmeId].join(':')}
      {...props}
    />
  );
}
function OwnerPanel(
  props: Identity & { workspaceId: string; programmeId: string; view: 'companies' | 'agenda' },
) {
  const [after, setAfter] = useState<string | undefined>(),
    [taskId, setTaskId] = useState(''),
    [start, setStart] = useState<string | null>(null),
    [end, setEnd] = useState<string | null>(null),
    [audience, setAudience] = useState<'ALL' | 'SELECTED'>('ALL'),
    [attendees, setAttendees] = useState<string[]>([]);
  const { host, ...view } = useProjection<ProgrammeProjection>(props, {
    view: 'owner',
    workspaceId: props.workspaceId,
    programmeId: props.programmeId,
    ...(after ? { after } : {}),
  });
  const d = view.data;
  const task = d?.agenda.find((t) => t.taskId === taskId),
    zone = d?.context?.timezone;
  function edit(id: string) {
    const row = d?.agenda.find((t) => t.taskId === id);
    if (!row) return;
    setTaskId(id);
    setStart(row.startsAt);
    setEnd(row.endsAt);
    setAudience(row.audience);
    setAttendees(row.attendees);
  }
  const paging =
    d && (after || d.nextAfter) ? (
      <div className="button-row">
        {after && (
          <button type="button" disabled={view.busy} onClick={() => setAfter(undefined)}>
            First participant page
          </button>
        )}
        {d.nextAfter && (
          <button type="button" disabled={view.busy} onClick={() => setAfter(d.nextAfter!)}>
            Next participant page
          </button>
        )}
      </div>
    ) : null;
  return (
    <section
      ref={host}
      aria-label={
        props.view === 'companies' ? 'Programme companies and readiness' : 'Programme timed agenda'
      }
      aria-busy={view.busy}
    >
      <h4>{props.view === 'companies' ? 'Companies and readiness' : 'Timed agenda'}</h4>
      {view.notice && <p role="alert">{view.notice}</p>}
      {view.canRetry && (
        <button type="button" disabled={view.busy} onClick={() => void view.retry()}>
          Retry same change
        </button>
      )}
      <button type="button" disabled={view.busy} onClick={() => void view.load()}>
        Refresh programme projection
      </button>
      {!d ? (
        <p role="status">Programme data is loading or has expired. Refresh to read it again.</p>
      ) : props.view === 'companies' ? (
        <>
          <p>
            <strong>
              {d.readiness.readyParticipants} of {d.readiness.activeParticipants} active
              participants ready
            </strong>
          </p>
          <p>
            Ready means an active registration, current eligibility, confirmed place, current terms
            accepted and a current shared company profile. This checklist is not legal, financial or
            company verification.
          </p>
          {d.companies.length === 0 ? (
            <p>No active participants on this page.</p>
          ) : (
            <ul>
              {d.companies.map((row) => (
                <li key={row.registrationId}>
                  <h5>{row.label}</h5>
                  {row.company ? (
                    <>
                      <p>
                        {row.company.name} · {row.company.countryCode}
                      </p>
                      <p>
                        {row.company.roles.join(', ')} · {row.company.sectors.join(', ')}
                      </p>
                      <p>{row.company.objective}</p>
                      <p>
                        Participant-shared, self-reported · profile version{' '}
                        {row.company.profileVersion}
                      </p>
                    </>
                  ) : (
                    <p>Company not shared or unavailable.</p>
                  )}
                  <p>
                    {row.ready
                      ? 'Ready'
                      : 'Still needed: ' + row.missing.map((x) => missingLabels[x] ?? x).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {paging}
          <h5>Meetings from explicitly shared missions</h5>
          {d.meetings.scheduled === null ? (
            <p>
              Meeting counts are {d.meetings.state === 'NOT_SHARED' ? 'not shared' : 'unavailable'}.
            </p>
          ) : (
            <>
              <p>
                Scheduled meetings: {d.meetings.scheduled}. Qualified held meetings:{' '}
                {d.meetings.qualifiedHeld}.
              </p>
              <p>
                Counts cover {d.meetings.sharedLinks} permitted shared mission links from{' '}
                {d.meetings.participantsSharing} of {d.readiness.activeParticipants} active
                participants. They do not represent all private activity.
              </p>
              {d.meetings.unavailableLinks > 0 && (
                <p>{d.meetings.unavailableLinks} shared links are unavailable and excluded.</p>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <p>
            Activities use the programme time zone
            {zone ? ': ' + zone : '. Set programme dates and time zone in Overview first.'}.
          </p>
          {d.conflicts.length > 0 ? (
            <div role="status">
              <h5>Attendee overlaps</h5>
              <ul>
                {d.conflicts.map((c) => (
                  <li key={c.left + ':' + c.right}>
                    {d.agenda.find((t) => t.taskId === c.left)?.title} overlaps{' '}
                    {d.agenda.find((t) => t.taskId === c.right)?.title}.
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>No attendee overlaps recorded.</p>
          )}
          <ul>
            {d.agenda.map((row) => (
              <li key={row.taskId}>
                <strong>{row.title}</strong> · {row.status}
                {row.scheduled && (
                  <p>
                    {new Intl.DateTimeFormat('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: zone ?? row.timezone ?? 'UTC',
                    }).format(new Date(row.startsAt!))}{' '}
                    to{' '}
                    {new Intl.DateTimeFormat('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: zone ?? row.timezone ?? 'UTC',
                    }).format(new Date(row.endsAt!))}
                  </p>
                )}
                {row.needsReview && (
                  <p role="status">Programme dates changed. Review this activity.</p>
                )}
                <button type="button" disabled={view.busy} onClick={() => edit(row.taskId)}>
                  Edit schedule for {row.title}
                </button>
              </li>
            ))}
          </ul>
          {d.agenda.length === 0 ? (
            <p>Create a coordination task in Plan and report, then return here to schedule it.</p>
          ) : (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!task || !start || !end) return;
                void view.send({
                  action: 'schedule',
                  workspaceId: props.workspaceId,
                  programmeId: props.programmeId,
                  taskId,
                  expectedVersion: task.version,
                  scheduled: true,
                  startsAt: start,
                  endsAt: end,
                  audience,
                  attendees: audience === 'ALL' ? [] : attendees,
                });
              }}
            >
              <label className="field">
                Activity
                <select
                  value={taskId}
                  disabled={view.busy}
                  required
                  onChange={(e) => edit(e.target.value)}
                >
                  <option value="">Choose an existing coordination task</option>
                  {d.agenda.map((t) => (
                    <option key={t.taskId} value={t.taskId}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              <DateTimeInput
                label="Activity starts"
                value={start}
                onChange={setStart}
                timeZone={zone}
                disabled={view.busy || !zone}
                required
              />
              <DateTimeInput
                label="Activity ends"
                value={end}
                onChange={setEnd}
                timeZone={zone}
                disabled={view.busy || !zone}
                required
              />
              <label className="field">
                Attendees
                <select
                  value={audience}
                  disabled={view.busy}
                  onChange={(e) => {
                    setAudience(e.target.value as 'ALL' | 'SELECTED');
                    setAttendees([]);
                  }}
                >
                  <option value="ALL">All active participants</option>
                  <option value="SELECTED">Selected active participants</option>
                </select>
              </label>
              {audience === 'SELECTED' && (
                <fieldset>
                  <legend>Select participants ({attendees.length} selected across pages)</legend>
                  {d.companies.map((row) => (
                    <label className="check-field" key={row.registrationId}>
                      <input
                        type="checkbox"
                        checked={attendees.includes(row.registrationId)}
                        disabled={view.busy}
                        onChange={(e) =>
                          setAttendees((a) =>
                            e.target.checked
                              ? [...a, row.registrationId]
                              : a.filter((x) => x !== row.registrationId),
                          )
                        }
                      />
                      {row.label}
                    </label>
                  ))}
                  {paging}
                </fieldset>
              )}
              <button
                type="submit"
                disabled={
                  view.busy ||
                  !zone ||
                  !task ||
                  task.status === 'CANCELLED' ||
                  (audience === 'SELECTED' && !attendees.length)
                }
              >
                Save activity schedule
              </button>
              {task?.scheduled && (
                <button
                  type="button"
                  disabled={view.busy}
                  onClick={() =>
                    void view.send({
                      action: 'schedule',
                      workspaceId: props.workspaceId,
                      programmeId: props.programmeId,
                      taskId,
                      expectedVersion: task.version,
                      scheduled: false,
                    })
                  }
                >
                  Remove schedule
                </button>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}

export function ParticipantProjectionSharing(props: Identity & { registrationId: string }) {
  return (
    <OwnSharing key={[props.issuer, props.subject, props.registrationId].join(':')} {...props} />
  );
}
function OwnSharing(props: Identity & { registrationId: string }) {
  const [objective, setObjective] = useState(''),
    [consentVersion, setConsentVersion] = useState<number | null>(null),
    [after, setAfter] = useState<string | undefined>();
  const { host, ...view } = useProjection<OwnProgrammeProjection>(props, {
      view: 'own',
      registrationId: props.registrationId,
      ...(after ? { after } : {}),
    }),
    d = view.data;
  return (
    <section ref={host} aria-label="Programme company and meeting sharing" aria-busy={view.busy}>
      <h4>Company and meeting sharing</h4>
      <p>
        The programme owner and admins can see only the fields you explicitly share here.
        Meeting-count permission is separate from sharing an objective.
      </p>
      {view.notice && <p role="alert">{view.notice}</p>}
      {view.canRetry && (
        <button type="button" disabled={view.busy} onClick={() => void view.retry()}>
          Retry same change
        </button>
      )}
      <button type="button" disabled={view.busy} onClick={() => void view.load()}>
        Refresh sharing
      </button>
      {!d ? (
        <p role="status">Sharing data is loading or has expired.</p>
      ) : (
        <>
          {d.profile && d.active ? (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!d.profile || consentVersion !== d.profile.version) return;
                void view
                  .send({
                    action: 'company',
                    registrationId: props.registrationId,
                    expectedVersion: d.company.version,
                    shared: true,
                    profileVersion: d.profile.version,
                    objective,
                  })
                  .then((ok) => {
                    if (ok) setConsentVersion(null);
                  });
              }}
            >
              <h5>Review the exact company fields</h5>
              <p>
                {d.profile.name} · {d.profile.countryCode}
              </p>
              <p>
                {d.profile.roles.join(', ')} · {d.profile.sectors.join(', ')}
              </p>
              <label className="field">
                Short objective to share
                {!realCustomerInput() && (
                  <span>Use made-up information starting with “Synthetic ”.</span>
                )}
                <textarea
                  required
                  minLength={realCustomerInput() ? 2 : 11}
                  maxLength={500}
                  value={objective}
                  disabled={view.busy}
                  onChange={(e) => setObjective(e.target.value)}
                />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  required
                  checked={consentVersion === d.profile.version}
                  disabled={view.busy}
                  onChange={(e) => setConsentVersion(e.target.checked ? d.profile!.version : null)}
                />
                I agree to share these company fields and this objective with the programme owner
                and admins.
              </label>
              <button type="submit" disabled={view.busy || consentVersion !== d.profile.version}>
                {d.company.shared ? 'Update company sharing' : 'Share company profile'}
              </button>
            </form>
          ) : (
            <p>
              Apply for a place using your company profile in Your place first. Sharing also
              requires an active registration and current company authority.
            </p>
          )}
          {d.company.shared && (
            <>
              <p>
                Company sharing is on. Changes to your private profile are not automatically shared.
              </p>
              <button
                type="button"
                disabled={view.busy}
                onClick={() =>
                  void view.send({
                    action: 'company',
                    registrationId: props.registrationId,
                    expectedVersion: d.company.version,
                    shared: false,
                  })
                }
              >
                Stop sharing company
              </button>
            </>
          )}
          <h5>Aggregate meeting counts</h5>
          <p>
            Sharing permits scheduled and qualified-held counts only. It does not share contacts,
            meeting titles, notes, offers or financial values.
          </p>
          {d.missionLinks.length === 0 ? (
            <p>Share a mission objective first to choose its separate count permission here.</p>
          ) : (
            <ul>
              {d.missionLinks.map((link) => (
                <li key={link.id}>
                  <p>{link.summary ?? 'Shared mission is unavailable'}</p>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={link.shared}
                      disabled={view.busy || (!link.available && !link.shared)}
                      onChange={(e) =>
                        void view.send({
                          action: 'meetings',
                          linkId: link.id,
                          expectedVersion: link.version,
                          shared: e.target.checked,
                        })
                      }
                    />
                    Share aggregate meeting counts for this mission
                  </label>
                  {!link.available && <p>Source access is unavailable; its counts are excluded.</p>}
                </li>
              ))}
            </ul>
          )}
          {(after || d.nextLinkAfter) && (
            <div className="button-row">
              {after && (
                <button type="button" onClick={() => setAfter(undefined)}>
                  First mission page
                </button>
              )}
              {d.nextLinkAfter && (
                <button type="button" onClick={() => setAfter(d.nextLinkAfter!)}>
                  Next mission page
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
