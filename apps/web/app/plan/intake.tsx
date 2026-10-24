'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { accountClient } from '../../lib/neon-auth-client';
import { accountAccessPath } from '../../lib/account-return';
import { browserStores, forgetReceipt, readReceipt, saveReceipt } from '../../lib/receipt-memory';
import { JourneyBar } from '../../components/journey-bar';
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
const titles = [
  'What are you trying to achieve?',
  'Where?',
  'What are you offering or looking for?',
  'What would make this worthwhile?',
  'Where should we respond?',
];
function objectiveForJob(job: string) {
  if (['sourcing', 'machinery_procurement', 'supplier_evaluation'].includes(job))
    return 'Source suppliers';
  if (job === 'delegations') return 'Run a multi-company mission';
  if (['business_trips', 'factory_visits', 'trade_fairs', 'meetings'].includes(job))
    return 'Make an upcoming business trip more productive';
  if (['customers', 'distributors', 'partners'].includes(job))
    return 'Find customers or distributors';
  return 'Sell in a new market';
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
  if (!response.ok)
    throw new Error(body.error ?? 'Your request could not be submitted. Try again.');
  if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id))
    throw new Error('The request response could not be read. Open your account to check it.');
  try {
    sessionStorage.removeItem(storageKey);
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
  throw new Error('Request navigation is unavailable. Open your account to continue.');
}
function IntakeForm({
  privateSubmission,
  realMode = false,
  codeSignIn = false,
  navigate = missingNavigation,
}: IntakeProps & { navigate?: (path: string) => void }) {
  const privateMode = privateSubmission !== undefined;
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
    [draftNotice, setDraftNotice] = useState('');
  const key = useRef(''),
    submitted = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    errorSummary = useRef<HTMLDivElement>(null);
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
              ? 'A saved draft could not be restored. Keep a copy of your request before leaving this tab.'
              : 'A saved draft could not be restored. The form still works; keep a copy of your invented request before leaving this tab.',
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
          setDraftNotice(
            'A draft from this tab was resumed. Your saved choices take precedence over link suggestions.',
          );
          key.current = saved.key;
          setDraft({ ...empty, ...saved.draft });
          setStep(saved.version === 2 ? Math.max(0, Math.min(4, Number(saved.step) || 0)) : 0);
        }
        if (saved && !restored)
          setDraftNotice('The earlier draft could not be resumed. Drafts expire after 24 hours.');
        const query = new URLSearchParams(window.location.search);
        const suggestedJob = query.get('job');
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
          realMode
            ? 'A saved draft could not be restored. Keep a copy of your request before leaving this tab.'
            : 'A saved draft could not be restored. The form still works; keep a copy of your invented request before leaving this tab.',
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
        if (identity.error)
          throw new Error('Account status could not be checked. Sign in or try again.');
        if (!response.ok) throw new Error('Saved request status could not be checked. Try again.');
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
        if (pending.available === false)
          setMessage(
            'New requests are paused. Existing requests remain available in your account.',
          );
        if (pending.pending === true && user?.emailVerified) {
          setMessage('Opening your private request…');
          await claimSavedRequest(draftStorageKey, navigate);
        }
      })
      .catch((error) => {
        if (active)
          setMessage(error instanceof Error ? error.message : 'Your account could not be checked.');
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
    if (Object.values(errors).some((messages) => messages.length)) errorSummary.current?.focus();
  }, [errors]);
  function persist(v: Draft, n: number) {
    if (!key.current) key.current = crypto.randomUUID();
    try {
      saveDraft(v, n, key.current, draftStorageKey);
    } catch {
      setDraftNotice(
        realMode
          ? 'This browser could not save the draft. Keep this tab open and copy your request before leaving.'
          : 'This browser could not save the draft. Keep this tab open and copy the invented request before leaving.',
      );
    }
  }
  function change(field: keyof Draft, value: string | boolean | string[]) {
    const v = { ...draft, [field]: value };
    if (field === 'job' && value) v.objective = objectiveForJob(String(value));
    if (field === 'objective')
      v.job = (
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
    setErrors((e) => ({ ...e, [field]: [] }));
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
      if (!draft.job) next.job = ['Choose the commercial job'];
    }
    if (step === 1 || fields.length === groups.flat().length) {
      if (!countryCodes.includes(draft.companyCountry as (typeof countryCodes)[number]))
        next.companyCountry = ['Choose the company country'];
      if (
        draft.marketCode !== 'EU' &&
        !countryCodes.includes(draft.marketCode as (typeof countryCodes)[number])
      )
        next.marketCode = ['Choose the target market'];
    }
    if (step === 2 || fields.length === groups.flat().length) {
      let structured;
      try {
        structured = intakeExperience.safeParse(experience());
      } catch (err) {
        next.requirements = [
          err instanceof Error ? err.message : 'Check the original amount and currency.',
        ];
      }
      if (structured && !structured.success)
        next.requirements = [structured.error.issues.map((e) => e.message).join('. ')];
    }
    setErrors(next);
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
        if (!intakeAvailable)
          throw new Error('New requests are paused. Open your account for existing work.');
        if (!accountChecked) throw new Error('Wait for your account status to finish loading.');
        if (account && draft.email.trim().toLowerCase() !== account.email.trim().toLowerCase())
          throw new Error(
            'Use the email address on your signed-in account, or sign out to use a different account.',
          );
        if (!account && password.length < 14)
          throw new Error('Choose an account password with at least 14 characters.');
        const response = await fetch('/api/intake/pending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: key.current,
            brief: realBriefSchema.parse(canonicalDraft()),
          }),
        });
        const saved = await response.json();
        if (!response.ok)
          throw new Error(
            saved.error ?? 'Your request could not be saved. Your input is still here.',
          );
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
                'Your request is saved for 24 hours. Your account could not be created. Try signing in or creating your account below.',
              );
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
          ? 'This invented example request has already been recorded.'
          : 'Your invented example request has been recorded. No real customer mission has been accepted.',
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
        if (place === 'none')
          setDraftNotice(
            'The request was recorded, but this browser could not save its receipt. Copy the private code before leaving.',
          );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to save. Your input is still here.');
    } finally {
      setBusy(false);
    }
  }
  async function copyReceipt() {
    try {
      await navigator.clipboard.writeText(receipt);
      setMessage('Private receipt code copied.');
    } catch {
      setMessage('Could not copy the code. Select it and copy it before leaving this page.');
    }
  }
  async function check(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
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
      setMessage(e instanceof Error ? e.message : 'Unable to check receipt');
    } finally {
      setBusy(false);
    }
  }
  const field = (name: keyof Draft, label: string, type = 'text') => (
    <div className="field" key={name}>
      <label htmlFor={`brief-${name}`}>{label}</label>
      <input
        id={`brief-${name}`}
        type={type}
        value={String(draft[name])}
        onChange={(e) => change(name, e.target.value)}
        aria-invalid={!!errors[name]?.length}
        aria-describedby={errors[name]?.length ? `${name}-error` : undefined}
      />
      {!!errors[name]?.length && (
        <span id={`${name}-error`} className="field-error">
          {errors[name][0]}
        </span>
      )}
    </div>
  );
  const error = (name: string) =>
    errors[name]?.length ? (
      <p role="alert" className="field-error" id={`${name}-error`}>
        {errors[name][0]}
      </p>
    ) : null;
  return (
    <div className="ux-intake-layout">
      <div className="guide-plan-top">
        {realMode ? (
          <aside className="intake-notice">
            <span className="guide-pill">YOUR REQUEST</span>
            <p>
              <strong>Start with the work you need.</strong> At the final step, create an account or
              sign in to keep your request and replies private.{' '}
              <Link href="/privacy">Read the privacy and request notice</Link>.
            </p>
          </aside>
        ) : (
          <aside className="intake-notice">
            <span className="guide-pill">Test mode</span>
            <p>
              <strong>Test intake is open. Real customer mission admission is unavailable.</strong>{' '}
              Use invented details and an email ending in @example.invalid.{' '}
              {privateMode
                ? 'Sample requests stay private to this account. '
                : 'Keep your receipt to read replies. '}
              Email delivery is not enabled.{' '}
              <Link href="/privacy">Read the test intake notice</Link>.
            </p>
          </aside>
        )}
        <details lang="bn" className="guide-bn">
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
          {message}
        </p>
        {draftNotice && (
          <p className="ux-draft-notice" aria-live="polite">
            {draftNotice}
          </p>
        )}
      </div>
      <div className="guide-plan-body">
        <div className="guide-plan-main">
          {realMode && pendingReady && (
            <section className="receipt-saved" aria-labelledby="pending-request-title">
              <h2 id="pending-request-title">Finish your request.</h2>
              <p>
                Your request is saved privately for 24 hours while you activate your account and
                sign in. Use this same device and browser. It is submitted to Corridra after that
                step.
              </p>
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
                            : 'Your request could not be opened.',
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Open your request
                  </button>
                ) : (
                  <Link
                    className="primary-link"
                    href={accountAccessPath(account ? '/verify-email' : '/signin', '/plan')}
                  >
                    {account ? 'Activate your account' : 'Sign in and continue'}
                  </Link>
                )}
                {!account && (
                  <Link className="text-link" href={accountAccessPath('/signup', '/plan')}>
                    Create your account
                  </Link>
                )}
                {!account && codeSignIn && (
                  <Link className="text-link" href={accountAccessPath('/signin', '/plan', 'code')}>
                    Sign in with a code to see your request
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
                  Return to the form
                </button>
              </div>
            </section>
          )}
          {!finished && !pendingReady && (
            <form className="intake-form" onSubmit={submit} noValidate inert={!ready || busy}>
              <p className="label">STEP {step + 1} OF 5</p>
              <JourneyBar
                steps={['Goal', 'Where', 'Details', 'Results', 'Contact']}
                current={step}
                label="Request steps"
              />
              <progress
                className="sr-only"
                value={step + 1}
                max={5}
                aria-label="Request progress"
              />
              <h2 ref={heading} tabIndex={-1}>
                {titles[step]}
              </h2>
              {Object.values(errors).some((messages) => messages.length) && (
                <div ref={errorSummary} className="ux-error-summary" tabIndex={-1} role="alert">
                  <strong>Check this step.</strong>
                  <p>
                    Review the highlighted fields before continuing. Your entries are still here.
                  </p>
                </div>
              )}
              {step === 0 && (
                <fieldset>
                  <legend className="sr-only">Mission objective</legend>
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
                        {v}
                      </label>
                    ))}
                  </div>
                  {error('objective')}
                  <label className="field guide-more">
                    Commercial job
                    <select
                      value={draft.job}
                      onChange={(e) => change('job', e.target.value)}
                      required
                      aria-describedby="job-hint"
                    >
                      <option value="">Choose the job</option>
                      {missionCatalogue.map((job) => (
                        <option key={job.key} value={job.key}>
                          {job.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p id="job-hint" className="guide-hint">
                    Choose a more exact job if you know it.
                  </p>
                  {error('job')}
                </fieldset>
              )}
              {step === 1 && (
                <>
                  <label className="field">
                    Where is the company based?
                    <select
                      value={draft.companyCountry}
                      onChange={(e) => change('companyCountry', e.target.value)}
                      required
                    >
                      <option value="">Choose a country</option>
                      {countryCodes.map((code) => (
                        <option key={code} value={code}>
                          {new Intl.DisplayNames(['en'], { type: 'region' }).of(code)} ({code})
                        </option>
                      ))}
                    </select>
                  </label>
                  {error('companyCountry')}
                  <label className="field">
                    Which market is involved?
                    <select
                      value={draft.marketCode}
                      onChange={(e) => change('marketCode', e.target.value)}
                      required
                    >
                      <option value="">Choose a market</option>
                      <option value="EU">European Union (trade bloc)</option>
                      {countryCodes.map((code) => (
                        <option key={code} value={code}>
                          {new Intl.DisplayNames(['en'], { type: 'region' }).of(code)} ({code})
                        </option>
                      ))}
                    </select>
                  </label>
                  {error('marketCode')}
                  <p className="guide-hint">
                    Company country and target market do not define shipment or meeting location.{' '}
                    {draft.companyCountry &&
                      draft.marketCode &&
                      !(
                        draft.companyCountry === 'BD' &&
                        ['CN', 'ES', 'EU'].includes(draft.marketCode)
                      ) &&
                      (realMode
                        ? 'Tell us what you need. Availability and scope for this direction must be agreed after review.'
                        : 'No operating offer is announced for this direction. You can still describe an invented test mission.')}
                  </p>
                  {field('whenNeeded', 'When is the activity needed? (optional)', 'date')}
                  <fieldset>
                    <legend>Will you be there in person?</legend>
                    <div className="guide-options guide-options-row">
                      {['Yes', 'No', 'Not decided'].map((v) => (
                        <label className="choice" key={v}>
                          <input
                            type="radio"
                            name="attendance"
                            checked={draft.attendance === v}
                            onChange={() => change('attendance', v)}
                          />
                          {v}
                        </label>
                      ))}
                    </div>
                    {error('attendance')}
                  </fieldset>
                  {draft.attendance === 'Yes' && (
                    <>
                      <div className="guide-pair">
                        {field('startDate', 'From', 'date')}
                        {field('endDate', 'To', 'date')}
                      </div>
                      {field('timezone', 'Visit timezone')}
                    </>
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <label className="field">
                    Your offer or requirement
                    <textarea
                      rows={6}
                      maxLength={1000}
                      value={draft.offer}
                      onChange={(e) => change('offer', e.target.value)}
                      placeholder="Example: We manufacture hotel towels in Bangladesh and want to meet Spanish hospitality distributors buying private-label products."
                      aria-invalid={!!errors.offer?.length}
                      aria-describedby={errors.offer?.length ? 'offer-error' : undefined}
                    />
                    {error('offer')}
                  </label>
                  {draft.job === 'machinery_procurement' && (
                    <>
                      {field('technicalPurpose', 'Technical purpose (optional)')}
                      {field('parameters', 'Key technical parameters (optional)')}
                      {field(
                        'preferences',
                        'Site, integration or after-sales constraints (optional)',
                      )}
                    </>
                  )}
                  {['sourcing', 'supplier_evaluation', 'factory_visits'].includes(draft.job) && (
                    <>
                      {field('parameters', 'Product specifications (optional)')}
                      {field('quantity', 'Required quantity (optional)')}
                      {field('unit', 'Quantity unit (required with quantity)')}
                      {field('preferences', 'Supplier preferences and constraints (optional)')}
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
                      {field('parameters', 'Target buyer or distributor (optional)')}
                      {field('preferences', 'Commercial readiness and constraints (optional)')}
                    </>
                  )}
                  {draft.job === 'delegations' && (
                    <>
                      {field('organiser', 'Delegation organiser (optional)')}
                      {field(
                        'participants',
                        'Participating organisations and individual needs (optional)',
                      )}
                      <p className="guide-hint">
                        Each participant receives an independent mission. Private offers and
                        contacts are not shared with the organiser automatically.
                      </p>
                    </>
                  )}
                  {['sourcing', 'machinery_procurement'].includes(draft.job) && (
                    <details>
                      <summary>Budget context (optional)</summary>
                      {field('budgetAmount', 'Budget in original currency (optional)')}
                      <label className="field">
                        Original currency
                        <select
                          value={draft.currency}
                          onChange={(e) => change('currency', e.target.value)}
                        >
                          <option value="">No budget supplied</option>
                          {Object.entries(currencies).map(([code, places]) => (
                            <option value={code} key={code}>
                              {code} ({places} decimal places)
                            </option>
                          ))}
                        </select>
                      </label>
                      {field('budgetBasis', 'Budget basis, such as total equipment budget')}
                      <p className="guide-hint">
                        Enter the amount as quoted, such as CNY 12.00 or BHD 1.234. Use the selected
                        currency’s decimal places. No currency conversion is performed.
                      </p>
                    </details>
                  )}
                  {error('requirements')}
                  {field('website', 'Website or catalogue URL (optional)', 'url')}
                  <p className="guide-hint">
                    A public link helps. We do not open it automatically. Documents can be requested
                    after review.
                  </p>
                </>
              )}
              {step === 3 && (
                <>
                  {field(
                    'worthwhile',
                    'What outcome would make the engagement worthwhile? (optional)',
                  )}
                  <fieldset>
                    <legend>Desired outcomes</legend>
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
                          {v}
                        </label>
                      ))}
                    </div>
                    {error('outcomes')}
                  </fieldset>
                  <label className="field">
                    Anything specific we should know? (optional)
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={draft.notes}
                      onChange={(e) => change('notes', e.target.value)}
                    />
                    {error('notes')}
                  </label>
                </>
              )}
              {step === 4 && (
                <>
                  {field('name', 'Name')}
                  {field('company', 'Company')}
                  {field('email', 'Work email', 'email')}
                  <label className="choice">
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
                      Create an account password
                      <input
                        type="password"
                        autoComplete="new-password"
                        minLength={14}
                        maxLength={128}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        aria-describedby="intake-password-help"
                      />
                      <span id="intake-password-help" className="guide-hint">
                        Use at least 14 characters. Your password goes only to the account provider.
                      </span>
                    </label>
                  )}
                  {realMode && !privateMode && (
                    <p className="guide-hint">
                      {account ? `Signed in as ${account.email}.` : 'Already have an account? '}{' '}
                      {!account && (
                        <Link className="text-link" href={accountAccessPath('/signin', '/plan')}>
                          Sign in and return to this request
                        </Link>
                      )}
                    </p>
                  )}
                  <p className="guide-hint">
                    {realMode
                      ? 'We review your request and propose next steps. Activate your account to submit it and read replies privately.'
                      : 'No account needed. We review your request first, then propose next steps. Use your receipt to read replies.'}
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
                    Back
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
                    ? 'Saving…'
                    : step === 4
                      ? realMode && !privateMode && !account
                        ? 'Create account and continue'
                        : 'Submit mission request'
                      : 'Continue'}
                </button>
              </div>
              <p className="guide-hint guide-draft-line">
                Drafts stay in this tab for 24 hours.{' '}
                <button
                  className="text-link"
                  type="button"
                  onClick={() => {
                    key.current = crypto.randomUUID();
                    setDraft(empty);
                    setDraftNotice('');
                    setStep(0);
                    setErrors({});
                    persist(empty, 0);
                  }}
                >
                  Clear draft
                </button>
              </p>
            </form>
          )}
          {receipt && (
            <section className="receipt-panel" aria-labelledby="plan-receipt-title">
              <p className="label">REQUEST SAVED</p>
              <h2 id="plan-receipt-title">Keep your private receipt.</h2>
              <p>
                {deviceSaved
                  ? 'Anyone with this code can read the mission status and replies. It expires after 30 days.'
                  : 'Anyone with this code can read the mission status and replies. Save it before closing this tab. It expires after 30 days.'}
              </p>
              {deviceSaved ? (
                <p className="guide-hint">
                  Your request is saved on this device. You do not need to copy a code. Use another
                  device? Copy the code first.{' '}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      forgetReceipt(browserStores());
                      setDeviceSaved(false);
                      setForgotten(true);
                    }}
                  >
                    Forget this request on this device
                  </button>
                </p>
              ) : (
                forgotten && (
                  <p className="guide-hint">
                    This device no longer remembers your request. Copy the code now if you still
                    need it.
                  </p>
                )
              )}
              <label className="field">
                Private receipt code
                <input
                  readOnly
                  value={receipt}
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <button type="button" className="button-secondary" onClick={copyReceipt}>
                Copy receipt code
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
              Start another request (save your receipt first)
            </button>
          )}
          <section id="receipt-check" tabIndex={-1} className="receipt-panel" hidden={privateMode}>
            <h2>{realMode ? 'Check an earlier receipt.' : 'Check a mission request.'}</h2>
            <form className="operator-form" onSubmit={check}>
              <label className="field">
                Receipt code
                <input
                  required
                  value={checkCode}
                  onChange={(e) => setCheckCode(e.target.value)}
                  autoComplete="off"
                  maxLength={64}
                />
              </label>
              <button className="primary-link" disabled={!ready || busy}>
                Check status and replies
              </button>
            </form>
            {realMode && !privateMode && !account && codeSignIn && (
              <p className="guide-hint">
                <Link className="text-link" href={accountAccessPath('/signin', '/account', 'code')}>
                  Sign in with a code to see your request
                </Link>
              </p>
            )}
            {result && (
              <div>
                <p>
                  Status: <strong>{result.status.replaceAll('_', ' ')}</strong>
                </p>
                {result.replies.length ? (
                  result.replies.map((r, i) => (
                    <article className="detail-card" key={i}>
                      <p>{r.body}</p>
                      <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
                    </article>
                  ))
                ) : (
                  <p>No operator reply yet.</p>
                )}
              </div>
            )}
          </section>
        </div>
        {!finished && (
          <aside
            className="ux-brief-summary"
            aria-label={realMode ? 'Your request' : 'Your example request'}
          >
            <p className="label">{realMode ? 'YOUR REQUEST' : 'YOUR EXAMPLE REQUEST'}</p>
            <dl>
              <div>
                <dt>Objective</dt>
                <dd>
                  {missionCatalogue.find((item) => item.key === draft.job)?.label ?? 'Not chosen'}
                </dd>
              </div>
              <div>
                <dt>Company country</dt>
                <dd>
                  {countryCodes.includes(draft.companyCountry as (typeof countryCodes)[number])
                    ? new Intl.DisplayNames(['en'], { type: 'region' }).of(draft.companyCountry)
                    : 'Not chosen'}
                </dd>
              </div>
              <div>
                <dt>Target market</dt>
                <dd>
                  {draft.marketCode === 'EU'
                    ? 'European Union (trade bloc)'
                    : countryCodes.includes(draft.marketCode as (typeof countryCodes)[number])
                      ? new Intl.DisplayNames(['en'], { type: 'region' }).of(draft.marketCode)
                      : 'Not chosen'}
                </dd>
              </div>
              <div>
                <dt>Original budget</dt>
                <dd>
                  {draft.budgetAmount
                    ? `${draft.budgetAmount} ${draft.currency || '(currency not chosen)'}`
                    : 'Not supplied'}
                </dd>
              </div>
            </dl>
            <p>Draft only. Nothing here is an offer, a quote or a promise.</p>
          </aside>
        )}
      </div>
    </div>
  );
}
