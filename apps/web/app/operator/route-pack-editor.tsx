'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CorridraIcon } from '../../components/corridra-icon';
import { StatusBadge } from '../../components/access-state';
import { FieldError } from '../../components/field-error';
import { EmptyState } from '../../components/ux/empty-state';
import { FactMark, StaleMark } from '../../components/ux/fact-mark';
import { RouteFactRow } from '../../components/ux/route-fact-row';
import { SegmentedFilter } from '../../components/ux/segmented-filter';
import { ShowMoreList } from '../../components/ux/show-more';
import { formatDate, formatUtcDay } from '../../lib/ux/format';
import type { OverviewRoute, RouteSummary } from '../../lib/route-pack-editor-read';
import {
  answersFor,
  draftFromFact,
  factFromDraft,
  liveIssues,
  type FactDraft,
  type FormField,
} from '../../lib/route-pack-editor-fact-form';
import {
  applyStage,
  cautionKeys,
  discard as discardStage,
  emptyStage,
  overlayDocument,
  sameValue,
  stageCount,
  stageFact,
  stageMark,
  unstageFact,
  warningWords,
  type Stage,
} from '../../lib/route-pack-editor-stage';
import type { FactsSaved } from '../../lib/route-pack-editor-write';
import { canOfferMark } from '../../lib/route-pack-editor-section';
import {
  cautionLine,
  changeKept,
  changesDiscarded,
  changesNotSaved,
  fieldAddedLine,
  finishOpenField,
  lockedCorePendingLine,
  markRemovedLine,
  noChangeToKeep,
  openFieldNotIncluded,
  restoredLine,
  savedLine,
} from '../../lib/route-pack-editor-words';
import {
  addressFor,
  coreListWords,
  defaultView,
  factsByKey,
  fieldView,
  formFieldOf,
  gapsLine,
  isEditable,
  optionalLine,
  overlayCompleteness,
  packChangeLine,
  progressWords,
  readinessLine,
  sectionLines,
  sectionName,
  sectionParts,
  staleLine,
  staleListWords,
  todayUtc,
  todoCount,
  todoItems,
  type EditorView,
  type RouteAddress,
  type SectionLine,
} from '../../lib/route-pack-editor-view';
import { CountryName, countryName } from './country-name';
import {
  goTo,
  setLeaveGuard,
  takePendingFocus,
  useRouteDetail,
  type DetailData,
} from './route-pack-editor-data';
import {
  clearMirror,
  isMirrored,
  isTouched,
  mirrorMatches,
  useRouteSession,
  type RouteSession,
} from './route-pack-editor-stage-store';
import { RouteFactEditor } from './route-pack-fact-editor';
import { RouteCustomDialog } from './route-pack-custom-dialog';
import { DiscardDialog, LeaveDialog } from './route-pack-leave-dialogs';
import { RouteMarkDialog } from './route-pack-mark-dialog';
import { moreButtonOf, RouteMoreMenu } from './route-pack-more-menu';
import { Say, SaveFactsDialog } from './route-pack-save-dialog';
import { UnsavedBar } from './route-pack-unsaved-bar';
import { packStatusWords, packTones } from './pack-status';
import {
  standardFieldByKey,
  liveStatuses,
  type ContentDocument,
  type ContentFact,
  type PackView,
} from '@corridra/domain/route-pack-standard';
import './route-pack-editor.css';
import './route-pack-editor-edit.css';

// ADR-093 Phase 3, PR 1: the route pack editor, read only. One place in Settings: the Routes list (with completeness), and for
// the route a person opened, its header, a View choice and one of To Do, All Sections or one section. No control here writes:
// a control without a working backend is not drawn. The words come from the helpers in lib/route-pack-editor-view.ts; the rows
// from the standard's field dictionary.
const routeHeading = 'route-pack-editor-heading';
const sectionHeading = 'route-pack-section-heading';
const adminNote = 'Only the owner can change route facts and packs. You can read everything here.';
const notFoundRoute = 'That route was not found. Choose one from the list.';
const notFoundSection = 'That section was not found.';
const denied = 'You do not have access to route facts.';
const unavailable = 'Route facts are unavailable. Try again.';

/**
 * The name of a route in the Routes list, as a link to ?route=KEY. A plain click opens the route by `history.pushState` (so Back
 * and Forward work) and moves focus to the route name; a click with a modifier key, or a middle click, is left to the browser.
 */
