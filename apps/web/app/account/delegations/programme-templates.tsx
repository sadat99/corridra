'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { currencies, formatMoney, parseMoney } from '@corridra/domain/opportunities';

type Code = keyof typeof currencies;
type CostKind = 'ORGANISER_EXPENSE' | 'ORGANISER_OBLIGATION' | 'CORRIDRA_SERVICE_FEE';
type TaskRow = { title: string; detail: string; offset: string; assignee: string };
type CostRow = { kind: CostKind; description: string; currency: Code; amount: string };
type Content = {
  reportingPurpose: string;
  capacity: number | null;
  tasks: {
    title: string;
    detail: string | null;
    dueOffsetDays: number | null;
    assigneeLabel: string | null;
  }[];
  plannedCosts: { kind: CostKind; description: string; currency: Code; amountMinor: string }[];
};
type Template = {
  id: string;
  seq: number;
  version: number;
  name: string;
  description: string | null;
  retired: boolean;
  content: Content;
  taskCount: number;
  costCount: number;
  capacity: number | null;
};
type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmes: { id: string; name: string }[];
  onChanged: () => void;
};

const kindLabels: Record<CostKind, string> = {
  ORGANISER_EXPENSE: 'Expense',
  ORGANISER_OBLIGATION: 'Amount owed',
  CORRIDRA_SERVICE_FEE: 'Corridra service fee',
};
const kinds = Object.keys(kindLabels) as CostKind[];
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= max;
const nullable = <T,>(v: unknown, ok: (x: unknown) => x is T): v is T | null => v === null || ok(v);
function parseContent(c: unknown): Content {
  if (
    !object(c) ||
    !text(c.reportingPurpose, 500) ||
    !(c.capacity === null || (Number.isInteger(c.capacity) && (c.capacity as number) >= 1)) ||
    !Array.isArray(c.tasks) ||
    c.tasks.length > 50 ||
    !Array.isArray(c.plannedCosts) ||
    c.plannedCosts.length > 30
  )
    throw Error('Invalid content');
  for (const t of c.tasks)
    if (
      !object(t) ||
      !text(t.title, 160) ||
      !nullable(t.detail, (x): x is string => text(x, 1000)) ||
      !nullable(
        t.dueOffsetDays,
        (x): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 730,
      ) ||
      !nullable(t.assigneeLabel, (x): x is string => text(x, 120))
    )
      throw Error('Invalid task');
  for (const k of c.plannedCosts)
    if (
      !object(k) ||
      !kinds.includes(k.kind as CostKind) ||
      !text(k.description, 300) ||
      typeof k.currency !== 'string' ||
      !(k.currency in currencies) ||
      typeof k.amountMinor !== 'string' ||
      !/^[1-9][0-9]{0,17}$/.test(k.amountMinor)
    )
      throw Error('Invalid cost');
  return c as unknown as Content;
}
function parseTemplate(t: unknown): Template {
  if (
    !object(t) ||
    !uuid(t.id) ||
    !Number.isInteger(t.seq) ||
    !Number.isInteger(t.version) ||
    !text(t.name, 120) ||
    !nullable(t.description, (x): x is string => text(x, 500)) ||
    typeof t.retired !== 'boolean' ||
    !Number.isInteger(t.taskCount) ||
    !Number.isInteger(t.costCount) ||
    t.provenance !== 'ORGANISER_RECORDED'
  )
    throw Error('Invalid template');
  parseContent(t.content);
  return t as unknown as Template;
}
const blankTask = (): TaskRow => ({
  title: realCustomerInput() ? '' : 'Synthetic ',
  detail: '',
  offset: '',
  assignee: '',
});
const blankCost = (): CostRow => ({
  kind: 'ORGANISER_EXPENSE',
  description: realCustomerInput() ? '' : 'Synthetic ',
  currency: 'BDT',
  amount: '',
});
const syntheticOk = (v: string) =>
  realCustomerInput() ? v.trim().length >= 2 : /^Synthetic .{3,}/.test(v.trim());

