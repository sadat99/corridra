'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { ProgrammePageView } from '../../delegations/[address]/programme-page-view';
import '../../delegations/[address]/programme-page.css';
import './first-run.css';
import { pp } from '../../../lib/i18n/programme-pages';
import { useFormDraft } from '../../../lib/ux/use-form-draft';
import { customerHeaders, object, uuid } from './pricing-client';
import { pageRequest, parsePageView } from './programme-page-client';
import {
  copyFrom,
  emptyDraft,
  isoDay,
  lineProblem,
  type Draft,
  type FirstRunLine,
} from './programme-page';
import { parseTemplate } from './programme-templates';

// The guided first run (ADR-084 slice S0): from "I want to run a delegation" to a published page in three steps of
// at most three fields. It adds no command, field, id or payload. Publish sends, in order, the existing create
// command, the existing template application when a template was chosen (tasks and planned costs only, never people,
// fees or payments) and the existing publish command with its closing rule. Until that press everything typed lives
// in this browser's session storage and nowhere else; nothing is public and nothing is on the server.
type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  templatesEnabled: boolean;
  /** The new programme is saved and its page is public. */
  onPublished: (programmeId: string) => void;
  /** The account or the workspace role changed; the page clears what it holds. */
  onDenied: () => void;
  /** The plain create form, folded; it sits under the preview on a wide screen and after it on a phone. */
  plain?: ReactNode;
};
// What is kept in the session. The four lines under "More Page Lines" are absent until the organiser changes one,
// so the workspace's own name and the page's plain "Not stated yet" stand in for them and are seen in the preview.
export type FirstRunKept = {
  step: number;
  title: string;
  destination: string;
  templateId: string;
  dates: string;
  unsure: boolean;
  audience: string;
  summary: string;
  fee: string;
  capacity: string;
  organiser?: string;
  focus?: string;
  eligibility?: string;
  closes?: string;
  // How far a Publish press got, so the next press never repeats a finished command.
  createId?: string;
  createFor?: string;
  programmeId?: string;
  applyId?: string;
  appliedTemplate?: string;
  publishId?: string;
  publishFor?: string;
};
type TemplateChoice = { id: string; version: number; name: string };
const steps = [
  pp('pp.first.step.name'),
  pp('pp.first.step.dates'),
  pp('pp.first.step.fee'),
  pp('pp.first.step.review'),
];
// The lines each step asks for, in the order they are shown and judged.
export const firstRunStepLines: readonly (readonly FirstRunLine[])[] = [
  ['title', 'destination'],
  ['dates', 'audience', 'summary'],
  ['fee', 'capacity'],
  // The review step asks for no line of its own: it shows the others with an Edit action each, and the two ticks.
  [],
];
export const firstRunMoreLines: readonly FirstRunLine[] = [
  'organiser',
  'focus',
  'eligibility',
  'closes',
];
const last = firstRunStepLines.length - 1;
const fresh = (sample: boolean): FirstRunKept => ({
  step: 0,
  // A sample programme and its organiser are marked in their names; the first word is offered, as the templates do.
  title: sample ? 'Synthetic ' : '',
  destination: '',
  templateId: '',
  dates: '',
  unsure: false,
  audience: '',
  summary: '',
  fee: '',
  capacity: '',
});
const day = /^\d{4}-\d{2}-\d{2}$/;
/** The editor's own draft, filled from the first run: the same lines, so the same rules and the same public copy. */
export function firstRunPageDraft(kept: FirstRunKept, workspaceName: string): Draft {
  return {
    ...emptyDraft(kept.title),
    organiser: kept.organiser ?? workspaceName,
    summary: kept.summary,
    destination: kept.destination,
    dates: kept.unsure ? pp('pp.first.dates.unsureValue') : kept.dates,
    focus: kept.focus ?? pp('pp.public.notStated'),
    audience: kept.audience,
    eligibility: kept.eligibility ?? pp('pp.public.notStated'),
    capacity: kept.capacity,
    fee: kept.fee,
    closes: kept.closes ?? isoDay(30),
  };
}
/** The private purpose the create command asks for: the organiser's own "What it is for", inside its 500 characters. */
export function firstRunPurpose(summary: string) {
  let out = '';
  for (const char of summary.trim()) {
    if (out.length + char.length > 500) break;
    out += char;
  }
  return out.trim();
}
// One paragraph: the public lines are single lines, so a line break typed in a box becomes a space.
const oneParagraph = (value: string) => value.replace(/\s*[\r\n]+\s*/g, ' ');