export function RouteLink({
  routeKey,
  current,
  label,
  children,
}: {
  routeKey: string;
  current: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <a
      className="settings-route-name"
      href={addressFor(window.location.href, { route: routeKey })}
      aria-current={current ? 'true' : undefined}
      aria-label={label}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        goTo({ route: routeKey }, routeHeading);
      }}
    >
      {children}
    </a>
  );
}

/** The facts of one row of the Routes list: Core words, stale words and Live with gaps, only the ones that hold. */
export function RouteRowFacts({ summary }: { summary: RouteSummary }) {
  const core = coreListWords(summary.core);
  const stale = staleListWords(summary.core.stale);
  if (!core && !stale && !summary.liveWithGaps) return null;
  return (
    <span className="settings-route-facts">
      {core ? <span className="settings-route-core">{core}</span> : null}
      {stale ? (
        <span className="settings-route-stale">
          <CorridraIcon name="clock" />
          {stale}
        </span>
      ) : null}
      {summary.liveWithGaps ? (
        <StatusBadge tone="caution">
          <CorridraIcon name="alert" /> Live with gaps
        </StatusBadge>
      ) : null}
    </span>
  );
}

/** What stands under the Routes heading once the facts are read: the helper line, or why they are not shown. */
export function RoutesFactsHead({
  state,
  notice,
  retry,
  retrying,
}: {
  state: 'ready' | 'denied' | 'error';
  notice: boolean;
  retry: () => void;
  retrying: boolean;
}) {
  if (state === 'denied') return <p className="settings-routes-quiet">{denied}</p>;
  if (state === 'error')
    return (
      <div className="settings-routes-error">
        <FieldError id="route-facts-error">{unavailable}</FieldError>
        <button type="button" className="text-link" aria-busy={retrying} onClick={retry}>
          Try Again
        </button>
      </div>
    );
  return (
    <>
      <p className="settings-routes-quiet">
        Facts describe a route. The pack decides what the team may do on it. Choose a route to read
        its facts.
      </p>
      {notice ? (
        <p className="settings-routes-quiet" role="status">
          {notFoundRoute}
        </p>
      ) : null}
    </>
  );
}

const foldWidthRem = 56;
/**
 * The list and the editor of the open route. At least 56 rem of region and the two stand side by side (a rule on the width of
 * this region, not of the window); narrower, the list folds into one closed row, "Routes: Bangladesh to China".
 */
export function RouteEditorShell({
  list,
  summary,
  tenant,
  role,
  refreshKey,
  address,
  onGone,
  onSaved,
}: {
  list: ReactNode;
  summary: RouteSummary;
  tenant: string;
  role: string;
  refreshKey: unknown;
  address: RouteAddress;
  /** The route read answered 404: ask the list again, which then answers 404 too and the page falls back to the plain list. */
  onGone: () => void;
  /** A save went through: the Routes list is asked again, so its Core words follow the new facts. */
  onSaved: () => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const element = shell.current;
    if (!element) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWide(element.getBoundingClientRect().width >= foldWidthRem * rem);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="settings-routes-shell" ref={shell} data-wide={wide ? 'true' : 'false'}>
      <details className="settings-routes-fold" open={wide || undefined}>
        <summary>
          Routes:{' '}
          <span className="settings-routes-fold-name">
            <CountryName code={summary.origin} /> to <CountryName code={summary.destination} />
          </span>
        </summary>
        {list}
      </details>
      <RoutePackEditor
        tenant={tenant}
        role={role}
        summary={summary}
        refreshKey={refreshKey}
        address={address}
        onGone={onGone}
        onSaved={onSaved}
      />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="route-editor-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function RoutePackEditor(props: {
  tenant: string;
  role: string;
  summary: RouteSummary;
  refreshKey: unknown;
  address: RouteAddress;
  onGone: () => void;
  onSaved: () => void;
}) {
  // One editor per route: the unsaved edits, the open row and the leave question belong to the route and start fresh with it.
  return <RoutePackEditorOf key={`${props.tenant}/${props.summary.routeId}`} {...props} />;
}

