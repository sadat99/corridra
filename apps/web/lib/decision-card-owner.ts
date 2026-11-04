// The owner's side of the decision card (ADR-076 item 4, docs/revamp/specs/decision-card-ui.md). Pure rules:
// what the panel may do at each step, what it says when the service refuses, and what the requests look like.
// The panel never decides who may share (the service does) and creates nothing before the acknowledgement.
export type CardSummary = {
  id: string;
  decisionId: string;
  state: 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED' | 'UNAVAILABLE';
  createdAt: string;
  expiresAt: string;
  opens: number;
  lastOpenedAt: string | null;
};
export type Preview = {
  fields: {
    company: string;
    decision: string;
    rationale: string;
    nextAction: string;
    dueAt: string;
    provenance: { sourceKind: string; claimStatus: string };
  };
  digest: string;
  expiresAt: string;
};
export type CreatedCard = {
  cardId: string;
  state: CardSummary['state'];
  expiresAt: string;
  token?: string;
};
export type Panel = {
  /** `loading` until the service answers, `hidden` when the person cannot share, `ready` when they can. */
  phase: 'loading' | 'hidden' | 'ready';
  cards: CardSummary[];
  maxActive: number;
  chosen: string | null;
  preview: Preview | null;
  acknowledged: boolean;
  /** The link made in this visit. Kept in memory only, and dropped when the page is hidden. */
  link: string | null;
  linkExpiresAt: string | null;
  notice: string | null;
  busy: boolean;
  /**
   * The create command in flight for the preview now on screen. If its answer is lost the same acknowledged
   * preview is still there, and a retry must send this same command so the service returns the first card and
   * its link instead of making a second one.
   */
  pendingCreate: { commandId: string; decisionId: string; digest: string } | null;
};

export const initialPanel: Panel = {
  phase: 'loading',
  cards: [],
  maxActive: 5,
  chosen: null,
  preview: null,
  acknowledged: false,
  link: null,
  linkExpiresAt: null,
  notice: null,
  busy: false,
  pendingCreate: null,
};

export type PanelEvent =
  | { type: 'stateLoaded'; canShare: boolean; maxActive: number; cards: CardSummary[] }
  | { type: 'stateFailed' }
  | { type: 'choose'; decisionId: string }
  | { type: 'previewLoaded'; preview: Preview }
  | { type: 'acknowledge'; value: boolean }
  | { type: 'busy'; value: boolean }
  | { type: 'createStarted'; commandId: string }
  | { type: 'created'; created: CreatedCard; origin: string }
  | { type: 'withdrawn'; cardId: string }
  | { type: 'failed'; status: number; reason?: string }
  | { type: 'clearLink' };

export function failureWords(status: number, reason?: string): string {
  if (status === 409 && reason === 'CHANGED')
    return 'The decision changed since the preview. Preview again.';
  if (status === 409 && reason === 'CAP_REACHED')
    return 'Five links are active for this report. Withdraw one first.';
  if (status === 429) return 'Too many new links in the last hour. Try again later.';
  if (status === 503) return 'Not available right now.';
  if (status === 401 || status === 403) return 'You cannot share from this report.';
  return 'Something went wrong. Try again.';
}

export const cardLink = (origin: string, token: string) => `${origin}/decision-card#${token}`;

export const countsWords = (opens: number) =>
  `${opens} ${opens === 1 ? 'open' : 'opens'}. Counts page loads, including automatic link checks.`;

/**
 * Step 1 offers only decisions whose original requirement is still current. A decision made against a
 * requirement that has since changed is not something to put in a link, whatever else is true of it.
 */
export const shareableDecisions = <T extends { requirementCurrent?: boolean }>(
  decisions: T[],
): T[] => decisions.filter((decision) => decision.requirementCurrent === true);

/**
 * An active card, or one that is momentarily unavailable because a source changed: the database still counts
 * that one toward the five allowed until it expires, and the creator may withdraw it, so the slot can be freed.
 */
export const withdrawable = (card: Pick<CardSummary, 'state'>) =>
  card.state === 'ACTIVE' || card.state === 'UNAVAILABLE';

