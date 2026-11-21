'use client';
// ADR-089. The guided Connect AI screen: nine short steps that save one new version of a provider connection. It is
// configuration only: it sends plain answers to POST ai-connect and the server builds the policy. It never asks for a key,
// never shows whether one is set, calls no provider and switches nothing on. The read answers 404 unless
// CORRIDRA_AI_CONNECT_FORM is on; then this draws nothing and the settings panel is what it was. Every refusal is placed by
// its code, never by its words. The developer JSON command under Advanced is untouched.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { taskIds, type TaskId } from '@corridra/intelligence/registry';
import { BeforeSend } from '../../components/before-send';
import { CorridraIcon } from '../../components/corridra-icon';
import { FieldError } from '../../components/field-error';
import { ChoiceChip } from '../../components/ux/choice-chip';
import { NumberField } from '../../components/ux/number-field';
import { ActionError, readJson, withStepUp } from '../../lib/ux/step-up';
import { PlanProgress } from '../plan/plan-progress';
import {
  changeFact,
  changeLabel,
  euConsequence,
  euHelper,
  fallbackOption,
  fromVersion,
  kindLabel,
  progressLine,
  providerName,
  providerNames,
  reasonCount,
  reviewSummary,
  savedText,
  showTasks,
  stepNames,
  stepQuestions,
  taskLabels,
  tasksChosen,
  words,
  type AdapterChoice,
} from './connect-ai-copy';
import {
  buildConnectionRequest,
  emptyDraft,
  minorToUsd,
  stepErrors,
  stepFields,
  usdToMinor,
  type ConnectDraft,
  type EvaluationStatus,
  type FieldErrors,
  type FieldName,
} from './connect-ai-request';
import { CountryListPicker, countryName } from './country-list-picker';
import './connect-ai-form.css';

type PolicyRow = {
  key: string;
  id: string;
  version: number;
  dailyBudgetMinor: string;
  configuration: {
    model?: string;
    evaluationStatus?: string;
    processingLocations?: string[];
    tasks?: string[];
    fallbackPolicyIds?: string[];
    inputRateMinorPerMillion?: string;
    outputRateMinorPerMillion?: string;
    maxCostMinor?: string;
  };
};
type Candidate = { id: string; key: string; version: number; adapter: string; model: string };
type SourceRow = { id: string; kind: string; locator: string; observedAt: string };
type Blocked = 'MODULE_NOT_INSTALLED' | 'REAL_USE_OFF';
type Options = {
  moduleInstalled: boolean;
  realWorkspace: boolean;
  canConnect: boolean;
  canManage: boolean;
  blockedReason: Blocked | null;
  locationLimit: number;
  latest: PolicyRow[];
  fallbackCandidates: Candidate[];
  eu: { codes: string[]; recordedOn: string | null };
  sources: SourceRow[];
};
type Banner = { text: string; action?: 'retry' | 'loadLatest' };

const adapters: readonly AdapterChoice[] = ['openai', 'anthropic', 'google'];
const evaluationStatuses: readonly EvaluationStatus[] = ['SYNTHETIC_ONLY', 'APPROVED_PROVIDER'];
const sourceCap = 50;
const reviewStep = 7;
const saveStep = 8;
const dateWords = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const inWords = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateWords.format(date);
};
const isTask = (value: string): value is TaskId => (taskIds as readonly string[]).includes(value);
const isEvaluation = (value: string | undefined): value is EvaluationStatus =>
  value === 'SYNTHETIC_ONLY' || value === 'APPROVED_PROVIDER';
const sourceLabel = (source: SourceRow) =>
  `${kindLabel(source.kind)} · ${source.locator.slice(0, 60)}${source.locator.length > 60 ? '…' : ''} · ${inWords(source.observedAt)}`;
const usd = (typed: string) => {
  const money = usdToMinor(typed);
  return 'minor' in money ? `${minorToUsd(money.minor)} USD` : '';
};

