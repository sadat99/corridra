'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { accountClient } from '../../lib/neon-auth-client';
import { accountAccessPath } from '../../lib/account-return';
import { browserStores, forgetReceipt, readReceipt, saveReceipt } from '../../lib/receipt-memory';
import { JourneyBar } from '../../components/journey-bar';
import { objectiveForJob, selectedPicture, pictures } from '../../lib/first-question';
import { FirstQuestion } from '../../components/mr/first-question';
import { rememberVerifyEmail } from '../../components/verify-email-handoff';
import { fill } from '../../lib/i18n/fill';
import { formEn, type FormKey } from '../../lib/i18n/form-words/en';
import { issueSeparator } from '../../lib/i18n/form-words/messages';
import { useFormWords } from './form-words';
import { rememberSentRequest } from '../../lib/private-request-storage';
import { countryOptions, euCountries, pinnedCountries } from '../../lib/ux/options';
import { missionCatalogue } from '@corridra/domain/commercial-missions';
import { countryCodes } from '@corridra/domain/countries';
import { currencies } from '@corridra/domain/currencies';
import { intakeExperience } from '@corridra/domain/experience';
import { originalAmountToMinor } from '@corridra/domain/locale';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  briefSchema,
  realBriefSchema,
  realIntakeSteps,
  intakeSteps,
  objectiveOptions,
  outcomeOptions,
} from '@corridra/domain/missions';
type Draft = {
  companyCountry: string;
  marketCode: string;
  job: string;
  technicalPurpose: string;
  parameters: string;
  quantity: string;
  unit: string;
  preferences: string;
  budgetAmount: string;
  currency: string;
  budgetBasis: string;
  whenNeeded: string;
  worthwhile: string;
  organiser: string;
  participants: string;
  objective: string;
  market: string;
  attendance: string;
  startDate: string;
  endDate: string;
  timezone: string;
  offer: string;
  website: string;
  outcomes: string[];
  notes: string;
  name: string;
  company: string;
  email: string;
  acknowledged: boolean;
};
const empty: Draft = {
  companyCountry: '',
  marketCode: '',
  job: '',
  technicalPurpose: '',
  parameters: '',
  quantity: '',
  unit: '',
  preferences: '',
  budgetAmount: '',
  currency: '',
  budgetBasis: '',
  whenNeeded: '',
  worthwhile: '',
  organiser: '',
  participants: '',
  objective: '',
  market: '',
  attendance: 'Not decided',
  startDate: '',
  endDate: '',
  timezone: 'UTC',
  offer: '',
  website: '',
  outcomes: [],
  notes: '',
  name: '',
  company: '',
  email: '',
  acknowledged: false,
};
const groups = [
  ['objective'],
  ['market', 'attendance', 'startDate', 'endDate', 'timezone'],
  ['offer', 'website'],
  ['outcomes', 'notes'],
  ['name', 'company', 'email', 'acknowledged'],
];
const titles: readonly FormKey[] = [
  'form.step.titleGoal',
  'form.step.titleWhere',
  'form.step.titleDetails',
  'form.step.titleResults',
  'form.step.titleContact',
];
const stepWords: readonly FormKey[] = [
  'form.step.goal',
  'form.step.where',
  'form.step.details',
  'form.step.results',
  'form.step.contact',
];
// The words shown for stored values. The values themselves, and so the request, are the same in every language;
// a new domain option fails the type check here until it has words.
const objectiveWords = {
  'Sell in a new market': 'form.goal.sell',
  'Find customers or distributors': 'form.goal.customers',
  'Source suppliers': 'form.goal.source',
  'Make an upcoming business trip more productive': 'form.goal.trip',
  'Run a multi-company mission': 'form.goal.mission',
  'Something else': 'form.goal.other',
} satisfies Record<(typeof objectiveOptions)[number], FormKey>;
const outcomeWords = {
  'Relevant meetings': 'form.results.meetings',
  'Buyers / customers': 'form.results.buyers',
  'Distributor conversations': 'form.results.distributors',
  'Supplier visits': 'form.results.supplierVisits',
  'Market validation': 'form.results.validation',
  'Local commercial intelligence': 'form.results.intelligence',
  'Something else': 'form.results.other',
} satisfies Record<(typeof outcomeOptions)[number], FormKey>;
const attendanceOptions = ['Yes', 'No', 'Not decided'] as const;
const attendanceWords = {
  Yes: 'form.where.yes',
  No: 'form.where.no',
  'Not decided': 'form.where.undecided',
} satisfies Record<(typeof attendanceOptions)[number], FormKey>;
const jobWord = (key: (typeof missionCatalogue)[number]['key']): FormKey => `form.job.${key}`;
/**
 * Where a problem the structured request reports is shown (CQ-11): next to the field the person typed it in, never
 * under an unrelated optional field. A problem without its own field stays on the shared requirements line.
 */
const requirementField: Record<string, keyof Draft> = {
  product: 'offer',
  specifications: 'parameters',
  quantity: 'quantity',
  unit: 'unit',
  technicalConstraints: 'preferences',
  budgetMinor: 'budgetAmount',
  currency: 'currency',
  budgetBasis: 'budgetBasis',
  travelDates: 'whenNeeded',
  decisionCriteria: 'worthwhile',
  machinery: 'technicalPurpose',
};
function issueField(path: readonly PropertyKey[], message: string): string {
  if (path[0] === 'organiser' || path[0] === 'participants') return String(path[0]);
  if (path[0] !== 'requirements') return 'requirements';
  if (path.length === 1)
    return message.startsWith('Quantity needs')
      ? 'unit'
      : message.startsWith('Budget needs')
        ? 'budgetAmount'
        : 'requirements';
  return requirementField[String(path[1])] ?? 'requirements';
}
// The step each field is asked on, so a final check that finds a problem opens the step where it can be fixed.
const fieldStep: Record<string, number> = {
  objective: 0,
  job: 0,
  companyCountry: 1,
  marketCode: 1,
  market: 1,
  whenNeeded: 1,
  attendance: 1,
  startDate: 1,
  endDate: 1,
  timezone: 1,
  offer: 2,
  website: 2,
  technicalPurpose: 2,
  parameters: 2,
  quantity: 2,
  unit: 2,
  preferences: 2,
  budgetAmount: 2,
  currency: 2,
  budgetBasis: 2,
  organiser: 2,
  participants: 2,
  requirements: 2,
  worthwhile: 3,
  outcomes: 3,
  notes: 3,
};
const budgetFields = ['budgetAmount', 'currency', 'budgetBasis'];
/** The choices a link can make (`?job`, `?companyCountry` and `?marketCode`), applied to a draft. */
function withLinkChoices(base: Draft): Draft {
  const query = new URLSearchParams(window.location.search);
  const next = { ...base };
  const job = query.get('job');
  if (job && missionCatalogue.some((t) => t.key === job)) {
    next.job = job;
    next.objective = objectiveForJob(job);
  }
  const companyCountry = query.get('companyCountry'),
    marketCode = query.get('marketCode');
  if (
    companyCountry &&
    countryCodes.includes(companyCountry as (typeof countryCodes)[number]) &&
    marketCode &&
    (marketCode === 'EU' || countryCodes.includes(marketCode as (typeof countryCodes)[number]))
  ) {
    next.companyCountry = companyCountry;
    next.marketCode = marketCode;
    next.market =
      marketCode === 'EU'
        ? 'European Union'
        : (new Intl.DisplayNames(['en'], { type: 'region' }).of(marketCode) ?? marketCode);
  }
  return next;
}
// The receipt's sentences on who can read it and how long it lasts stay English (Lane 11).
const receiptReaders = 'Anyone with this code can read the mission status and replies.';
const receiptExpiry = 'It expires after 30 days.';
/**
 * The direction of a field's text when the form is translated: addresses, the timezone and amounts read left to
 * right, typed text keeps the direction it is written in, and dates keep the browser's own.
 */
