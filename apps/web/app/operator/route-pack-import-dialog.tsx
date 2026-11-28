'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { StatusBadge } from '../../components/access-state';
import { CorridraIcon } from '../../components/corridra-icon';
import { FieldError } from '../../components/field-error';
import { ChangeSummary } from '../../components/ux/change-summary';
import { Dialog } from '../../components/ux/dialog';
import { standardFieldByKey, standardFieldsV1 } from '@corridra/domain/route-pack-standard';
import type { SheetReport, SheetRoutePlan } from '@corridra/missions/route-pack-sheet';
import type { RouteSummary } from '../../lib/route-pack-editor-read';
import { addressFor } from '../../lib/route-pack-editor-view';
import {
  changedUnnamed,
  decodeSheet,
  doneRoutes,
  dryRunBody,
  fileRefusal,
  nextSaveCommand,
  routeResults,
  onlyPendingCustom,
  packFieldLabels,
  problemItems,
  saveBody,
  savedFactCount,
  savedSummary,
  skippedRows,
  type RouteResult,
  type FileRefusal,
  type ProblemItem,
  type SaveCommand,
  type SaveOutcome,
} from '../../lib/route-pack-editor-sheet';
import { countryName } from './country-name';
import { importWords } from './route-pack-data-words';
import { packWords, reasonCount } from './route-pack-pack-words';
import { checkSheet, downloadText, saveSheet } from './route-pack-sheet-send';
import {
  blankTemplate,
  problemList,
  problemListName,
  templateName,
} from './route-pack-sheet-files';
import './route-pack-pack.css';
import './route-pack-data.css';

// ADR-093 Phase 3, PR 4: Import Route Data (spec 12.1). One dialog, four steps in words. Choosing a file starts the check (a dry
// run, audit.read, writes nothing) at once; problems block the save and list every row; a clean check shows what each route
// would get; only the owner saves (config.manage plus a fresh authenticator check, opened in place by sendWithStepUp). One save
// id belongs to one file text: Try the Rest Again and a send after the authenticator check reuse it, so nothing is written
// twice. The file, the save id and the reason live only in this component's state and are dropped when it closes.

type Step = 1 | 2 | 3 | 4;
type View =
  | { kind: 'form' }
  | { kind: 'problems'; items: ProblemItem[]; rows: number }
  | { kind: 'saved'; words: string; first: string | null }
  /** Part way, or a route changed after something was written: what each route got, and Try the Rest Again. */
  | { kind: 'partWay'; report: SheetReport }
  /** A route changed and nothing was written (the server named none). */
  | { kind: 'changed' };

const routeName = (key: string) => {
  const [origin, destination] = key.split('-');
  return origin && destination ? `${countryName(origin)} to ${countryName(destination)}` : key;
};
const labelOf = (key: string) => standardFieldByKey.get(key)?.label ?? key;
const fieldNames = (list: { key: string; label: string }[]) =>
  list.map((item) => item.label || labelOf(item.key));
/** One line for a route a save did not finish, in the words of spec 12.1 (PR 4 per G72). */
function resultLine(item: Exclude<RouteResult, { kind: 'done' }>) {
  const name = routeName(item.route);
  if (item.kind === 'factsOnly')
    return item.why === 'changed'
      ? importWords.factsSavedPackChanged(name)
      : item.why === 'refused' && item.reason
        ? importWords.factsSavedReason(name, item.reason)
        : importWords.factsSavedPackNotTried(name);
  if (item.why === 'changed') return importWords.routeChanged(name);
  return item.why === 'refused' && item.reason
    ? importWords.routeReason(name, item.reason)
    : importWords.notTried(name);
}

