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
  groupSummary,
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
  taskGroups,
  taskLabels,
  tasksChosen,
  words,
  type AdapterChoice,
} from './connect-ai-copy';
import {
  buildConnectionRequest,
  effectiveScope,
  emptyDraft,
  minorToUsd,
  stepErrors,
  stepFields,
  usdToMinor,
  type ConnectDraft,
  type DraftContext,
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
    scope: row ? 'countries' : '',
    codes: (c.processingLocations ?? []).slice(0, limit),
    inputRate: c.inputRateMinorPerMillion ? minorToUsd(c.inputRateMinorPerMillion) : '',
    outputRate: c.outputRateMinorPerMillion ? minorToUsd(c.outputRateMinorPerMillion) : '',
    maxCost: c.maxCostMinor ? minorToUsd(c.maxCostMinor) : '',
    dailyBudget: row ? minorToUsd(row.dailyBudgetMinor) : '',
    tasks: (c.tasks ?? []).filter(isTask),
    fallbackPolicyId: fallback && candidates.some((p) => p.id === fallback) ? fallback : '',
  } satisfies Partial<ConnectDraft>;
}

// Whether these options offer the EU list in a form a save can use.
const euUsableIn = (value: Options) =>
  value.moduleInstalled &&
  value.eu.codes.length >= 1 &&
  value.eu.codes.length <= value.locationLimit;

// The draft without the answers the new lists no longer hold: a source or fallback that has gone, and an EU choice when
// the EU list is not usable (so it cannot come back later over countries chosen meanwhile). Any change clears the tick.
function withoutGone(draft: ConnectDraft, value: Options): ConnectDraft {
  const sourceIds = value.sources.map((s) => s.id);
  const fallbackIds = value.fallbackCandidates
    .filter((p) => p.key !== `connect-${draft.adapter}`)
    .map((p) => p.id);
  const gone = {
    termsSourceId: !!draft.termsSourceId && !sourceIds.includes(draft.termsSourceId),
    evaluationSourceId: !!draft.evaluationSourceId && !sourceIds.includes(draft.evaluationSourceId),
    fallbackPolicyId: !!draft.fallbackPolicyId && !fallbackIds.includes(draft.fallbackPolicyId),
    market: draft.scope === 'market' && !euUsableIn(value),
  };
  if (!Object.values(gone).some(Boolean)) return draft;
  return {
    ...draft,
    scope: gone.market ? 'countries' : draft.scope,
    termsSourceId: gone.termsSourceId ? '' : draft.termsSourceId,
    evaluationSourceId: gone.evaluationSourceId ? '' : draft.evaluationSourceId,
    fallbackPolicyId: gone.fallbackPolicyId ? '' : draft.fallbackPolicyId,
    confirmed: false,
  };
}

type View = 'hidden' | 'loading' | 'readFailed' | 'ready' | 'denied';

/**
 * What a failed first read draws. 404 is the switch off and 401 no session; a lost request says nothing about the switch.
 * All three draw nothing, so the settings panel is what it was. Only a 403 or a server failure shows the switch is on.
 */
export function firstReadView(error: unknown): View {
  if (!(error instanceof ActionError)) return 'hidden';
  if (error.status === 403) return 'denied';
  return error.status >= 500 ? 'readFailed' : 'hidden';
}

/** What a failed later read draws: the switch turned off (404) draws nothing; anything else offers Try Again. */
export function laterReadView(error: unknown): View {
  if (error instanceof ActionError && error.status === 404) return 'hidden';
  if (error instanceof ActionError && error.status === 403 && !error.code) return 'denied';
  return 'readFailed';
}

