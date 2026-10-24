// Your Move: what a person has to do next, worked out only from records the customer screens already
// read. Pure functions over plain data, so every rule is tested without a database. Nothing here is
// invented: a card exists only where a real state exists, a date only where a real date exists, and an
// action only for a role that may take it.
import type { Holder, MoveVerb } from '../components/mr/types';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type MoveInput = {
  workspaces: { id: string; name: string; role: WorkspaceRole }[];
  /** Unfinished drafts the person can read, per workspace. */
  drafts: { id: string; workspaceId: string; title: string; updatedAt: string }[];
  /** Service requests in status `quoted`. */
  quotes: { id: string; workspaceId: string; title: string; contextLabel: string }[];
  /** Company links whose status is `needs_evidence`. */
  companyLinks: { workspaceId: string; organisationName: string | null }[];
  /** Requests with the progress a customer may read. */
  requests: {
    id: string;
    workspaceId: string;
    createdAt: string;
    progress: null | {
      status: string;
      receivedAt: string;
      replies: { createdAt: string }[];
    };
  }[];
};

export type MoveCardKind = 'draft' | 'quote' | 'company';

/** A card is data only. The words for each kind come from the message module, in the person's language. */
export type MoveCardData = {
  id: string;
  kind: MoveCardKind;
  verb: MoveVerb;
  holder: Holder;
  /** The request or workspace the card belongs to. Present when it helps tell cards apart. */
  context?: string;
  href: string;
};

export type WaitingRow = {
  id: string;
  /** Who holds it. `owner` means a workspace owner or admin, not the person reading. */
  holder: 'team' | 'owner';
  kind: 'request' | 'quote' | 'company';
  /** Free text the person or the team wrote (a service title, a company name), or null for a request. */
  title: string | null;
  /** The mission status for a request the team holds; null otherwise. */
  status: string | null;
  /** The date a request was received, for the label. */
  received: string | null;
  href: string;
};

export type MoveModel = {
  /** Things the person can act on, in the order they are shown. */
  cards: MoveCardData[];
  /** Things somebody else holds. */
  waiting: WaitingRow[];
  /** A request with a reply newer than the last one the person read on this device, per request. */
  replyCandidates: { requestId: string; latestReplyAt: string; received: string; href: string }[];
  /** The most recent request, used when nothing is waiting. */
  latest: null | { id: string; createdAt: string; status: string | null; href: string };
};

const teamStatuses = [
  'QUALIFICATION',
  'ACTIVE',
  'TARGETING',
  'OUTREACH',
  'MEETINGS',
  'FOLLOW_UP',
] as const;

const writer = (role: WorkspaceRole) => role === 'owner' || role === 'admin';

/**
 * Cards for the person, drafts first (the next thing they started), then answers they owe, then
 * evidence they owe. Cards that need an owner or admin go to `waiting` for a member, never to
 * "You", so a card never claims an action the person cannot take.
 */
export function buildMoveModel(input: MoveInput): MoveModel {
  const many = input.workspaces.length > 1;
  const role = new Map(input.workspaces.map((w) => [w.id, w.role] as const));
  const name = new Map(input.workspaces.map((w) => [w.id, w.name] as const));
  const where = (workspaceId: string) => (many ? name.get(workspaceId) : undefined);

  const cards: MoveCardData[] = [];
  const waiting: WaitingRow[] = [];

  for (const draft of [...input.drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    cards.push({
      id: `draft:${draft.id}`,
      kind: 'draft',
      verb: 'Send',
      holder: 'you',
      context: [draft.title, where(draft.workspaceId)].filter(Boolean).join(' · '),
      href: `/account/drafts/${draft.workspaceId}`,
    });

  for (const quote of input.quotes) {
    const mine = writer(role.get(quote.workspaceId) ?? 'member');
    if (mine)
      cards.push({
        id: `quote:${quote.id}`,
        kind: 'quote',
        verb: 'Answer',
        holder: 'you',
        context: [quote.title, where(quote.workspaceId)].filter(Boolean).join(' · '),
        href: `/account/service-requests/${quote.workspaceId}/${quote.id}`,
      });
    else
      waiting.push({
        id: `quote:${quote.id}`,
        holder: 'owner',
        kind: 'quote',
        title: quote.title,
        status: null,
        received: null,
        href: `/account/service-requests/${quote.workspaceId}/${quote.id}`,
      });
  }

  for (const link of input.companyLinks) {
    const mine = writer(role.get(link.workspaceId) ?? 'member');
    const title = link.organisationName ?? 'Company link';
    if (mine)
      cards.push({
        id: `company:${link.workspaceId}`,
        kind: 'company',
        verb: 'Add',
        holder: 'you',
        context: [title, where(link.workspaceId)].filter(Boolean).join(' · '),
        href: `/account/profile/${link.workspaceId}`,
      });
    else
      waiting.push({
        id: `company:${link.workspaceId}`,
        holder: 'owner',
        kind: 'company',
        title,
        status: null,
        received: null,
        href: `/account/profile/${link.workspaceId}`,
      });
  }

  const replyCandidates: MoveModel['replyCandidates'] = [];
  for (const request of input.requests) {
    if (!request.progress) continue;
    const href = `/account/requests/${request.id}`;
    const received = request.progress.receivedAt.slice(0, 10);
    const replies = request.progress.replies;
    if (replies.length > 0)
      replyCandidates.push({
        requestId: request.id,
        latestReplyAt: replies.map((r) => r.createdAt).sort()[replies.length - 1],
        received,
        href,
      });
    if ((teamStatuses as readonly string[]).includes(request.progress.status))
      waiting.push({
        id: `request:${request.id}`,
        holder: 'team',
        kind: 'request',
        title: null,
        status: request.progress.status,
        received,
        href,
      });
  }

  const newest = [...input.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    cards,
    waiting,
    replyCandidates,
    latest: newest
      ? {
          id: newest.id,
          createdAt: newest.createdAt,
          status: newest.progress?.status ?? null,
          href: `/account/requests/${newest.id}`,
        }
      : null,
  };
}

/** Reply candidates newer than the last one the person marked as read on this device. */
export function unreadReplies(
  candidates: MoveModel['replyCandidates'],
  seen: Record<string, string | undefined>,
) {
  return candidates.filter((c) => {
    const mark = seen[c.requestId];
    return !mark || c.latestReplyAt > mark;
  });
}
