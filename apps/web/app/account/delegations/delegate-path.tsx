'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { customerLabelAllowed, realCustomerInput } from '@corridra/domain/customer-input-mode';
import { pp } from '../../../lib/i18n/programme-pages';
import {
  delegateNextStep,
  draftFromObjective,
  prefillFromContext,
  saveObjectiveReturn,
  type DelegateDirection,
  type ProgrammeContextShared,
} from '../../../lib/delegate-objective';
import { customerHeaders } from './pricing-client';
import { isUuid } from './participant-client';
import './delegate-path.css';

/**
 * The delegate's objective, carried instead of asked again.
 *
 * Before this, a person said what they wanted when they applied to a programme, and after joining had to start
 * over: find the request form through a workspace, write the same thing again, come back, find the objective
 * tools, pick the request and write it a third time. Here the same words become a private request draft in one
 * press, and the path names the single next step: request, share one sentence with the organisers, record results.
 *
 * It composes services that already exist and adds no authority: the application is read through the person's own
 * applications, the draft is an ordinary guided request draft in their own workspace, and sharing goes through the
 * existing objective tools with the same explicit consent. A read that fails claims nothing: that step simply shows
 * its action without a state.
 */
type Workspace = { id: string; name: string };
type Loaded = {
  statement: string | null;
  displayLabel: string;
  workspaces: Workspace[] | null;
  privateRequests: number | null;
  sharedObjectives: number | null;
  /** The programme's destination and dates, only if the organisers shared them with this registration. */
  context: ProgrammeContextShared | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
/** The shared context of this registration, or null when nothing is shared or the answer is not as expected. */
function sharedContext(value: unknown, registrationId: string): ProgrammeContextShared | null {
  if (!object(value) || value.registrationId !== registrationId || !object(value.context))
    return null;
  const { marketCode, startsAt, endsAt, timezone } = value.context;
  return typeof marketCode === 'string' &&
    typeof startsAt === 'string' &&
    typeof endsAt === 'string' &&
    typeof timezone === 'string' &&
    prefillFromContext({ marketCode, startsAt, endsAt, timezone })
    ? { marketCode, startsAt, endsAt, timezone }
    : null;
}

export function DelegatePath(props: {
  subject: string;
  issuer: string;
  registrationId: string;
  programmeName: string;
  displayLabel: string;
  /** Guided request drafts are on: the request can be prepared here. Otherwise the step links to the workspaces. */
  draftsEnabled: boolean;
  /** Opens the existing objective tools with the delegate's words ready to approve. */
  onShare: (summary: string) => void;
}) {
  const { subject, issuer, registrationId } = props;
  const headers = useMemo(() => customerHeaders(subject, issuer), [subject, issuer]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceName, setWorkspaceName] = useState(props.displayLabel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One command id for the workspace and one for the draft, kept until the result is known, so a retry after an
  // uncertain answer repeats the same change instead of making a second workspace or a second draft.
  const commands = useRef<{ workspace?: string; draft?: string }>({});
  const active = useRef(true);
  const fieldId = useId();
  const router = useRouter();

  const read = useCallback(
    async (url: string) => {
      const r = await fetch(url, {
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error('unavailable');
      return (await r.json()) as unknown;
    },
    [headers],
  );
  const load = useCallback(() => {
    const query = new URLSearchParams({ registrationId });
    void Promise.allSettled([
      read('/api/customer-programme-pages?view=own'),
      read('/api/customer-workspaces'),
      read('/api/customer-programme-objectives?view=choices&' + query),
      read('/api/customer-programme-objectives?view=own&' + query),
      read('/api/customer-programme-context?' + query),
    ]).then(([applications, workspaces, choices, own, shared]) => {
      if (!active.current) return;
      const mine =
        applications.status === 'fulfilled' &&
        object(applications.value) &&
        Array.isArray(applications.value.applications)
          ? applications.value.applications.find(
              (a) => object(a) && a.registrationId === registrationId && a.status === 'JOINED',
            )
          : undefined;
      const rooms =
        workspaces.status === 'fulfilled' &&
        object(workspaces.value) &&
        Array.isArray(workspaces.value.workspaces)
          ? workspaces.value.workspaces
              .filter(
                (w): w is Workspace => object(w) && isUuid(w.id) && typeof w.name === 'string',
              )
              .map((w) => ({ id: w.id, name: w.name }))
          : null;
      const count = (
        settled: PromiseSettledResult<unknown>,
        list: string,
        keep: (v: unknown) => boolean,
      ) =>
        settled.status === 'fulfilled' &&
        object(settled.value) &&
        settled.value.registrationId === registrationId &&
        Array.isArray(settled.value[list])
          ? (settled.value[list] as unknown[]).filter(keep).length
          : null;
      setLoaded({
        statement:
          object(mine) && typeof mine.statement === 'string' && mine.statement.trim()
            ? mine.statement.trim()
            : null,
        displayLabel:
          object(mine) && typeof mine.displayLabel === 'string'
            ? mine.displayLabel
            : props.displayLabel,
        workspaces: rooms,
        privateRequests: count(choices, 'requests', (r) => object(r) && r.available === true),
        sharedObjectives: count(own, 'objectives', (o) => object(o) && o.status === 'SHARED'),
        context: shared.status === 'fulfilled' ? sharedContext(shared.value, registrationId) : null,
      });
      if (rooms?.length === 1) setWorkspaceId(rooms[0].id);
    });
  }, [read, registrationId, props.displayLabel]);
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(load);
    // The objective tools on this registration say when a share or a withdrawal was saved.
    const changed = (e: Event) => {
      if ((e as CustomEvent<{ registrationId?: string }>).detail?.registrationId === registrationId)
        load();
    };
    window.addEventListener('corridra-objective-changed', changed);
    return () => {
      active.current = false;
      window.removeEventListener('corridra-objective-changed', changed);
    };
  }, [load, registrationId]);

  const send = async (url: string, body: unknown) => {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...customerHeaders(subject, issuer) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error('refused');
    return (await r.json()) as unknown;
  };
  const start = async (direction: DelegateDirection) => {
    if (busy || !loaded) return;
    setError('');
    let target = workspaceId;
    const name = workspaceName.trim();
    if (!target && (!customerLabelAllowed(name) || name.length > 120)) {
      setError(realCustomerInput() ? pp('pp.path.error.name') : pp('pp.path.error.name.sample'));
      return;
    }
    setBusy(true);
    try {
      if (!target) {
        commands.current.workspace ??= crypto.randomUUID();
        const made = await send('/api/customer-workspaces', {
          commandId: commands.current.workspace,
          name,
        }).catch(() => {
          throw new Error('workspace');
        });
        if (!object(made) || !isUuid(made.id)) throw new Error('workspace');
        target = made.id;
        if (active.current) setWorkspaceId(target);
      }
      // Read the shared context again now, so a context the organisers have since withdrawn is not carried. A read
      // that fails carries nothing: the draft then starts without a market or dates, as before.
      const context = await read(
        '/api/customer-programme-context?' + new URLSearchParams({ registrationId }),
      )
        .then((value) => sharedContext(value, registrationId))
        .catch(() => null);
      commands.current.draft ??= crypto.randomUUID();
      const saved = await send('/api/customer-mission-drafts', {
        action: 'save',
        input: {
          commandId: commands.current.draft,
          workspaceId: target,
          draftId: null,
          expectedVersion: 0,
          details: draftFromObjective({
            programmeName: props.programmeName,
            statement: loaded.statement ?? '',
            displayLabel: loaded.displayLabel,
            direction,
            context,
          }),
          acknowledged: true,
        },
      });
      const draftId = object(saved) && object(saved.draft) ? saved.draft.id : null;
      if (!isUuid(draftId)) throw new Error('draft');
      saveObjectiveReturn(window.sessionStorage, {
        registrationId,
        draftId,
        programmeName: props.programmeName,
      });
      router.push(`/account/drafts/${target}?draft=${draftId}`);
    } catch (e) {
      if (!active.current) return;
      setError(
        e instanceof Error && e.message === 'workspace'
          ? pp('pp.path.error.workspace')
          : pp('pp.path.error.start'),
      );
      setBusy(false);
    }
  };

  // Back from sending the request (the confirmation links here with this registration named): open the share step
  // once, with the words ready. Nothing is shared until the person ticks consent and presses the button.
  const offered = useRef(false);
  const { onShare } = props;
  useEffect(() => {
    if (!loaded || offered.current || delegateNextStep(loaded) !== 'share') return;
    if (new URLSearchParams(window.location.search).get('objective') !== registrationId) return;
    offered.current = true;
    onShare(loaded.statement ?? '');
  }, [loaded, onShare, registrationId]);
  if (!loaded) return null;
  const next = delegateNextStep(loaded);
  const state = (step: 'request' | 'share' | 'results') => {
    const order = ['request', 'share', 'results'] as const;
    const at = order.indexOf(step) - order.indexOf(next);
    return at < 0 ? 'done' : at === 0 ? 'next' : 'later';
  };
  const chip = (step: 'request' | 'share' | 'results') => {
    const s = state(step);
    return (
      <span className="delegate-path-state" data-state={s}>
        {s === 'done'
          ? pp('pp.path.state.done')
          : s === 'next'
            ? pp('pp.path.state.next')
            : pp('pp.path.state.later')}
      </span>
    );
  };
  const rooms = loaded.workspaces;
  const prefill = prefillFromContext(loaded.context);
  const directions = [
    ['SUPPLIERS_PRODUCTS', pp('pp.path.find.suppliers')],
    ['BUYERS_PARTNERS', pp('pp.path.find.buyers')],
    ['OTHER', pp('pp.path.find.other')],
  ] as const;
  const startControls = rooms && (
    <>
      {rooms.length > 1 && (
        <label className="field" htmlFor={fieldId + 'w'}>
          {pp('pp.path.workspace')}
          <select
            id={fieldId + 'w'}
            value={workspaceId}
            disabled={busy}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {!workspaceId && <option value="" />}
            {rooms.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {rooms.length === 0 && (
        <label className="field" htmlFor={fieldId + 'n'}>
          {pp('pp.path.workspace.new')}
          <input
            id={fieldId + 'n'}
            value={workspaceName}
            maxLength={120}
            disabled={busy}
            dir="auto"
            aria-describedby={fieldId + 'nh'}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
          <span id={fieldId + 'nh'} className="delegate-path-note">
            {pp('pp.path.workspace.new.hint')}
          </span>
        </label>
      )}
      <div className="delegate-path-actions">
        {directions.map(([direction, label], n) => (
          <button
            key={direction}
            type="button"
            className={
              n === 0 && state('request') === 'next'
                ? 'button button-primary'
                : 'button button-secondary'
            }
            disabled={busy || (rooms.length > 1 && !workspaceId)}
            onClick={() => void start(direction)}
          >
            {label}
          </button>
        ))}
      </div>
      {busy && <p role="status">{pp('pp.path.starting')}</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
  return (
    <section className="delegate-path" aria-labelledby={fieldId + 'h'} aria-busy={busy}>
      <h4 id={fieldId + 'h'}>{pp('pp.path.heading')}</h4>
      <p className="delegate-path-lead">{pp('pp.path.lead')}</p>
      {loaded.statement ? (
        <figure className="delegate-path-words">
          <figcaption>{pp('pp.path.statement.label')}</figcaption>
          <blockquote dir="auto">{loaded.statement}</blockquote>
        </figure>
      ) : (
        <p className="delegate-path-note">{pp('pp.path.statement.none')}</p>
      )}
      <ol>
        <li aria-current={state('request') === 'next' ? 'step' : undefined}>
          <h5>
            {pp('pp.path.step.request')} {chip('request')}
          </h5>
          <p>
            {pp('pp.path.step.request.text')}{' '}
            {loaded.statement && props.draftsEnabled ? pp('pp.path.step.request.carried') : ''}
          </p>
          {prefill && state('request') !== 'done' && props.draftsEnabled && (
            <p className="delegate-path-note" data-testid="delegate-path-prefill">
              {pp('pp.path.step.request.prefill', {
                market: prefill.market,
                start: prefill.startDate,
                end: prefill.endDate,
                zone: prefill.timezone,
              })}
            </p>
          )}
          {state('request') === 'done' && (
            <p className="delegate-path-note">{pp('pp.path.step.request.have')}</p>
          )}
          {props.draftsEnabled && rooms ? (
            state('request') === 'done' ? (
              <details>
                <summary>{pp('pp.path.step.request.another')}</summary>
                <div className="delegate-path-start">{startControls}</div>
              </details>
            ) : (
              <div className="delegate-path-start">{startControls}</div>
            )
          ) : (
            <a className="text-link" href="/account?view=work#customer-workspaces">
              {pp('pp.path.step.request.elsewhere')}
            </a>
          )}
        </li>
        <li aria-current={state('share') === 'next' ? 'step' : undefined}>
          <h5>
            {pp('pp.path.step.share')} {chip('share')}
          </h5>
          <p>{pp('pp.path.step.share.text')}</p>
          {state('share') === 'done' ? (
            <p className="delegate-path-note">{pp('pp.path.step.share.done')}</p>
          ) : state('share') === 'next' ? (
            <button
              type="button"
              className="button button-primary"
              onClick={() => props.onShare(loaded.statement ?? '')}
            >
              {pp('pp.path.share')}
            </button>
          ) : (
            <p className="delegate-path-note">{pp('pp.path.step.share.needs')}</p>
          )}
        </li>
        <li aria-current={state('results') === 'next' ? 'step' : undefined}>
          <h5>
            {pp('pp.path.step.results')} {chip('results')}
          </h5>
          <p>{pp('pp.path.step.results.text')}</p>
        </li>
      </ol>
    </section>
  );
}