function RoutePackEditorOf({
  tenant,
  role,
  summary,
  refreshKey,
  address,
  onGone,
  onSaved,
}: {
  tenant: string;
  role: string;
  summary: RouteSummary;
  refreshKey: unknown;
  address: RouteAddress;
  onGone: () => void;
  onSaved: () => void;
}) {
  const data = useRouteDetail(tenant, summary.routeId, refreshKey);
  // A 404 is never shown as an error: the list is asked again and falls back quietly if it answers 404 as well.
  const gone = data.state === 'off';
  useEffect(() => {
    if (gone) onGone();
  }, [gone, onGone]);
  // Focus moves to the heading of the route or the section a person clicked, never on a deep link, Back or Forward.
  useEffect(() => {
    const target = takePendingFocus();
    if (target) document.getElementById(target)?.focus();
  });
  const route = data.detail?.route ?? null;
  const owner = role === 'owner';
  const session = useRouteSession(
    tenant,
    summary.routeId,
    route ? (route.content?.version ?? 0) : null,
    owner,
  );
  // Leaving this route with edits that are not saved (or an answer that is open and changed) asks first. Only a move to another
  // route is asked: a view, a section, Back and Forward are not.
  const held = stageCount(session.stage) > 0 || isTouched(session.open);
  const holding = useRef(false);
  useEffect(() => {
    holding.current = held;
  }, [held]);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (!owner) return;
    setLeaveGuard((go) => {
      if (!holding.current) return false;
      setLeaving(() => go);
      return true;
    });
    return () => setLeaveGuard(null);
  }, [owner]);
  return (
    <section
      className="route-editor"
      aria-labelledby={routeHeading}
      data-staged={stageCount(session.stage) > 0 ? 'true' : undefined}
    >
      <h2 id={routeHeading} tabIndex={-1}>
        <CountryName code={summary.origin} /> to <CountryName code={summary.destination} />
      </h2>
      {data.state === 'loading' ? (
        <>
          <p role="status" className="route-editor-quiet">
            Loading route facts…
          </p>
          <Skeleton />
        </>
      ) : gone ? null : data.state === 'denied' ? (
        <p className="route-editor-quiet">{denied}</p>
      ) : data.state === 'error' ? (
        <div className="settings-routes-error">
          <FieldError id="route-editor-error">{unavailable}</FieldError>
          <button
            type="button"
            className="text-link"
            aria-busy={data.retrying}
            onClick={data.retry}
          >
            Try Again
          </button>
        </div>
      ) : !route ? (
        <p role="status" className="route-editor-quiet">
          {notFoundRoute}
        </p>
      ) : (
        <RouteBody
          route={route}
          detail={data.detail!}
          packHistory={data.packHistory}
          role={role}
          tenant={tenant}
          summary={summary}
          address={address}
          session={session}
          reload={data.reload}
          onSaved={onSaved}
        />
      )}
      <LeaveDialog
        open={leaving !== null}
        count={stageCount(session.stage)}
        kept={leaving !== null && isMirrored(tenant, summary.routeId)}
        onKeep={() => setLeaving(null)}
        onLeave={() => {
          const go = leaving;
          setLeaving(null);
          go?.();
        }}
      />
    </section>
  );
}

type Route = NonNullable<OverviewRoute['route']>;
type FieldItem = Route['completeness']['fields'][number];