export function ConnectAiForm({
  tenant,
  step: stepNumber,
  onShownChange,
}: {
  tenant: string;
  /** The section's number in the panel, as drawn ("03", or "04" after Add route pack). */
  step: string;
  /** Told when the section appears or goes, so the panel can list it among its jump links. */
  onShownChange?: (shown: boolean) => void;
}) {
  const base = useId();
  const [options, setOptions] = useState<Options | null>(null);
  const [view, setViewState] = useState<View>('hidden');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ConnectDraft>(emptyDraft);
  const [prefilledFor, setPrefilledFor] = useState<AdapterChoice | ''>('');
  const [prefilledVersion, setPrefilledVersion] = useState<number | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{
    provider: string;
    version: number;
    refreshFailed: boolean;
  } | null>(null);
  const savingNow = useRef(false);
  // Which flow this is. Starting again (Connect Another Provider, or closing after a save) begins a new one, so a read
  // still in flight from the finished flow cannot change the new flow's lists or its saved view.
  const generation = useRef(0);
  // The provider whose read is in flight; choosing another provider meanwhile drops that read's answer.
  const pendingAdapter = useRef<AdapterChoice | null>(null);
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
  // On a phone the step action sticks to the bottom only while it is small: when large text or a short screen makes it
  // take more than about a fifth of the screen, it sits in the flow instead, so it never covers a field. It measures the
  // area's content without its sticky padding and edge, which are the same in both places, and it switches back only
  // well below the limit, so typing never makes it jump between the two.
  const actionsRef = useCallback((area: HTMLDivElement | null) => {
    if (!area || typeof ResizeObserver === 'undefined') return;
    let inline = false;
    const measure = () => {
      const style = getComputedStyle(area);
      const content =
        area.getBoundingClientRect().height -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom) -
        parseFloat(style.borderTopWidth) -
        parseFloat(style.borderBottomWidth);
      const share = content / window.innerHeight;
      if (!inline && share > 0.22) inline = true;
      else if (inline && share < 0.18) inline = false;
      area.dataset.inline = inline ? 'true' : 'false';
    };
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // The latest callback, read when the view changes, so a new function from the panel never repeats the first read.
  const shownChange = useRef(onShownChange);
  useEffect(() => {
    shownChange.current = onShownChange;
  });
  const setView = useCallback((next: View) => {
    setViewState(next);
    shownChange.current?.(next !== 'hidden');
  }, []);

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

  // The first read decides whether anything is drawn (firstReadView).
  useEffect(() => {
    let live = true;
    read()
      .then((value) => {
        if (!live) return;
        setOptions(value);
        setView('ready');
      })
      .catch((error) => {
        if (live) setView(firstReadView(error));
      });
    return () => {
      live = false;
    };
  }, [read, setView]);

  // A later read: the switch is known to have been on (laterReadView).
  // New lists from the server: an answer they no longer hold is cleared, so the select, Review and the request agree.
  const applyOptions = useCallback((value: Options) => {
    setOptions(value);
    setDraft((previous) => withoutGone(previous, value));
  }, []);

  const reread = useCallback(
    async (adapter?: AdapterChoice | '') => {
      try {
        const value = await read(adapter);
        applyOptions(value);
        return value;
      } catch (error) {
        setView(laterReadView(error));
        return null;
      }
    },
    [read, setView, applyOptions],
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
  const euUsable = !!options && euUsableIn(options);
  const context: DraftContext = {
    sourceIds: sources.map((s) => s.id),
    fallbackIds: candidates.map((p) => p.id),
    euOffered: euUsable,
  };
  const scope = effectiveScope(draft, context);

  const focusId = (field: FieldName) =>
    field === 'adapter'
      ? id(`adapter-${draft.adapter || adapters[0]}`)
      : field === 'evaluationStatus'
        ? id(`evaluation-${draft.evaluationStatus || evaluationStatuses[0]}`)
        : field === 'codes'
          ? scope === 'countries'
            ? id('find')
            : id(`scope-${scope || 'countries'}`)
          : field === 'tasks'
            ? id('task-group-0')
            : id(field);
  // Any changed answer other than the reason clears the tick: the facts before saving are read again.
  const update = <K extends keyof ConnectDraft>(field: K, value: ConnectDraft[K]) => {
    setDraft((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'reason' || field === 'confirmed' ? {} : { confirmed: false }),
    }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };
  const goTo = (next: number, focus?: string) => {
    setStep(next);
    focusSoon(focus ?? id('question'));
  };
  const restart = () => {
    generation.current += 1;
    pendingAdapter.current = null;
    setChoosing(false);
    setDraft(emptyDraft);
    setPrefilledFor('');
    setPrefilledVersion(null);
    setErrors({});
    setBanner(null);
    setSaved(null);
    setStep(0);
  };
  const close = () => {
    setOpen(false);
    if (saved) restart();
    summaryRef.current?.focus();
  };
  const chooseAdapter = (adapter: AdapterChoice) => {
    // A read for another provider that is still in flight no longer counts.
    pendingAdapter.current = null;
    setChoosing(false);
    update('adapter', adapter);
  };

  async function chooseProvider() {
    if (!draft.adapter || draft.adapter === prefilledFor) return goTo(1);
    const adapter = draft.adapter;
    pendingAdapter.current = adapter;
    setChoosing(true);
    // Only the answer for the provider still chosen counts: a superseded read changes nothing, not even the lists.
    let fresh: Options;
    try {
      fresh = await read(adapter);
    } catch (error) {
      if (pendingAdapter.current !== adapter) return;
      pendingAdapter.current = null;
      setChoosing(false);
      setView(laterReadView(error));
      return;
    }
    if (pendingAdapter.current !== adapter) return;
    pendingAdapter.current = null;
    setChoosing(false);
    applyOptions(fresh);
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
    setPrefilledVersion(row?.version ?? null);
    goTo(1);
  }

  function next() {
    if (choosing) return;
    const found = stepErrors(draft, step, context);
    setErrors(found);
    const first = stepFields[step].find((field) => found[field]);
    if (first) return void focusSoon(focusId(first));
    if (step === 0) return void chooseProvider();
    goTo(step + 1);
  }

  async function refreshAfterSave(adapter: AdapterChoice | '') {
    const started = generation.current;
    let fresh: Options;
    try {
      fresh = await read(adapter);
    } catch {
      // The version is saved; only the lists behind the screen are older. Say so quietly, never that nothing changed.
      if (generation.current === started)
        setSaved((previous) => previous && { ...previous, refreshFailed: true });
      return;
    }
    // A late answer after the person started again belongs to the finished flow: the new flow keeps its own lists.
    if (generation.current === started) setOptions(fresh);
  }

  async function save() {
    if (savingNow.current) return;
    const found = stepErrors(draft, saveStep, context);
    setErrors(found);
    const first = stepFields[saveStep].find((field) => found[field]);
    if (first) return void focusSoon(focusId(first));
    // Any earlier step that no longer passes (a date that has since passed, a source that has gone) opens with its error.
    for (let s = 0; s < saveStep; s++) {
      const earlier = stepErrors(draft, s, context);
      const field = stepFields[s].find((f) => earlier[f]);
      if (field) {
        setErrors(earlier);
        update('confirmed', false);
        return goTo(s, focusId(field));
      }
    }
    const body = buildConnectionRequest(draft, latestVersion, context);
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
      setSaved({ provider, version: result.version, refreshFailed: false });
      focusSoon(id('saved'));
      void refreshAfterSave(draft.adapter);
    } catch (error) {
      await refused(error);
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  async function refused(error: unknown) {
    const code = error instanceof ActionError ? error.code : undefined;
    // Nothing was saved: the person reads the facts again before the next try.
    update('confirmed', false);
    if (code === 'VERSION_CHANGED')
      return setBanner({ text: words.save.versionChanged, action: 'loadLatest' });
    if (code === 'SOURCE_TERMS' || code === 'SOURCE_EVALUATION') {
      const field = code === 'SOURCE_TERMS' ? 'termsSourceId' : 'evaluationSourceId';
      update(field, '');
      await reread(draft.adapter);
      setErrors({ [field]: words.sources.refused });
      setBanner({ text: words.sources.banner });
      return goTo(3, id(field));
    }
    if (code === 'FALLBACK_SELF' || code === 'FALLBACK_NOT_CURRENT') {
      update('fallbackPolicyId', '');
      await reread(draft.adapter);
      setErrors({ fallbackPolicyId: words.fallback[code] });
      return goTo(6, id('fallbackPolicyId'));
    }
    if (code === 'EU_UNAVAILABLE' || code === 'EU_UNUSABLE' || code === 'COUNTRY_LIMIT') {
      // The EU list cannot be used now: the countries path opens, with the countries already chosen kept.
      if (code !== 'COUNTRY_LIMIT') update('scope', 'countries');
      await reread(draft.adapter);
      setErrors({ codes: words.scopeRefused[code] });
      return goTo(2, id('find'));
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
  const check = (
    inputId: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    label: string,
    field?: FieldName,
  ) => (
    <label className="ux-check connect-ai-check">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-invalid={field && errors[field] ? true : undefined}
        aria-describedby={field ? described(field) : undefined}
      />
      <span>{label}</span>
    </label>
  );

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
          onChoose={() => chooseAdapter(adapter)}
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
    // 3 Countries: the approved EU words sit right under the EU choice, and the owner's settings line shows once the EU list
    // is chosen; only the list of countries is folded. Without the EU list the countries path is the only one.
    <div key="countries" className="connect-ai-fields">
      <fieldset className="connect-ai-choices">
        <legend>{words.countries.legend}</legend>
        <p className="connect-ai-helper">{words.countries.helper}</p>
        {euUsable && (
          <>
            <ChoiceChip
              id={id('scope-countries')}
              name={id('scope')}
              value="countries"
              checked={draft.scope === 'countries'}
              onChoose={() => update('scope', 'countries')}
              label={words.countries.oneByOne}
            />
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
              {scope === 'market' && draft.adapter && (
                <p className="connect-ai-helper">{euConsequence(draft.adapter)}</p>
              )}
              <details className="connect-ai-more">
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
          </>
        )}
        {euOffered && !euUsable && <p className="connect-ai-helper">{words.countries.euEmpty}</p>}
      </fieldset>
      {scope === 'countries' ? (
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
    // 7 Tasks, in three closed groups with their counts
    <div key="tasks" className="connect-ai-fields">
      <fieldset className="connect-ai-choices" aria-describedby={described('tasks')}>
        <legend>{words.tasks.legend}</legend>
        <p className="connect-ai-helper">{tasksChosen(draft.tasks.length, taskIds.length)}</p>
        {taskGroups.map((group, index) => (
          <details key={group.name} className="connect-ai-more">
            <summary id={id(`task-group-${index}`)}>
              {groupSummary(
                group.name,
                group.tasks.filter((task) => draft.tasks.includes(task)).length,
                group.tasks.length,
              )}
            </summary>
            {group.tasks.map((task) => (
              <div key={task}>
                {check(
                  id(`task-${task}`),
                  draft.tasks.includes(task),
                  (checked) =>
                    update(
                      'tasks',
                      checked ? [...draft.tasks, task] : draft.tasks.filter((t) => t !== task),
                    ),
                  taskLabels[task],
                )}
              </div>
            ))}
          </details>
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
      scope={scope}
      onChange={(s) => {
        // A changed answer means the facts before saving are read again.
        update('confirmed', false);
        goTo(s);
      }}
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
      {check(
        id('confirmed'),
        draft.confirmed,
        (checked) => update('confirmed', checked),
        words.save.confirm,
        'confirmed',
      )}
      {error('confirmed')}
    </div>,
  ];

  const body = () => {
    if (saved)
      return (
        <div className="connect-ai-fields">
          <div role="status">
            <h3 id={id('saved')} tabIndex={-1} className="connect-ai-question">
              {words.success.heading}
            </h3>
            <p>{savedText(saved.provider, saved.version)}</p>
            {saved.refreshFailed && (
              <p className="connect-ai-helper">{words.success.refreshFailed}</p>
            )}
          </div>
          <div className="connect-ai-end">
            <button type="button" className="primary-link" onClick={close}>
              {words.backToSettings}
            </button>
            <button
              type="button"
              className="text-link connect-ai-link"
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
                .catch((e) => setView(laterReadView(e)));
            }}
          >
            {words.tryAgain}
          </button>
        </div>
      );
    if (view === 'denied' || (options && !options.canManage))
      return (
        <div className="connect-ai-fields">
          <h3 className="connect-ai-question">{words.deniedHeading}</h3>
          <p>{words.denied}</p>
        </div>
      );
    if (!options) return null;
    if (!options.canConnect)
      return (
        <div className="connect-ai-fields">
          <h3 className="connect-ai-question">{words.notAvailable}</h3>
          <p>{options.blockedReason ? words.blocked[options.blockedReason] : null}</p>
          <button type="button" className="text-link connect-ai-link" onClick={close}>
            {words.backToSettings}
          </button>
        </div>
      );
    const showFrom = prefilledVersion !== null && prefilledFor && step >= 1 && step <= 6;
    const waiting = (step === 0 && !draft.adapter) || choosing;
    return (
      <form className="connect-ai-form" aria-label={words.formLabel} onSubmit={submit} noValidate>
        <PlanProgress
          line={progressLine(step)}
          names={stepNames}
          current={step}
          listLabel={words.stepsLabel}
          progressLabel={progressLine(step)}
        />
        <h3 id={id('question')} tabIndex={-1} className="connect-ai-question">
          {stepQuestions[step]}
        </h3>
        {showFrom && <p className="connect-ai-helper">{fromVersion(prefilledVersion)}</p>}
        {banner && (
          <div className="connect-ai-fields">
            <p role="alert" className="connect-ai-banner">
              <CorridraIcon name="alert" />
              <span>{banner.text}</span>
            </p>
            {banner.action === 'loadLatest' && (
              <button
                type="button"
                className="text-link connect-ai-link"
                onClick={() => void loadLatest()}
              >
                {words.save.loadLatest}
              </button>
            )}
            {banner.action === 'retry' && (
              <button
                type="button"
                className="text-link connect-ai-link"
                onClick={() => void save()}
              >
                {words.tryAgain}
              </button>
            )}
          </div>
        )}
        {steps[step]}
        {step > 0 && (
          <button
            type="button"
            className="text-link connect-ai-link connect-ai-back"
            onClick={() => goTo(step - 1)}
          >
            {words.back}
          </button>
        )}
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
            <p role="status" className="connect-ai-helper">
              {saving ? words.save.busyStatus : ''}
            </p>
          </div>
        ) : (
          <div className="connect-ai-actions" ref={actionsRef}>
            <button
              type="submit"
              className="primary-link"
              aria-disabled={waiting || undefined}
              aria-busy={choosing || undefined}
            >
              {step === 0 && !draft.adapter ? words.pickProvider : words.next}
            </button>
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
      <summary ref={summaryRef} data-step={stepNumber}>
        {words.open}
      </summary>
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
  scope,
  onChange,
}: {
  draft: ConnectDraft;
  latestVersion: number;
  sources: SourceRow[];
  candidates: Candidate[];
  euCount: number;
  scope: ConnectDraft['scope'];
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
      scope === 'market'
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
        <details className="connect-ai-plain">
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
              <button
                type="button"
                className="text-link connect-ai-link"
                onClick={() => onChange(s)}
              >
                {changeLabel(stepNames[s])}
              </button>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
