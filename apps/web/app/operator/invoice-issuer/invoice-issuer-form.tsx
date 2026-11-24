'use client';
// ADR-092 (unit B8). The Owner-only Invoice issuer form: four short steps that save one new version of the details
// printed on every real invoice. The authenticator code is checked at the moment of the save, read from the form when it
// is sent and never kept, shown or sent with the details. Made-up values never reach this screen: a field that is still
// made up arrives empty and is typed. Saving switches nothing on. Every refusal is placed by its status or code, never
// by its words.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { identityClient } from '@corridra/auth/client';
import type { IssuerSaved, IssuerView } from '@corridra/auth/customer-invoicing-real-issuer';
import { StatusBadge } from '../../../components/access-state';
import { FieldError } from '../../../components/field-error';
import { ChoiceChip } from '../../../components/ux/choice-chip';
import { classifyVerifyResult } from '../../../lib/authenticator-check';
import { formatUtcDay } from '../../../lib/ux/format';
import './invoice-issuer.css';

type Field =
  | 'legalName'
  | 'uen'
  | 'address'
  | 'gstRegistered'
  | 'gstRegistrationNo'
  | 'paymentInstructions'
  | 'financeLabel'
  | 'code';
type Answers = {
  legalName: string;
  uen: string;
  address: string;
  gstRegistered: '' | 'yes' | 'no';
  gstRegistrationNo: string;
  paymentInstructions: string;
  financeLabel: string;
};
type Errors = Partial<Record<Field, string>>;
type Load =
  | { state: 'loading' }
  | { state: 'ready'; view: IssuerView }
  | { state: 'refused'; text: string; retry: boolean };
type Result = { tone: 'status' | 'alert'; text: string; latest?: boolean };
type SaveAnswer = (Partial<IssuerSaved> & { code?: string }) | null;

const steps = ['Company', 'GST', 'Payment', 'Check And Save'] as const;
const stepFields: readonly (readonly Field[])[] = [
  ['legalName', 'uen', 'address'],
  ['gstRegistered', 'gstRegistrationNo'],
  ['paymentInstructions', 'financeLabel'],
  ['code'],
];
// Plain names for the fields that are still needed, by their database name.
const neededText: Record<string, string> = {
  legal_name: 'legal name',
  address: 'registered address',
  uen: 'company registration number (UEN)',
  gst_registered: 'GST status',
  gst_registration_no: 'GST registration number',
  payment_instructions: 'payment instructions',
  finance_label: 'finance contact label',
  gst_rate_bps: 'tax rate (set from your GST answer when you save)',
};
const neededOrder = Object.keys(neededText);
// ADR-092 addendum: the tax rate is never typed. The database derives it from the GST answer and says here what each
// answer writes; null (or absent, before that install) means this screen leaves the rate as it is.
function rateLine(view: IssuerView, registered: boolean): string | null {
  const bps = registered ? view.fixed.rateWhenRegisteredBps : view.fixed.rateWhenNotRegisteredBps;
  if (typeof bps !== 'number') return null;
  return registered
    ? `${bps / 100}% ${view.fixed.taxLabel}, the Singapore standard rate`
    : `${bps / 100}%, no ${view.fixed.taxLabel} is charged`;
}
const lengths: Record<Exclude<Field, 'gstRegistered' | 'code'>, [number, number, string]> = {
  legalName: [2, 120, 'Enter the legal name, 2 to 120 characters.'],
  uen: [3, 60, 'Enter the company registration number (UEN), 3 to 60 characters.'],
  address: [5, 300, 'Enter the registered address, 5 to 300 characters.'],
  gstRegistrationNo: [3, 60, 'Enter the GST registration number, 3 to 60 characters.'],
  paymentInstructions: [5, 400, 'Enter the payment instructions, 5 to 400 characters.'],
  financeLabel: [2, 120, 'Enter the finance contact label, 2 to 120 characters.'],
};
const endpoint = (tenant: string) =>
  '/operator/invoice-issuer/details?tenant=' + encodeURIComponent(tenant);