export function FirstRun(props: Props) {
  return (
    <ScopedFirstRun key={props.issuer + ':' + props.subject + ':' + props.workspaceId} {...props} />
  );
}

function ScopedFirstRun({
  subject,
  issuer,
  workspaceId,
  templatesEnabled,
  onPublished,
  onDenied,
  plain,
}: Props) {
  const sample = !realCustomerInput();
  const store = useFormDraft<FirstRunKept>(
    'programme-first-run:' + JSON.stringify([issuer, subject, workspaceId]),
  );
  const kept: FirstRunKept = { ...fresh(sample), ...(store.draft ?? {}) };
  const step = Math.min(Math.max(Number.isInteger(kept.step) ? kept.step : 0, 0), last);
  const [workspaceName, setWorkspaceName] = useState('');
  const [templates, setTemplates] = useState<TemplateChoice[]>([]);
  const [planning, setPlanning] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const writing = useRef(false);
  const moved = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const headersRef = useRef(customerHeaders(subject, issuer));
  const titleId = useId();

  // Two quiet reads of what already exists: the workspace's own name, offered as "Organised by", and the workspace's
  // templates. Neither is needed to continue; where one cannot be read the line is typed and no template is offered.
  useEffect(() => {
    const task = new AbortController();
    const get = (url: string) =>
      fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: headersRef.current,
        signal: task.signal,
      });
    void Promise.resolve().then(async () => {
      // The preview starts open where there is room for it beside the form; on a phone it is one tap away.
      setPreviewOpen(window.matchMedia('(min-width: 64rem)').matches);
      try {
        const r = await get('/api/customer-workspaces');
        const body: unknown = r.ok ? await r.json() : null;
        const rows = object(body) && Array.isArray(body.workspaces) ? body.workspaces : [];
        const mine = rows.find((row) => object(row) && row.id === workspaceId);
        if (!task.signal.aborted && object(mine) && typeof mine.name === 'string')
          setWorkspaceName(mine.name.trim().slice(0, 160));
      } catch {
        /* The line stays empty and is typed under More Page Lines. */
      }
      if (!templatesEnabled) return;
      try {
        const r = await get(
          '/api/customer-programme-templates?view=list&pageSize=50&workspaceId=' + workspaceId,
        );
        const body: unknown = r.ok ? await r.json() : null;
        if (
          task.signal.aborted ||
          !object(body) ||
          body.workspaceId !== workspaceId ||
          !Array.isArray(body.templates)
        )
          return;
        setTemplates(
          body.templates
            .map(parseTemplate)
            .filter((t) => !t.retired)
            .map((t) => ({ id: t.id, version: t.version, name: t.name })),
        );
      } catch {
        /* No template is offered. */
      }
    });
    return () => task.abort();
  }, [workspaceId, templatesEnabled]);
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);

  const save = (change: Partial<FirstRunKept>) => store.save({ ...kept, ...change });
  const page = firstRunPageDraft(kept, workspaceName);
  const wrongIn = (lines: readonly FirstRunLine[]) => {
    for (const line of lines) {
      const wrong = lineProblem(line, page, sample);
      if (wrong) return wrong;
    }
    return '';
  };
  function go(to: number) {
    moved.current = true;
    setError('');
    save({ step: to });
  }
  function forward() {
    const wrong = wrongIn(firstRunStepLines[step]!);
    setError(wrong);
    if (!wrong) go(step + 1);
  }
  function denied() {
    store.clear();
    onDenied();
  }

  async function publish() {
    if (writing.current || !store.restored) return;
    for (let s = 0; s <= last; s++) {
      const wrong = wrongIn(firstRunStepLines[s]!);
      if (wrong) {
        if (s !== step) go(s);
        setError(wrong);
        return;
      }
    }
    const more = wrongIn(firstRunMoreLines);
    if (more) {
      setMoreOpen(true);
      if (step !== 2) go(2);
      setError(more);
      return;
    }
    if (!planning || !agreed) {
      setError(pp('pp.first.ackNeeded'));
      return;
    }
    writing.current = true;
    setError('');
    // Each finished stage is written to the session at once, so a failure further on, or a reload, picks up from there.
    let now: FirstRunKept = kept;
    const keep = (change: Partial<FirstRunKept>) => {
      now = { ...now, ...change };
      store.save(now);
    };
    const stop = (message: string) => {
      writing.current = false;
      setBusy('');
      setError(message);
    };
    const headers = { 'content-type': 'application/json', ...headersRef.current };
    try {
      let programmeId = now.programmeId;
      if (!programmeId) {
        setBusy(pp('pp.first.busy.create'));
        const name = page.title.trim();
        const reportingPurpose = firstRunPurpose(page.summary);
        const createFor = JSON.stringify([name, reportingPurpose]);
        // The same words are the same request: a retry after a lost answer cannot create a second programme.
        if (now.createFor !== createFor || !now.createId)
          keep({ createFor, createId: crypto.randomUUID() });
        const created = await fetch('/api/customer-programmes', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({
            commandId: now.createId,
            workspaceId,
            name,
            reportingPurpose,
            acknowledged: true,
          }),
        });
        if ([401, 403].includes(created.status)) {
          writing.current = false;
          setBusy('');
          return denied();
        }
        if (created.status === 409) return stop(pp('pp.first.error.conflict'));
        if (!created.ok) return stop(pp('pp.first.error.create'));
        const made: unknown = await created.json();
        if (!object(made) || !uuid(made.id) || made.workspaceId !== workspaceId)
          return stop(pp('pp.first.error.create'));
        programmeId = made.id;
        keep({ programmeId });
      }
      const template = templates.find((t) => t.id === now.templateId);
      if (template && now.appliedTemplate !== template.id) {
        setBusy(pp('pp.first.busy.template'));
        if (!now.applyId) keep({ applyId: crypto.randomUUID() });
        const applied = await fetch('/api/customer-programme-templates', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({
            action: 'apply',
            input: {
              commandId: now.applyId,
              workspaceId,
              programmeId,
              templateId: template.id,
              expectedVersion: template.version,
              startDate: null,
            },
          }),
        });
        const body: unknown = await applied.json().catch(() => null);
        if (
          !applied.ok ||
          !object(body) ||
          body.programmeId !== programmeId ||
          body.templateId !== template.id
        )
          return stop(pp('pp.first.error.template'));
        keep({ appliedTemplate: template.id });
      }
      setBusy(pp('pp.edit.publishing'));
      const read = await fetch(
        `/api/customer-programme-pages?view=page&workspaceId=${workspaceId}&programmeId=${programmeId}`,
        { cache: 'no-store', credentials: 'same-origin', headers: headersRef.current },
      );
      if (!read.ok) return stop(pp('pp.first.error.page'));
      const view = parsePageView(await read.json());
      const copy = copyFrom(page);
      const closesAt = `${page.closes}T23:59:00.000Z`;
      const publishFor = JSON.stringify([programmeId, view.version, copy, closesAt]);
      if (now.publishFor !== publishFor || !now.publishId)
        keep({ publishFor, publishId: crypto.randomUUID() });
      const result = await pageRequest(
        { subject, issuer },
        {
          kind: 'page',
          action: 'publish',
          commandId: now.publishId,
          workspaceId,
          programmeId,
          expectedVersion: view.version,
          copy,
          closesAt,
          acknowledged: true,
        },
      );
      if (!result.ok) return stop(result.message);
      writing.current = false;
      setBusy('');
      store.clear();
      onPublished(programmeId);
    } catch {
      stop(now.programmeId ? pp('pp.first.error.page') : pp('pp.first.error.create'));
    }
  }

  const locked = !store.restored || busy !== '';
  const text = (
    key: FirstRunLine,
    label: string,
    hint: string,
    options: { area?: boolean; max?: number; type?: string; disabled?: boolean } = {},
  ) => {
    // A line under More Page Lines shows what stands in for it until it is changed.
    const value = (kept as Record<string, unknown>)[key] ?? page[key];
    const change = (next: string) => save({ [key]: options.area ? oneParagraph(next) : next });
    return (
      <label className="field">
        <span>{label}</span>
        {options.area ? (
          <textarea
            name={`first-${key}`}
            rows={2}
            maxLength={options.max}
            value={value as string}
            disabled={locked}
            onChange={(event) => change(event.target.value)}
          />
        ) : (
          <input
            name={`first-${key}`}
            type={options.type ?? 'text'}
            maxLength={options.max}
            min={options.type === 'date' ? isoDay(1) : undefined}
            max={options.type === 'date' ? isoDay(179) : undefined}
            inputMode={key === 'capacity' ? 'numeric' : undefined}
            value={options.disabled ? '' : (value as string)}
            disabled={locked || options.disabled}
            onChange={(event) => change(event.target.value)}
          />
        )}
        <small>{hint}</small>
      </label>
    );
  };
  // The preview is the public view itself, fed the words typed so far. A line not written yet says so in the
  // preview only; Publish refuses until every line the page needs is written.
  const copy = copyFrom(page);
  const shown = (line: string) => line || pp('pp.first.preview.empty');
  // The sample mark offered in the name box is not a name yet, so the preview does not show it as one.
  const previewName = copy.title.trim() === 'Synthetic' ? '' : copy.title;
  const previewCloses = day.test(page.closes) ? page.closes : isoDay(30);
  // The review step: every answer of the first three steps, each group with an Edit action back to its step.
  const reviewGroups: {
    step: number;
    lines: {
      key: 'title' | 'destination' | 'dates' | 'audience' | 'summary' | 'fee' | 'capacity';
      label: string;
    }[];
  }[] = [
    {
      step: 0,
      lines: [
        { key: 'title', label: pp('pp.first.name.label') },
        { key: 'destination', label: pp('pp.edit.destination.label') },
      ],
    },
    {
      step: 1,
      lines: [
        { key: 'dates', label: pp('pp.edit.dates.label') },
        { key: 'audience', label: pp('pp.edit.audience.label') },
        { key: 'summary', label: pp('pp.edit.summary.label') },
      ],
    },
    {
      step: 2,
      lines: [
        { key: 'fee', label: pp('pp.edit.fee.label') },
        { key: 'capacity', label: pp('pp.edit.capacity.label') },
      ],
    },
  ];

  return (
    <section className="first-run" aria-labelledby={titleId}>
      <header className="first-run-head">
        <h2 id={titleId}>{pp('pp.first.title')}</h2>
        <p className="programme-note">{pp('pp.first.lead')}</p>
      </header>
      <div className="first-run-form">
        <form
          className="programme-page-editor"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (step === last) void publish();
            else forward();
          }}
        >
          <h3 ref={heading} tabIndex={-1}>
            {pp('pp.edit.step', { step: step + 1, total: steps.length, name: steps[step]! })}
          </h3>
          <progress max={steps.length} value={step + 1} aria-label={pp('pp.edit.progress')}>
            {pp('pp.edit.progressValue', { step: step + 1, total: steps.length })}
          </progress>
          {!store.restored && <p role="status">{pp('pp.first.restoring')}</p>}
          {step === 0 && (
            <>
              {text('title', pp('pp.first.name.label'), pp('pp.edit.title.hint'), { max: 160 })}
              {text(
                'destination',
                pp('pp.edit.destination.label'),
                pp('pp.edit.destination.hint'),
                { max: 160 },
              )}
              {templates.length > 0 && (
                <label className="field">
                  <span>{pp('pp.first.template.label')}</span>
                  <select
                    name="first-template"
                    value={templates.some((t) => t.id === kept.templateId) ? kept.templateId : ''}
                    disabled={locked || !!kept.appliedTemplate}
                    onChange={(event) => save({ templateId: event.target.value })}
                  >
                    <option value="">{pp('pp.first.template.none')}</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <small>{pp('pp.first.template.hint')}</small>
                </label>
              )}
            </>
          )}
          {step === 1 && (
            <>
              {text('dates', pp('pp.edit.dates.label'), pp('pp.first.dates.hint'), {
                max: 160,
                disabled: kept.unsure,
              })}
              <label className="check-field">
                <input
                  type="checkbox"
                  name="first-dates-unsure"
                  checked={kept.unsure}
                  disabled={locked}
                  onChange={(event) => save({ unsure: event.target.checked })}
                />
                {pp('pp.first.dates.unsure')}
              </label>
              {text('audience', pp('pp.edit.audience.label'), pp('pp.edit.audience.hint'), {
                area: true,
                max: 600,
              })}
              {text('summary', pp('pp.edit.summary.label'), pp('pp.edit.summary.hint'), {
                area: true,
                max: 1200,
              })}
            </>
          )}
          {step === 2 && (
            <>
              {text('fee', pp('pp.edit.fee.label'), pp('pp.edit.fee.hint'), { max: 300 })}
              {text('capacity', pp('pp.edit.capacity.label'), pp('pp.edit.capacity.hint'), {
                max: 4,
              })}
              <details
                className="first-run-more"
                open={moreOpen}
                onToggle={(event) => setMoreOpen(event.currentTarget.open)}
              >
                <summary>{pp('pp.first.more')}</summary>
                <p className="programme-note">{pp('pp.first.more.note')}</p>
                {text('organiser', pp('pp.edit.organiser.label'), pp('pp.edit.organiser.hint'), {
                  max: 160,
                })}
                {text('focus', pp('pp.edit.focus.label'), pp('pp.edit.focus.hint'), { max: 300 })}
                {text(
                  'eligibility',
                  pp('pp.edit.eligibility.label'),
                  pp('pp.edit.eligibility.hint'),
                  { max: 600 },
                )}
                {text('closes', pp('pp.edit.closes.label'), pp('pp.edit.closes.hint'), {
                  type: 'date',
                })}
              </details>
            </>
          )}
          {step === last && (
            <>
              <div className="first-run-review">
                {reviewGroups.map((group) => (
                  <div key={group.step} className="first-run-review-group">
                    <h4>{steps[group.step]}</h4>
                    <dl>
                      {group.lines.map((line) => (
                        <div key={line.key}>
                          <dt>{line.label}</dt>
                          <dd>{page[line.key] || pp('pp.first.preview.empty')}</dd>
                        </div>
                      ))}
                    </dl>
                    <button
                      type="button"
                      className="text-link"
                      disabled={locked}
                      aria-label={pp('pp.first.review.editName', { name: steps[group.step]! })}
                      onClick={() => go(group.step)}
                    >
                      {pp('pp.first.review.edit')}
                    </button>
                  </div>
                ))}
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="first-ack-planning"
                  checked={planning}
                  disabled={locked}
                  onChange={(event) => setPlanning(event.target.checked)}
                />
                {sample ? pp('pp.first.ack.sample') : pp('pp.first.ack.planning')}
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="first-ack-page"
                  checked={agreed}
                  disabled={locked}
                  onChange={(event) => setAgreed(event.target.checked)}
                />
                {pp('pp.edit.agree')}
              </label>
            </>
          )}
          {kept.programmeId && !busy && !error && (
            <p className="programme-note">{pp('pp.first.saved.note')}</p>
          )}
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">{busy}</p>}
          <div className="guide-actions-row">
            <button type="submit" className="primary-link" disabled={locked}>
              {step === last
                ? busy
                  ? pp('pp.edit.publishing')
                  : pp('pp.edit.publish')
                : pp('pp.edit.continue')}
            </button>
            {step > 0 && (
              <button
                type="button"
                className="text-link"
                disabled={locked}
                onClick={() => go(step - 1)}
              >
                {pp('pp.edit.back')}
              </button>
            )}
            {store.draft && (
              <button
                type="button"
                className="text-link"
                disabled={locked}
                onClick={() => {
                  if (!window.confirm(pp('pp.first.startAgainConfirm'))) return;
                  moved.current = true;
                  setError('');
                  setPlanning(false);
                  setAgreed(false);
                  setMoreOpen(false);
                  store.clear();
                }}
              >
                {pp('pp.first.startAgain')}
              </button>
            )}
          </div>
        </form>
      </div>
      <div className="first-run-side">
        <details
          className="first-run-preview"
          open={previewOpen}
          onToggle={(event) => setPreviewOpen(event.currentTarget.open)}
        >
          <summary>{pp('pp.first.preview.open')}</summary>
          <div
            className="first-run-preview-page"
            role="region"
            aria-label={pp('pp.first.preview.title')}
            tabIndex={0}
          >
            <p className="programme-note">{pp('pp.first.preview.note')}</p>
            <p className="first-run-preview-name">{previewName || pp('pp.first.preview.name')}</p>
            <ProgrammePageView
              preview
              page={{
                state: 'OPEN',
                programme: {
                  ...copy,
                  title: previewName || pp('pp.first.preview.name'),
                  summary: shown(copy.summary),
                  destination: shown(copy.destination),
                  dates: shown(copy.dates),
                  organiser: shown(copy.organiser),
                  focus: shown(copy.focus),
                  audience: shown(copy.audience),
                  eligibility: shown(copy.eligibility),
                },
                closesAt: `${previewCloses}T23:59:00.000Z`,
                sample,
              }}
            />
          </div>
        </details>
        {plain}
      </div>
    </section>
  );
}
