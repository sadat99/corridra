'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { ProgrammeContext } from './programme-context';
import { ProgrammeRoom } from './programme-room';
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
const ProgrammeParticipants = lazy(() =>
  import('./programme-participants').then((module) => ({ default: module.ProgrammeParticipants })),
);
const ProgrammeTemplates = lazy(() =>
  import('./programme-templates').then((module) => ({ default: module.ProgrammeTemplates })),
);
const ProgrammePricing = lazy(() =>
  import('./programme-pricing').then((module) => ({ default: module.ProgrammePricing })),
);
const ProgrammeCoordination = lazy(() =>
  import('./programme-coordination').then((module) => ({ default: module.ProgrammeCoordination })),
);
const ProgrammeTerms = lazy(() =>
  import('./programme-terms').then((module) => ({ default: module.ProgrammeTerms })),
);
const ProgrammeEconomics = lazy(() =>
  import('./programme-economics').then((module) => ({ default: module.ProgrammeEconomics })),
);
type Programme = {
  id: string;
  workspaceId: string;
  name: string;
  reportingPurpose: string;
  createdAt: string;
  synthetic: boolean;
};
type Command = {
  commandId: string;
  workspaceId: string;
  name: string;
  reportingPurpose: string;
  acknowledged: true;
};
type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  participantsEnabled?: boolean;
  missionSharesEnabled?: boolean;
  contextEnabled?: boolean;
  economicsEnabled?: boolean;
  coordinationEnabled?: boolean;
  templatesEnabled?: boolean;
  termsEnabled?: boolean;
  pricingEnabled?: boolean;
  serviceRequestsEnabled?: boolean;
  roomEnabled?: boolean;
};
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function programme(value: unknown, workspaceId: string): value is Programme {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Programme>;
  return (
    uuid(p.id) &&
    p.workspaceId === workspaceId &&
    customerProvenanceAllowed(p.synthetic) &&
    typeof p.name === 'string' &&
    p.name.length >= 3 &&
    p.name.length <= 160 &&
    typeof p.reportingPurpose === 'string' &&
    p.reportingPurpose.length >= 10 &&
    p.reportingPurpose.length <= 500 &&
    typeof p.createdAt === 'string' &&
    Number.isFinite(Date.parse(p.createdAt))
  );
}
export function CustomerProgrammes(props: Props) {
  return (
    <ScopedProgrammes
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId}
      {...props}
    />
  );
}
function ScopedProgrammes({
  subject,
  issuer,
  workspaceId,
  participantsEnabled = false,
  missionSharesEnabled = false,
  contextEnabled = false,
  economicsEnabled = false,
  coordinationEnabled = false,
  templatesEnabled = false,
  termsEnabled = false,
  pricingEnabled = false,
  serviceRequestsEnabled = false,
  roomEnabled = false,
}: Props) {
  const [selectedProgramme, setSelectedProgramme] = useState<string | null>(null);
  const [financeProgramme, setFinanceProgramme] = useState<string | null>(null);
  const [coordinationProgramme, setCoordinationProgramme] = useState<string | null>(null);
  const [termsProgramme, setTermsProgramme] = useState<string | null>(null);
  const [rows, setRows] = useState<Programme[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'denied' | 'unavailable'>(
    'loading',
  );
  const [name, setName] = useState(''),
    [purpose, setPurpose] = useState(''),
    [ack, setAck] = useState(false);
  const [pending, setPending] = useState<Command | null>(null),
    [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(true),
    [message, setMessage] = useState('');
  const active = useRef(false),
    getTask = useRef<AbortController | null>(null),
    postTask = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  const headers = { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer };
  const deny = useCallback(() => {
    postTask.current?.abort();
    setBusy(false);
    inFlight.current = false;
    setRows([]);
    setNext(null);
    setPending(null);
    setName('');
    setPurpose('');
    setAck(false);
    setMessage('Account or workspace access changed. Local planning details were cleared.');
    setStatus('denied');
  }, []);
  const load = useCallback(
    async (after?: string) => {
      getTask.current?.abort();
      const task = new AbortController();
      getTask.current = task;
      try {
        const query = new URLSearchParams({ workspaceId, ...(after ? { after } : {}) });
        const response = await fetch('/api/customer-programmes?' + query, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer },
          signal: task.signal,
        });
        if (task.signal.aborted || !active.current) return;
        if ([401, 403, 409].includes(response.status)) {
          deny();
          return;
        }
        if (response.status === 503) {
          setRows([]);
          setNext(null);
          setStatus('unavailable');
          return;
        }
        if (!response.ok) throw Error('Programme list failed');
        const data = await response.json();
        if (task.signal.aborted || !active.current) return;
        if (
          !data ||
          !customerProvenanceAllowed(data.synthetic) ||
          data.workspaceId !== workspaceId ||
          !Array.isArray(data.programmes) ||
          data.programmes.length > 25 ||
          !data.programmes.every((p: unknown) => programme(p, workspaceId)) ||
          new Set(data.programmes.map((p: Programme) => p.id)).size !== data.programmes.length ||
          !(
            data.nextAfter === null ||
            (uuid(data.nextAfter) && data.nextAfter === data.programmes.at(-1)?.id)
          )
        )
          throw Error('Invalid programme list');
        setRows((old) =>
          after
            ? [
                ...old,
                ...data.programmes.filter((p: Programme) => !old.some((item) => item.id === p.id)),
              ]
            : data.programmes,
        );
        setNext(data.nextAfter);
        setStatus('ready');
      } catch {
        if (!task.signal.aborted && active.current) {
          setRows([]);
          setNext(null);
          setStatus('failed');
        }
      }
    },
    [subject, issuer, workspaceId, deny],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    const hide = () => {
      getTask.current?.abort();
      postTask.current?.abort();
      setVisible(false);
      setRows([]);
      setNext(null);
      setMessage('');
    };
    const show = () => {
      setVisible(true);
      setBusy(false);
      inFlight.current = false;
      setStatus('loading');
      void load();
    };
    const visibility = () => (document.visibilityState === 'hidden' ? hide() : show());
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false;
      getTask.current?.abort();
      postTask.current?.abort();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load]);
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (name || purpose || pending) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [name, purpose, pending]);
  async function create() {
    if (inFlight.current || status !== 'ready') return;
    let command = pending;
    if (!command) {
      if (
        name.trim().length < 3 ||
        name.trim().length > 160 ||
        purpose.trim().length < 10 ||
        purpose.trim().length > 500 ||
        !ack
      ) {
        setMessage(
          realCustomerInput()
            ? 'Enter a programme name and purpose, and confirm the planning details.'
            : 'Use a fictional name and purpose, and confirm sample planning only.',
        );
        return;
      }
      command = {
        commandId: crypto.randomUUID(),
        workspaceId,
        name: name.trim(),
        reportingPurpose: purpose.trim(),
        acknowledged: true,
      };
      setPending(command);
    }
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    const task = new AbortController();
    postTask.current = task;
    try {
      const response = await fetch('/api/customer-programmes', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(command),
        signal: task.signal,
      });
      if (task.signal.aborted || !active.current) return;
      if ([401, 403].includes(response.status)) {
        deny();
        return;
      }
      if (response.status === 409) {
        setMessage(
          'The planning request conflicts with current access or state. Reload this workspace before trying again.',
        );
        setPending(null);
        setRows([]);
        setNext(null);
        setStatus('failed');
        return;
      }
      if (!response.ok) throw Error('Unconfirmed programme command');
      const data = await response.json();
      if (task.signal.aborted || !active.current) return;
      if (
        !programme(data, workspaceId) ||
        data.name !== command.name ||
        data.reportingPurpose !== command.reportingPurpose
      )
        throw Error('Unconfirmed programme response');
      setPending(null);
      setName('');
      setPurpose('');
      setAck(false);
      setMessage(
        realCustomerInput()
          ? 'Your planning programme is saved. Participant and delivery operations are not available here.'
          : 'Your sample planning programme is saved. Participant and delivery operations are not available here.',
      );
      await load();
    } catch {
      if (!task.signal.aborted && active.current)
        setMessage(
          'Saving could not be confirmed. Retry the same planning request before changing it.',
        );
    } finally {
      if (!task.signal.aborted && active.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  if (!visible)
    return (
      <p role="status">Planning details are hidden. Access will be checked when you return.</p>
    );
  return (
    <section
      className="delivery-view ux-saved-commercial-report"
      aria-label={realCustomerInput() ? 'Delegation planning' : 'Sample delegation planning'}
    >
      <a className="text-link ux-back" href="/account#customer-workspaces">
        Back to my workspaces
      </a>
      <p>
        {realCustomerInput()
          ? 'Fictional planning only. This creates a programme in your workspace. Participant'
          : 'Fictional sample planning only. This creates a programme in your workspace. Participant'}{' '}
        {participantsEnabled
          ? realCustomerInput()
            ? 'invitations and consented registrations have separate controls below. Private missions, dates, agendas, meetings, fees and costs are not available here yet.'
            : 'invitations and consented registrations have separate sample controls below. Private missions, dates, agendas, meetings, fees and costs are not available here yet.'
          : 'invitations, private missions, dates, agendas, meetings, fees and costs are not available here yet.'}
      </p>
      {status === 'loading' && <p role="status">Checking programme access…</p>}
      {status === 'denied' && (
        <p role="alert">
          Programme administration access could not be confirmed. Only current workspace owners and
          administrators can use this page.
        </p>
      )}
      {status === 'unavailable' && (
        <p role="status">
          {' '}
          {realCustomerInput()
            ? 'Delegation planning is unavailable.'
            : 'Sample delegation planning is unavailable.'}{' '}
        </p>
      )}
      {status === 'failed' && (
        <p role="alert">Programmes could not be loaded. Reload to check access and try again.</p>
      )}
      {status === 'ready' && (
        <>
          <h2>Your planning programmes</h2>
          {rows.length === 0 ? (
            <p className="ux-empty">
              {' '}
              {realCustomerInput() ? 'No programmes yet.' : 'No sample programmes yet.'}{' '}
            </p>
          ) : (
            <ul>
              {rows.map((p) => (
                <li key={p.id}>
                  {roomEnabled ? (
                    <ProgrammeRoom
                      programmeId={p.id}
                      name={p.name}
                      purpose={p.reportingPurpose}
                      notes={
                        <>
                          <p>
                            {' '}
                            {realCustomerInput()
                              ? 'Planning record only · data'
                              : 'Planning record only · Sample data'}{' '}
                          </p>
                          {serviceRequestsEnabled && (
                            <p>
                              <a
                                className="text-link"
                                href={
                                  '/account/service-requests/new?kind=programme&ref=' +
                                  encodeURIComponent(p.id) +
                                  '&workspace=' +
                                  encodeURIComponent(workspaceId)
                                }
                              >
                                Request help with this programme
                              </a>
                            </p>
                          )}
                        </>
                      }
                      scope={{ subject, issuer, workspaceId, programmeId: p.id }}
                      participantsEnabled={participantsEnabled}
                      sharedMoneyNote={templatesEnabled || pricingEnabled}
                      panels={{
                        overview: contextEnabled ? (
                          <ProgrammeContext
                            subject={subject}
                            issuer={issuer}
                            workspaceId={workspaceId}
                            programmeId={p.id}
                          />
                        ) : null,
                        people: participantsEnabled ? (
                          <Suspense
                            fallback={
                              <p role="status">
                                {' '}
                                {realCustomerInput()
                                  ? 'Loading participant tools…'
                                  : 'Loading sample participant tools…'}{' '}
                              </p>
                            }
                          >
                            <ProgrammeParticipants
                              subject={subject}
                              issuer={issuer}
                              workspaceId={workspaceId}
                              missionSharesEnabled={missionSharesEnabled}
                              programmeId={p.id}
                            />
                          </Suspense>
                        ) : null,
                        plan:
                          participantsEnabled && coordinationEnabled ? (
                            <Suspense
                              fallback={
                                <p role="status">
                                  {' '}
                                  {realCustomerInput()
                                    ? 'Loading coordination tools…'
                                    : 'Loading sample coordination tools…'}{' '}
                                </p>
                              }
                            >
                              <ProgrammeCoordination
                                subject={subject}
                                issuer={issuer}
                                workspaceId={workspaceId}
                                programmeId={p.id}
                              />
                            </Suspense>
                          ) : null,
                        terms:
                          participantsEnabled && termsEnabled ? (
                            <Suspense fallback={<p role="status">Loading terms and places…</p>}>
                              <ProgrammeTerms
                                subject={subject}
                                issuer={issuer}
                                workspaceId={workspaceId}
                                programmeId={p.id}
                                coordinationEnabled={coordinationEnabled}
                              />
                            </Suspense>
                          ) : null,
                        money:
                          participantsEnabled && economicsEnabled ? (
                            <Suspense
                              fallback={
                                <p role="status">
                                  {' '}
                                  {realCustomerInput()
                                    ? 'Loading finance tools…'
                                    : 'Loading sample finance tools…'}{' '}
                                </p>
                              }
                            >
                              <ProgrammeEconomics
                                subject={subject}
                                issuer={issuer}
                                workspaceId={workspaceId}
                                programmeId={p.id}
                              />
                            </Suspense>
                          ) : null,
                      }}
                    />
                  ) : (
                    <>
                      <h3>{p.name}</h3>
                      <p>{p.reportingPurpose}</p>
                      <p>
                        {' '}
                        {realCustomerInput()
                          ? 'Planning record only · data'
                          : 'Planning record only · Sample data'}{' '}
                      </p>
                      {serviceRequestsEnabled && (
                        <p>
                          <a
                            className="text-link"
                            href={
                              '/account/service-requests/new?kind=programme&ref=' +
                              encodeURIComponent(p.id) +
                              '&workspace=' +
                              encodeURIComponent(workspaceId)
                            }
                          >
                            Request help with this programme
                          </a>
                        </p>
                      )}
                      {contextEnabled && (
                        <ProgrammeContext
                          subject={subject}
                          issuer={issuer}
                          workspaceId={workspaceId}
                          programmeId={p.id}
                        />
                      )}
                      {participantsEnabled && (
                        <>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() =>
                              setSelectedProgramme(selectedProgramme === p.id ? null : p.id)
                            }
                          >
                            {selectedProgramme === p.id
                              ? realCustomerInput()
                                ? 'Hide participants'
                                : 'Hide sample participants'
                              : realCustomerInput()
                                ? 'Manage participants'
                                : 'Manage sample participants'}
                          </button>
                          {selectedProgramme === p.id && (
                            <Suspense
                              fallback={
                                <p role="status">
                                  {' '}
                                  {realCustomerInput()
                                    ? 'Loading participant tools…'
                                    : 'Loading sample participant tools…'}{' '}
                                </p>
                              }
                            >
                              <ProgrammeParticipants
                                subject={subject}
                                issuer={issuer}
                                workspaceId={workspaceId}
                                missionSharesEnabled={missionSharesEnabled}
                                programmeId={p.id}
                              />
                            </Suspense>
                          )}
                        </>
                      )}
                      {participantsEnabled && coordinationEnabled && (
                        <>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() =>
                              setCoordinationProgramme(coordinationProgramme === p.id ? null : p.id)
                            }
                          >
                            {coordinationProgramme === p.id
                              ? 'Hide coordination and report'
                              : 'Coordinate and report'}
                          </button>
                          {coordinationProgramme === p.id && (
                            <Suspense
                              fallback={
                                <p role="status">
                                  {' '}
                                  {realCustomerInput()
                                    ? 'Loading coordination tools…'
                                    : 'Loading sample coordination tools…'}{' '}
                                </p>
                              }
                            >
                              <ProgrammeCoordination
                                subject={subject}
                                issuer={issuer}
                                workspaceId={workspaceId}
                                programmeId={p.id}
                              />
                            </Suspense>
                          )}
                        </>
                      )}
                      {participantsEnabled && termsEnabled && (
                        <>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => setTermsProgramme(termsProgramme === p.id ? null : p.id)}
                          >
                            {termsProgramme === p.id
                              ? 'Hide terms, eligibility and places'
                              : 'Terms, eligibility and places'}
                          </button>
                          {termsProgramme === p.id && (
                            <Suspense fallback={<p role="status">Loading terms and places…</p>}>
                              <ProgrammeTerms
                                subject={subject}
                                issuer={issuer}
                                workspaceId={workspaceId}
                                programmeId={p.id}
                                coordinationEnabled={coordinationEnabled}
                              />
                            </Suspense>
                          )}
                        </>
                      )}
                      {participantsEnabled && economicsEnabled && (
                        <>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() =>
                              setFinanceProgramme(financeProgramme === p.id ? null : p.id)
                            }
                          >
                            {financeProgramme === p.id
                              ? realCustomerInput()
                                ? 'Hide finances'
                                : 'Hide sample finances'
                              : realCustomerInput()
                                ? 'Record fees and costs'
                                : 'Record sample fees and costs'}
                          </button>
                          {financeProgramme === p.id && (
                            <Suspense
                              fallback={
                                <p role="status">
                                  {' '}
                                  {realCustomerInput()
                                    ? 'Loading finance tools…'
                                    : 'Loading sample finance tools…'}{' '}
                                </p>
                              }
                            >
                              <ProgrammeEconomics
                                subject={subject}
                                issuer={issuer}
                                workspaceId={workspaceId}
                                programmeId={p.id}
                              />
                            </Suspense>
                          )}
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {templatesEnabled && (
            <Suspense
              fallback={
                <p role="status">
                  {' '}
                  {realCustomerInput() ? 'Loading templates…' : 'Loading sample templates…'}{' '}
                </p>
              }
            >
              <ProgrammeTemplates
                subject={subject}
                issuer={issuer}
                workspaceId={workspaceId}
                programmes={rows.map((p) => ({ id: p.id, name: p.name }))}
                onChanged={() => void load()}
              />
            </Suspense>
          )}
          {templatesEnabled && pricingEnabled && (
            <Suspense fallback={<p role="status">Loading pricing and series…</p>}>
              <ProgrammePricing
                subject={subject}
                issuer={issuer}
                workspaceId={workspaceId}
                programmes={rows.map((p) => ({ id: p.id, name: p.name }))}
                onChanged={() => void load()}
              />
            </Suspense>
          )}
          {next && (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => void load(next)}
            >
              Load more planning programmes
            </button>
          )}
          <form
            className="operator-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <h2>{realCustomerInput() ? 'Create a programme' : 'Create a sample programme'}</h2>
            <label className="field">
              Programme name
              <input
                value={name}
                minLength={3}
                maxLength={160}
                required
                disabled={busy || !!pending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="field">
              Purpose and intended outcomes
              <textarea
                value={purpose}
                minLength={10}
                maxLength={500}
                required
                disabled={busy || !!pending}
                onChange={(event) => setPurpose(event.target.value)}
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={ack}
                required
                disabled={busy || !!pending}
                onChange={(event) => setAck(event.target.checked)}
              />
              {realCustomerInput()
                ? 'I confirm these planning details. Arrangements and costs need separate agreement.'
                : 'I am using fictional information for sample planning only.'}
            </label>
            <button className="primary-link" disabled={busy}>
              {pending
                ? 'Retry same planning request'
                : realCustomerInput()
                  ? 'Save programme'
                  : 'Save sample programme'}
            </button>
          </form>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {status !== 'loading' && status !== 'denied' && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => {
            setRows([]);
            setNext(null);
            setStatus('loading');
            void load();
          }}
        >
          Reload planning programmes
        </button>
      )}
      <p>
        Programme administration does not grant access to participants&apos; private offers,
        contacts, negotiations or commercial values.
      </p>
    </section>
  );
}
