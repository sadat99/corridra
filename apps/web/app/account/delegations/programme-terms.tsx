'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PlacesReport, TermsState } from '@corridra/auth/customer-programme-terms';
import { MyReminders } from './my-reminders';
import {
  failureText,
  organiserReason,
  parseReport,
  parseState,
  percent,
  roleLabel,
  statusLabel,
  syntheticOk,
  termsApi,
  TermsError,
} from './terms-client';

type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmeId: string;
  coordinationEnabled?: boolean;
};
type Phase = 'loading' | 'ready' | 'denied' | 'unavailable' | 'failed';
const tabs = ['terms', 'eligibility', 'capacity', 'reminders'] as const;
type Tab = (typeof tabs)[number];
const tabLabel: Record<Tab, string> = {
  terms: 'Terms',
  eligibility: 'Eligibility',
  capacity: 'Capacity',
  reminders: 'Reminders',
};
const roles = Object.keys(roleLabel);
const sizeBands = ['1-10', '11-50', '51-200', '201-1000', '1000+'];
const list = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Terms, who may take part, how many places there are and who owns which task, for one programme.
export function ProgrammeTerms(props: Props) {
  return (
    <ScopedTerms
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId + ':' + props.programmeId}
      {...props}
    />
  );
}

function ScopedTerms({ subject, issuer, workspaceId, programmeId, coordinationEnabled }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<TermsState | null>(null);
  const [report, setReport] = useState<PlacesReport | null>(null);
  const [tab, setTab] = useState<Tab>('terms');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  // Terms form
  const [included, setIncluded] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [excluded, setExcluded] = useState('');
  const [cancellation, setCancellation] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [changes, setChanges] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [feesApply, setFeesApply] = useState(false);
  const [feeNote, setFeeNote] = useState('');
  const [termsReason, setTermsReason] = useState(realCustomerInput() ? '' : 'Synthetic ');
  // Eligibility form
  const [pickRoles, setPickRoles] = useState<string[]>([]);
  const [pickSizes, setPickSizes] = useState<string[]>([]);
  const [countries, setCountries] = useState('');
  const [sectors, setSectors] = useState('');
  const [minFields, setMinFields] = useState('0');
  const [criteriaReason, setCriteriaReason] = useState(realCustomerInput() ? '' : 'Synthetic ');
  // Places form
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [waitlist, setWaitlist] = useState(true);
  const [placesReason, setPlacesReason] = useState(realCustomerInput() ? '' : 'Synthetic ');
  // Task owners
  const [owners, setOwners] = useState<Record<string, { key: string; visible: boolean }>>({});
  const active = useRef(true);
  const task = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writing = useRef(false);
  const intent = useRef<{ signature: string; commandId: string } | null>(null);
  const api = useRef(termsApi(subject, issuer));
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const clear = useCallback(() => {
    setState(null);
    setReport(null);
    setIncluded(realCustomerInput() ? '' : 'Synthetic ');
    setExcluded('');
    setCancellation(realCustomerInput() ? '' : 'Synthetic ');
    setChanges(realCustomerInput() ? '' : 'Synthetic ');
    setFeesApply(false);
    setFeeNote('');
    setTermsReason(realCustomerInput() ? '' : 'Synthetic ');
    setPickRoles([]);
    setPickSizes([]);
    setCountries('');
    setSectors('');
    setMinFields('0');
    setCriteriaReason(realCustomerInput() ? '' : 'Synthetic ');
    setMinimum('');
    setMaximum('');
    setPlacesReason(realCustomerInput() ? '' : 'Synthetic ');
    setOwners({});
    intent.current = null;
  }, []);
  const lose = useCallback(
    (to: Phase, message = '') => {
      if (timer.current) clearTimeout(timer.current);
      clear();
      setPhase(to);
      setNotice(message);
    },
    [clear],
  );
  const load = useCallback(
    async (keepNotice = false) => {
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      if (!keepNotice) setNotice('');
      try {
        const [s, r] = await Promise.all([
          api.current.get({ view: 'state', workspaceId, programmeId }, controller.signal),
          api.current.get({ view: 'report', workspaceId, programmeId }, controller.signal),
        ]);
        if (controller.signal.aborted || !active.current) return;
        const st = parseState(s, workspaceId, programmeId);
        const rep = parseReport(r, workspaceId, programmeId);
        setState(st);
        setReport(rep);
        setPhase('ready');
        // Forms start from what is saved, so a new version is an edit of the last one.
        const t = st.terms.current;
        setIncluded(t ? t.included : realCustomerInput() ? '' : 'Synthetic ');
        setExcluded(t?.excluded ?? '');
        setCancellation(t ? t.cancellationTerms : realCustomerInput() ? '' : 'Synthetic ');
        setChanges(t ? t.changeTerms : realCustomerInput() ? '' : 'Synthetic ');
        setFeesApply(t ? t.feesApply : false);
        setFeeNote(t?.feeNote ?? '');
        setTermsReason(realCustomerInput() ? '' : 'Synthetic ');
        const e = st.eligibility.current;
        setPickRoles(e ? e.roles : []);
        setPickSizes(e ? e.sizeBands : []);
        setCountries(e ? e.countries.join(', ') : '');
        setSectors(e ? e.sectors.join(', ') : '');
        setMinFields(e ? String(e.minProfileFields) : '0');
        setCriteriaReason(realCustomerInput() ? '' : 'Synthetic ');
        setMinimum(st.places.minimum === null ? '' : String(st.places.minimum));
        setMaximum(st.places.maximum === null ? '' : String(st.places.maximum));
        setWaitlist(st.places.version > 0 ? st.places.waitlist : true);
        setPlacesReason(realCustomerInput() ? '' : 'Synthetic ');
        setOwners(
          Object.fromEntries(
            st.tasks.map((x) => [
              x.id,
              { key: x.plan.assigneeKey ?? '', visible: x.plan.participantVisible },
            ]),
          ),
        );
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(
          () => lose('failed', 'This private view expired. Reload to check access again.'),
          Math.max(Date.parse(st.expiresAt) - Date.now(), 1000),
        );
      } catch (e) {
        if (controller.signal.aborted || !active.current) return;
        if (e instanceof TermsError && e.kind === 'denied')
          lose('denied', 'Account or programme access changed. Private details were cleared.');
        else if (e instanceof TermsError && e.kind === 'unavailable')
          lose('unavailable', 'Programme terms are unavailable right now.');
        else lose('failed', 'This could not be loaded. Reload to check access and try again.');
      }
    },
    [workspaceId, programmeId, lose],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    return () => {
      active.current = false;
      task.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [busy]);

  async function send(action: string, input: Record<string, unknown>, message: string) {
    if (writing.current) return;
    const signature = action + JSON.stringify(input);
    if (intent.current?.signature !== signature)
      intent.current = { signature, commandId: crypto.randomUUID() };
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await api.current.post(action, {
        commandId: intent.current.commandId,
        workspaceId,
        programmeId,
        ...input,
      });
      intent.current = null;
      setNotice(message);
      await load(true);
    } catch (e) {
      if (e instanceof TermsError && e.kind === 'denied')
        lose('denied', 'Account or programme access changed. Private details were cleared.');
      else setError(failureText(e));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function saveTerms() {
    setError('');
    if (![included, cancellation, changes, termsReason].every(syntheticOk))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start each text with the word Synthetic and add a few words: included, cancelling, changes and the reason.',
      );
    if (excluded.trim() && !syntheticOk(excluded))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the "not included" text with the word Synthetic, or clear it.',
      );
    if (feesApply && feeNote.trim() && !syntheticOk(feeNote))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the fee note with the word Synthetic, or clear it.',
      );
    void send(
      'terms',
      {
        expectedVersion: state!.terms.current?.version ?? 0,
        included: included.trim(),
        excluded: excluded.trim() || null,
        cancellationTerms: cancellation.trim(),
        changeTerms: changes.trim(),
        feesApply,
        feeNote: feesApply && feeNote.trim() ? feeNote.trim() : null,
        reason: termsReason.trim(),
      },
      'Terms saved as a new version. Participants accept it when they apply or when asked.',
    );
  }
  function saveCriteria() {
    setError('');
    if (!syntheticOk(criteriaReason))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the reason with the word Synthetic and add a few words.',
      );
    const cs = list(countries).map((c) => c.toUpperCase());
    if (cs.some((c) => !/^[A-Z]{2}$/.test(c)))
      return setError(
        'Write countries as two-letter codes separated by commas, for example BD, DE.',
      );
    const ss = list(sectors);
    if (ss.some((s) => s.length < 2 || s.length > 60) || ss.length > 10)
      return setError('Write up to ten sectors separated by commas.');
    void send(
      'eligibility',
      {
        expectedVersion: state!.eligibility.current?.version ?? 0,
        roles: pickRoles,
        sectors: ss,
        countries: cs,
        sizeBands: pickSizes,
        minProfileFields: Number(minFields),
        reason: criteriaReason.trim(),
      },
      'Criteria saved as a new version. Earlier versions are kept.',
    );
  }
  function savePlaces() {
    setError('');
    if (!/^[1-9][0-9]{0,4}$/.test(minimum) || !/^[1-9][0-9]{0,4}$/.test(maximum))
      return setError('Enter whole numbers from 1 to 10000 for the minimum and the maximum.');
    if (Number(minimum) > Number(maximum))
      return setError('The minimum cannot be more than the maximum.');
    if (!syntheticOk(placesReason))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the reason with the word Synthetic and add a few words.',
      );
    void send(
      'places',
      {
        expectedVersion: state!.places.version,
        minimum: Number(minimum),
        maximum: Number(maximum),
        waitlist,
        reason: placesReason.trim(),
      },
      'Places saved.',
    );
  }
  function saveOwner(t: TermsState['tasks'][number]) {
    const o = owners[t.id];
    void send(
      'assign',
      {
        taskId: t.id,
        expectedVersion: t.plan.version,
        assigneeKey: o.key || null,
        participantVisible: o.visible,
      },
      'Task owner saved.',
    );
  }
  const toggle = (set: (v: string[]) => void, current: string[], value: string) =>
    set(current.includes(value) ? current.filter((x) => x !== value) : [...current, value]);
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const i = tabs.indexOf(tab);
    let next = i;
    if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setTab(tabs[next]);
    tabRefs.current[tabs[next]]?.focus();
  }

  const t = state?.terms.current ?? null;
  const e = state?.eligibility.current ?? null;
  return (
    <section
      className="detail-card"
      aria-label="Programme terms, eligibility and places"
      aria-busy={busy || phase === 'loading'}
    >
      <h4>Terms, eligibility and places</h4>
      <p>
        Set what participants agree to, who can take part and how many places there are. This
        records your decisions only; nothing is sent to anyone.
      </p>
      {phase === 'loading' && <p role="status">Loading terms and places…</p>}
      {phase === 'unavailable' && <p role="status">{notice}</p>}
      {(phase === 'denied' || phase === 'failed') && (
        <>
          <p role="alert">{notice}</p>
          {phase === 'failed' && (
            <button type="button" className="text-link" onClick={() => void load()}>
              Reload terms and places
            </button>
          )}
        </>
      )}
      {phase === 'ready' && state && report && (
        <>
          <div role="tablist" aria-label="Programme settings" className="terms-tabs">
            {tabs.map((id) => (
              <button
                key={id}
                id={'terms-tab-' + programmeId + '-' + id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls={'terms-panel-' + programmeId + '-' + id}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={onTabKey}
              >
                {tabLabel[id]}
              </button>
            ))}
          </div>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}

          {tab === 'terms' && (
            <div
              role="tabpanel"
              id={'terms-panel-' + programmeId + '-terms'}
              aria-labelledby={'terms-tab-' + programmeId + '-terms'}
            >
              <h5>Programme terms</h5>
              {t ? (
                <dl>
                  <dt>Version {t.version}</dt>
                  <dd>{t.reason}</dd>
                  <dt>What is included</dt>
                  <dd>{t.included}</dd>
                  {t.excluded && (
                    <>
                      <dt>What is not included</dt>
                      <dd>{t.excluded}</dd>
                    </>
                  )}
                  <dt>Cancelling</dt>
                  <dd>{t.cancellationTerms}</dd>
                  <dt>If the plan changes</dt>
                  <dd>{t.changeTerms}</dd>
                  <dt>Fees</dt>
                  <dd>{t.feesApply ? (t.feeNote ?? 'A fee applies.') : 'No fee applies.'}</dd>
                </dl>
              ) : (
                <p>No terms yet. Participants can apply without accepting any terms.</p>
              )}
              {report.terms.version > 0 && (
                <p>
                  {report.terms.acceptedCurrent} of {report.funnel.registered} registered people
                  have accepted version {report.terms.version} (
                  {percent(report.terms.acceptanceRatePermille)}). {report.terms.pendingAcceptance}{' '}
                  with a place or a waiting spot still need to accept it.
                </p>
              )}
              <form
                className="operator-form"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  saveTerms();
                }}
              >
                <h5>{t ? 'Publish version ' + (t.version + 1) : 'Publish the first version'}</h5>
                <p>
                  Each version is kept. A new version asks participants to accept it again. Start
                  each text with the word Synthetic.
                </p>
                <label className="field">
                  What is included
                  <textarea
                    value={included}
                    maxLength={1000}
                    disabled={busy}
                    onChange={(ev) => setIncluded(ev.target.value)}
                  />
                </label>
                <label className="field">
                  What is not included (optional)
                  <textarea
                    value={excluded}
                    maxLength={1000}
                    disabled={busy}
                    onChange={(ev) => setExcluded(ev.target.value)}
                  />
                </label>
                <label className="field">
                  Cancelling
                  <textarea
                    value={cancellation}
                    maxLength={1000}
                    disabled={busy}
                    onChange={(ev) => setCancellation(ev.target.value)}
                  />
                </label>
                <label className="field">
                  If the plan changes
                  <textarea
                    value={changes}
                    maxLength={1000}
                    disabled={busy}
                    onChange={(ev) => setChanges(ev.target.value)}
                  />
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={feesApply}
                    disabled={busy}
                    onChange={(ev) => setFeesApply(ev.target.checked)}
                  />
                  A fee applies. Amounts are recorded under fees and costs, never here.
                </label>
                {feesApply && (
                  <label className="field">
                    Fee note (optional)
                    <input
                      type="text"
                      maxLength={500}
                      value={feeNote}
                      disabled={busy}
                      onChange={(ev) => setFeeNote(ev.target.value)}
                    />
                  </label>
                )}
                <label className="field">
                  Why this version
                  <input
                    type="text"
                    maxLength={300}
                    value={termsReason}
                    disabled={busy}
                    onChange={(ev) => setTermsReason(ev.target.value)}
                  />
                </label>
                <button type="submit" className="primary-link" disabled={busy}>
                  {t ? 'Publish new version' : 'Publish terms'}
                </button>
              </form>
              {state.terms.history.length > 1 && (
                <details>
                  <summary>Earlier versions ({state.terms.history.length - 1})</summary>
                  <ul>
                    {state.terms.history.slice(1).map((h) => (
                      <li key={h.version}>
                        Version {h.version} · {h.reason} · {h.included}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {tab === 'eligibility' && (
            <div
              role="tabpanel"
              id={'terms-panel-' + programmeId + '-eligibility'}
              aria-labelledby={'terms-tab-' + programmeId + '-eligibility'}
            >
              <h5>Who can take part</h5>
              {e ? (
                <ul>
                  <li>
                    Version {e.version}: {e.reason}
                  </li>
                  <li>
                    Commercial roles:{' '}
                    {e.roles.length ? e.roles.map((r) => roleLabel[r] ?? r).join(', ') : 'any'}
                  </li>
                  <li>Sectors: {e.sectors.length ? e.sectors.join(', ') : 'any'}</li>
                  <li>Countries: {e.countries.length ? e.countries.join(', ') : 'any'}</li>
                  <li>Company size: {e.sizeBands.length ? e.sizeBands.join(', ') : 'any'}</li>
                  <li>Profile details filled in: at least {e.minProfileFields} of 7</li>
                </ul>
              ) : (
                <p>No criteria yet. Anyone registered can apply.</p>
              )}
              <p>
                People are checked against the organisation profile they choose. You see which rule
                was not met, never what is in their profile.
              </p>
              {report.funnel.notEligible > 0 && (
                <>
                  <h5>Not eligible so far: {report.funnel.notEligible}</h5>
                  <ul>
                    {Object.entries(report.eligibility.notEligibleByReason).map(([code, n]) => (
                      <li key={code}>
                        {organiserReason[code] ?? code}: {n}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <form
                className="operator-form"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  saveCriteria();
                }}
              >
                <h5>{e ? 'Save version ' + (e.version + 1) : 'Set the first criteria'}</h5>
                <p>Leave a group empty to accept anything in it. Earlier versions are kept.</p>
                <fieldset>
                  <legend>Commercial roles</legend>
                  {roles.map((r) => (
                    <label key={r} className="check-field">
                      <input
                        type="checkbox"
                        checked={pickRoles.includes(r)}
                        disabled={busy}
                        onChange={() => toggle(setPickRoles, pickRoles, r)}
                      />
                      {roleLabel[r]}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Company size</legend>
                  {sizeBands.map((r) => (
                    <label key={r} className="check-field">
                      <input
                        type="checkbox"
                        checked={pickSizes.includes(r)}
                        disabled={busy}
                        onChange={() => toggle(setPickSizes, pickSizes, r)}
                      />
                      {r} people
                    </label>
                  ))}
                </fieldset>
                <label className="field">
                  Countries (two-letter codes, separated by commas)
                  <input
                    type="text"
                    value={countries}
                    disabled={busy}
                    onChange={(ev) => setCountries(ev.target.value)}
                  />
                </label>
                <label className="field">
                  Sectors (separated by commas)
                  <input
                    type="text"
                    value={sectors}
                    disabled={busy}
                    onChange={(ev) => setSectors(ev.target.value)}
                  />
                </label>
                <label className="field">
                  Profile details filled in, at least (of 7)
                  <select
                    value={minFields}
                    disabled={busy}
                    onChange={(ev) => setMinFields(ev.target.value)}
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Why this change
                  <input
                    type="text"
                    maxLength={300}
                    value={criteriaReason}
                    disabled={busy}
                    onChange={(ev) => setCriteriaReason(ev.target.value)}
                  />
                </label>
                <button type="submit" className="primary-link" disabled={busy}>
                  Save criteria
                </button>
              </form>
              {state.eligibility.history.length > 1 && (
                <details>
                  <summary>Earlier versions ({state.eligibility.history.length - 1})</summary>
                  <ul>
                    {state.eligibility.history.slice(1).map((h) => (
                      <li key={h.version}>
                        Version {h.version} · {h.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {tab === 'capacity' && (
            <div
              role="tabpanel"
              id={'terms-panel-' + programmeId + '-capacity'}
              aria-labelledby={'terms-tab-' + programmeId + '-capacity'}
            >
              <h5>Places</h5>
              <table>
                <caption>Capacity, acceptance and satisfaction</caption>
                <tbody>
                  <tr>
                    <th scope="row">Places taken</th>
                    <td>
                      {report.places.placed}
                      {report.places.maximum !== null
                        ? ' of ' +
                          report.places.maximum +
                          ' (' +
                          percent(report.places.fillPermille) +
                          ' full)'
                        : ' (no maximum set)'}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Minimum to run</th>
                    <td>
                      {report.places.minimum === null
                        ? 'Not set'
                        : report.places.minimum +
                          (report.places.minimumMet ? ' · reached' : ' · not reached yet')}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Waiting list</th>
                    <td>
                      {report.places.waitlist ? report.places.waiting + ' waiting' : 'Switched off'}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Applications</th>
                    <td>
                      {report.funnel.registered} registered · {report.funnel.notApplied} not applied
                      · {report.funnel.notEligible} not eligible · {report.funnel.cancelled} gave up
                      a place
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Terms accepted (reported by participants)</th>
                    <td>
                      {report.terms.version === 0
                        ? 'No terms published'
                        : report.terms.acceptedCurrent +
                          ' of ' +
                          report.funnel.registered +
                          ' (' +
                          percent(report.terms.acceptanceRatePermille) +
                          ')'}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Satisfaction (reported by participants)</th>
                    <td>
                      {report.satisfaction.ratingCount === 0
                        ? 'No shared ratings yet'
                        : (report.satisfaction.ratingSum / report.satisfaction.ratingCount).toFixed(
                            1,
                          ) +
                          ' out of 5 from ' +
                          report.satisfaction.ratingCount +
                          ' shared rating' +
                          (report.satisfaction.ratingCount === 1 ? '' : 's')}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Results shared with you</th>
                    <td>
                      {report.outcomes.shared} from {report.outcomes.participantsWithOutcome} people
                    </td>
                  </tr>
                </tbody>
              </table>
              {report.places.promotable > 0 && (
                <div role="status">
                  <p>
                    {report.places.promotable} place
                    {report.places.promotable === 1 ? ' is' : 's are'} free and people are waiting.
                  </p>
                  <button
                    type="button"
                    className="primary-link"
                    disabled={busy}
                    onClick={() =>
                      void send('refresh', {}, 'Waiting people were moved up in order.')
                    }
                  >
                    Move waiting people up
                  </button>
                </div>
              )}
              <form
                className="operator-form"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  savePlaces();
                }}
              >
                <h5>Set places</h5>
                <label className="field">
                  Minimum to run the programme
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={minimum}
                    disabled={busy}
                    onChange={(ev) => setMinimum(ev.target.value)}
                  />
                </label>
                <label className="field">
                  Maximum places
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={maximum}
                    disabled={busy}
                    onChange={(ev) => setMaximum(ev.target.value)}
                  />
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={waitlist}
                    disabled={busy}
                    onChange={(ev) => setWaitlist(ev.target.checked)}
                  />
                  Keep a waiting list. When a place is freed, the next person in line gets it.
                </label>
                <label className="field">
                  Why this change
                  <input
                    type="text"
                    maxLength={300}
                    value={placesReason}
                    disabled={busy}
                    onChange={(ev) => setPlacesReason(ev.target.value)}
                  />
                </label>
                <button type="submit" className="primary-link" disabled={busy}>
                  Save places
                </button>
              </form>
              <h5>People</h5>
              {report.roster.length === 0 ? (
                <p>No one is registered yet.</p>
              ) : (
                <ul>
                  {report.roster.map((r) => (
                    <li key={r.registrationId}>
                      <strong>{r.label}</strong> · {statusLabel[r.status]}
                      {r.status === 'WAITLISTED' && r.position ? ', number ' + r.position : ''}
                      {r.reasons.length > 0
                        ? ' · ' + r.reasons.map((c) => organiserReason[c] ?? c).join('; ')
                        : ''}
                      {report.terms.version > 0 &&
                      r.status !== 'NOT_APPLIED' &&
                      r.status !== 'NOT_ELIGIBLE'
                        ? r.termsCurrent
                          ? ' · accepted the current terms'
                          : ' · has not accepted the current terms'
                        : ''}
                    </li>
                  ))}
                </ul>
              )}
              {report.rosterTruncated && <p>Only the first 500 people are listed.</p>}
            </div>
          )}

          {tab === 'reminders' && (
            <div
              role="tabpanel"
              id={'terms-panel-' + programmeId + '-reminders'}
              aria-labelledby={'terms-tab-' + programmeId + '-reminders'}
            >
              <h5>Who does what</h5>
              {!coordinationEnabled ? (
                <p>Tasks are not switched on for this workspace.</p>
              ) : state.tasks.length === 0 ? (
                <p>
                  No tasks yet. Add tasks under Coordinate and report, then give them owners here.
                </p>
              ) : (
                <ul>
                  {state.tasks.map((x) => {
                    const o = owners[x.id] ?? { key: '', visible: false };
                    return (
                      <li key={x.id}>
                        <strong>{x.title}</strong>
                        {x.dueOn ? ' · due ' + x.dueOn : ''} ·{' '}
                        {x.status.toLowerCase().replace('_', ' ')}
                        <label className="field">
                          Owner of {x.title}
                          <select
                            value={o.key}
                            disabled={busy}
                            onChange={(ev) =>
                              setOwners({ ...owners, [x.id]: { ...o, key: ev.target.value } })
                            }
                          >
                            <option value="">No one yet</option>
                            {state.members.map((m) => (
                              <option key={m.key} value={m.key}>
                                {m.label}
                                {m.isYou ? ' (you)' : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={o.visible}
                            disabled={busy}
                            onChange={(ev) =>
                              setOwners({ ...owners, [x.id]: { ...o, visible: ev.target.checked } })
                            }
                          />
                          Show the title and due date to people with a place
                        </label>
                        <button
                          type="button"
                          className="text-link"
                          disabled={
                            busy ||
                            (o.key === (x.plan.assigneeKey ?? '') &&
                              o.visible === x.plan.participantVisible)
                          }
                          onClick={() => saveOwner(x)}
                        >
                          Save owner for {x.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <MyReminders subject={subject} issuer={issuer} />
            </div>
          )}
          <button type="button" className="text-link" disabled={busy} onClick={() => void load()}>
            Reload terms and places
          </button>
        </>
      )}
    </section>
  );
}
