'use client';
import { useEffect, useReducer, useRef } from 'react';
import {
  canCreate,
  canPreview,
  countsWords,
  initialPanel,
  nextCreateCommand,
  nextWithdrawCommand,
  panelReducer,
  requestBodies,
  shareableDecisions,
  withdrawable,
  type CardSummary,
  type CreatedCard,
  type Panel,
  type Preview,
} from '../../../lib/decision-card-owner';
import { decisionLabel, provenanceLabel } from '../../../lib/decision-card-page';
import { contentLang } from '../../../lib/work-items/view';
import { formatDate, formatDateTime } from '../../../lib/ux/format';
import { savedMissionHeaders } from '../saved-missions';
import './decision-card-panel.css';

type Decision = {
  id: string;
  company: string;
  decision: string;
  requirementCurrent?: boolean;
};
type Handlers = {
  choose?: (decisionId: string) => void;
  preview?: () => void;
  acknowledge?: (value: boolean) => void;
  create?: () => void;
  copy?: () => void;
  withdraw?: (cardId: string) => void;
};
const stateWords: Record<CardSummary['state'], string> = {
  ACTIVE: 'Active',
  WITHDRAWN: 'Withdrawn',
  EXPIRED: 'Expired',
  UNAVAILABLE: 'Not available',
};