function RouteBody({
  route,
  detail,
  packHistory,
  role,
  tenant,
  summary,
  address,
  session,
  reload,
  onSaved,
}: {
  route: Route;
  detail: OverviewRoute;
  packHistory: DetailData['packHistory'];
  role: string;
  tenant: string;
  summary: RouteSummary;
  address: RouteAddress;
  session: RouteSession;
  reload: DetailData['reload'];
  onSaved: () => void;
}) {
  const { completeness, pack, content } = route;
  const total = completeness.fields.filter((row) => row.core).length;
  const pending = completeness.pendingCore.length;
  const stale = completeness.staleCore.length;
  const live = !!pack && (liveStatuses as readonly string[]).includes(pack.status);
  // Right after a save the rows already show what was saved, until the route read that follows it arrives (nothing flashes back).
  const [justSaved, setJustSaved] = useState<{ version: number; document: ContentDocument } | null>(
    null,
  );
  const fresh = justSaved && justSaved.version > (content?.version ?? 0) ? justSaved : null;
  const saved = fresh?.document ?? content?.document ?? null;
  const savedVersion = fresh?.version ?? content?.version ?? 0;
  const { stage, setStage, open, setOpen } = session;
  const owner = role === 'owner';
  const today = todayUtc();
  const packView: PackView = pack
    ? { status: pack.status, configuration: pack.configuration }
    : null;
  // What the rows show: the saved document with the unsaved edits on top. Which rows there are, their headings and every count of
  // the header stay the saved truth, so nothing moves until it is saved.
  const shownDocument = overlayDocument(saved, stage);
  const shown = overlayCompleteness(packView, saved, stage, today);
  const shownRows = new Map(shown.fields.map((item) => [item.key, item]));
  const savedFacts = factsByKey(saved);
  const facts = factsByKey(shownDocument);
  const labels = (key: string) =>
    standardFieldByKey.get(key)?.label ??
    facts.get(key)?.label ??
    savedFacts.get(key)?.label ??
    detail.customLabels[key] ??
    key;
  const view: EditorView | 'section' = address.section
    ? 'section'
    : address.sectionUnknown
      ? 'sections'
      : (address.view ?? defaultView({ pending, stale }));
  // The section open now, and its mark with the unsaved edits on top (PR 2c: a mark is staged like a fact).
  const section = view === 'section' ? address.section : null;
  const markNote =
    section === null
      ? null
      : (shownDocument.sectionMarks.find((mark) => mark.section === section)?.note ?? null);
  const routeName = `${countryName(summary.origin)} to ${countryName(summary.destination)}`;
  const lastChange = packHistory?.[0];
  const changeWords = lastChange
    ? packChangeLine(lastChange, formatDate(lastChange.effectiveFrom))
    : null;

  // Messages: one visible status line that takes focus after a save, a discard or a refusal to leave an answer half open, and one
  // hidden status for the small announcements of staging. Both are mounted before their words.
  const [status, setStatus] = useState<{ text: string; caution: string | null }>({
    text: '',
    caution: null,
  });
  const [staging, setStaging] = useState('');
  const statusLine = useRef<HTMLDivElement>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  // The restore is announced once, after the route is drawn, so the status line is in the page before its words.
  useEffect(() => {
    if (session.restored === 0) return;
    const timer = window.setTimeout(
      () => setStatus({ text: restoredLine(session.restored), caution: null }),
      0,
    );
    return () => window.clearTimeout(timer);
    // Only the first draw of the route restores anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const focusKey = useRef<string | null>(null);
  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    focusKey.current = null;
    // A custom field added and not saved has no row once its change is undone: focus goes to the status line, not the page.
    (
      document.querySelector<HTMLElement>(`[data-edit-key="${CSS.escape(key)}"]`) ??
      statusLine.current
    )?.focus();
  });
  const focusOpenEditor = () =>
    document.querySelector<HTMLElement>('.route-edit .ux-choice')?.focus();

  const staged = stageCount(stage);
  const openField = (item: FieldItem) => {
    const field = formFieldOf(item, saved, shownDocument);
    if (!field) return null;
    return field;
  };
  const edit = (item: FieldItem) => {
    if (open && isTouched(open) && open.key !== item.key) {
      setStatus({ text: finishOpenField, caution: null });
      focusOpenEditor();
      return;
    }
    const field = openField(item);
    if (!field) return;
    let draft = draftFromFact(field, facts.get(item.key) ?? null, today);
    // A row with nothing in it opens ready to be filled: that is why the person pressed Edit. Pending stays one press away.
    if (draft.answer === 'PENDING') draft = { ...draft, answer: 'FILLED' };
    if (field.type === 'money' && !draft.currency) draft = { ...draft, currency: 'USD' };
    setStatus({ text: '', caution: null });
    setOpen({ key: item.key, initial: draft, draft, step: 1, shown: [], focus: 0 });
  };
  const close = (key: string, message: string) => {
    focusKey.current = key;
    setOpen(null);
    setStaging(message);
  };
  const attempt = (item: FieldItem, step: 'next' | 'keep') => {
    const field = openField(item);
    if (!open || !field) return;
    const built = factFromDraft(field, open.draft, today);
    if (!built.ok) {
      const early = ['text', 'items', 'currency', 'amount', 'note', 'form', 'filledNote'].includes(
        built.refusals[0]?.field ?? 'form',
      );
      if (step === 'next' && !early) {
        setOpen({ ...open, step: 2, shown: [] });
        return;
      }
      setOpen({ ...open, step: early ? 1 : 2, shown: built.refusals, focus: open.focus + 1 });
      return;
    }
    if (step === 'next') {
      setOpen({ ...open, step: 2, shown: [] });
      return;
    }
    const after = stageFact(stage, saved, item.key, built.fact);
    const changed = !sameValue(stage.facts[item.key] ?? null, after.facts[item.key] ?? null);
    setStage((current) => stageFact(current, saved, item.key, built.fact));
    close(item.key, changed ? changeKept(stageCount(after)) : '');
    if (!changed) setStatus({ text: noChangeToKeep, caution: null });
  };
  const undo = (item: FieldItem) => {
    const left = staged - (stage.facts[item.key] ? 1 : 0);
    setStage((current) => unstageFact(current, item.key));
    if (open?.key === item.key) setOpen(null);
    focusKey.current = item.key;
    setStaging(left > 0 ? `Change undone. ${changesNotSaved(left)}.` : 'Change undone.');
  };
  const cautionFor = (field: FormField, draft: FactDraft) => {
    if (draft.answer !== 'PENDING' || !live || !field.core) return null;
    const after = applyStage(saved, stageFact(stage, saved, field.key, null));
    const keys = cautionKeys(packView, saved, after).filter((key) => key === field.key);
    return keys.length ? cautionLine(keys, labels) : null;
  };
  const row = (item: FieldItem, heading?: ReactNode) => {
    const shownRow: FieldItem = shownRows.get(item.key) ?? {
      ...item,
      state: 'PENDING',
      stale: false,
    };
    const v = fieldView(shownRow, facts, pack?.configuration ?? null, detail.customLabels);
    const field = formFieldOf(item, saved, shownDocument);
    const isStaged = !!stage.facts[item.key];
    const editable = isEditable(shownRow, role, field);
    // The open answer is this row's when its key is, and only a row that has a field can be open.
    const draft = open && open.key === item.key && field ? open : null;
    const issues = draft && field ? liveIssues(field, draft.draft) : [];
    return (
      <RouteFactRow
        key={item.key}
        label={v.label}
        core={v.core}
        locked={v.locked}
        state={v.state}
        value={v.value}
        note={v.note}
        packNote={v.packNote}
        source={v.source}
        observed={v.observedOn ? formatUtcDay(v.observedOn) : null}
        validUntil={v.validUntil ? formatUtcDay(v.validUntil) : null}
        staleSince={shownRow.stale && v.validUntil ? formatUtcDay(v.validUntil) : null}
        heading={heading}
        unsaved={isStaged}
        editing={!!draft}
        editor={
          draft && field ? (
            <RouteFactEditor
              label={v.label}
              field={field}
              answers={answersFor({ field, coveredBySection: shownRow.coveredBySection })}
              covered={shownRow.coveredBySection && !field.custom}
              savedFilled={!!facts.get(item.key)}
              open={{
                ...draft,
                shown: [
                  ...issues,
                  ...draft.shown.filter(
                    (refusal) => !issues.some((l) => l.field === refusal.field),
                  ),
                ],
              }}
              today={today}
              caution={cautionFor(field, draft.draft)}
              onChange={(changed) => setOpen({ ...draft, draft: changed, shown: [] })}
              onNext={() => attempt(item, 'next')}
              onBack={() => setOpen({ ...draft, step: 1, shown: [] })}
              onKeep={() => attempt(item, 'keep')}
              onCancel={() => close(item.key, '')}
            />
          ) : undefined
        }
        action={
          editable ? (
            <>
              <button
                type="button"
                className="text-link"
                data-edit-key={item.key}
                aria-label={`Edit ${v.label}`}
                onClick={() => edit(item)}
              >
                Edit
              </button>
              {isStaged ? (
                <button
                  type="button"
                  className="text-link"
                  aria-label={`Undo Change to ${v.label}`}
                  onClick={() => undo(item)}
                >
                  Undo Change
                </button>
              ) : null}
            </>
          ) : undefined
        }
      />
    );
  };
  const review = () => {
    if (open && isTouched(open)) {
      const label = open.key ? labels(open.key) : '';
      setStatus({ text: openFieldNotIncluded(label), caution: null });
      focusOpenEditor();
      return;
    }
    if (open) setOpen(null);
    setSaveOpen(true);
  };
  const [moreDialog, setMoreDialog] = useState<'mark' | 'custom' | null>(null);
  const more = useRef<HTMLDivElement>(null);
  // A dialog opened from a row of More: the row is gone when it closes, so focus goes back to the More button, or to the status
  // line once the dialog changed something (or when More is not shown).
  const toStatus = useRef(false);
  const backFromMore = () => {
    const button = moreButtonOf(more.current);
    const target =
      toStatus.current || !button || button.offsetParent === null ? statusLine.current : button;
    toStatus.current = false;
    return target;
  };
  const discard = () => {
    toStatus.current = true;
    setStage(discardStage);
    setOpen(null);
    clearMirror(tenant, summary.routeId);
    setDiscardOpen(false);
    setStaging('');
    setStatus({ text: changesDiscarded, caution: null });
  };
  // ---- PR 2c: the three actions of More on a section. Each stages like Keep Change does and says so on the status line. ----
  // An open answer that was changed blocks the menu's actions (it says so and keeps focus there); an untouched one is closed.
  const openRowBlocks = () => {
    if (open && isTouched(open)) {
      setStatus({ text: finishOpenField, caution: null });
      focusOpenEditor();
      return true;
    }
    if (open) setOpen(null);
    return false;
  };
  const sayStaged = (text: string) => {
    setStaging('');
    setStatus({ text, caution: null });
  };
  const markSection = (note: string) => {
    if (section === null) return;
    const after = stageMark(stage, saved, section, note);
    setStage((current) => stageMark(current, saved, section, note));
    toStatus.current = true;
    sayStaged(after.marks[String(section)] ? changeKept(stageCount(after)) : noChangeToKeep);
  };
  const unmarkSection = () => {
    if (section === null || openRowBlocks()) return;
    const after = stageMark(stage, saved, section, null);
    setStage((current) => stageMark(current, saved, section, null));
    const left = stageCount(after);
    sayStaged(left > 0 ? markRemovedLine(left) : 'Mark removed.');
    statusLine.current?.focus();
  };
  // A key the route already has is refused in the dialog; it is checked again here so a fact is never overwritten.
  const takenKeys = new Set([
    ...savedFacts.keys(),
    ...Object.keys(stage.facts),
    ...Object.keys(detail.customLabels),
    ...completeness.fields.map((item) => item.key),
  ]);
  const addCustom = (key: string, fact: ContentFact) => {
    if (takenKeys.has(key)) return;
    const after = stageFact(stage, saved, key, fact);
    setStage((current) => (current.facts[key] ? current : stageFact(current, saved, key, fact)));
    toStatus.current = true;
    sayStaged(fieldAddedLine(stageCount(after)));
  };
  const openMore = (which: 'mark' | 'custom') => {
    if (!openRowBlocks()) setMoreDialog(which);
  };
  const saveDone = (result: FactsSaved, document: ContentDocument, sent: Stage) => {
    setJustSaved({ version: result.version, document });
    setStage(() => emptyStage(result.version));
    setOpen(null);
    // Only a copy of what was sent: edits made since (on this route again, after leaving it) keep their copy.
    if (mirrorMatches(tenant, summary.routeId, sent)) clearMirror(tenant, summary.routeId);
    // The dialog closes itself (it was told to), so focus is returned by the dialog to the status line.
    setStaging('');
    setStatus({
      text: savedLine(result.version),
      caution: warningWords(result.warnings, labels) || null,
    });
    void reload();
    onSaved();
  };
  return (
    <>
      {owner ? (
        <div className="route-editor-actions">
          <RouteMoreMenu
            routeName={routeName}
            sectionName={section === null ? '' : sectionName(section)}
            wrapperRef={more}
            onAddCustom={section === null ? undefined : () => openMore('custom')}
            onMark={
              section !== null && markNote === null && canOfferMark(role)
                ? () => openMore('mark')
                : undefined
            }
            onUnmark={section !== null && markNote !== null ? unmarkSection : undefined}
            onDiscard={staged > 0 ? () => setDiscardOpen(true) : undefined}
          />
        </div>
      ) : null}
      <p className="route-editor-line">
        {pack ? (
          <>
            <StatusBadge tone={packTones[pack.status]}>{packStatusWords(pack.status)}</StatusBadge>{' '}
            <span>Pack version {pack.version}</span>
          </>
        ) : (
          <StatusBadge tone="unknown">No pack yet</StatusBadge>
        )}
        <span>
          {content || fresh ? `Route facts version ${savedVersion}` : 'No facts saved yet'}
        </span>
      </p>
      <div className="route-editor-progress">
        <p>{progressWords({ total, pending })}</p>
        <progress value={total - pending} max={total} aria-label="Core fields done" />
      </div>
      {stale > 0 ? (
        <p className="route-editor-line">
          <StaleMark>{staleLine(stale)}</StaleMark>
        </p>
      ) : null}
      {live && pending > 0 ? (
        <p className="route-editor-gaps">
          <CorridraIcon name="alert" />
          <span>{gapsLine(packStatusWords(pack.status), pending)}</span>
        </p>
      ) : null}
      {route.readiness && pack ? (
        <p className="route-editor-quiet">{readinessLine(route.readiness, pack.version)}</p>
      ) : null}
      {pack ? (
        <p className="route-editor-quiet">
          {changeWords ?? 'The last pack change is not available.'}
        </p>
      ) : null}
      {owner ? null : <p className="route-editor-quiet">{adminNote}</p>}
      <div className="route-editor-status" role="status" tabIndex={-1} ref={statusLine}>
        {status.text ? <p>{status.text}</p> : null}
        {status.caution ? (
          <p className="route-edit-caution">
            <CorridraIcon name="alert" />
            <span>{status.caution}</span>
          </p>
        ) : null}
      </div>
      <p className="sr-only" role="status">
        {staging}
      </p>
      <SegmentedFilter<EditorView | 'section'>
        label="View"
        // A section is neither choice, so choosing either one fires and clears the section.
        value={view}
        options={[
          { value: 'todo', label: 'To Do', count: todoCount(completeness) },
          { value: 'sections', label: 'All Sections', count: completeness.sections.length },
        ]}
        onChange={(next) => next !== 'section' && goTo({ route: summary.key, view: next })}
      />
      {view === 'todo' ? (
        <TodoView
          route={route}
          hasFacts={!!content}
          row={row}
          optional={optionalLine(completeness.pendingOptionalCount)}
        />
      ) : view === 'sections' ? (
        <SectionsView
          lines={sectionLines(completeness)}
          routeKey={summary.key}
          unknown={address.sectionUnknown}
        />
      ) : (
        <SectionView
          route={route}
          section={address.section!}
          row={row}
          shown={shown}
          markNote={markNote}
          labels={labels}
        />
      )}
      {owner && staged > 0 ? (
        <UnsavedBar count={staged} onReview={review} onDiscard={() => setDiscardOpen(true)} />
      ) : null}
      {owner ? (
        <>
          {section !== null ? (
            <>
              <RouteMarkDialog
                open={moreDialog === 'mark'}
                onClose={() => setMoreDialog(null)}
                section={{ number: section, name: sectionName(section) }}
                onStage={markSection}
                returnFocusTo={backFromMore}
              />
              <RouteCustomDialog
                open={moreDialog === 'custom'}
                onClose={() => setMoreDialog(null)}
                section={{ number: section, name: sectionName(section) }}
                takenKeys={takenKeys}
                today={today}
                onAdd={(key, definition, fact) => addCustom(key, { ...fact, ...definition })}
                returnFocusTo={backFromMore}
              />
            </>
          ) : null}
          <SaveFactsDialog
            open={saveOpen}
            onClose={() => setSaveOpen(false)}
            tenant={tenant}
            routeId={summary.routeId}
            // Plain words in the statement sentence: a flag inside running text breaks its line (designer audit).
            routeName={routeName}
            stage={stage}
            document={saved}
            savedVersion={savedVersion}
            pack={packView}
            labelOf={(key, fact) =>
              standardFieldByKey.get(key)?.label ?? fact?.label ?? labels(key)
            }
            reload={reload}
            onStage={(next) => setStage(() => next)}
            onSaved={saveDone}
            returnFocusTo={() =>
              document.querySelector<HTMLElement>('.route-bar button') ?? statusLine.current
            }
          />
          <DiscardDialog
            open={discardOpen}
            count={staged}
            onKeep={() => setDiscardOpen(false)}
            onDiscard={discard}
            returnFocusTo={backFromMore}
          />
        </>
      ) : null}
    </>
  );
}