/** The command for a create: the one already in flight for this very preview, otherwise a fresh one. */
export function nextCreateCommand(panel: Panel, fresh: string): string {
  const pending = panel.pendingCreate;
  return pending && pending.decisionId === panel.chosen && pending.digest === panel.preview?.digest
    ? pending.commandId
    : fresh;
}

export const canPreview = (panel: Panel) =>
  panel.phase === 'ready' && !!panel.chosen && !panel.busy;
/** A card is made only from a preview the person has seen and only after the acknowledgement. */
export const canCreate = (panel: Panel) =>
  panel.phase === 'ready' && !!panel.chosen && !!panel.preview && panel.acknowledged && !panel.busy;

export function panelReducer(panel: Panel, event: PanelEvent): Panel {
  switch (event.type) {
    case 'stateLoaded':
      return {
        ...panel,
        phase: event.canShare ? 'ready' : 'hidden',
        cards: event.cards,
        maxActive: event.maxActive,
      };
    case 'stateFailed':
      return { ...panel, phase: 'hidden' };
    case 'choose':
      return {
        ...panel,
        chosen: event.decisionId,
        preview: null,
        acknowledged: false,
        notice: null,
        pendingCreate: null,
      };
    case 'previewLoaded':
      return {
        ...panel,
        preview: event.preview,
        acknowledged: false,
        notice: null,
        busy: false,
        pendingCreate: null,
      };
    case 'acknowledge':
      return { ...panel, acknowledged: panel.preview ? event.value : false };
    case 'busy':
      return { ...panel, busy: event.value };
    case 'createStarted':
      return {
        ...panel,
        pendingCreate:
          panel.chosen && panel.preview
            ? { commandId: event.commandId, decisionId: panel.chosen, digest: panel.preview.digest }
            : null,
      };
    case 'created': {
      const card: CardSummary = {
        id: event.created.cardId,
        decisionId: panel.chosen ?? '',
        state: event.created.state,
        createdAt: '',
        expiresAt: event.created.expiresAt,
        opens: 0,
        lastOpenedAt: null,
      };
      return {
        ...panel,
        cards: [card, ...panel.cards.filter((existing) => existing.id !== card.id)],
        link: event.created.token ? cardLink(event.origin, event.created.token) : null,
        linkExpiresAt: event.created.expiresAt,
        chosen: null,
        preview: null,
        acknowledged: false,
        notice: null,
        busy: false,
        pendingCreate: null,
      };
    }
    case 'withdrawn':
      return {
        ...panel,
        cards: panel.cards.map((card) =>
          card.id === event.cardId ? { ...card, state: 'WITHDRAWN' as const } : card,
        ),
        link: panel.cards.find((card) => card.id === event.cardId) ? null : panel.link,
        notice: null,
        busy: false,
      };
    case 'failed':
      return {
        ...panel,
        notice: failureWords(event.status, event.reason),
        // A changed decision must be previewed again before anything can be made.
        ...(event.status === 409 && event.reason === 'CHANGED'
          ? { preview: null, acknowledged: false, pendingCreate: null }
          : {}),
        busy: false,
      };
    case 'clearLink':
      return { ...panel, link: null };
  }
}

type Ids = { resourceId: string; commandId: string };
/** The four requests, in the exact shape the service accepts. `commandId` is fresh for each make or withdraw. */
export function requestBodies({ resourceId, commandId }: Ids) {
  return {
    state: () => ({ action: 'state' as const, resourceId }),
    preview: (decisionId: string) => ({ action: 'preview' as const, resourceId, decisionId }),
    create: (decisionId: string, preview: Pick<Preview, 'digest' | 'expiresAt'>) => ({
      action: 'create' as const,
      commandId,
      resourceId,
      decisionId,
      digest: preview.digest,
      expiresAt: preview.expiresAt,
      acknowledged: true as const,
    }),
    withdraw: (cardId: string) => ({ action: 'withdraw' as const, commandId, cardId }),
  };
}