function inputDirection(name: string, type: string) {
  if (type === 'date') return undefined;
  if (type === 'email' || type === 'url' || name === 'timezone' || name === 'budgetAmount')
    return 'ltr';
  return 'auto';
}
function saveDraft(draft: Draft, step: number, key: string, storageKey: string) {
  sessionStorage.setItem(
    storageKey,
    JSON.stringify({ version: 2, draft, step, key, at: Date.now() }),
  );
}
export type PrivateIntakeSubmission = {
  draftStorageKey: string;
  submit: (commandId: string, brief: unknown) => Promise<void>;
};
async function claimSavedRequest(storageKey: string, navigate: (path: string) => void) {
  const response = await fetch('/api/intake/pending/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? formEn['form.message.claimFailed']);
  if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id))
    throw new Error(formEn['form.message.claimUnreadable']);
  try {
    sessionStorage.removeItem(storageKey);
    // The account request page can say "Request sent" for this id once (CQ-58).
    rememberSentRequest(sessionStorage, body.id);
  } catch {
    /* Navigation still works when tab storage is blocked. */
  }
  navigate('/account/requests/' + encodeURIComponent(body.id));
}
type IntakeProps = {
  privateSubmission?: PrivateIntakeSubmission;
  realMode?: boolean;
  /** From CORRIDRA_CUSTOMER_CODE_SIGNIN on the server. Adds a code sign-in link where a request lives in an account. */
  codeSignIn?: boolean;
  /** From CORRIDRA_UX_FIRSTQ on the server. The first question is five pictures; every job type stays selectable. Off is the page as it was. */
  firstQuestion?: boolean;
};
export function Intake(props: IntakeProps = {}) {
  return props.realMode && !props.privateSubmission ? (
    <RegisteredIntake {...props} />
  ) : (
    <IntakeForm {...props} />
  );
}
function RegisteredIntake(props: IntakeProps) {
  const router = useRouter();
  return <IntakeForm {...props} navigate={router.replace} />;
}
function missingNavigation() {
  throw new Error(formEn['form.message.navigationMissing']);
}
function IntakeForm({
  privateSubmission,
  realMode = false,
  codeSignIn = false,
  firstQuestion = false,
  navigate = missingNavigation,
}: IntakeProps & { navigate?: (path: string) => void }) {
  const privateMode = privateSubmission !== undefined;
  const {
    translated,
    tag,
    dir,
    say,
    sayWith,
    english,
    englishIsland,
    withEnglish,
    showMessage,
    englishProps,
    wsa,
  } = useFormWords();
  const draftStorageKey =
    privateSubmission?.draftStorageKey ??
    (realMode ? 'corridra-real-mission-draft' : 'corridra-mission-draft');
  const [password, setPassword] = useState('');
  const [account, setAccount] = useState<{ email: string; emailVerified: boolean } | null>(null);
  const [accountChecked, setAccountChecked] = useState(!realMode || privateMode);
  const [pendingReady, setPendingReady] = useState(false);
  const [intakeAvailable, setIntakeAvailable] = useState(true);
  const [draft, setDraft] = useState<Draft>(empty),
    [step, setStep] = useState(0),
    [errors, setErrors] = useState<Record<string, string[]>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [receipt, setReceipt] = useState(''),
    [checkCode, setCheckCode] = useState(''),
    [result, setResult] = useState<{
      status: string;
      replies: { body: string; createdAt: string }[];
    } | null>(null),
    [finished, setFinished] = useState(false),
    [deviceSaved, setDeviceSaved] = useState(false),
    [forgotten, setForgotten] = useState(false),
    [ready, setReady] = useState(false),
    [draftNotice, setDraftNotice] = useState(''),
    // A link asked for another job than the saved draft has (CQ-14): the person chooses which to keep.
    [jobChoice, setJobChoice] = useState(''),
    [checkEmpty, setCheckEmpty] = useState(false);
  const key = useRef(''),
    submitted = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    errorSummary = useRef<HTMLDivElement>(null),
    // The error summary takes focus once, when a check finds problems; typing in a field never moves focus.
    focusSummary = useRef(false);
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        let restored = false;
        let saved;
        try {
          saved = JSON.parse(sessionStorage.getItem(draftStorageKey) ?? 'null');
        } catch {
          setDraftNotice(
            realMode
              ? formEn['form.message.draftLostReal']
              : formEn['form.message.draftLostSample'],
          );
        }
        if (
          saved &&
          Date.now() - saved.at < 86400000 &&
          typeof saved.key === 'string' &&
          typeof saved.draft?.offer === 'string' &&
          Array.isArray(saved.draft.outcomes)
        ) {
          restored = true;
          setDraftNotice(formEn['form.message.draftResumed']);
          key.current = saved.key;
          setDraft({ ...empty, ...saved.draft });
          setStep(saved.version === 2 ? Math.max(0, Math.min(4, Number(saved.step) || 0)) : 0);
        }
        if (saved && !restored)
          setDraftNotice(`${formEn['form.message.draftNotResumed']} Drafts expire after 24 hours.`);
        const query = new URLSearchParams(window.location.search);
        const suggestedJob = query.get('job');
        if (
          restored &&
          suggestedJob &&
          missionCatalogue.some((t) => t.key === suggestedJob) &&
          saved.draft.job !== suggestedJob
        )
          setJobChoice(suggestedJob);
        if (!restored && suggestedJob && missionCatalogue.some((t) => t.key === suggestedJob))
          setDraft((current) => ({
            ...current,
            job: suggestedJob,
            objective: objectiveForJob(suggestedJob),
          }));
        const companyCountry = query.get('companyCountry'),
          marketCode = query.get('marketCode');
        if (
          !restored &&
          companyCountry &&
          countryCodes.includes(companyCountry as (typeof countryCodes)[number]) &&
          marketCode &&
          (marketCode === 'EU' ||
            countryCodes.includes(marketCode as (typeof countryCodes)[number]))
        ) {
          setDraft((current) => ({
            ...current,
            companyCountry,
            marketCode,
            market:
              marketCode === 'EU'
                ? 'European Union'
                : (new Intl.DisplayNames(['en'], { type: 'region' }).of(marketCode) ?? marketCode),
          }));
        }
        const remembered = privateMode || realMode ? null : readReceipt(browserStores());
        if (remembered) {
          setReceipt(remembered.receipt);
          setCheckCode(remembered.receipt);
          setDeviceSaved(remembered.place === 'device');
          setFinished(true);
          submitted.current = true;
        }
      } catch {
        setDraftNotice(
          realMode ? formEn['form.message.draftLostReal'] : formEn['form.message.draftLostSample'],
        );
      } finally {
        setReady(true);
      }
    });
  }, [draftStorageKey, privateMode, realMode]);
  useEffect(() => {
    if (!realMode || privateMode) return;
    let active = true;
    const controller = new AbortController();
    Promise.all([
      accountClient.getSession(),
      fetch('/api/intake/pending', { cache: 'no-store', signal: controller.signal }),
    ])
      .then(async ([identity, response]) => {
        if (!active) return;
        if (identity.error) throw new Error(formEn['form.message.accountUnchecked']);
        if (!response.ok) throw new Error(formEn['form.message.pendingUnchecked']);
        const user = identity.data?.user;
        setAccount(user ? { email: user.email, emailVerified: user.emailVerified } : null);
        if (user)
          setDraft((previous) => ({
            ...previous,
            email: previous.email || user.email,
            name: previous.name || user.name || '',
          }));
        const pending = await response.json();
        if (!active) return;
        setPendingReady(pending.pending === true);
        setIntakeAvailable(pending.available !== false);
        if (pending.available === false) setMessage(formEn['form.message.paused']);
        if (pending.pending === true && user?.emailVerified) {
          setMessage(formEn['form.message.opening']);
          await claimSavedRequest(draftStorageKey, navigate);
        }
      })
      .catch((error) => {
        if (active)
          setMessage(error instanceof Error ? error.message : formEn['form.message.accountFailed']);
      })
      .finally(() => {
        if (active) setAccountChecked(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [realMode, privateMode, draftStorageKey, navigate]);
  useEffect(() => {
    if (!focusSummary.current) return;
    focusSummary.current = false;
    if (Object.values(errors).some((messages) => messages.length)) errorSummary.current?.focus();
  }, [errors]);
  function persist(v: Draft, n: number) {
    if (!key.current) key.current = crypto.randomUUID();
    try {
      saveDraft(v, n, key.current, draftStorageKey);
    } catch {
      setDraftNotice(
        realMode
          ? formEn['form.message.draftUnsavedReal']
          : formEn['form.message.draftUnsavedSample'],
      );
    }
  }
  function change(field: keyof Draft, value: string | boolean | string[], openJob = false) {
    const v = { ...draft, [field]: value };
    if (field === 'job' && value) v.objective = objectiveForJob(String(value));
    if (field === 'objective')
      v.job = openJob
        ? ''
        : (
            {
              'Sell in a new market': 'buyers',
              'Find customers or distributors': 'distributors',
              'Source suppliers': 'sourcing',
              'Make an upcoming business trip more productive': 'business_trips',
              'Run a multi-company mission': 'delegations',
              'Something else': 'market_validation',
            } as Record<string, string>
          )[String(value)];
    if (v.job !== draft.job)
      for (const k of [
        'technicalPurpose',
        'parameters',
        'quantity',
        'unit',
        'preferences',
        'budgetAmount',
        'currency',
        'budgetBasis',
        'organiser',
        'participants',
      ] as const)
        v[k] = '';
    if (field === 'marketCode')
      v.market =
        String(value) === 'EU'
          ? 'European Union'
          : (new Intl.DisplayNames(['en'], { type: 'region' }).of(String(value)) ?? String(value));

    if (field === 'attendance' && value !== 'Yes') {
      v.startDate = '';
      v.endDate = '';
    }
    setDraft(v);
    persist(v, step);
    setErrors((e) => (e[field]?.length ? { ...e, [field]: [] } : e));
  }
  function canonicalDraft() {
    const {
      objective,
      market,
      attendance,
      startDate,
      endDate,
      timezone,
      offer,
      website,
      outcomes,
      notes,
      name,
      company,
      email,
      acknowledged,
    } = draft;
    return {
      objective,
      market,
      attendance,
      startDate,
      endDate,
      timezone,
      offer,
      website,
      outcomes,
      notes,
      name,
      company,
      email,
      acknowledged,
      experience: experience(),
    };
  }
  function validate(fields: string[]) {
    const p = (
      fields.length === groups.flat().length
        ? realMode
          ? realBriefSchema
          : briefSchema
        : (realMode ? realIntakeSteps : intakeSteps)[step]
    ).safeParse(fields.length === groups.flat().length && realMode ? canonicalDraft() : draft);
    const next: Record<string, string[]> = {};
    if (!p.success)
      for (const e of p.error.issues) {
        const f = String(e.path[0]);
        if (fields.includes(f)) next[f] = [e.message];
      }
    if (step === 0 || fields.length === groups.flat().length) {
      if (!draft.job) next.job = [formEn['form.message.chooseJob']];
    }
    if (step === 1 || fields.length === groups.flat().length) {
      if (!countryCodes.includes(draft.companyCountry as (typeof countryCodes)[number]))
        next.companyCountry = [formEn['form.message.chooseCountry']];
      if (
        draft.marketCode !== 'EU' &&
        !countryCodes.includes(draft.marketCode as (typeof countryCodes)[number])
      )
        next.marketCode = [formEn['form.message.chooseMarket']];
    }
    const all = fields.length === groups.flat().length;
    if (step >= 2 || all) {
      // The structured request is checked on the details step and after it; each problem is shown on its field.
      const shown = (field: string) => all || fieldStep[field] === step;
      let structured;
      try {
        structured = intakeExperience.safeParse(experience());
      } catch (err) {
        if (shown('budgetAmount'))
          next.budgetAmount = [
            err instanceof Error ? err.message : formEn['form.message.checkAmount'],
          ];
      }
      if (structured && !structured.success) {
        const shared: string[] = [];
        for (const issue of structured.error.issues) {
          const target = issueField(issue.path, issue.message);
          if (!shown(target)) continue;
          if (target === 'requirements') shared.push(issue.message);
          else if (!next[target]) next[target] = [issue.message];
        }
        if (shared.length) next.requirements = [shared.join(issueSeparator)];
      }
    }
    focusSummary.current = Object.keys(next).length > 0;
    setErrors(next);
    if (all && Object.keys(next).length) {
      // Open the first step that has a problem, so the person sees the field to fix.
      const first = Math.min(...Object.keys(next).map((f) => fieldStep[f] ?? 4));
      if (first !== step) {
        setStep(first);
        persist(draft, first);
      }
    }
    return Object.keys(next).length === 0;
  }
  function move(n: number) {
    setStep(n);
    setErrors({});
    persist(draft, n);
    queueMicrotask(() => heading.current?.focus());
  }
  function experience() {
    const sourcing = ['sourcing', 'supplier_evaluation', 'factory_visits'].includes(draft.job);
    const machinery = draft.job === 'machinery_procurement';
    const optional = (value: string) => value.trim() || undefined;
    return {
      schemaVersion: 1,
      companyCountry: draft.companyCountry,
      marketCode: draft.marketCode,
      job: draft.job,
      requirements: {
        objective: missionCatalogue.find((t) => t.key === draft.job)?.label ?? draft.objective,
        role:
          draft.job === 'delegations'
            ? 'INSTITUTION'
            : machinery
              ? 'BUYER'
              : sourcing
                ? 'IMPORTER'
                : 'EXPORTER',
        product: draft.offer,
        specifications: optional(draft.parameters),
        quantity: optional(draft.quantity),
        unit: optional(draft.unit),
        technicalConstraints: optional(draft.preferences),
        budgetMinor: optional(draft.budgetAmount)
          ? originalAmountToMinor(draft.budgetAmount, draft.currency)
          : undefined,
        currency: optional(draft.currency),
        budgetBasis: optional(draft.budgetBasis),
        travelDates: optional(draft.whenNeeded),
        decisionCriteria: optional(draft.worthwhile) ? [draft.worthwhile] : undefined,
        machinery:
          machinery && optional(draft.technicalPurpose)
            ? { application: draft.technicalPurpose }
            : undefined,
      },
      organiser: draft.job === 'delegations' ? optional(draft.organiser) : undefined,
      participants: draft.job === 'delegations' ? optional(draft.participants) : undefined,
    };
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || submitted.current) return;
    if (step < 4) {
      if (validate(groups[step])) move(step + 1);
      return;
    }
    if (!validate(groups.flat())) return;
    setBusy(true);
    setMessage('');
    persist(draft, step);
    try {
      if (realMode && !privateSubmission) {
        if (!intakeAvailable) throw new Error(formEn['form.message.pausedSubmit']);
        if (!accountChecked) throw new Error(formEn['form.message.accountLoading']);
        if (account && draft.email.trim().toLowerCase() !== account.email.trim().toLowerCase())
          throw new Error(formEn['form.message.emailMismatch']);
        if (!account && password.length < 14) throw new Error(formEn['form.message.passwordShort']);
        const response = await fetch('/api/intake/pending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: key.current,
            brief: realBriefSchema.parse(canonicalDraft()),
          }),
        });
        const saved = await response.json();
        if (!response.ok) throw new Error(saved.error ?? formEn['form.message.notSaved']);
        setPendingReady(true);
        submitted.current = true;
        if (account?.emailVerified) {
          await claimSavedRequest(draftStorageKey, navigate);
          return;
        }
        if (!account) {
          try {
            const result = await accountClient.signUp.email({
              name: draft.name,
              email: draft.email,
              password,
            });
            if (result.error)
              throw new Error(
                `Your request is saved for 24 hours. ${formEn['form.message.accountNotCreated']}`,
              );
            rememberVerifyEmail(draft.email);
          } finally {
            setPassword('');
          }
        }
        navigate(accountAccessPath('/verify-email', '/plan'));
        return;
      }
      if (privateSubmission) {
        await privateSubmission.submit(
          key.current,
          (realMode ? realBriefSchema : briefSchema).parse(
            realMode ? canonicalDraft() : { ...draft, experience: experience() },
          ),
        );
        submitted.current = true;
        return;
      }
      const r = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key.current,
          brief: briefSchema.parse({ ...draft, experience: experience() }),
          websiteCheck: '',
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErrors(data.fields ?? {});
        throw new Error(data.error);
      }
      submitted.current = true;
      setFinished(true);
      setMessage(
        data.duplicate
          ? formEn['form.message.duplicate']
          : `${formEn['form.message.recorded']} No real customer mission has been accepted.`,
      );
      if (data.receipt) {
        setReceipt(data.receipt);
        setCheckCode(data.receipt);
        const place = saveReceipt(browserStores(), data.receipt);
        setDeviceSaved(place === 'device');
        try {
          sessionStorage.removeItem('corridra-mission-draft');
        } catch {
          /* The draft only expires sooner when tab storage is blocked. */
        }
        if (place === 'none') setDraftNotice(formEn['form.message.receiptUnsaved']);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : formEn['form.message.unableToSave']);
    } finally {
      setBusy(false);
    }
  }
  async function copyReceipt() {
    try {
      await navigator.clipboard.writeText(receipt);
      setMessage(formEn['form.message.copied']);
    } catch {
      setMessage(formEn['form.message.copyFailed']);
    }
  }
  async function check(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!checkCode.trim()) {
      setCheckEmpty(true);
      return;
    }
    setResult(null);
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/intake/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt: checkCode }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : formEn['form.message.unableToCheck']);
    } finally {
      setBusy(false);
    }
  }
  const field = (name: keyof Draft, label: string, type = 'text', autoComplete?: string) => (
    <div className="field" key={name}>
      <label htmlFor={`brief-${name}`}>{label}</label>
      <input
        id={`brief-${name}`}
        type={type}
        autoComplete={autoComplete}
        dir={translated ? inputDirection(name, type) : undefined}
        value={String(draft[name])}
        onChange={(e) => change(name, e.target.value)}
        aria-invalid={!!errors[name]?.length}
        aria-describedby={errors[name]?.length ? `${name}-error` : undefined}
      />
      {!!errors[name]?.length && (
        <span id={`${name}-error`} className="field-error">
          {showMessage(errors[name][0])}
        </span>
      )}
    </div>
  );
  const error = (name: string) =>
    errors[name]?.length ? (
      <p role="alert" className="field-error" id={`${name}-error`}>
        {showMessage(errors[name][0])}
      </p>
    ) : null;
  const regionNames = new Intl.DisplayNames([tag], { type: 'region' });
  const chosenJob = missionCatalogue.find((item) => item.key === draft.job);
  // Countries by name in the shown language (CQ-15): the three route countries first, then the EU, then the rest.
  const countries = countryOptions(tag);
  const countryGroups = [
    { label: wsa('wsa.plan.countries.pinned'), codes: [...pinnedCountries] as string[] },
    {
      label: wsa('wsa.plan.countries.eu'),
      codes: countries.filter((c) => c.hint === 'EU').map((c) => c.value),
    },
    {
      label: wsa('wsa.plan.countries.other'),
      codes: countries
        .filter(
          (c) =>
            !(pinnedCountries as readonly string[]).includes(c.value) &&
            !(euCountries as readonly string[]).includes(c.value),
        )
        .map((c) => c.value),
    },
  ];
  const countryChoices = countryGroups.map((group) => (
    <optgroup key={group.label} label={group.label}>
      {group.codes.map((code) => (
        <option key={code} value={code}>
          {countries.find((c) => c.value === code)?.label ?? regionNames.of(code)}
        </option>
      ))}
    </optgroup>
  ));
  const delegation = draft.job === 'delegations';
  const budgetOpen = budgetFields.some((name) => errors[name]?.length);
  return (
    // Without real use (a preview or local copy) everything entered here is made up, and the page says so.
    <div className="ux-intake-layout" data-madeup-panel={realMode ? undefined : ''}>
      <div className="guide-plan-top">
        {realMode ? (
          <aside className="intake-notice">
            <span className="guide-pill">{say('form.notice.realPill')}</span>
            <p>
              <strong>{say('form.notice.realLead')}</strong>
              {englishIsland(
                ' At the final step, create an account or sign in to keep your request and replies private.',
              )}{' '}
              {englishIsland(
                <>
                  <Link href="/privacy">Read the privacy and request notice</Link>.
                </>,
              )}
            </p>
            {translated && <p>{say('form.notice.englishParts')}</p>}
          </aside>
        ) : (
          <aside className="intake-notice">
            <span className="guide-pill">{say('form.notice.samplePill')}</span>
            <p>
              <strong>{say('form.notice.sampleLead')}</strong>{' '}
              {sayWith('form.notice.sampleUse', { domain: english('@example.invalid') })}{' '}
              {privateMode
                ? 'Sample requests stay private to this account. '
                : `${say('form.notice.sampleReceipt')} `}
              {say('form.notice.sampleEmail')}{' '}
              {englishIsland(
                <>
                  <Link href="/privacy">Read the test intake notice</Link>.
                </>,
              )}
            </p>
            {translated && <p>{say('form.notice.englishParts')}</p>}
          </aside>
        )}
        <details lang="bn" className="guide-bn" dir={dir === 'rtl' ? 'ltr' : undefined}>
          <summary>বাংলায় সংক্ষিপ্ত নির্দেশনা</summary>
          <p>
            আপনি কী অর্জন করতে চান, প্রতিষ্ঠান কোন দেশে এবং কোন বাজারে কাজ করতে চান তা জানান। পণ্য,
            যন্ত্রপাতির প্রয়োজন, সময় এবং প্রত্যাশিত ফল সংক্ষেপে লিখুন। প্রতিটি প্রতিষ্ঠানের কাজ ও
            গোপন তথ্য আলাদা রাখা হয়।
          </p>
          <p>
            {realMode
              ? 'শেষ ধাপে আপনার যোগাযোগের তথ্য দিন এবং অ্যাকাউন্ট তৈরি করুন বা সাইন ইন করুন। ইমেইল যাচাই করার পরে আপনার ব্যক্তিগত অ্যাকাউন্টে অনুরোধ এবং উত্তর দেখতে পারবেন। এখন নথি আপলোড করতে হবে না।'
              : 'শুধু কাল্পনিক পরীক্ষামূলক তথ্য এবং @example.invalid ঠিকানা ব্যবহার করুন। প্রকৃত গ্রাহকের কাজ এখানে গ্রহণ করা হচ্ছে না। নথি এখন আপলোড করতে হবে না।'}
          </p>
        </details>
        <p role="status" aria-live="polite" className="guide-status" hidden={!message}>
          {showMessage(message)}
        </p>
        {draftNotice && (
          <p className="ux-draft-notice" aria-live="polite">
            {showMessage(draftNotice)}
          </p>
        )}
      </div>
      <div className="guide-plan-body">
        <div className="guide-plan-main">
          {realMode && pendingReady && (
            <section className="receipt-saved" aria-labelledby="pending-request-title">
              <h2 id="pending-request-title">{say('form.pending.title')}</h2>
              {translated ? (
                <p>
                  {say('form.pending.sameDevice')}
                  {englishIsland(
                    'Your request is saved privately for 24 hours while you activate your account and sign in.',
                  )}
                </p>
              ) : (
                <p>
                  Your request is saved privately for 24 hours while you activate your account and
                  sign in. Use this same device and browser. It is submitted to Corridra after that
                  step.
                </p>
              )}
              <div className="guide-actions">
                {account?.emailVerified ? (
                  <button
                    className="primary-link"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await claimSavedRequest(draftStorageKey, navigate);
                      } catch (error) {
                        setMessage(
                          error instanceof Error
                            ? error.message
                            : formEn['form.message.openFailed'],
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {say('form.pending.open')}
                  </button>
                ) : (
                  <Link
                    className="primary-link"
                    href={accountAccessPath(account ? '/verify-email' : '/signin', '/plan')}
                  >
                    {account ? say('form.pending.activate') : say('form.pending.signIn')}
                  </Link>
                )}
                {!account && (
                  <Link className="text-link" href={accountAccessPath('/signup', '/plan')}>
                    {say('form.pending.create')}
                  </Link>
                )}
                {!account && codeSignIn && (
                  <Link className="text-link" href={accountAccessPath('/signin', '/plan', 'code')}>
                    {say('form.pending.codeSignIn')}
                  </Link>
                )}
                <button
                  className="button-secondary"
                  onClick={() => {
                    key.current = crypto.randomUUID();
                    submitted.current = false;
                    setPendingReady(false);
                    setPassword('');
                    setMessage('');
                    persist(draft, step);
                  }}
                >
                  {say('form.pending.return')}
                </button>
              </div>
            </section>
          )}
          {jobChoice && !finished && !pendingReady && (
            <section className="ux-job-choice" role="group" aria-labelledby="job-choice-text">
              <p id="job-choice-text">
                {fill(wsa('wsa.plan.jobChoice'), {
                  job: say(jobWord(jobChoice as (typeof missionCatalogue)[number]['key'])),
                })}
              </p>
              <div className="guide-actions">
                <button type="button" className="button-secondary" onClick={() => setJobChoice('')}>
                  {wsa('wsa.plan.jobChoice.continue')}
                </button>
                <button
                  type="button"
                  className="primary-link"
                  onClick={() => {
                    const fresh = withLinkChoices(empty);
                    key.current = crypto.randomUUID();
                    setDraft(fresh);
                    setDraftNotice('');
                    setJobChoice('');
                    setErrors({});
                    setStep(0);
                    persist(fresh, 0);
                    queueMicrotask(() => heading.current?.focus());
                  }}
                >
                  {wsa('wsa.plan.jobChoice.start')}
                </button>
              </div>
            </section>
          )}
          {!finished && !pendingReady && (
            <form className="intake-form" onSubmit={submit} noValidate inert={!ready || busy}>
              <p className="label">
                {sayWith('form.step.counter', { step: step + 1, total: String(groups.length) })}
              </p>
              <JourneyBar
                steps={stepWords.map((word) => say(word))}
                current={step}
                label={say('form.step.journey')}
              />
              <progress
                className="sr-only"
                value={step + 1}
                max={5}
                aria-label={say('form.step.progress')}
              />
              <h2 ref={heading} tabIndex={-1}>
                {say(titles[step])}
              </h2>
              {Object.values(errors).some((messages) => messages.length) && (
                <div ref={errorSummary} className="ux-error-summary" tabIndex={-1} role="alert">
                  <strong>{say('form.summary.title')}</strong>
                  <p>{say('form.summary.body')}</p>
                </div>
              )}
              {step === 0 && (
                <fieldset>
                  <legend className="sr-only">{say('form.goal.legend')}</legend>
                  {firstQuestion ? (
                    <FirstQuestion
                      value={selectedPicture(draft.objective, draft.job)}
                      onChoose={(key) => {
                        const picture = pictures.find((item) => item.key === key);
                        if (picture?.defaultJob) change('job', picture.defaultJob);
                        // "Something else" has no default job: the person picks one from the list. The
                        // older objective handler would fill in "Validate a market", so it is not used.
                        else if (selectedPicture(draft.objective, draft.job) !== key)
                          change('objective', 'Something else', true);
                      }}
                    />
                  ) : (
                    <div className="guide-options">
                      {objectiveOptions.map((v) => (
                        <label className="choice" key={v}>
                          <input
                            type="radio"
                            name="objective"
                            value={v}
                            checked={draft.objective === v}
                            onChange={() => change('objective', v)}
                          />
                          {say(objectiveWords[v])}
                        </label>
                      ))}
                    </div>
                  )}
                  {error('objective')}
                  <label className="field guide-more">
                    {say('form.goal.job')}
                    <select
                      value={draft.job}
                      onChange={(e) => change('job', e.target.value)}
                      required
                      aria-describedby="job-hint"
                    >
                      <option value="">{say('form.goal.choose')}</option>
                      {missionCatalogue.map((job) => (
                        <option key={job.key} value={job.key}>
                          {say(jobWord(job.key))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p id="job-hint" className="guide-hint">
                    {say('form.goal.hint')}
                  </p>
                  {error('job')}
                </fieldset>
              )}
              {step === 1 && (
                <>
                  <label className="field">
                    {say('form.where.company')}
                    <select
                      value={draft.companyCountry}
                      onChange={(e) => change('companyCountry', e.target.value)}
                      required
                    >
                      <option value="">{say('form.where.chooseCountry')}</option>
                      {countryChoices}
                    </select>
                  </label>
                  {error('companyCountry')}
                  <label className="field">
                    {say('form.where.market')}
                    <select
                      value={draft.marketCode}
                      onChange={(e) => change('marketCode', e.target.value)}
                      required
                    >
                      <option value="">{say('form.where.chooseMarket')}</option>
                      <option value="EU">{say('form.where.eu')}</option>
                      {countryChoices}
                    </select>
                  </label>
                  {error('marketCode')}
                  <p className="guide-hint">
                    {say('form.where.hint')}{' '}
                    {draft.companyCountry &&
                      draft.marketCode &&
                      !(
                        draft.companyCountry === 'BD' &&
                        ['CN', 'ES', 'EU'].includes(draft.marketCode)
                      ) &&
                      (realMode ? say('form.where.realOther') : say('form.where.sampleOther'))}
                  </p>
                  {field('whenNeeded', say('form.where.when'), 'date')}
                  <fieldset>
                    <legend>{say('form.where.attendance')}</legend>
                    <div className="guide-options guide-options-row">
                      {attendanceOptions.map((v) => (
                        <label className="choice" key={v}>
                          <input
                            type="radio"
                            name="attendance"
                            checked={draft.attendance === v}
                            onChange={() => change('attendance', v)}
                          />
                          {say(attendanceWords[v])}
                        </label>
                      ))}
                    </div>
                    {error('attendance')}
                  </fieldset>
                  {draft.attendance === 'Yes' && (
                    <>
                      <div className="guide-pair">
                        {field('startDate', say('form.where.from'), 'date')}
                        {field('endDate', say('form.where.to'), 'date')}
                      </div>
                      {field('timezone', say('form.where.timezone'))}
                    </>
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <label className="field">
                    {delegation ? wsa('wsa.plan.trip.offer') : say('form.details.offer')}
                    <textarea
                      rows={6}
                      dir={translated ? 'auto' : undefined}
                      maxLength={1000}
                      value={draft.offer}
                      onChange={(e) => change('offer', e.target.value)}
                      placeholder={
                        delegation
                          ? wsa('wsa.plan.trip.offerExample')
                          : say('form.details.offerExample')
                      }
                      aria-invalid={!!errors.offer?.length}
                      aria-describedby={
                        errors.offer?.length ? 'offer-hint offer-error' : 'offer-hint'
                      }
                    />
                    {error('offer')}
                  </label>
                  <p id="offer-hint">
                    {delegation ? wsa('wsa.plan.trip.offerHint') : say('form.details.offerHint')}
                  </p>
                  {draft.job === 'machinery_procurement' && (
                    <>
                      {field('technicalPurpose', say('form.details.technicalPurpose'))}
                      {field('parameters', say('form.details.technicalParameters'))}
                      {field('preferences', say('form.details.siteConstraints'))}
                    </>
                  )}
                  {['sourcing', 'supplier_evaluation', 'factory_visits'].includes(draft.job) && (
                    <>
                      {field('parameters', say('form.details.specifications'))}
                      {field('quantity', say('form.details.quantity'))}
                      {field('unit', say('form.details.unit'))}
                      {field('preferences', say('form.details.supplierPreferences'))}
                    </>
                  )}
                  {[
                    'buyers',
                    'distributors',
                    'customers',
                    'market_entry',
                    'export_market_access',
                  ].includes(draft.job) && (
                    <>
                      {field('parameters', say('form.details.targetBuyer'))}
                      {field('preferences', say('form.details.readiness'))}
                    </>
                  )}
                  {draft.job === 'delegations' && (
                    <>
                      {field('organiser', say('form.details.organiser'))}
                      {field('participants', say('form.details.participants'))}
                      <p className="guide-hint">
                        {withEnglish(
                          'form.details.delegationHint',
                          'Private offers and contacts are not shared with the organiser automatically.',
                        )}
                      </p>
                    </>
                  )}
                  {['sourcing', 'machinery_procurement'].includes(draft.job) && (
                    <details open={budgetOpen || undefined}>
                      <summary>{say('form.budget.summary')}</summary>
                      {field('budgetAmount', say('form.budget.amount'))}
                      <label className="field">
                        {say('form.budget.currency')}
                        <select
                          value={draft.currency}
                          onChange={(e) => change('currency', e.target.value)}
                          aria-invalid={!!errors.currency?.length}
                          aria-describedby={errors.currency?.length ? 'currency-error' : undefined}
                        >
                          <option value="">{say('form.budget.none')}</option>
                          {Object.entries(currencies).map(([code, places]) => (
                            <option value={code} key={code}>
                              {fill(say('form.budget.option'), { code, places })}
                            </option>
                          ))}
                        </select>
                      </label>
                      {error('currency')}
                      {field('budgetBasis', say('form.budget.basis'))}
                      <p className="guide-hint">
                        {sayWith('form.budget.hint', {
                          cny: english('CNY 12.00'),
                          bhd: english('BHD 1.234'),
                        })}
                      </p>
                    </details>
                  )}
                  {error('requirements')}
                  {field('website', say('form.details.website'), 'url')}
                  <p className="guide-hint">{say('form.details.websiteHint')}</p>
                </>
              )}
              {step === 3 && (
                <>
                  {field('worthwhile', say('form.results.worthwhile'))}
                  <fieldset
                    aria-describedby={
                      errors.outcomes?.length ? 'outcomes-hint outcomes-error' : 'outcomes-hint'
                    }
                  >
                    <legend>
                      {say('form.results.legend')}{' '}
                      <span className="ux-required">({wsa('wsa.plan.required')})</span>
                    </legend>
                    <p id="outcomes-hint" className="guide-hint">
                      {wsa('wsa.plan.outcomesHint')}
                    </p>
                    <div className="guide-options">
                      {outcomeOptions.map((v) => (
                        <label className="choice" key={v}>
                          <input
                            type="checkbox"
                            checked={draft.outcomes.includes(v)}
                            onChange={(e) =>
                              change(
                                'outcomes',
                                e.target.checked
                                  ? [...draft.outcomes, v]
                                  : draft.outcomes.filter((o) => o !== v),
                              )
                            }
                          />
                          {say(outcomeWords[v])}
                        </label>
                      ))}
                    </div>
                    {error('outcomes')}
                  </fieldset>
                  <label className="field">
                    {say('form.results.notes')}
                    <textarea
                      rows={3}
                      dir={translated ? 'auto' : undefined}
                      maxLength={1000}
                      value={draft.notes}
                      onChange={(e) => change('notes', e.target.value)}
                      aria-invalid={!!errors.notes?.length}
                      aria-describedby={
                        errors.notes?.length
                          ? 'request-context-hint notes-error'
                          : 'request-context-hint'
                      }
                    />
                    {error('notes')}
                  </label>
                  <p id="request-context-hint">{say('form.results.contextHint')}</p>
                </>
              )}
              {step === 4 && (
                <>
                  {field('name', say('form.contact.name'), 'text', 'name')}
                  {field('company', say('form.contact.company'), 'text', 'organization')}
                  {field('email', say('form.contact.email'), 'email', 'email')}
                  <label className="choice" {...englishProps}>
                    <input
                      type="checkbox"
                      checked={draft.acknowledged}
                      onChange={(e) => change('acknowledged', e.target.checked)}
                    />
                    {realMode
                      ? 'I have read the privacy and request notice and agree to Corridra handling this request.'
                      : 'I have read the test intake notice and am submitting invented test details.'}
                  </label>
                  {error('acknowledged')}
                  {realMode && !privateMode && !account && (
                    <label className="field">
                      {say('form.contact.password')}
                      <input
                        type="password"
                        dir={translated ? 'ltr' : undefined}
                        autoComplete="new-password"
                        minLength={14}
                        maxLength={128}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        aria-describedby="intake-password-help"
                      />
                      <span id="intake-password-help" className="guide-hint">
                        {withEnglish(
                          'form.contact.passwordHint',
                          'Your password goes only to the account provider.',
                        )}
                      </span>
                    </label>
                  )}
                  {realMode && !privateMode && (
                    <p className="guide-hint">
                      {account
                        ? sayWith('form.contact.signedInAs', { email: english(account.email) })
                        : `${say('form.contact.haveAccount')} `}{' '}
                      {!account && (
                        <Link className="text-link" href={accountAccessPath('/signin', '/plan')}>
                          {say('form.contact.signInReturn')}
                        </Link>
                      )}
                    </p>
                  )}
                  <p className="guide-hint">
                    {realMode
                      ? withEnglish(
                          'form.contact.realHint',
                          'Activate your account to submit it and read replies privately.',
                        )
                      : say('form.contact.sampleHint')}
                  </p>
                </>
              )}
              <div className="guide-actions">
                {step > 0 && (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => move(step - 1)}
                    disabled={busy}
                  >
                    {say('form.action.back')}
                  </button>
                )}
                <button
                  className="primary-link"
                  disabled={
                    !ready ||
                    busy ||
                    (realMode &&
                      !privateMode &&
                      step === 4 &&
                      (!accountChecked || !intakeAvailable))
                  }
                >
                  {busy
                    ? say('form.action.saving')
                    : step === 4
                      ? realMode && !privateMode && !account
                        ? say('form.action.createAccount')
                        : say('form.action.submit')
                      : say('form.action.continue')}
                </button>
              </div>
              <p className="guide-hint guide-draft-line">
                {english('Drafts stay in this tab for 24 hours.')}{' '}
                <button
                  className="text-link"
                  type="button"
                  onClick={() => {
                    // A cleared draft starts again from what the link asked for (CQ-14).
                    const fresh = withLinkChoices(empty);
                    key.current = crypto.randomUUID();
                    setDraft(fresh);
                    setDraftNotice('');
                    setJobChoice('');
                    setStep(0);
                    setErrors({});
                    persist(fresh, 0);
                  }}
                >
                  {say('form.action.clearDraft')}
                </button>
              </p>
            </form>
          )}
          {receipt && (
            <section className="receipt-panel" aria-labelledby="plan-receipt-title">
              <p className="label">{say('form.receipt.label')}</p>
              <h2 id="plan-receipt-title">{say('form.receipt.title')}</h2>
              <p>
                {translated ? (
                  <>
                    {!deviceSaved && say('form.receipt.saveBeforeClosing')}
                    {englishIsland(`${receiptReaders} ${receiptExpiry}`)}
                  </>
                ) : deviceSaved ? (
                  `${receiptReaders} ${receiptExpiry}`
                ) : (
                  `${receiptReaders} ${say('form.receipt.saveBeforeClosing')} ${receiptExpiry}`
                )}
              </p>
              {deviceSaved ? (
                <p className="guide-hint">
                  {english(
                    'Your request is saved on this device. You do not need to copy a code. Use another device? Copy the code first.',
                  )}{' '}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      forgetReceipt(browserStores());
                      setDeviceSaved(false);
                      setForgotten(true);
                    }}
                  >
                    {say('form.receipt.forget')}
                  </button>
                </p>
              ) : (
                forgotten && (
                  <p className="guide-hint" {...englishProps}>
                    This device no longer remembers your request. Copy the code now if you still
                    need it.
                  </p>
                )
              )}
              <label className="field">
                {say('form.receipt.code')}
                <input
                  readOnly
                  dir={translated ? 'ltr' : undefined}
                  value={receipt}
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <button type="button" className="button-secondary" onClick={copyReceipt}>
                {say('form.receipt.copy')}
              </button>
            </section>
          )}
          {finished && (
            <button
              type="button"
              className="button-secondary guide-receipt-reset"
              onClick={() => {
                submitted.current = false;
                key.current = crypto.randomUUID();
                setFinished(false);
                setDraftNotice('');
                setReceipt('');
                setDraft(empty);
                setStep(0);
                setMessage('');
                setErrors({});
                setDeviceSaved(false);
                setForgotten(false);
                forgetReceipt(browserStores());
                persist(empty, 0);
              }}
            >
              {say('form.receipt.another')}
            </button>
          )}
          <section id="receipt-check" tabIndex={-1} className="receipt-panel" hidden={privateMode}>
            <h2>{realMode ? say('form.check.realTitle') : say('form.check.sampleTitle')}</h2>
            <form className="operator-form" onSubmit={check} noValidate>
              <label className="field">
                {say('form.check.code')}
                <input
                  required
                  dir={translated ? 'ltr' : undefined}
                  value={checkCode}
                  onChange={(e) => {
                    setCheckCode(e.target.value);
                    setCheckEmpty(false);
                  }}
                  autoComplete="off"
                  maxLength={64}
                  aria-invalid={checkEmpty}
                  aria-describedby={checkEmpty ? 'check-hint check-error' : 'check-hint'}
                />
              </label>
              <p id="check-hint" className="guide-hint">
                {realMode ? wsa('wsa.plan.check.hintReal') : wsa('wsa.plan.check.hintSample')}
              </p>
              {checkEmpty && (
                <p id="check-error" role="alert" className="field-error">
                  {wsa('wsa.plan.check.empty')}
                </p>
              )}
              <button className="primary-link" disabled={!ready || busy}>
                {say('form.check.submit')}
              </button>
            </form>
            {realMode && !privateMode && !account && codeSignIn && (
              <p className="guide-hint">
                <Link className="text-link" href={accountAccessPath('/signin', '/account', 'code')}>
                  {say('form.pending.codeSignIn')}
                </Link>
              </p>
            )}
            {result && (
              <div>
                <p>
                  {sayWith('form.check.status', {
                    status: <strong {...englishProps}>{result.status.replaceAll('_', ' ')}</strong>,
                  })}
                </p>
                {result.replies.length ? (
                  result.replies.map((r, i) => (
                    <article className="detail-card" key={i}>
                      <p dir={translated ? 'auto' : undefined}>{r.body}</p>
                      <time dateTime={r.createdAt}>
                        {translated
                          ? new Date(r.createdAt).toLocaleString(tag)
                          : new Date(r.createdAt).toLocaleString()}
                      </time>
                    </article>
                  ))
                ) : (
                  <p>{say('form.check.noReply')}</p>
                )}
              </div>
            )}
          </section>
        </div>
        {!finished && (
          <aside
            className="ux-brief-summary"
            aria-label={realMode ? say('form.side.realLabel') : say('form.side.sampleLabel')}
          >
            <p className="label">
              {realMode ? say('form.side.realHeading') : say('form.side.sampleHeading')}
            </p>
            <dl>
              <div>
                <dt>{say('form.side.objective')}</dt>
                <dd>{chosenJob ? say(jobWord(chosenJob.key)) : say('form.side.notChosen')}</dd>
              </div>
              <div>
                <dt>{say('form.side.country')}</dt>
                <dd>
                  {countryCodes.includes(draft.companyCountry as (typeof countryCodes)[number])
                    ? regionNames.of(draft.companyCountry)
                    : say('form.side.notChosen')}
                </dd>
              </div>
              <div>
                <dt>{say('form.side.market')}</dt>
                <dd>
                  {draft.marketCode === 'EU'
                    ? say('form.where.eu')
                    : countryCodes.includes(draft.marketCode as (typeof countryCodes)[number])
                      ? regionNames.of(draft.marketCode)
                      : say('form.side.notChosen')}
                </dd>
              </div>
              {/* The budget row shows only once a budget is given; most jobs never ask for one (CQ-49). */}
              <div hidden={!draft.budgetAmount}>
                <dt>{say('form.side.budget')}</dt>
                <dd>
                  {!draft.budgetAmount ? (
                    say('form.side.notSupplied')
                  ) : !translated ? (
                    `${draft.budgetAmount} ${draft.currency || say('form.side.noCurrency')}`
                  ) : draft.currency ? (
                    english(`${draft.budgetAmount} ${draft.currency}`)
                  ) : (
                    <>
                      {english(draft.budgetAmount)} {say('form.side.noCurrency')}
                    </>
                  )}
                </dd>
              </div>
            </dl>
            <p>
              {withEnglish(
                'form.side.draftOnly',
                'Nothing here is an offer, a quote or a promise.',
              )}
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