type RowMaker = (item: Route['completeness']['fields'][number], heading?: ReactNode) => ReactNode;

function TodoView({
  route,
  hasFacts,
  row,
  optional,
}: {
  route: Route;
  hasFacts: boolean;
  row: RowMaker;
  optional: string | null;
}) {
  const items = todoItems(route.completeness);
  return (
    <div className="route-editor-view">
      {!hasFacts ? (
        <p className="route-editor-quiet">Nothing is recorded for this route yet.</p>
      ) : null}
      {items.length ? (
        <ShowMoreList limit={8} noun="fields" className="route-editor-rows">
          {items.map((item) =>
            row(
              item.row,
              item.heading ? (
                <h3>
                  {item.heading.number}. {item.heading.name}
                </h3>
              ) : undefined,
            ),
          )}
        </ShowMoreList>
      ) : (
        <EmptyState icon="check">Every Core field is done and nothing is stale.</EmptyState>
      )}
      {optional ? <p className="route-editor-quiet">{optional}</p> : null}
    </div>
  );
}

function SectionsView({
  lines,
  routeKey,
  unknown,
}: {
  lines: SectionLine[];
  routeKey: string;
  unknown: boolean;
}) {
  return (
    <div className="route-editor-view">
      {unknown ? (
        <p role="status" className="route-editor-quiet">
          {notFoundSection}
        </p>
      ) : null}
      <ul className="route-editor-sections">
        {lines.map((line) => (
          <li key={line.number}>
            <a
              href={addressFor(window.location.href, { route: routeKey, section: line.number })}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                goTo({ route: routeKey, section: line.number }, sectionHeading);
              }}
            >
              <span className="route-editor-section-name">
                {line.number}. {line.name}
              </span>
              <FactMark state={line.state} />
              {sectionParts(line).map((part) => (
                <span key={part} className="route-editor-section-part">
                  {part}
                </span>
              ))}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionView({
  route,
  section,
  row,
  shown,
  markNote,
  labels,
}: {
  route: Route;
  section: number;
  row: RowMaker;
  /** The completeness with the unsaved edits on top: the section's state, and the custom fields added and not saved yet. */
  shown: Route['completeness'];
  /** The note of the section's mark, saved or staged; null when the section is not marked. */
  markNote: string | null;
  labels: (key: string) => string;
}) {
  const state = shown.sections.find((item) => item.section === section);
  const saved = route.completeness.fields.filter((item) => item.section === section);
  const savedKeys = new Set(route.completeness.fields.map((item) => item.key));
  const added = shown.fields.filter(
    (item) => item.section === section && item.custom && !savedKeys.has(item.key),
  );
  const rows = [...saved, ...added];
  // A Locked Core row that is not Filled keeps a marked section Pending, and the line says which (spec 8.6).
  const lockedOpen =
    markNote !== null && state ? lockedCorePendingLine(state.pendingLockedCore.map(labels)) : null;
  const groups = [
    { name: 'Core fields', rows: rows.filter((item) => item.core) },
    { name: 'Optional fields', rows: rows.filter((item) => !item.core && !item.custom) },
    { name: 'Your own fields', rows: rows.filter((item) => item.custom) },
  ].filter((group) => group.rows.length);
  return (
    <div className="route-editor-view">
      <h3 id={sectionHeading} tabIndex={-1}>
        {section}. {sectionName(section)}
      </h3>
      {state ? <FactMark state={state.state} /> : null}
      {markNote !== null ? (
        <p className="route-editor-quiet">
          Not applicable: <bdi>{markNote}</bdi>
        </p>
      ) : null}
      {lockedOpen ? (
        <p className="route-editor-quiet">
          <Say words={lockedOpen} />
        </p>
      ) : null}
      <ShowMoreList limit={8} noun="fields" className="route-editor-rows">
        {groups.flatMap((group) =>
          group.rows.map((item, index) =>
            row(item, index === 0 ? <h4>{group.name}</h4> : undefined),
          ),
        )}
      </ShowMoreList>
    </div>
  );
}