function fromView(view: IssuerView): Answers {
  const d = view.details;
  return {
    legalName: d.legalName ?? '',
    uen: d.uen ?? '',
    address: d.address ?? '',
    gstRegistered: d.gstRegistered === null ? '' : d.gstRegistered ? 'yes' : 'no',
    gstRegistrationNo: d.gstRegistrationNo ?? '',
    paymentInstructions: d.paymentInstructions ?? '',
    financeLabel: d.financeLabel ?? '',
  };
}
// The same rules the server and the database apply, so a refusal there is rare.
function textError(field: keyof typeof lengths, raw: string) {
  const value = raw.trim();
  const [min, max, words] = lengths[field];
  if (value.length < min || value.length > max) return words;
  if (/\(madeup\)/i.test(value)) return 'Remove the text "(madeup)" and enter the real value.';
  if (/[\u0000-\u001f\u007f]/u.test(value) || /(:\/\/|@|www\.)/.test(value))
    return 'Use plain words only, with no links or email addresses.';
  return undefined;
}
function fieldError(field: Field, a: Answers, code: string) {
  if (field === 'code')
    return /^[0-9]{6}$/.test(code)
      ? undefined
      : 'Enter the six-digit code from your authenticator app.';
  if (field === 'gstRegistered')
    return a.gstRegistered ? undefined : 'Choose whether the company is GST registered.';
  if (field === 'gstRegistrationNo')
    return a.gstRegistered === 'yes' ? textError(field, a.gstRegistrationNo) : undefined;
  return textError(field, a[field]);
}
function statusLine(view: IssuerView) {
  if (view.complete)
    return `Issuer details are complete. ${view.enteredByOwner ? 'Typed by the owner and saved' : 'Saved'} on ${formatUtcDay(view.savedAt)}.`;
  const needed = neededOrder
    .filter((name) => view.madeupFields.includes(name) || (name === 'uen' && !view.details.uen))
    .map((name) => neededText[name]);
  return `${needed.length} ${needed.length === 1 ? 'detail is' : 'details are'} still needed: ${needed.join(', ')}.`;
}