export function RouteDataImportDialog({
  open,
  onClose,
  tenant,
  role,
  onePersonPublication,
  routes,
  onSaved,
  onOpenRoute,
  onBusy,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  tenant: string;
  role: string;
  /** The one-person module is installed: the save shows the one-person line. */
  onePersonPublication: boolean;
  routes: RouteSummary[];
  /** A save wrote something: the page reads the routes again and keeps the words for its status line. */
  onSaved: (words: string) => void;
  /** Open {Route}: the dialog has closed and the page opens that route, focus on its name. */
  onOpenRoute: (key: string) => void;
  /** A check runs (true) or has settled (false): the list head shows the opener busy meanwhile. */
  onBusy: (busy: boolean) => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const owner = role === 'owner';
  const [step, setStep] = useState<Step>(1);
  const [view, setView] = useState<View>({ kind: 'form' });
  const [refusal, setRefusal] = useState<FileRefusal | 'encoding' | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [report, setReport] = useState<SheetReport | null>(null);
  const [allProblems, setAllProblems] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const command = useRef<SaveCommand | null>(null);
  // Facts written by earlier answers of the same save (a part way save finished by Try the Rest Again), and whether any wrote.
  const factsSoFar = useRef(0);
  const wroteBefore = useRef(false);
  // Each check has a number; an answer for an older one (the file was changed or the dialog closed) is dropped.
  const asked = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const doneLine = useRef<HTMLParagraphElement>(null);
  const banner = useRef<HTMLDivElement>(null);
  const reasonBox = useRef<HTMLTextAreaElement>(null);
  const stepLine = useRef<HTMLParagraphElement>(null);
  const focusAfter = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    target()?.focus();
  });

  const reset = () => {
    setStep(1);
    setView({ kind: 'form' });
    setRefusal(null);
    setFile(null);
    setChecking(false);
    setCheckFailed(false);
    setReport(null);
    setAllProblems(false);
    setSaveError(null);
  };
  // A closed dialog starts again from its first step; the file, its save id and the reason are dropped.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      reset();
      setReason('');
      setReasonError(false);
      setSaving(false);
    }
  }
  const forget = () => {
    asked.current++;
    command.current = null;
    factsSoFar.current = 0;
    wroteBefore.current = false;
    if (checking) onBusy(false);
  };
  const close = () => {
    forget();
    onClose();
  };

  const check = async (csv: string) => {
    const mine = ++asked.current;
    setChecking(true);
    setCheckFailed(false);
    onBusy(true);
    const outcome = await checkSheet(tenant, dryRunBody(csv));
    if (mine !== asked.current) return;
    setChecking(false);
    onBusy(false);
    if (outcome.kind === 'failed') {
      setCheckFailed(true);
      focusAfter.current = () => banner.current;
      return;
    }
    if (outcome.kind === 'fileProblem') {
      showProblems([
        {
          row: null,
          route: null,
          label: null,
          message: outcome.message ?? importWords.checkFailed,
        },
      ]);
      return;
    }
    if (outcome.report.errors.length) {
      const found = problemItems(outcome.report.errors, labelOf);
      showProblems(found.items, found.rows);
      return;
    }
    setReport(outcome.report);
    setStep(3);
    focusAfter.current = () => heading.current;
  };
  const showProblems = (items: ProblemItem[], rows = 0) => {
    setView({ kind: 'problems', items, rows });
    setAllProblems(false);
    focusAfter.current = () => heading.current;
  };
  const choose = async (chosen: File | undefined) => {
    if (!chosen) return;
    const refused = fileRefusal(chosen);
    setRefusal(refused);
    if (refused) {
      if (input.current) input.current.value = '';
      focusAfter.current = () => input.current;
      return;
    }
    let csv: string | null;
    try {
      // Decoded strictly: a file that is not UTF-8 is refused here, before any upload, instead of being changed silently.
      csv = decodeSheet(await chosen.arrayBuffer());
    } catch {
      setCheckFailed(true);
      setStep(2);
      focusAfter.current = () => banner.current;
      return;
    }
    if (csv === null) {
      setRefusal('encoding');
      if (input.current) input.current.value = '';
      focusAfter.current = () => input.current;
      return;
    }
    setFile(csv);
    setStep(2);
    focusAfter.current = () => stepLine.current;
    void check(csv);
  };
  const chooseAnother = () => {
    forget();
    reset();
    focusAfter.current = () => input.current;
  };

  const save = async () => {
    if (!file || !report || saving || !owner) return;
    if (reason.trim().length < 3) {
      setReasonError(true);
      focusAfter.current = () => reasonBox.current;
      return;
    }
    setSaveError(null);
    command.current = nextSaveCommand(command.current, file, () => crypto.randomUUID());
    setSaving(true);
    const outcome = await saveSheet(
      tenant,
      saveBody(file, command.current, reason, report.planFingerprint ?? ''),
    );
    setSaving(false);
    settle(outcome);
  };
  const settle = (outcome: SaveOutcome) => {
    switch (outcome.kind) {
      case 'saved': {
        const summary = savedSummary(outcome.report, factsSoFar.current, wroteBefore.current);
        const words =
          summary.kind === 'nothingLeft'
            ? importWords.nothingLeft
            : importWords.saved(summary.routes, summary.facts);
        setView({ kind: 'saved', words, first: outcome.report.routes[0]?.route ?? null });
        command.current = null;
        factsSoFar.current = 0;
        wroteBefore.current = false;
        onSaved(words);
        focusAfter.current = () => doneLine.current;
        return;
      }
      case 'partWay':
      case 'routeChanged': {
        const report = outcome.report;
        if (!report) {
          // Refused before anything was written; the server named no route.
          setView({ kind: 'changed' });
          focusAfter.current = () => banner.current;
          return;
        }
        factsSoFar.current += savedFactCount(report);
        if (report.saved?.length) {
          wroteBefore.current = true;
          // The routes are read again; the dialog stays, with its file and save id.
          onSaved('');
        }
        setView({ kind: 'partWay', report });
        focusAfter.current = () => banner.current;
        return;
      }
      case 'problems': {
        const found = problemItems(outcome.report.errors, labelOf);
        // The save planned again and found problems: they belong to the check step.
        setStep(2);
        showProblems(found.items, found.rows);
        return;
      }
      case 'stepUp':
        setSaveError(packWords.stepUpKept);
        break;
      case 'denied':
        setSaveError(importWords.saveDenied);
        break;
      case 'refused':
        setSaveError(outcome.message ?? importWords.notSaved);
        break;
      case 'signedOut':
        setSaveError(packWords.signedOut);
        break;
      case 'reused':
        // The id belonged to another file: the next press is a new save.
        command.current = null;
        setSaveError(importWords.notSaved);
        break;
      default:
        setSaveError(importWords.notSaved);
    }
    focusAfter.current = () => banner.current;
  };

  const locked = saving;
  const plans = report?.routes ?? [];
  const skipped = report ? skippedRows(report) : [];
  const anyNew = plans.some((plan) => plan.willBeAdded);
  const busyWords = checking
    ? importWords.checking
    : saving
      ? importWords.saving(plans.length)
      : '';
  const stepWords = importWords.stepLine(step, importWords.stepNames[step - 1] ?? '');

  const routeBlock = (plan: SheetRoutePlan) => {
    const { added, updated, removed } = plan.content;
    const lines = importWords.changeLines(
      fieldNames(added),
      fieldNames(updated),
      fieldNames(removed),
    );
    return (
      <li key={plan.route} className="route-data-route">
        <h4 dir="auto">{routeName(plan.route)}</h4>
        {plan.willBeAdded ? <StatusBadge tone="info">{importWords.willBeAdded}</StatusBadge> : null}
        <ChangeSummary
          counts={{ added: added.length, changed: updated.length, removed: removed.length }}
          lines={[]}
        />
        {plan.pack.changed ? (
          <>
            <p dir="auto">
              {importWords.packSettings(packFieldLabels(plan.pack.changedFields, standardFieldsV1))}
            </p>
            {plan.pack.nextVersion !== null ? (
              <>
                <div className="route-pack-warning">
                  <CorridraIcon name="alert" />
                  <p>{importWords.readinessWarning(plan.pack.nextVersion)}</p>
                </div>
                <p>{importWords.becomes(plan.pack.nextVersion)}</p>
              </>
            ) : null}
          </>
        ) : null}
        {lines.length ? (
          <details>
            <summary>{importWords.showChanges}</summary>
            <ChangeSummary lines={lines} />
          </details>
        ) : null}
      </li>
    );
  };

  const problemsView = view.kind === 'problems' && (
    <>
      <h3 tabIndex={-1} ref={heading}>
        {importWords.problemsHeading(view.items.length, view.rows)}
      </h3>
      <ol className="route-data-problems" id={`${id}-problems`}>
        {(allProblems ? view.items : view.items.slice(0, 20)).map((item, index) => (
          <li key={index} dir="auto">
            {importWords.problemItem(item.row, item.route, item.label, item.message)}
          </li>
        ))}
      </ol>
      {view.items.length > 20 && !allProblems ? (
        <button
          type="button"
          className="text-link"
          aria-expanded={allProblems}
          aria-controls={`${id}-problems`}
          onClick={() => setAllProblems(true)}
        >
          {importWords.showAllProblems(view.items.length)}
        </button>
      ) : null}
      <div className="route-dialog-actions">
        <button type="button" className="primary-link" onClick={chooseAnother}>
          {importWords.chooseAnother}
        </button>
        <button
          type="button"
          className="text-link"
          onClick={() => downloadText(problemListName, problemList(view.items))}
        >
          {importWords.downloadProblems}
        </button>
      </div>
    </>
  );

  const content = (() => {
    if (view.kind === 'problems') return problemsView;
    if (view.kind === 'saved')
      return (
        <>
          <p className="route-data-done" tabIndex={-1} ref={doneLine} role="status">
            {view.words}
          </p>
          {view.first ? (
            <p>
              <a
                className="text-link"
                href={addressFor(window.location.href, { route: view.first })}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                    return;
                  event.preventDefault();
                  const key = view.first;
                  if (!key) return;
                  forget();
                  onOpenRoute(key);
                }}
              >
                {importWords.openRoute(routeName(view.first))}
              </a>
            </p>
          ) : null}
          <div className="route-dialog-actions">
            <button type="button" className="primary-link" data-autofocus onClick={close}>
              {importWords.close}
            </button>
          </div>
        </>
      );
    if (view.kind === 'partWay') {
      const missing = routeResults(view.report).filter(
        (item): item is Exclude<RouteResult, { kind: 'done' }> => item.kind !== 'done',
      );
      return (
        <>
          <ul className="route-data-problems">
            {missing.map((item) => (
              <li key={item.route} dir="auto">
                {resultLine(item)}
              </li>
            ))}
          </ul>
          <div className="route-dialog-actions">
            <button
              type="button"
              className="primary-link"
              disabled={locked}
              aria-busy={saving || undefined}
              onClick={() => void save()}
            >
              {saving ? importWords.saving(plans.length) : importWords.tryRest}
            </button>
            <button type="button" className="text-link" disabled={locked} onClick={chooseAnother}>
              {importWords.chooseAnother}
            </button>
            <button type="button" className="text-link" disabled={locked} onClick={close}>
              {importWords.close}
            </button>
          </div>
        </>
      );
    }
    if (view.kind === 'changed')
      return (
        <div className="route-dialog-actions">
          <button type="button" className="primary-link" onClick={chooseAnother}>
            {importWords.chooseAnother}
          </button>
          <button type="button" className="text-link" onClick={close}>
            {importWords.close}
          </button>
        </div>
      );
    if (step === 1)
      return (
        <>
          <p>{importWords.intro}</p>
          <p className="route-edit-quiet">{importWords.helpCopy}</p>
          <p className="route-edit-quiet">{importWords.helpSeveral}</p>
          <div className="route-dialog-actions">
            <label className="primary-link route-data-file">
              <input
                ref={input}
                type="file"
                accept=".csv,text/csv"
                data-autofocus
                aria-invalid={refusal ? true : undefined}
                aria-describedby={refusal ? `${id}-refusal` : undefined}
                onChange={(event) => void choose(event.target.files?.[0])}
              />
              {importWords.chooseFile}
            </label>
            <button
              type="button"
              className="text-link"
              onClick={() => downloadText(templateName, blankTemplate(routes[0]?.key ?? ''))}
            >
              {importWords.blankTemplate}
            </button>
            <button type="button" className="text-link" onClick={close}>
              {importWords.cancel}
            </button>
          </div>
          {refusal ? (
            <FieldError id={`${id}-refusal`}>
              {refusal === 'type'
                ? importWords.notCsv
                : refusal === 'size'
                  ? importWords.tooBig
                  : importWords.notUtf8}
            </FieldError>
          ) : null}
        </>
      );
    if (step === 2)
      return (
        <>
          <p>{importWords.checkingOnly}</p>
          {checking ? <p className="route-edit-quiet">{importWords.checking}</p> : null}
          {checkFailed ? (
            <div className="route-dialog-actions">
              <button
                type="button"
                className="primary-link"
                onClick={() => (file ? void check(file) : chooseAnother())}
              >
                {importWords.tryAgain}
              </button>
              <button type="button" className="text-link" onClick={chooseAnother}>
                {importWords.chooseAnother}
              </button>
            </div>
          ) : (
            <div className="route-dialog-actions">
              <button type="button" className="text-link" onClick={close}>
                {importWords.cancel}
              </button>
            </div>
          )}
        </>
      );
    if (step === 3)
      return (
        <>
          <h3 tabIndex={-1} ref={heading}>
            {importWords.ready(plans.length)}
          </h3>
          <ul className="route-data-routes">{plans.map(routeBlock)}</ul>
          {skipped.length ? (
            onlyPendingCustom(skipped) ? (
              <p>{importWords.skippedPending(skipped.length)}</p>
            ) : (
              <>
                <p>{importWords.skippedMixed(skipped.length)}</p>
                <ul className="route-data-problems">
                  {skipped.map((skip) => (
                    <li key={`${skip.route}-${skip.row}-${skip.key}`} dir="auto">
                      {importWords.problemItem(
                        skip.row,
                        skip.route,
                        labelOf(skip.key),
                        skip.message,
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : null}
          <p className="route-edit-quiet">{importWords.statusKept}</p>
          {anyNew ? <p className="route-edit-quiet">{importWords.newRouteDraft}</p> : null}
          <div className="route-dialog-actions">
            <button
              type="button"
              className="primary-link"
              onClick={() => {
                setStep(4);
                focusAfter.current = () => (owner ? reasonBox.current : stepLine.current);
              }}
            >
              {importWords.next}
            </button>
            <button type="button" className="text-link" onClick={chooseAnother}>
              {importWords.chooseAnother}
            </button>
            <button type="button" className="text-link" onClick={close}>
              {importWords.cancel}
            </button>
          </div>
        </>
      );
    return (
      <>
        {owner ? (
          <fieldset className="route-pack-boxes" disabled={locked}>
            <div className="field route-edit-field">
              <label htmlFor={`${id}-reason`}>{packWords.reasonLabel}</label>
              <textarea
                id={`${id}-reason`}
                ref={reasonBox}
                dir="auto"
                rows={3}
                maxLength={500}
                value={reason}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={`${id}-reason-count${reasonError ? ` ${id}-reason-error` : ''}`}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (event.target.value.trim().length >= 3) setReasonError(false);
                }}
              />
              <p className="route-edit-count" id={`${id}-reason-count`}>
                {reasonCount(reason.length)}
              </p>
              {reasonError ? (
                <FieldError id={`${id}-reason-error`}>{packWords.reasonShort}</FieldError>
              ) : null}
            </div>
          </fieldset>
        ) : null}
        <div className="route-dialog-actions">
          <button
            type="button"
            className="primary-link"
            disabled={locked || !owner}
            aria-busy={saving || undefined}
            aria-describedby={owner ? undefined : `${id}-lock`}
            onClick={() => void save()}
          >
            {saving
              ? importWords.saving(plans.length)
              : saveError === importWords.notSaved
                ? importWords.tryAgain
                : importWords.saveAll}
          </button>
          <button
            type="button"
            className="text-link"
            disabled={locked}
            onClick={() => {
              setStep(3);
              setSaveError(null);
              focusAfter.current = () => heading.current;
            }}
          >
            {importWords.back}
          </button>
          <button type="button" className="text-link" disabled={locked} onClick={close}>
            {importWords.cancel}
          </button>
        </div>
        {owner ? (
          onePersonPublication ? (
            <p className="route-edit-quiet">{importWords.onePerson}</p>
          ) : null
        ) : (
          <p className="route-edit-quiet" id={`${id}-lock`}>
            <CorridraIcon name="lock" />
            <span>{importWords.adminLock}</span>
          </p>
        )}
      </>
    );
  })();

  const bannerWords = checkFailed
    ? importWords.checkFailed
    : view.kind === 'partWay'
      ? changedUnnamed(view.report)
        ? importWords.changedSome
        : importWords.partWay(
            doneRoutes(view.report).length,
            view.report.routes.length,
            routeResults(view.report)
              .filter((item) => item.kind === 'nothing')
              .map((item) => routeName(item.route)),
          )
      : view.kind === 'changed'
        ? importWords.changedNoRoute
        : saveError;
  const showStep = view.kind === 'form' || view.kind === 'problems';
  return (
    <Dialog
      open={open}
      onClose={close}
      title={importWords.title}
      locked={locked}
      returnFocusTo={returnFocusTo}
    >
      <div
        className="route-dialog route-pack route-data"
        aria-busy={checking || saving || undefined}
      >
        <p className="sr-only" role="status">
          {busyWords}
        </p>
        {showStep ? (
          <p className="route-edit-step" tabIndex={-1} ref={stepLine}>
            {stepWords}
          </p>
        ) : null}
        <div className="route-pack-banner" role="alert" tabIndex={-1} ref={banner}>
          {bannerWords ? (
            <p>
              <CorridraIcon name="alert" />
              <span>{bannerWords}</span>
            </p>
          ) : null}
        </div>
        {content}
      </div>
    </Dialog>
  );
}