/** What the owner sees. `real` is a report from a real workspace; cards exist for sample workspaces only. */
export function DecisionCardPanelView({
  panel,
  decisions = [],
  handlers = {},
  real = false,
}: {
  panel?: Panel;
  decisions?: Decision[];
  handlers?: Handlers;
  real?: boolean;
}) {
  if (real)
    return (
      <section className="decision-card-owner" aria-label="Share a decision">
        <h3>Share a decision</h3>
        <p>Decision cards are available for sample workspaces only.</p>
      </section>
    );
  // Absent, never disabled: until the service says this person can share, nothing is drawn.
  if (!panel || panel.phase !== 'ready') return null;
  const preview = panel.preview;
  const offered = shareableDecisions(decisions);
  return (
    <section className="decision-card-owner" aria-label="Share a decision">
      <h3>Share a decision</h3>
      <p>
        Make a private link to one decision you have reviewed. You see exactly what it shows before
        anything is made.
      </p>
      {offered.length === 0 ? (
        <p>There is no reviewed decision to share yet.</p>
      ) : (
        <fieldset>
          <legend>1. Choose a decision</legend>
          {offered.map((d) => (
            <label key={d.id} className="decision-card-choice">
              <input
                type="radio"
                name="decision-card-choice"
                value={d.id}
                checked={panel.chosen === d.id}
                onChange={() => handlers.choose?.(d.id)}
              />
              <span dir="auto">
                <span lang={contentLang(d.company)}>{d.company}</span> · {decisionLabel(d.decision)}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <button
        type="button"
        className="decision-card-action"
        onClick={() => handlers.preview?.()}
        disabled={!canPreview(panel)}
      >
        Preview
      </button>
      {preview && (
        <div className="decision-card-preview">
          <h4>2. Check what will be shared</h4>
          <dl>
            <div>
              <dt>Company</dt>
              <dd dir="auto" lang={contentLang(preview.fields.company)}>
                {preview.fields.company}
              </dd>
            </div>
            <div>
              <dt>Decision</dt>
              <dd>{decisionLabel(preview.fields.decision)}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd dir="auto">{preview.fields.rationale}</dd>
            </div>
            <div>
              <dt>Next step</dt>
              <dd dir="auto">{preview.fields.nextAction}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{formatDate(preview.fields.dueAt)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{provenanceLabel(preview.fields.provenance)}</dd>
            </div>
          </dl>
          <p>This link works until {formatDateTime(preview.expiresAt)}.</p>
          <label className="decision-card-choice">
            <input
              type="checkbox"
              checked={panel.acknowledged}
              onChange={(event) => handlers.acknowledge?.(event.target.checked)}
            />
            <span>I understand that anyone with the link can see these six fields.</span>
          </label>
          <button
            type="button"
            className="decision-card-action"
            onClick={() => handlers.create?.()}
            disabled={!canCreate(panel)}
          >
            Create Link
          </button>
        </div>
      )}
      {panel.notice && (
        <p role="status" className="decision-card-notice">
          {panel.notice}
        </p>
      )}
      {panel.link && (
        <div className="decision-card-link">
          <h4>Your link</h4>
          <input type="text" readOnly value={panel.link} aria-label="Decision card link" />
          <button type="button" className="decision-card-action" onClick={() => handlers.copy?.()}>
            Copy Link
          </button>
          {panel.linkExpiresAt && <p>Works until {formatDateTime(panel.linkExpiresAt)}.</p>}
          <p>Anyone with this link can see these six fields until it expires or you withdraw it.</p>
        </div>
      )}
      {panel.cards.length > 0 && (
        <div className="decision-card-list">
          <h4>Your links for this report</h4>
          <ul>
            {panel.cards.map((card) => (
              <li key={card.id}>
                <span>
                  {stateWords[card.state]} · expires {formatDateTime(card.expiresAt)}
                </span>
                <span>{countsWords(card.opens)}</span>
                {card.lastOpenedAt && <span>Last opened {formatDateTime(card.lastOpenedAt)}.</span>}
                {withdrawable(card) && (
                  <button
                    type="button"
                    className="decision-card-action"
                    onClick={() => handlers.withdraw?.(card.id)}
                  >
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

async function send(
  body: unknown,
  scope: { subject: string; issuer: string },
  signal: AbortSignal,
) {
  const response = await fetch('/api/customer-decision-cards', {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: savedMissionHeaders(scope),
    body: JSON.stringify(body),
  });
  const value = (await response.json().catch(() => ({}))) as { reason?: string };
  if (!response.ok) throw Object.assign(new Error('refused'), { status: response.status, value });
  return value;
}

/** The owner panel inside a saved report. Asks the service first and draws nothing unless it says yes. */
export function DecisionCardPanel({
  resourceId,
  subject,
  issuer,
  decisions,
  synthetic,
}: {
  resourceId: string;
  subject: string;
  issuer: string;
  decisions: Decision[];
  synthetic: boolean;
}) {
  const [panel, dispatch] = useReducer(panelReducer, initialPanel);
  const controller = useRef<AbortController | null>(null);
  const scope = { subject, issuer };
  useEffect(() => {
    if (!synthetic) return;
    const task = new AbortController();
    controller.current = task;
    send(requestBodies({ resourceId, commandId: '' }).state(), scope, task.signal)
      .then((value) => {
        const v = value as {
          canShare?: boolean;
          maxActive?: number;
          cards?: CardSummary[];
        };
        if (!task.signal.aborted)
          dispatch({
            type: 'stateLoaded',
            canShare: v.canShare === true,
            maxActive: v.maxActive ?? 5,
            cards: Array.isArray(v.cards) ? v.cards : [],
          });
      })
      .catch(() => {
        if (!task.signal.aborted) dispatch({ type: 'stateFailed' });
      });
    // A private link is not kept on a page the person has left or hidden.
    const hide = () => dispatch({ type: 'clearLink' });
    window.addEventListener('pagehide', hide);
    return () => {
      task.abort();
      window.removeEventListener('pagehide', hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, subject, issuer, synthetic]);

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    const task = controller.current ?? new AbortController();
    dispatch({ type: 'busy', value: true });
    try {
      await work(task.signal);
    } catch (error) {
      const failure = error as { status?: number; value?: { reason?: string } };
      dispatch({ type: 'failed', status: failure.status ?? 0, reason: failure.value?.reason });
    }
  }
  const handlers: Handlers = {
    choose: (decisionId) => dispatch({ type: 'choose', decisionId }),
    acknowledge: (value) => dispatch({ type: 'acknowledge', value }),
    preview: () =>
      void run(async (signal) => {
        if (!panel.chosen) return;
        const value = await send(
          requestBodies({ resourceId, commandId: '' }).preview(panel.chosen),
          scope,
          signal,
        );
        dispatch({ type: 'previewLoaded', preview: value as unknown as Preview });
      }),
    create: () =>
      void run(async (signal) => {
        // The only place a card is made: after a preview and the acknowledgement.
        if (!canCreate(panel) || !panel.chosen || !panel.preview) return;
        // The same command as an earlier try for this preview whose answer was lost, so a retry returns the
        // first card and its link instead of making another.
        const commandId = nextCreateCommand(panel, crypto.randomUUID());
        dispatch({ type: 'createStarted', commandId });
        const body = requestBodies({ resourceId, commandId }).create(panel.chosen, panel.preview);
        const value = await send(body, scope, signal);
        dispatch({
          type: 'created',
          created: value as unknown as CreatedCard,
          origin: window.location.origin,
        });
      }),
    copy: () => {
      if (panel.link) void navigator.clipboard?.writeText(panel.link).catch(() => undefined);
    },
    withdraw: (cardId) =>
      void run(async (signal) => {
        // One command per card: a retry after a lost answer is the same command.
        const commandId = nextWithdrawCommand(panel, cardId, crypto.randomUUID());
        dispatch({ type: 'withdrawStarted', cardId, commandId });
        await send(requestBodies({ resourceId, commandId }).withdraw(cardId), scope, signal);
        dispatch({ type: 'withdrawn', cardId });
      }),
  };
  return (
    <DecisionCardPanelView
      panel={panel}
      decisions={decisions}
      handlers={handlers}
      real={!synthetic}
    />
  );
}