export function InvoiceIssuerForm({ tenant }: { tenant: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);
  // One command id per set of answers: a save whose answer was lost is sent again under the same id.
  const [commandId, setCommandId] = useState<string | null>(null);
  const pending = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusField = useRef<Field | null>(null);
  const focusHeading = useRef(false);

  const read = useCallback(
    async (keepResult = false) => {
      if (!keepResult) setResult(null);
      setLoad({ state: 'loading' });
      let status = 0;
      let body: unknown = null;
      try {
        const response = await fetch(endpoint(tenant), {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        status = response.status;
        body = await response.json().catch(() => null);
      } catch {
        status = 0;
      }
      const view = body as IssuerView | null;
      if (
        status === 200 &&
        view &&
        view.synthetic === false &&
        typeof view.version === 'number' &&
        Array.isArray(view.madeupFields) &&
        view.details &&
        typeof view.details === 'object'
      ) {
        setAnswers(fromView(view));
        setStep(0);
        setErrors({});
        setCommandId(null);
        setLoad({ state: 'ready', view });
        return;
      }
      setLoad({
        state: 'refused',
        retry: ![401, 403, 404, 503].includes(status),
        text:
          status === 403
            ? 'This page is for the workspace owner. Ask the owner to enter the issuer details.'
            : status === 401
              ? 'Your sign-in has ended. Sign in again to open the issuer details.'
              : status === 503
                ? 'The invoice module is not installed here yet. Nothing can be saved.'
                : status === 404
                  ? 'This screen is not switched on.'
                  : 'The issuer details could not be loaded. Nothing was changed.',
      });
    },
    [tenant],
  );
  useEffect(() => {
    void Promise.resolve().then(() => read());
  }, [read]);
  useEffect(() => {
    if (focusField.current) {
      const name = focusField.current;
      focusField.current = null;
      document.querySelector<HTMLElement>(`.invoice-issuer [name="${name}"]`)?.focus();
    } else if (focusHeading.current) {
      focusHeading.current = false;
      headingRef.current?.focus();
    }
  });

  if (load.state === 'loading')
    return (
      <p className="billing-notice" role="status">
        Loading the issuer details…
      </p>
    );
  if (load.state === 'refused' || !answers)
    return (
      <div className="invoice-issuer">
        <p className="billing-notice" role="alert">
          {load.state === 'refused' ? load.text : ''}
        </p>
        {load.state === 'refused' && load.retry ? (
          <button type="button" className="secondary-link" onClick={() => void read()}>
            Try Again
          </button>
        ) : null}
      </div>
    );
  const view = load.view;
  const set = (field: keyof Answers, value: string) => {
    setAnswers({ ...answers, [field]: value } as Answers);
    setCommandId(null);
    if (errors[field]) setErrors({ ...errors, [field]: undefined });
  };
  const check = (index: number, code = '') => {
    const found: Errors = {};
    for (const field of stepFields[index]!) {
      const problem = fieldError(field, answers, code);
      if (problem) found[field] = problem;
    }
    setErrors(found);
    const first = stepFields[index]!.find((field) => found[field]);
    if (first) focusField.current = first;
    return !first;
  };
  const go = (to: number) => {
    setErrors({});
    setStep(to);
    focusHeading.current = true;
  };
  const current = answers;
  async function save(form: HTMLFormElement) {
    if (pending.current) return;
    const input = form.elements.namedItem('code') as HTMLInputElement | null;
    const code = input?.value.trim() ?? '';
    if (!check(3, code)) return;
    pending.current = true;
    setSaving(true);
    setResult(null);
    try {
      let outcome: ReturnType<typeof classifyVerifyResult> = 'unknown';
      try {
        outcome = classifyVerifyResult(
          await identityClient.twoFactor.verifyTotp({ code, trustDevice: false }),
        );
      } catch {
        outcome = 'unknown';
      }
      if (input) input.value = '';
      if (outcome !== 'accepted') {
        if (outcome === 'invalid-code') {
          setErrors({
            code: 'That code was not accepted. Enter the current code from your authenticator app.',
          });
          focusField.current = 'code';
        } else
          setResult({
            tone: 'alert',
            text:
              outcome === 'rate-limited'
                ? 'Too many tries. The code was not checked. Wait a minute, then enter a new code.'
                : outcome === 'signed-out'
                  ? 'Your sign-in has ended, so the code was not checked. Sign in again, then save. Copy your answers first.'
                  : 'The code could not be checked. Nothing was saved. Enter a new code and save again.',
          });
        return;
      }
      const command = commandId ?? crypto.randomUUID();
      setCommandId(command);
      const registered = current.gstRegistered === 'yes';
      let status = 0;
      let body: SaveAnswer = null;
      try {
        const response = await fetch(endpoint(tenant), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commandId: command,
            expectedVersion: view.version,
            legalName: current.legalName.trim(),
            address: current.address.trim(),
            uen: current.uen.trim(),
            gstRegistered: registered,
            gstRegistrationNo: registered ? current.gstRegistrationNo.trim() : null,
            paymentInstructions: current.paymentInstructions.trim(),
            financeLabel: current.financeLabel.trim(),
          }),
        });
        status = response.status;
        body = (await response.json().catch(() => null)) as SaveAnswer;
      } catch {
        status = 0;
      }
      if (status === 200 && body && (body.state === 'saved' || body.state === 'unchanged')) {
        setResult({
          tone: 'status',
          text:
            body.state === 'unchanged'
              ? 'Nothing changed. These details were already saved.'
              : body.complete
                ? 'Saved. Issuer details are complete. Real invoices stay off until they are switched on separately.'
                : 'Saved. One detail that is not on this screen is still needed, so real invoices stay refused.',
        });
        await read(true);
        return;
      }
      setResult(
        status === 409 && body?.code === 'ISSUER_DETAILS_CHANGED'
          ? {
              tone: 'alert',
              latest: true,
              text: 'These details changed after you opened this page. Load the latest details and check them again.',
            }
          : status === 401 && body?.code === 'STEP_UP_REQUIRED'
            ? {
                tone: 'alert',
                text: 'The authenticator check ran out before the save. Enter a new code and save again.',
              }
            : status === 401
              ? {
                  tone: 'alert',
                  text: 'Your sign-in has ended. Sign in again, then save. Copy your answers first.',
                }
              : status === 403
                ? { tone: 'alert', text: 'Only the workspace owner can save the issuer details.' }
                : status === 400 || status === 409
                  ? {
                      tone: 'alert',
                      text: 'Some details were not accepted. Check each step and save again.',
                    }
                  : status === 503 || status === 404
                    ? {
                        tone: 'alert',
                        text: 'The issuer details cannot be saved here right now. Nothing was changed.',
                      }
                    : {
                        tone: 'alert',
                        text: 'The save could not be confirmed. Enter a new code and save again. The same save is never applied twice.',
                      },
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 3) {
      if (check(step)) go(step + 1);
      return;
    }
    void save(event.currentTarget);
  }
  const described = (field: Field, help?: string) =>
    [errors[field] ? `issuer-${field}-error` : '', help ?? ''].filter(Boolean).join(' ') ||
    undefined;
  const text = (
    field: Exclude<keyof Answers, 'gstRegistered'>,
    label: string,
    options: { area?: boolean; help?: string; autoComplete?: string } = {},
  ) => {
    const shared = {
      id: `issuer-${field}`,
      name: field,
      value: answers[field],
      'aria-invalid': errors[field] ? (true as const) : undefined,
      'aria-describedby': described(field, options.help ? `issuer-${field}-help` : undefined),
      autoComplete: options.autoComplete ?? 'off',
    };
    return (
      <div className="invoice-issuer-field">
        {/* The label sits beside its field, not around it: a textarea's value would otherwise join the label's words. */}
        <div className="field">
          <label htmlFor={`issuer-${field}`}>{label}</label>
          {options.area ? (
            <textarea rows={3} {...shared} onChange={(e) => set(field, e.target.value)} />
          ) : (
            <input {...shared} onChange={(e) => set(field, e.target.value)} />
          )}
        </div>
        {options.help ? (
          <p id={`issuer-${field}-help`} className="invoice-issuer-help">
            {options.help}
          </p>
        ) : null}
        {errors[field] ? (
          <FieldError id={`issuer-${field}-error`}>{errors[field]}</FieldError>
        ) : null}
      </div>
    );
  };
  const taxRate = rateLine(view, answers.gstRegistered === 'yes');
  const summary: [string, string][] = [
    ['Legal name', answers.legalName.trim()],
    ['Company registration number (UEN)', answers.uen.trim()],
    ['Registered address', answers.address.trim()],
    ['GST status', answers.gstRegistered === 'yes' ? 'GST registered' : 'Not GST registered'],
    ...(answers.gstRegistered === 'yes'
      ? ([['GST registration number', answers.gstRegistrationNo.trim()]] as [string, string][])
      : []),
    ...(taxRate ? ([['Tax rate on invoices', taxRate]] as [string, string][]) : []),
    ['Payment instructions', answers.paymentInstructions.trim()],
    ['Finance contact label', answers.financeLabel.trim()],
  ];
  return (
    <div className="invoice-issuer">
      <div id="issuer-status" className="invoice-issuer-status">
        <p>
          <StatusBadge tone={view.complete ? 'positive' : 'caution'}>
            {view.complete ? 'Complete' : 'Not complete'}
          </StatusBadge>{' '}
          {statusLine(view)}
        </p>
        <p className="invoice-issuer-help">
          Saving here does not switch real invoices on. Real invoices are{' '}
          {view.realInvoicesOpen ? 'switched on' : 'switched off'}.
        </p>
      </div>
      {result ? (
        <div className="invoice-issuer-result">
          <p id="issuer-result" className="billing-notice" role={result.tone}>
            {result.text}
          </p>
          {result.latest ? (
            <button type="button" className="secondary-link" onClick={() => void read()}>
              Load Latest Details
            </button>
          ) : null}
        </div>
      ) : null}
      <form
        className="operator-form invoice-issuer-form"
        noValidate
        aria-busy={saving ? true : undefined}
        onSubmit={submit}
      >
        <h2 ref={headingRef} tabIndex={-1} className="invoice-issuer-step">
          Step {step + 1} of 4: {steps[step]}
        </h2>
        {step === 0 ? (
          <>
            {text('legalName', 'Legal name', { autoComplete: 'organization' })}
            {text('uen', 'Company registration number (UEN)')}
            {text('address', 'Registered address', { area: true })}
          </>
        ) : null}
        {step === 1 ? (
          <>
            <fieldset
              className="invoice-issuer-choices"
              aria-describedby={described('gstRegistered')}
            >
              <legend>Is the company GST registered?</legend>
              <ChoiceChip
                name="gstRegistered"
                value="yes"
                checked={answers.gstRegistered === 'yes'}
                onChoose={() => set('gstRegistered', 'yes')}
                label="Yes, GST registered"
              />
              <ChoiceChip
                name="gstRegistered"
                value="no"
                checked={answers.gstRegistered === 'no'}
                onChoose={() => set('gstRegistered', 'no')}
                label="No, not GST registered"
              />
            </fieldset>
            {errors.gstRegistered ? (
              <FieldError id="issuer-gstRegistered-error">{errors.gstRegistered}</FieldError>
            ) : null}
            {answers.gstRegistered === 'no' && rateLine(view, false) ? (
              <p className="invoice-issuer-help">
                Invoices will show a tax rate of {rateLine(view, false)}.
              </p>
            ) : null}
            {answers.gstRegistered === 'yes'
              ? text('gstRegistrationNo', 'GST registration number', {
                  help: rateLine(view, true)
                    ? `Invoices will show ${rateLine(view, true)}. You do not type the rate.`
                    : `Invoices show ${view.fixed.taxLabel} at ${view.fixed.gstRateBps / 100}%. The rate is set by the install step.`,
                })
              : null}
          </>
        ) : null}
        {step === 2 ? (
          <>
            {text('paymentInstructions', 'Payment instructions', {
              area: true,
              help: 'Shown on every invoice. Plain words only: bank name, account name and account number. No links or email addresses.',
            })}
            {text('financeLabel', 'Finance contact label', {
              help: 'A name or team shown to customers, for example Corridra finance desk.',
            })}
          </>
        ) : null}
        {step === 3 ? (
          <>
            <dl id="issuer-summary" className="invoice-issuer-summary">
              {summary.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="invoice-issuer-field">
              <div className="field">
                <label htmlFor="issuer-code">Authenticator code</label>
                <input
                  id="issuer-code"
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  aria-invalid={errors.code ? true : undefined}
                  aria-describedby={described('code', 'issuer-code-help')}
                />
              </div>
              <p id="issuer-code-help" className="invoice-issuer-help">
                Enter the six-digit code from your authenticator app. It is checked now, for this
                save only.
              </p>
              {errors.code ? <FieldError id="issuer-code-error">{errors.code}</FieldError> : null}
            </div>
          </>
        ) : null}
        <div className="invoice-issuer-actions">
          <button className="primary-link" disabled={saving}>
            {step < 3 ? 'Next' : 'Save Issuer Details'}
          </button>
          {step > 0 ? (
            <button
              type="button"
              className="secondary-link"
              disabled={saving}
              onClick={() => go(step - 1)}
            >
              Back
            </button>
          ) : null}
        </div>
        {saving ? (
          <p className="billing-notice" role="status">
            Checking the code and saving…
          </p>
        ) : null}
      </form>
    </div>
  );
}