// The answers an earlier version of the same connection gives. Sources, valid until, reason and the tick never come from it.
function prefill(row: PolicyRow | undefined, limit: number, candidates: Candidate[]) {
  const c = row?.configuration ?? {};
  const fallback = c.fallbackPolicyIds?.[0];
  return {
    model: c.model ?? '',
    evaluationStatus: isEvaluation(c.evaluationStatus) ? c.evaluationStatus : '',
    scope: 'countries',
    codes: (c.processingLocations ?? []).slice(0, limit),
    inputRate: c.inputRateMinorPerMillion ? minorToUsd(c.inputRateMinorPerMillion) : '',
    outputRate: c.outputRateMinorPerMillion ? minorToUsd(c.outputRateMinorPerMillion) : '',
    maxCost: c.maxCostMinor ? minorToUsd(c.maxCostMinor) : '',
    dailyBudget: row ? minorToUsd(row.dailyBudgetMinor) : '',
    tasks: (c.tasks ?? []).filter(isTask),
    fallbackPolicyId: fallback && candidates.some((p) => p.id === fallback) ? fallback : '',
  } satisfies Partial<ConnectDraft>;
}

export function ConnectAiForm({ tenant }: { tenant: string }) {
  const base = useId();
  const [options, setOptions] = useState<Options | null>(null);
  const [view, setView] = useState<'hidden' | 'loading' | 'readFailed' | 'ready' | 'denied'>(
    'hidden',
  );
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ConnectDraft>(emptyDraft);
  const [prefilledFor, setPrefilledFor] = useState<AdapterChoice | ''>('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ provider: string; version: number } | null>(null);
  const savingNow = useRef(false);
  // Focus moves after the render that draws its target: a step heading, the first field with an error, the saved heading.
  const pendingFocus = useRef<string | null>(null);
  const focusSoon = (target: string) => {
    pendingFocus.current = target;
  };
  useEffect(() => {
    const target = pendingFocus.current && document.getElementById(pendingFocus.current);
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
  });
  const summaryRef = useRef<HTMLElement>(null);

  const read = useCallback(
    async (adapter?: AdapterChoice | '') => {
      const query = new URLSearchParams({ tenant });
      if (adapter) query.set('adapter', adapter);
      return readJson<Options>(
        await fetch(`/api/workspace/ai-connect?${query}`, { cache: 'no-store' }),
      );
    },
    [tenant],
  );

  // The first read decides whether anything is drawn. 404 is the switch off, 401 no session: draw nothing. A failed
  // network request says nothing about the switch either, so it also draws nothing.
  useEffect(() => {
    let live = true;
    read()
      .then((value) => {
        if (!live) return;
        setOptions(value);
        setView('ready');
      })
      .catch((error) => {
        if (!live || !(error instanceof ActionError)) return;
        if (error.status === 403) setView('denied');
        else if (error.status >= 500) setView('readFailed');
      });
    return () => {
      live = false;
    };
  }, [read]);

  // A later read: the switch is known to be on, so a failure is shown with a way to try again.
  const reread = useCallback(
    async (adapter?: AdapterChoice | '') => {
      try {
        const value = await read(adapter);
        setOptions(value);
        return value;
      } catch (error) {
        if (error instanceof ActionError && error.status === 403 && !error.code) setView('denied');
        else setView('readFailed');
        return null;
      }
    },
    [read],
  );

  if (view === 'hidden') return null;

  const id = (field: string) => `${base}-${field}`;
  const limit = options?.locationLimit ?? 20;
  const ownKey = draft.adapter ? `connect-${draft.adapter}` : null;
  const latestRow = options?.latest.find((p) => p.key === ownKey);
  const latestVersion = latestRow?.version ?? 0;
  const provider = draft.adapter ? providerNames[draft.adapter] : '';
  const candidates = (options?.fallbackCandidates ?? []).filter((p) => p.key !== ownKey);
  const sources = options?.sources ?? [];
  const eu = options?.eu ?? { codes: [], recordedOn: null };
  const euOffered = options?.moduleInstalled === true;
  const euUsable = euOffered && eu.codes.length >= 1 && eu.codes.length <= limit;

  const focusId = (field: FieldName) =>
    field === 'adapter'
      ? id(`adapter-${draft.adapter || adapters[0]}`)
      : field === 'evaluationStatus'
        ? id(`evaluation-${draft.evaluationStatus || evaluationStatuses[0]}`)
        : field === 'codes'
          ? draft.scope === 'market'
            ? id('scope-market')
            : id('find')
          : field === 'tasks'
            ? id(`task-${taskIds[0]}`)
            : id(field);
  const update = <K extends keyof ConnectDraft>(field: K, value: ConnectDraft[K]) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };
  const goTo = (next: number, focus?: string) => {
    setStep(next);
    focusSoon(focus ?? id('question'));
  };
  const close = () => {
    setOpen(false);
    if (saved) restart();
    summaryRef.current?.focus();
  };
  const restart = () => {
    setDraft(emptyDraft);
    setPrefilledFor('');
    setErrors({});
    setBanner(null);
    setSaved(null);
    setStep(0);
  };

  async function chooseProvider() {
    if (!draft.adapter || draft.adapter === prefilledFor) return goTo(1);
    const adapter = draft.adapter;
    const fresh = await reread(adapter);
    if (!fresh) return;
    const row = fresh.latest.find((p) => p.key === `connect-${adapter}`);
    // A new provider: answers taken from another provider's earlier version are not kept as if they were this one's.
    if (row || prefilledFor)
      setDraft((previous) => ({
        ...previous,
        ...prefill(
          row,
          fresh.locationLimit,
          fresh.fallbackCandidates.filter((p) => p.key !== `connect-${adapter}`),
        ),
      }));
    setPrefilledFor(adapter);
    goTo(1);
  }

  function next() {
    const found = stepErrors(draft, step);
    setErrors(found);
    const first = stepFields[step].find((field) => found[field]);
    if (first) return void focusSoon(focusId(first));
    if (step === 0) return void chooseProvider();
    goTo(step + 1);
  }

  async function save() {
    if (savingNow.current) return;
    const found = stepErrors(draft, saveStep);
    setErrors(found);
    const first = stepFields[saveStep].find((field) => found[field]);
    if (first) return void focusSoon(focusId(first));
    // Any earlier step that no longer passes (a date that has since passed) is opened with its error.
    for (let s = 0; s < saveStep; s++) {
      const earlier = stepErrors(draft, s);
      const field = stepFields[s].find((f) => earlier[f]);
      if (field) {
        setErrors(earlier);
        return goTo(s, focusId(field));
      }
    }
    const body = buildConnectionRequest(draft, latestVersion);
    savingNow.current = true;
    setSaving(true);
    setBanner(null);
    try {
      const result = await withStepUp(async () =>
        readJson<{ id: string; version: number }>(
          await fetch(`/api/workspace/ai-connect?${new URLSearchParams({ tenant })}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        ),
      );
      setSaved({ provider, version: result.version });
      focusSoon(id('saved'));
      void reread(draft.adapter);
    } catch (error) {
      await refused(error);
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  async function refused(error: unknown) {
    const code = error instanceof ActionError ? error.code : undefined;
    if (code === 'VERSION_CHANGED')
      return setBanner({ text: words.save.versionChanged, action: 'loadLatest' });
    if (code === 'SOURCE_TERMS' || code === 'SOURCE_EVALUATION') {
      const field = code === 'SOURCE_TERMS' ? 'termsSourceId' : 'evaluationSourceId';
      await reread(draft.adapter);
      setErrors({ [field]: words.sources.refused });
      setBanner({ text: words.sources.banner });
      return goTo(3, id(field));
    }
    if (code === 'FALLBACK_SELF' || code === 'FALLBACK_NOT_CURRENT') {
      await reread(draft.adapter);
      setErrors({ fallbackPolicyId: words.fallback[code] });
      return goTo(6, id('fallbackPolicyId'));
    }
    if (code === 'EU_UNAVAILABLE' || code === 'EU_UNUSABLE' || code === 'COUNTRY_LIMIT') {
      await reread(draft.adapter);
      setErrors({ codes: words.scopeRefused[code] });
      return goTo(2, focusId('codes'));
    }
    if (code === 'MODULE_NOT_INSTALLED' || code === 'REAL_USE_OFF') {
      await reread(draft.adapter);
      return;
    }
    if (error instanceof ActionError && error.status === 403 && !code) {
      setBanner({ text: words.denied });
      return goTo(reviewStep);
    }
    setBanner({ text: words.save.failed, action: 'retry' });
  }

  async function loadLatest() {
    const fresh = await reread(draft.adapter);
    if (!fresh) return;
    setBanner(null);
    update('confirmed', false);
    focusSoon(id('before-save'));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === saveStep) void save();
    else next();
  }

  const error = (field: FieldName) =>
    errors[field] ? <FieldError id={id(`${field}-error`)}>{errors[field]}</FieldError> : null;
  const described = (field: FieldName, helper?: string) =>
    [helper, errors[field] ? id(`${field}-error`) : undefined].filter(Boolean).join(' ') ||
    undefined;

  const steps = [
    // 1 Provider
    <fieldset key="provider" className="connect-ai-choices" aria-describedby={described('adapter')}>
      <legend>{words.provider.legend}</legend>
      {!options?.latest.some((p) => p.key.startsWith('connect-')) && (
        <p className="connect-ai-helper">{words.firstEver}</p>
      )}
      {adapters.map((adapter) => (
        <ChoiceChip
          key={adapter}
          id={id(`adapter-${adapter}`)}
          name={id('adapter')}
          value={adapter}
          checked={draft.adapter === adapter}
          onChoose={() => update('adapter', adapter)}
          label={providerNames[adapter]}
        />
      ))}
      {error('adapter')}
    </fieldset>,
    // 2 Model
    <div key="model" className="connect-ai-fields">
      <div className="field">
        <label htmlFor={id('model')}>{words.model.label}</label>
        <p id={id('model-helper')} className="connect-ai-helper">
          {words.model.helper}
        </p>
        <input
          id={id('model')}
          value={draft.model}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          onChange={(event) => update('model', event.target.value)}
          aria-invalid={errors.model ? true : undefined}
          aria-describedby={described('model', id('model-helper'))}
        />
        {error('model')}
      </div>
      <fieldset className="connect-ai-choices" aria-describedby={described('evaluationStatus')}>
        <legend>{words.evaluation.legend}</legend>
        {evaluationStatuses.map((status) => (
          <div key={status} className="connect-ai-choice">
            <ChoiceChip
              id={id(`evaluation-${status}`)}
              name={id('evaluation')}
              value={status}
              checked={draft.evaluationStatus === status}
              onChoose={() => update('evaluationStatus', status)}
              label={words.evaluation[status].label}
            />
            <p className="connect-ai-helper">{words.evaluation[status].line}</p>
          </div>
        ))}
        {error('evaluationStatus')}
      </fieldset>
    </div>,
    // 3 Countries
    <div key="countries" className="connect-ai-fields">
      <fieldset className="connect-ai-choices">
        <legend>{words.countries.legend}</legend>
        <p className="connect-ai-helper">{words.countries.helper}</p>
        {euOffered && (
          <div className="connect-ai-choice">
            <ChoiceChip
              id={id('scope-countries')}
              name={id('scope')}
              value="countries"
              checked={draft.scope === 'countries'}
              onChoose={() => update('scope', 'countries')}
              label={words.countries.oneByOne}
            />
          </div>
        )}
        {euOffered &&
          (euUsable ? (
            <div className="connect-ai-choice">
              <ChoiceChip
                id={id('scope-market')}
                name={id('scope')}
                value="market"
                checked={draft.scope === 'market'}
                onChoose={() => update('scope', 'market')}
                label={words.countries.euLabel}
              />
              <p className="connect-ai-helper">
                {euHelper(eu.codes.length, eu.recordedOn ? inWords(eu.recordedOn) : '')}
              </p>
              <details>
                <summary>{words.countries.showCountries}</summary>
                <ul className="connect-ai-list">
                  {eu.codes.map((code) => (
                    <li key={code}>
                      {countryName(code)} <span className="connect-ai-code">{code}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <p className="connect-ai-helper">{words.countries.euEmpty}</p>
          ))}
        {draft.adapter && <p className="connect-ai-helper">{euConsequence(draft.adapter)}</p>}
      </fieldset>
      {draft.scope === 'countries' || !euUsable ? (
        <CountryListPicker
          inputId={id('find')}
          chosen={draft.codes}
          limit={limit}
          onChange={(codes) => update('codes', codes)}
          error={errors.codes}
          errorId={id('codes-error')}
        />
      ) : (
        error('codes')
      )}
    </div>,
    // 4 Sources
    <div key="sources" className="connect-ai-fields">
      <p id={id('sources-helper')} className="connect-ai-helper">
        {sources.length ? words.sources.helper : words.sources.none}
      </p>
      {sources.length >= sourceCap && <p className="connect-ai-helper">{words.sources.capped}</p>}
      {(['termsSourceId', 'evaluationSourceId'] as const).map((field) => (
        <div key={field} className="field">
          <label htmlFor={id(field)}>
            {field === 'termsSourceId' ? words.sources.terms : words.sources.evaluation}
          </label>
          <select
            id={id(field)}
            value={draft[field]}
            onChange={(event) => update(field, event.target.value)}
            aria-invalid={errors[field] ? true : undefined}
            aria-describedby={described(field, id('sources-helper'))}
          >
            <option value="">{words.sources.choose}</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {sourceLabel(source)}
              </option>
            ))}
          </select>
          {error(field)}
        </div>
      ))}
    </div>,
    // 5 Prices
    <div key="prices" className="connect-ai-fields">
      <p className="connect-ai-helper">{words.prices.helper}</p>
      {(
        [
          ['inputRate', words.prices.input],
          ['outputRate', words.prices.output],
          ['maxCost', words.prices.cap],
        ] as const
      ).map(([field, label]) => (
        <NumberField
          key={field}
          id={id(field)}
          label={label}
          unit="USD"
          value={draft[field]}
          onChange={(value) => update(field, value)}
          error={errors[field]}
        />
      ))}
    </div>,
    // 6 Limits
    <div key="limits" className="connect-ai-fields">
      <p className="connect-ai-helper">{words.limits.budgetHelper}</p>
      <NumberField
        id={id('dailyBudget')}
        label={words.limits.budget}
        unit="USD"
        value={draft.dailyBudget}
        onChange={(value) => update('dailyBudget', value)}
        error={errors.dailyBudget}
      />
      <div className="field">
        <label htmlFor={id('validUntil')}>{words.limits.validUntil}</label>
        <p id={id('validUntil-helper')} className="connect-ai-helper">
          {words.limits.validHelper}
        </p>
        <input
          id={id('validUntil')}
          type="date"
          value={draft.validUntil}
          onChange={(event) => update('validUntil', event.target.value)}
          aria-invalid={errors.validUntil ? true : undefined}
          aria-describedby={described('validUntil', id('validUntil-helper'))}
        />
        {error('validUntil')}
      </div>
    </div>,
    // 7 Tasks
    <div key="tasks" className="connect-ai-fields">
      <fieldset className="connect-ai-choices" aria-describedby={described('tasks')}>
        <legend>{words.tasks.legend}</legend>
        <p className="connect-ai-helper">{tasksChosen(draft.tasks.length, taskIds.length)}</p>
        {taskIds.map((task) => (
          <label key={task} className="ux-check">
            <input
              id={id(`task-${task}`)}
              type="checkbox"
              checked={draft.tasks.includes(task)}
              onChange={(event) =>
                update(
                  'tasks',
                  event.target.checked
                    ? [...draft.tasks, task]
                    : draft.tasks.filter((t) => t !== task),
                )
              }
            />{' '}
            {taskLabels[task]}
          </label>
        ))}
        {error('tasks')}
      </fieldset>
      <div className="field">
        <label htmlFor={id('fallbackPolicyId')}>{words.fallback.label}</label>
        <p id={id('fallback-helper')} className="connect-ai-helper">
          {candidates.length ? words.fallback.helper : words.fallback.empty}
        </p>
        <select
          id={id('fallbackPolicyId')}
          value={draft.fallbackPolicyId}
          onChange={(event) => update('fallbackPolicyId', event.target.value)}
          aria-invalid={errors.fallbackPolicyId ? true : undefined}
          aria-describedby={described('fallbackPolicyId', id('fallback-helper'))}
        >
          <option value="">{words.fallback.none}</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {fallbackOption(providerName(p.adapter), p.model, p.version)}
            </option>
          ))}
        </select>
        {error('fallbackPolicyId')}
      </div>
    </div>,
    // 8 Review
    <Review
      key="review"
      draft={draft}
      latestVersion={latestVersion}
      sources={sources}
      candidates={candidates}
      euCount={eu.codes.length}
      onChange={(s) => goTo(s)}
    />,
    // 9 Save
    <div key="save" className="connect-ai-fields">
      <div className="field">
        <label htmlFor={id('reason')}>{words.save.reason}</label>
        <textarea
          id={id('reason')}
          rows={3}
          maxLength={500}
          value={draft.reason}
          onChange={(event) => update('reason', event.target.value)}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={described('reason', id('reason-count'))}
        />
        <p id={id('reason-count')} className="connect-ai-helper">
          {reasonCount(draft.reason.length)}
        </p>
        {error('reason')}
      </div>
      <div id={id('before-save')} tabIndex={-1} className="connect-ai-before">
        <BeforeSend
          surface="aiConnection"
          heading={words.beforeSave.heading}
          rows={{
            change: {
              question: words.beforeSave.change,
              fact: changeFact(provider, latestVersion),
            },
            money: { question: words.beforeSave.money, fact: words.beforeSave.moneyFact },
            run: {
              question: words.beforeSave.run,
              fact: options?.realWorkspace ? words.beforeSave.runReal : words.beforeSave.runSample,
            },
          }}
          recorded={words.beforeSave.recorded}
        />
      </div>
      <label className="ux-check">
        <input
          id={id('confirmed')}
          type="checkbox"
          checked={draft.confirmed}
          onChange={(event) => update('confirmed', event.target.checked)}
          aria-invalid={errors.confirmed ? true : undefined}
          aria-describedby={described('confirmed')}
        />{' '}
        {words.save.confirm}
      </label>
      {error('confirmed')}
    </div>,
  ];

  const body = () => {
    if (view === 'loading') return <p role="status">{words.loading}</p>;
    if (view === 'readFailed')
      return (
        <div className="connect-ai-fields">
          <p role="alert" className="connect-ai-banner">
            <CorridraIcon name="alert" />
            <span>{words.readFailed}</span>
          </p>
          <button
            type="button"
            className="primary-link"
            onClick={() => {
              setView('loading');
              void read(draft.adapter)
                .then((value) => {
                  setOptions(value);
                  setView('ready');
                })
                .catch((e) =>
                  setView(
                    e instanceof ActionError && e.status === 403 && !e.code
                      ? 'denied'
                      : 'readFailed',
                  ),
                );
            }}
          >
            {words.tryAgain}
          </button>
        </div>
      );
    if (view === 'denied' || (options && !options.canManage))
      return (
        <div className="connect-ai-fields">
          <h3>{words.deniedHeading}</h3>
          <p>{words.denied}</p>
        </div>
      );
    if (!options) return null;
    if (!options.canConnect)
      return (
        <div className="connect-ai-fields">
          <h3>{words.notAvailable}</h3>
          <p>{options.blockedReason ? words.blocked[options.blockedReason] : null}</p>
          <button type="button" className="text-link" onClick={close}>
            {words.backToSettings}
          </button>
        </div>
      );
    if (saved)
      return (
        <div className="connect-ai-fields">
          <div role="status">
            <h3 id={id('saved')} tabIndex={-1}>
              {words.success.heading}
            </h3>
            <p>{savedText(saved.provider, saved.version)}</p>
          </div>
          <div className="connect-ai-end">
            <button type="button" className="primary-link" onClick={close}>
              {words.backToSettings}
            </button>
            <button
              type="button"
              className="text-link"
              onClick={() => {
                restart();
                focusSoon(id('question'));
              }}
            >
              {words.success.another}
            </button>
          </div>
        </div>
      );
    const showFrom = latestRow && prefilledFor && step >= 1 && step <= 6;
    return (
      <form className="connect-ai-form" aria-label={words.formLabel} onSubmit={submit} noValidate>
        <PlanProgress
          line={progressLine(step)}
          names={stepNames}
          current={step}
          listLabel={words.formLabel}
          progressLabel={progressLine(step)}
        />
        <h3 id={id('question')} tabIndex={-1}>
          {stepQuestions[step]}
        </h3>
        {showFrom && <p className="connect-ai-helper">{fromVersion(latestRow.version)}</p>}
        {banner && (
          <div className="connect-ai-fields">
            <p role="alert" className="connect-ai-banner">
              <CorridraIcon name="alert" />
              <span>{banner.text}</span>
            </p>
            {banner.action === 'loadLatest' && (
              <button type="button" className="text-link" onClick={() => void loadLatest()}>
                {words.save.loadLatest}
              </button>
            )}
            {banner.action === 'retry' && (
              <button type="button" className="text-link" onClick={() => void save()}>
                {words.tryAgain}
              </button>
            )}
          </div>
        )}
        {steps[step]}
        {step === saveStep ? (
          <div className="connect-ai-end">
            <button
              type="submit"
              className="primary-link"
              aria-disabled={saving || undefined}
              aria-busy={saving || undefined}
            >
              {saving ? words.save.busy : words.save.action}
            </button>
            <button type="button" className="text-link" onClick={() => goTo(step - 1)}>
              {words.back}
            </button>
            <p role="status" className="connect-ai-helper">
              {saving ? words.save.busyStatus : ''}
            </p>
          </div>
        ) : (
          <div className="connect-ai-actions">
            <button
              type="submit"
              className="primary-link"
              aria-disabled={(step === 0 && !draft.adapter) || undefined}
            >
              {step === 0 && !draft.adapter ? words.pickProvider : words.next}
            </button>
            {step > 0 && (
              <button type="button" className="text-link" onClick={() => goTo(step - 1)}>
                {words.back}
              </button>
            )}
            <p className="connect-ai-helper">{words.reassurance}</p>
          </div>
        )}
      </form>
    );
  };

  return (
    <details
      className="connect-ai"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary ref={summaryRef}>{words.open}</summary>
      {body()}
    </details>
  );
}

function Review({
  draft,
  latestVersion,
  sources,
  candidates,
  euCount,
  onChange,
}: {
  draft: ConnectDraft;
  latestVersion: number;
  sources: SourceRow[];
  candidates: Candidate[];
  euCount: number;
  onChange: (step: number) => void;
}) {
  const provider = draft.adapter ? providerNames[draft.adapter] : '';
  const source = (sourceId: string) => {
    const found = sources.find((s) => s.id === sourceId);
    return found ? sourceLabel(found) : '';
  };
  const fallback = candidates.find((p) => p.id === draft.fallbackPolicyId);
  const rows: [number, ReactNode][] = [
    [0, provider],
    [
      1,
      <>
        {draft.model}
        <br />
        {draft.evaluationStatus ? words.evaluation[draft.evaluationStatus].label : ''}
      </>,
    ],
    [
      2,
      draft.scope === 'market'
        ? `${words.countries.euLabel}, ${euCount}`
        : draft.codes.map(countryName).join(', '),
    ],
    [
      3,
      <>
        {words.sources.terms}: {source(draft.termsSourceId)}
        <br />
        {words.sources.evaluation}: {source(draft.evaluationSourceId)}
      </>,
    ],
    [
      4,
      <>
        {words.prices.input}: {usd(draft.inputRate)}
        <br />
        {words.prices.output}: {usd(draft.outputRate)}
        <br />
        {words.prices.cap}: {usd(draft.maxCost)}
      </>,
    ],
    [
      5,
      <>
        {words.limits.budget}: {usd(draft.dailyBudget)}
        <br />
        {words.limits.validUntil}: {draft.validUntil ? inWords(draft.validUntil) : ''}
      </>,
    ],
    [
      6,
      <>
        <details>
          <summary>{showTasks(draft.tasks.length, taskIds.length)}</summary>
          <ul className="connect-ai-list">
            {taskIds
              .filter((task) => draft.tasks.includes(task))
              .map((task) => (
                <li key={task}>{taskLabels[task]}</li>
              ))}
          </ul>
        </details>
        {words.fallback.label}:{' '}
        {fallback
          ? fallbackOption(providerName(fallback.adapter), fallback.model, fallback.version)
          : words.fallback.none}
      </>,
    ],
  ];
  return (
    <div className="connect-ai-fields">
      <p>{reviewSummary(provider, draft.model, latestVersion + 1)}</p>
      <dl className="connect-ai-review">
        {rows.map(([s, value]) => (
          <div key={s}>
            <dt>{stepNames[s]}</dt>
            <dd>{value}</dd>
            <dd>
              <button type="button" className="text-link" onClick={() => onChange(s)}>
                {changeLabel(stepNames[s])}
              </button>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
