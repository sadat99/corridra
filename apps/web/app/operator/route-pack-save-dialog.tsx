'use client';
import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import { CorridraIcon } from '../../components/corridra-icon';
import { FieldError } from '../../components/field-error';
import { ChoiceButton, ChoiceRow } from '../../components/ux/choice-chip';
import { ChangeSummary } from '../../components/ux/change-summary';
import { Dialog } from '../../components/ux/dialog';
import type { ContentDocument, ContentFact, PackView } from '@corridra/domain/route-pack-standard';
import { refusalWords } from '../../lib/route-pack-editor-fact-form';
import {
  applyStage,
  canSave,
  cautionKeys,
  mergeStage,
  prepareSave,
  resolve,
  stageCount,
  type Choice,
  type Conflict,
  type MergeNote,
  type Stage,
} from '../../lib/route-pack-editor-stage';
import {
  nextCommand,
  outcomeWords,
  type Command,
  type FactsOutcome,
  type FactsSaved,
} from '../../lib/route-pack-editor-write';
import {
  allDroppedWords,
  checkingWords,
  checkSummary,
  choosePrompt,
  clashAsk,
  clashHeading,
  clashKept,
  conflictChoiceWords,
  conflictsPerStep,
  conflictStepWords,
  cautionLine,
  droppedLine,
  inRowOrder,
  mergedLine,
  noClashFirst,
  noteLabel,
  nothingLeftToSave,
  summaryLines,
  type Words,
} from '../../lib/route-pack-editor-words';
import { sendFacts } from './route-pack-editor-send';

// ADR-093 Phase 3, PR 2b: Save Route Facts (spec 9.1) and its conflict dialog (spec 9.2), one dialog with one reducer.
//   view  review: statement, summary, reason, Save Facts.
//         notice: another save landed first and nothing clashes: a banner, the summary again, nothing is sent on its own.
//         clash: another save landed first and some fact was changed by both: a choice for each, three to a step.
//   busy  saving: the request is in flight; checking: the route is read again. Either locks the dialog.
// Every save goes through `prepareSave`, which refuses while any choice is missing and takes the version from the stage, so a
// conflicted stage is never sent. A 409 and a stage restored from an older version both go through `check`, the one path that
// reads the route again and merges, so the person is always asked (spec 9.2). The reason and the command id outlive a failed send:
// the same id is sent again for the same document and reason, and a new one is made when either changes.
type Work = { stage: Stage; document: ContentDocument | null; version: number };
type State = {
  view: 'review' | 'notice' | 'clash';
  busy: null | 'saving' | 'checking';
  reason: string;
  /** "Give a reason..." is shown after Save Facts was pressed once without one. */
  reasonAsked: boolean;
  error: string | null;
  work: Work;
  command: Command | null;
  checks: number;
  conflicts: Conflict[];
  merged: MergeNote[];
  dropped: MergeNote[];
  choices: Record<string, Choice>;
  step: number;
  allDropped: boolean;
};
const reasonWords = 'Give a reason of at least 3 characters.';

function Say({ words }: { words: Words }) {
  return (
    <>
      {words.map((piece, index) =>
        typeof piece === 'string' ? piece : <bdi key={index}>{piece.label}</bdi>,
      )}
    </>
  );
}

export function SaveFactsDialog(props: SaveProps & { open: boolean; onClose: () => void }) {
  return props.open ? <SaveInner {...props} /> : null;
}
export type SaveProps = {
  tenant: string;
  routeId: string;
  /** The route's name for the statement. */
  routeName: ReactNode;
  stage: Stage;
  document: ContentDocument | null;
  savedVersion: number;
  pack: PackView;
  /** The label of a fact key (the standard's, or a custom fact's own). */
  labelOf: (key: string, fact: ContentFact | null) => string;
  /** Reads the route again without the loading state and answers with what was read. */
  reload: () => Promise<{
    state: string;
    detail: {
      route: { content: { version: number; document: ContentDocument } | null } | null;
    } | null;
  }>;
  /** The page's stage changes: edits that were already saved leave it, and a merge moves it to the version just read. */
  onStage: (stage: Stage) => void;
  /** The save went through: what the server answered and the document that was saved. */
  onSaved: (saved: FactsSaved, document: ContentDocument) => void;
  returnFocusTo: () => HTMLElement | null;
};