export function ProgrammeTemplates(props: Props) {
  return (
    <ScopedTemplates
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId}
      {...props}
    />
  );
}

function ScopedTemplates({ subject, issuer, workspaceId, programmes, onChanged }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'denied' | 'unavailable'>(
    'loading',
  );
  const [list, setList] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'none' | 'edit' | 'use'>('none');
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [capacity, setCapacity] = useState('');
  const [taskRows, setTaskRows] = useState<TaskRow[]>([]);
  const [costRows, setCostRows] = useState<CostRow[]>([]);
  const [using, setUsing] = useState<Template | null>(null);
  const [target, setTarget] = useState<'new' | string>('new');
  const [programmeName, setProgrammeName] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [startDate, setStartDate] = useState('');
  const [captureFrom, setCaptureFrom] = useState('');
  const active = useRef(true);
  const task = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intents = useRef<Map<string, string>>(new Map());
  const headers = useCallback(
    () => ({ 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer }),
    [subject, issuer],
  );
  const commandFor = (signature: string) => {
    let id = intents.current.get(signature);
    if (!id) {
      id = crypto.randomUUID();
      intents.current.set(signature, id);
    }
    return id;
  };
  const clear = useCallback(() => {
    setList([]);
    setMode('none');
    setEditing(null);
    setUsing(null);
    setName(realCustomerInput() ? '' : 'Synthetic ');
    setDescription('');
    setPurpose(realCustomerInput() ? '' : 'Synthetic ');
    setCapacity('');
    setTaskRows([]);
    setCostRows([]);
    intents.current.clear();
  }, []);
  const lose = useCallback(
    (to: 'denied' | 'failed' | 'unavailable', message: string) => {
      if (timer.current) clearTimeout(timer.current);
      clear();
      setStatus(to);
      setNotice(message);
    },
    [clear],
  );
  const load = useCallback(
    async (keepNotice = false) => {
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      setStatus((current) => (current === 'ready' ? current : 'loading'));
      if (!keepNotice) setNotice('');
      try {
        const r = await fetch(
          '/api/customer-programme-templates?view=list&pageSize=50&workspaceId=' + workspaceId,
          {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: headers(),
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted || !active.current) return;
        if ([401, 403, 409].includes(r.status))
          return lose(
            'denied',
            'Account or workspace access changed. Private details were cleared.',
          );
        if (r.status === 503) return lose('unavailable', 'Programme templates are unavailable.');
        if (!r.ok) throw Error('read failed');
        const v: unknown = await r.json();
        if (
          !object(v) ||
          v.workspaceId !== workspaceId ||
          !Array.isArray(v.templates) ||
          v.templates.length > 50 ||
          typeof v.expiresAt !== 'string'
        )
          throw Error('Invalid list');
        const parsed = v.templates.map(parseTemplate);
        if (controller.signal.aborted || !active.current) return;
        setList(parsed);
        if (timer.current) clearTimeout(timer.current);
        const wait = Date.parse(v.expiresAt) - Date.now();
        if (!(wait > 0))
          return lose('failed', 'This private view expired. Reload to check access again.');
        timer.current = setTimeout(
          () => lose('failed', 'This private view expired. Reload to check access again.'),
          wait,
        );
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted && active.current)
          lose('failed', 'Templates could not be loaded. Reload to check access and try again.');
      }
    },
    [headers, lose, workspaceId],
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

  async function post(action: 'save' | 'apply', input: Record<string, unknown>, signature: string) {
    const r = await fetch('/api/customer-programme-templates', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...headers() },
      body: JSON.stringify({
        action,
        input: { commandId: commandFor(signature), workspaceId, ...input },
      }),
    });
    const body: unknown = await r.json().catch(() => null);
    const changed =
      r.status === 409 &&
      object(body) &&
      typeof body.error === 'string' &&
      body.error.includes('account changed');
    if ([401, 403].includes(r.status) || changed) {
      lose('denied', 'Account or workspace access changed. Private details were cleared.');
      return null;
    }
    if (!r.ok) {
      setError(
        r.status === 409
          ? 'This changed since you opened it, or the programme is not empty. Reload to see the latest.'
          : r.status === 400
            ? 'Some details are not valid. Check the wording, numbers and dates.'
            : 'It could not be saved. What you typed is kept; try again.',
      );
      return null;
    }
    if (!object(body) || typeof body.commandId !== 'string') throw Error('Unconfirmed');
    return body;
  }
  async function guard(work: () => Promise<void>) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch {
      setError('It could not be confirmed. What you typed is kept; try again.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function startEdit(t: Template | null, content?: Content) {
    setError('');
    setMode('edit');
    setEditing(t);
    const c = content ?? t?.content;
    setName(t ? t.name : realCustomerInput() ? '' : 'Synthetic ');
    setDescription(t?.description ?? '');
    setPurpose(c?.reportingPurpose ?? (realCustomerInput() ? '' : 'Synthetic '));
    setCapacity(c?.capacity ? String(c.capacity) : '');
    setTaskRows(
      (c?.tasks ?? []).map((x) => ({
        title: x.title,
        detail: x.detail ?? '',
        offset: x.dueOffsetDays === null ? '' : String(x.dueOffsetDays),
        assignee: x.assigneeLabel ?? '',
      })),
    );
    setCostRows(
      // formatMoney renders "BDT 12.30", so the code and space are dropped to leave the plain amount.
      (c?.plannedCosts ?? []).map((k) => ({
        kind: k.kind,
        description: k.description,
        currency: k.currency,
        amount: formatMoney(k.amountMinor, k.currency).slice(4),
      })),
    );
  }
  function buildContent(): Content | null {
    if (!syntheticOk(purpose))
      return fail(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the default programme purpose with the word Synthetic and add a few words.',
      );
    if (capacity && (!/^[1-9][0-9]{0,4}$/.test(capacity) || Number(capacity) > 10000))
      return fail('Capacity must be a whole number from 1 to 10000, or empty.');
    const tasks: Content['tasks'] = [];
    for (const [i, t] of taskRows.entries()) {
      if (!syntheticOk(t.title))
        return fail(
          'Task ' +
            (i + 1) +
            (realCustomerInput()
              ? ': enter a name with at least two characters.'
              : ': start the title with the word Synthetic and add a few words.'),
        );
      if (t.detail.trim() && !syntheticOk(t.detail))
        return fail(
          'Task ' +
            (i + 1) +
            (realCustomerInput()
              ? ': enter a name with at least two characters.'
              : ': start the detail with the word Synthetic, or clear it.'),
        );
      if (t.assignee.trim() && !syntheticOk(t.assignee))
        return fail(
          'Task ' +
            (i + 1) +
            (realCustomerInput()
              ? ': enter a name with at least two characters.'
              : ': start the assignee with the word Synthetic, or clear it.'),
        );
      if (t.offset && (!/^(0|[1-9][0-9]{0,2})$/.test(t.offset) || Number(t.offset) > 730))
        return fail(
          'Task ' + (i + 1) + ': the due offset is a whole number of days from 0 to 730, or empty.',
        );
      tasks.push({
        title: t.title.trim(),
        detail: t.detail.trim() || null,
        dueOffsetDays: t.offset ? Number(t.offset) : null,
        assigneeLabel: t.assignee.trim() || null,
      });
    }
    const plannedCosts: Content['plannedCosts'] = [];
    for (const [i, k] of costRows.entries()) {
      if (!syntheticOk(k.description))
        return fail(
          'Cost ' +
            (i + 1) +
            (realCustomerInput()
              ? ': enter a name with at least two characters.'
              : ': start the description with the word Synthetic and add a few words.'),
        );
      let amountMinor: string;
      try {
        amountMinor = parseMoney(k.amount, k.currency);
      } catch {
        return fail(
          'Cost ' + (i + 1) + ': enter a positive amount using the currency’s decimal places.',
        );
      }
      plannedCosts.push({
        kind: k.kind,
        description: k.description.trim(),
        currency: k.currency,
        amountMinor,
      });
    }
    return {
      reportingPurpose: purpose.trim(),
      capacity: capacity ? Number(capacity) : null,
      tasks,
      plannedCosts,
    };
  }
  function fail(message: string): null {
    setError(message);
    return null;
  }
  function saveTemplate(
    retired = false,
    source: Template | null = editing,
    contentOverride?: Content,
  ) {
    setError('');
    const content = contentOverride ?? buildContent();
    if (!content) return;
    const nm = source && contentOverride ? source.name : name;
    const ds = source && contentOverride ? source.description : description.trim() || null;
    if (!syntheticOk(nm))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the template name with the word Synthetic and add a few words.',
      );
    if (ds && !syntheticOk(ds))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the description with the word Synthetic, or clear it.',
      );
    const input = {
      expectedVersion: source ? source.version : 0,
      templateId: source ? source.id : null,
      name: nm.trim(),
      description: ds,
      content,
      retired,
    };
    void guard(async () => {
      const body = await post('save', input, 'save' + JSON.stringify(input));
      if (!body) return;
      parseTemplate(body.template);
      setMode('none');
      setEditing(null);
      setNotice(retired ? 'Template retired.' : source ? 'Template saved.' : 'Template created.');
      await load(true);
    });
  }
  function toggleRetired(t: Template) {
    saveTemplate(!t.retired, t, t.content);
  }
  function capture() {
    setError('');
    if (!captureFrom) return setError('Choose a programme to capture.');
    void guard(async () => {
      const r = await fetch(
        '/api/customer-programme-templates?view=capture&workspaceId=' +
          workspaceId +
          '&programmeId=' +
          captureFrom,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: headers(),
        },
      );
      if ([401, 403, 409].includes(r.status))
        return lose('denied', 'Account or workspace access changed. Private details were cleared.');
      if (!r.ok) return setError('The programme plan could not be read. Try again.');
      const v: unknown = await r.json();
      if (!object(v) || v.programmeId !== captureFrom || v.workspaceId !== workspaceId)
        throw Error('Wrong scope');
      startEdit(null, parseContent(v.content));
      setNotice(
        'Plan captured. Review it, name the template and save. Nothing was changed in the programme.',
      );
    });
  }
  function startUse(t: Template) {
    setError('');
    setMode('use');
    setUsing(t);
    setTarget('new');
    setProgrammeName(realCustomerInput() ? '' : 'Synthetic ');
    setStartDate('');
  }
  function apply() {
    setError('');
    if (!using) return;
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
      return setError('Choose a valid start date or clear it.');
    if (
      target === 'new' &&
      !(realCustomerInput()
        ? programmeName.trim().length >= 2
        : /^Synthetic .{3,}/.test(programmeName.trim()))
    )
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the programme name with the word Synthetic and add a few words.',
      );
    const t = using;
    void guard(async () => {
      let programmeId = target;
      if (target === 'new') {
        const created = await fetch('/api/customer-programmes', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', ...headers() },
          body: JSON.stringify({
            commandId: commandFor('create' + t.id + t.version + programmeName.trim()),
            workspaceId,
            name: programmeName.trim(),
            reportingPurpose: t.content.reportingPurpose,
            acknowledged: true,
          }),
        });
        if ([401, 403].includes(created.status))
          return lose(
            'denied',
            'Account or workspace access changed. Private details were cleared.',
          );
        if (!created.ok)
          return setError('The programme could not be created. What you typed is kept; try again.');
        const made: unknown = await created.json();
        if (!object(made) || !uuid(made.id) || made.workspaceId !== workspaceId)
          throw Error('Unconfirmed programme');
        programmeId = made.id;
      }
      const input = {
        programmeId,
        templateId: t.id,
        expectedVersion: t.version,
        startDate: startDate || null,
      };
      const body = await post('apply', input, 'apply' + JSON.stringify(input));
      if (!body) {
        if (target === 'new') onChanged();
        return;
      }
      if (body.programmeId !== programmeId || body.templateId !== t.id)
        throw Error('Unconfirmed application');
      setMode('none');
      setUsing(null);
      setNotice(
        'Template applied: ' +
          body.tasksCreated +
          ' tasks and ' +
          body.plannedCostsCreated +
          ' planned costs were added. No participant or payment was created.',
      );
      onChanged();
      await load(true);
    });
  }

  return (
    <section
      className="detail-card"
      aria-label="Sample programme templates"
      aria-busy={busy || status === 'loading'}
    >
      <h4>Repeatable programme templates</h4>
      <p>
        A template is a starting plan you write or capture from a programme you ran: a default
        purpose, a capacity, tasks and planned costs. It holds no participants, fees, payments or
        results, and applying it sends nothing. It can only be applied to a programme that has no
        tasks, capacity or costs yet.
      </p>
      {status === 'loading' && (
        <p role="status">
          {' '}
          {realCustomerInput() ? 'Loading templates…' : 'Loading sample templates…'}{' '}
        </p>
      )}
      {status === 'unavailable' && <p role="status">{notice}</p>}
      {(status === 'denied' || status === 'failed') && (
        <>
          <p role="alert">{notice}</p>
          {status === 'failed' && (
            <button type="button" className="text-link" onClick={() => void load()}>
              Reload templates
            </button>
          )}
        </>
      )}
      {status === 'ready' && (
        <>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
          {list.length === 0 ? (
            <p className="ux-empty">No templates yet.</p>
          ) : (
            <ul>
              {list.map((t) => (
                <li key={t.id}>
                  <strong>{t.name}</strong> · version {t.version}
                  {t.retired ? ' · retired' : ''}
                  <br />
                  {t.description ? (
                    <>
                      {t.description}
                      <br />
                    </>
                  ) : null}
                  {t.taskCount} task{t.taskCount === 1 ? '' : 's'} · {t.costCount} planned cost
                  {t.costCount === 1 ? '' : 's'}
                  {t.capacity ? ' · capacity ' + t.capacity : ''}{' '}
                  {!t.retired && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => startUse(t)}
                    >
                      Use template {t.name}
                    </button>
                  )}{' '}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => startEdit(t)}
                  >
                    Edit template {t.name}
                  </button>{' '}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => toggleRetired(t)}
                  >
                    {t.retired ? 'Restore template ' : 'Retire template '}
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mode === 'none' && (
            <>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => startEdit(null)}
              >
                New template
              </button>
              <div className="operator-form">
                <label className="field">
                  Capture the plan of a programme
                  <select
                    value={captureFrom}
                    disabled={busy}
                    onChange={(e) => setCaptureFrom(e.target.value)}
                  >
                    <option value="">Choose a programme</option>
                    {programmes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="text-link" disabled={busy} onClick={capture}>
                  Capture plan
                </button>
              </div>
            </>
          )}
          {mode === 'edit' && (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveTemplate(false);
              }}
            >
              <h5>{editing ? 'Edit template' : 'New template'}</h5>
              <label className="field">
                {realCustomerInput() ? 'Template name' : 'Template name (start with Synthetic)'}{' '}
                <input
                  type="text"
                  maxLength={120}
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                {realCustomerInput()
                  ? 'Description (optional)'
                  : 'Description (optional, start with Synthetic)'}{' '}
                <input
                  type="text"
                  maxLength={500}
                  value={description}
                  disabled={busy}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className="field">
                {realCustomerInput()
                  ? 'Default programme purpose'
                  : 'Default programme purpose (start with Synthetic)'}{' '}
                <input
                  type="text"
                  maxLength={500}
                  value={purpose}
                  disabled={busy}
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </label>
              <label className="field">
                Places available (optional)
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={capacity}
                  disabled={busy}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </label>
              <h5>Tasks</h5>
              {taskRows.map((t, i) => (
                <fieldset key={i}>
                  <legend>Task {i + 1}</legend>
                  <label className="field">
                    Task {i + 1} title
                    <input
                      type="text"
                      maxLength={160}
                      value={t.title}
                      disabled={busy}
                      onChange={(e) =>
                        setTaskRows(
                          taskRows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Task {i + 1} detail (optional)
                    <input
                      type="text"
                      maxLength={1000}
                      value={t.detail}
                      disabled={busy}
                      onChange={(e) =>
                        setTaskRows(
                          taskRows.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Task {i + 1} due days after the start (optional)
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={t.offset}
                      disabled={busy}
                      onChange={(e) =>
                        setTaskRows(
                          taskRows.map((x, j) => (j === i ? { ...x, offset: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Task {i + 1} who is responsible (optional)
                    <input
                      type="text"
                      maxLength={120}
                      value={t.assignee}
                      disabled={busy}
                      onChange={(e) =>
                        setTaskRows(
                          taskRows.map((x, j) =>
                            j === i ? { ...x, assignee: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => setTaskRows(taskRows.filter((_, j) => j !== i))}
                  >
                    Remove task {i + 1}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                className="text-link"
                disabled={busy || taskRows.length >= 50}
                onClick={() => setTaskRows([...taskRows, blankTask()])}
              >
                Add a task
              </button>
              <h5>Planned costs</h5>
              {costRows.map((k, i) => (
                <fieldset key={i}>
                  <legend>Planned cost {i + 1}</legend>
                  <label className="field">
                    Cost {i + 1} type
                    <select
                      value={k.kind}
                      disabled={busy}
                      onChange={(e) =>
                        setCostRows(
                          costRows.map((x, j) =>
                            j === i ? { ...x, kind: e.target.value as CostKind } : x,
                          ),
                        )
                      }
                    >
                      {kinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kindLabels[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Cost {i + 1} description
                    <input
                      type="text"
                      maxLength={300}
                      value={k.description}
                      disabled={busy}
                      onChange={(e) =>
                        setCostRows(
                          costRows.map((x, j) =>
                            j === i ? { ...x, description: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Cost {i + 1} currency
                    <select
                      value={k.currency}
                      disabled={busy}
                      onChange={(e) =>
                        setCostRows(
                          costRows.map((x, j) =>
                            j === i ? { ...x, currency: e.target.value as Code } : x,
                          ),
                        )
                      }
                    >
                      {(Object.keys(currencies) as Code[]).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Cost {i + 1} amount ({currencies[k.currency]} decimal places)
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={k.amount}
                      disabled={busy}
                      onChange={(e) =>
                        setCostRows(
                          costRows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => setCostRows(costRows.filter((_, j) => j !== i))}
                  >
                    Remove cost {i + 1}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                className="text-link"
                disabled={busy || costRows.length >= 30}
                onClick={() => setCostRows([...costRows, blankCost()])}
              >
                Add a planned cost
              </button>
              <button type="submit" className="primary-link" disabled={busy}>
                {editing ? 'Save template' : 'Create template'}
              </button>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setMode('none');
                  setEditing(null);
                  setError('');
                }}
              >
                Cancel
              </button>
            </form>
          )}
          {mode === 'use' && using && (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                apply();
              }}
            >
              <h5>Use {using.name}</h5>
              <label className="field">
                Where should it go?
                <select value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
                  <option value="new">A new programme</option>
                  {programmes.map((p) => (
                    <option key={p.id} value={p.id}>
                      Existing programme: {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {target === 'new' && (
                <label className="field">
                  {realCustomerInput()
                    ? 'New programme name'
                    : 'New programme name (start with Synthetic)'}{' '}
                  <input
                    type="text"
                    maxLength={160}
                    value={programmeName}
                    disabled={busy}
                    onChange={(e) => setProgrammeName(e.target.value)}
                  />
                </label>
              )}
              <label className="field">
                Programme start date (optional, sets task due dates and dates the planned costs)
                <input
                  type="date"
                  value={startDate}
                  min="2000-01-01"
                  max="2100-01-01"
                  disabled={busy}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>
              <p>
                {using.taskCount} tasks, {using.costCount} planned costs
                {using.capacity ? ' and a capacity of ' + using.capacity : ''} will be added. An
                existing programme must have no tasks, capacity or costs.
              </p>
              <button type="submit" className="primary-link" disabled={busy}>
                Apply template
              </button>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setMode('none');
                  setUsing(null);
                  setError('');
                }}
              >
                Cancel
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