function SaveInner(props: SaveProps & { onClose: () => void }) {
  const { tenant, routeId, pack, labelOf, onStage, reload } = props;
  const behind = stageCount(props.stage) > 0 && props.stage.baseVersion < props.savedVersion;
  const [shown, setShown] = useState(true);
  const [s, patch] = useReducer(
    (state: State, change: Partial<State>) => ({ ...state, ...change }),
    {
      view: 'review',
      busy: null,
      reason: '',
      reasonAsked: false,
      error: null,
      work: { stage: props.stage, document: props.document, version: props.savedVersion },
      command: null,
      checks: 0,
      conflicts: [],
      merged: [],
      dropped: [],
      choices: {},
      step: 0,
      allDropped: false,
    } satisfies State,
  );
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const banner = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const reasonBox = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  // Rebuilds the stage on what is saved now. One path for a 409 and for a stage that was made on an older version.
  async function check(work: Work, checks: number, reason: string) {
    patch({ busy: 'checking', error: null });
    let read: Awaited<ReturnType<typeof reload>> | null = null;
    try {
      read = await reload();
    } catch {
      read = null;
    }
    const route = read?.state === 'ready' ? read.detail?.route : null;
    if (!route) {
      patch({ busy: null, error: outcomeWords('offline', null) });
      return;
    }
    const theirs = route.content?.document ?? null;
    const version = route.content?.version ?? 0;
    const merged = mergeStage(work.stage, theirs, version);
    onStage(merged.stage);
    const next: Work = { stage: merged.stage, document: theirs, version };
    const base = {
      busy: null,
      work: next,
      checks: checks + 1,
      merged: merged.merged,
      dropped: merged.dropped,
      conflicts: merged.conflicts,
      choices: {},
      step: 0,
      reason,
    } as const;
    if (merged.conflicts.length) patch({ ...base, view: 'clash', allDropped: false });
    else patch({ ...base, view: 'notice', allDropped: stageCount(merged.stage) === 0 });
  }
  // A stage made on an older version (restored from the tab, or another save landed meanwhile) always asks, even with no clash.
  useEffect(() => {
    if (started.current || !behind) return;
    started.current = true;
    void check(s.work, 0, s.reason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The check ends: focus goes to the banner (nothing clashes) or to the heading (something does), never to Save Facts.
  const seen = useRef<string>('');
  useEffect(() => {
    const key = `${s.view}:${s.busy}:${s.checks}`;
    if (seen.current === key) return;
    seen.current = key;
    if (s.busy || s.checks === 0) return;
    if (s.view === 'notice') banner.current?.focus();
    if (s.view === 'clash') heading.current?.focus();
  }, [s.view, s.busy, s.checks]);

  const lines = summaryLines(s.work.stage, labelOf);
  const caution = cautionKeys(pack, s.work.document, applyStage(s.work.document, s.work.stage));
  const trimmed = s.reason.trim();
  const reasonError =
    s.reason.length > 500
      ? refusalWords.limit(s.reason.length, 500)
      : s.reasonAsked && trimmed.length < 3
        ? reasonWords
        : null;
  const locked = s.busy !== null;
  const openChoices = s.conflicts.filter(
    (conflict) => s.choices[`${conflict.kind}:${conflict.key}`] === undefined,
  );

  async function save() {
    let command = s.command;
    const prepared = prepareSave({
      stage: s.work.stage,
      document: s.work.document,
      conflicts: s.conflicts,
      choices: s.choices,
      theirsVersion: s.work.version,
      routeId,
      reason: s.reason,
      id: (rest) => {
        command = nextCommand(s.command, rest, () => crypto.randomUUID());
        return command.id;
      },
    });
    if (!prepared.ok) {
      if (prepared.why === 'reason') {
        patch({ reasonAsked: true });
        reasonBox.current?.focus();
      } else if (prepared.why === 'nothing') patch({ error: nothingLeftToSave });
      return;
    }
    patch({ busy: 'saving', error: null, command });
    const result = await sendFacts(tenant, prepared.body);
    if (result.outcome === 'saved' && result.saved) {
      props.onSaved(result.saved, prepared.body.document);
      setShown(false);
      return;
    }
    if (result.outcome === 'conflict') {
      await check(s.work, s.checks, s.reason);
      return;
    }
    const outcome = result.outcome as Exclude<FactsOutcome, 'saved' | 'conflict'>;
    patch({
      busy: null,
      error: outcomeWords(outcome, result.error, (key) => {
        const label = labelOf(key, null);
        return label === key ? null : label;
      }),
      // The id belonged to a body the server refused to repeat: the next send is a new command.
      ...(outcome === 'commandReused' ? { command: null } : {}),
    });
  }

  const reasonField = (
    <div className="field route-edit-field">
      <label htmlFor={`${id}-reason`}>Reason</label>
      <textarea
        id={`${id}-reason`}
        ref={reasonBox}
        dir="auto"
        rows={3}
        placeholder="For example: added the 2027 public holidays from the official notice"
        value={s.reason}
        aria-invalid={reasonError ? true : undefined}
        aria-describedby={`${id}-reason-count${reasonError ? ` ${id}-reason-error` : ''}`}
        onChange={(event) => patch({ reason: event.target.value })}
      />
      <p className="route-edit-count" id={`${id}-reason-count`}>
        {s.reason.length} of 500
      </p>
      {reasonError ? <FieldError id={`${id}-reason-error`}>{reasonError}</FieldError> : null}
    </div>
  );
  const errorLine = s.error ? <FieldError id={`${id}-error`}>{s.error}</FieldError> : null;
  const cautionText = caution.length ? cautionLine(caution, (key) => labelOf(key, null)) : '';
  const cautionBlock = cautionText ? (
    <p className="route-edit-caution" role="status">
      <CorridraIcon name="alert" />
      <span>{cautionText}</span>
    </p>
  ) : null;
  const summary = <ChangeSummary counts={lines.counts} lines={lines.lines} />;
  const leave = () => setShown(false);
  const labelsOf = (notes: MergeNote[]) =>
    inRowOrder(notes).map((note) => noteLabel(note, (key) => labelOf(key, null)));
  const mergedWords = mergedLine(labelsOf(s.merged));
  const droppedWords = droppedLine(labelsOf(s.dropped));
  const stepCount = Math.max(1, Math.ceil(s.conflicts.length / conflictsPerStep));
  const shownConflicts = s.conflicts.slice(
    s.step * conflictsPerStep,
    (s.step + 1) * conflictsPerStep,
  );
  const lastStep = s.step >= stepCount - 1;
  const allChosen = s.conflicts.length > 0 && openChoices.length === 0;
  const resolved = allChosen ? resolve(s.work.stage, s.conflicts, s.choices, s.work.version) : null;
  const emptyAfterChoices = !!resolved && stageCount(resolved.stage) === 0;
  const ready = canSave(s.work.stage, s.conflicts, s.choices, s.work.version);

  return (
    <Dialog
      open={shown}
      onClose={props.onClose}
      title="Save Route Facts"
      locked={locked}
      returnFocusTo={props.returnFocusTo}
    >
      <div className="route-dialog route-save" aria-busy={locked || undefined}>
        {s.busy === 'checking' ? (
          <p role="status" className="route-edit-quiet">
            {checkingWords}
          </p>
        ) : null}
        {/* The banner is mounted before its words, so a screen reader hears them when focus moves here. */}
        <div className="route-save-banner" role="status" tabIndex={-1} ref={banner}>
          {s.view === 'notice' && s.busy !== 'checking' ? (
            s.allDropped ? (
              <p>{allDroppedWords(s.work.version)}</p>
            ) : (
              <>
                <p>{noClashFirst(s.work.version)}</p>
                {mergedWords ? (
                  <p>
                    <Say words={mergedWords} />
                  </p>
                ) : null}
                {droppedWords ? (
                  <p>
                    <Say words={droppedWords} />
                  </p>
                ) : null}
                <p>{checkSummary}</p>
              </>
            )
          ) : null}
        </div>
        {s.view === 'clash' && s.busy !== 'checking' ? (
          <>
            {s.step === 0 ? (
              <>
                <h3 className="route-save-heading" tabIndex={-1} ref={heading}>
                  {clashHeading(s.checks > 1)}
                </h3>
                {mergedWords || droppedWords ? (
                  <>
                    {mergedWords ? (
                      <p>
                        <Say words={mergedWords} />
                      </p>
                    ) : null}
                    {droppedWords ? (
                      <p>
                        <Say words={droppedWords} />
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p>{clashKept}</p>
                )}
                <p>{clashAsk}</p>
              </>
            ) : null}
            <p className="route-edit-step">{conflictStepWords(s.step + 1, stepCount)}</p>
            {shownConflicts.map((conflict) => {
              const key = `${conflict.kind}:${conflict.key}`;
              const name = noteLabel(conflict, (factKey) =>
                labelOf(
                  factKey,
                  conflict.kind === 'fact' ? (conflict.mine ?? conflict.theirs) : null,
                ),
              );
              return (
                <div className="route-save-clash" key={key}>
                  <h3 id={`${id}-${key}`} dir="auto">
                    {name}
                  </h3>
                  <ChoiceRow labelledBy={`${id}-${key}`}>
                    {(['mine', 'theirs'] as const).map((side) => (
                      <ChoiceButton
                        key={side}
                        chosen={s.choices[key] === side}
                        onClick={() =>
                          patch({ choices: { ...s.choices, [key]: side }, error: null })
                        }
                      >
                        {conflictChoiceWords(side, conflict)}
                      </ChoiceButton>
                    ))}
                  </ChoiceRow>
                </div>
              );
            })}
            {lastStep && !emptyAfterChoices ? reasonField : null}
            {lastStep && cautionBlock}
            {errorLine}
            {lastStep && emptyAfterChoices ? <p>{nothingLeftToSave}</p> : null}
            <div className="route-dialog-actions">
              {!lastStep ? (
                <button
                  type="button"
                  className="primary-link"
                  onClick={() => patch({ step: s.step + 1 })}
                >
                  Next
                </button>
              ) : emptyAfterChoices ? (
                <button
                  type="button"
                  className="primary-link"
                  onClick={() => {
                    onStage(resolved!.stage);
                    leave();
                  }}
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="primary-link"
                    disabled={!ready || locked}
                    aria-describedby={ready ? undefined : `${id}-choose`}
                    aria-busy={s.busy === 'saving' || undefined}
                    onClick={() => void save()}
                  >
                    {s.busy === 'saving' ? 'Saving…' : 'Save With These Choices'}
                  </button>
                  {!ready ? (
                    <span className="route-edit-quiet" id={`${id}-choose`}>
                      {choosePrompt}
                    </span>
                  ) : null}
                </>
              )}
              {s.step > 0 ? (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => patch({ step: s.step - 1 })}
                >
                  Back
                </button>
              ) : null}
              <button type="button" className="text-link" onClick={leave}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
        {s.view !== 'clash' && s.busy !== 'checking' ? (
          s.view === 'notice' && s.allDropped ? (
            <div className="route-dialog-actions">
              <button type="button" className="primary-link" onClick={leave}>
                Close
              </button>
            </div>
          ) : (
            <>
              {s.view === 'review' ? (
                <p>
                  This saves a new version of the facts for {props.routeName}. It does not change
                  the pack, so readiness stays as it is. Only your team can see route facts.
                </p>
              ) : null}
              {summary}
              {cautionBlock}
              {reasonField}
              {errorLine}
              <div className="route-dialog-actions">
                <button
                  type="button"
                  className="primary-link"
                  disabled={locked}
                  aria-busy={s.busy === 'saving' || undefined}
                  onClick={() => void save()}
                >
                  {s.busy === 'saving' ? 'Saving…' : 'Save Facts'}
                </button>
                <button type="button" className="text-link" disabled={locked} onClick={leave}>
                  Cancel
                </button>
              </div>
            </>
          )
        ) : null}
      </div>
    </Dialog>
  );
}
