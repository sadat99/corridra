'use client';
import { EmptyState } from '../../components/ux/empty-state';
import { formatDateTime } from '../../lib/ux/format';
import { ReplyForm } from './missions';
import './reply-review.css';

// Team desk v4.1, unit D9 (CORRIDRA_UX_TEAM_DESK_V41): the Replies tab of one mission. One timeline of
// what the customer can read on the private receipt, oldest first, and one message box under it. The box
// is the existing receipt reply form and posts through the mission page's own save, so the payload, the
// permission and the in-place authenticator check are the same. The delegation block (context, agenda,
// sharing and billing) is not drawn here: no read names a mission's programme, so the page cannot tell a
// programme mission from any other and guesses nothing. The block stays, unchanged, at its address under
// Reports, and this tab links there. Supplier replies are reviewed on the Quotes tab.
type Reply = { id: string; mission_id: string; body: string; created_at?: string };

export function MissionReplies({
  missionId,
  replies,
  canReply,
  busy,
  onSend,
  reportsHref,
}: {
  missionId: string;
  /** The receipt replies of the workspace's mission read; only this mission's are shown. */
  replies: Reply[];
  /** Owner, admin or operator. The server checks again. */
  canReply: boolean;
  busy: boolean;
  /** The mission page's save for a receipt reply: same body and reply id as the side panel form sends. */
  onSend: (body: string, replyId: string) => Promise<boolean>;
  /** The existing Reports section address. */
  reportsHref: string;
}) {
  const ordered = replies
    .filter((r) => r.mission_id === missionId)
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  return (
    <div className="mission-replies">
      <h3>Replies</h3>
      <section aria-labelledby="mission-replies-timeline">
        <h4 id="mission-replies-timeline">What the customer can read</h4>
        <p className="reply-review-note">
          Every reply the team posted on the customer&apos;s private receipt, oldest first. A posted
          reply stays as it was written.
        </p>
        {ordered.length ? (
          <ol className="mission-timeline">
            {ordered.map((r) => (
              <li key={r.id}>
                <p className="mission-timeline-meta">
                  Corridra team
                  {r.created_at ? (
                    <>
                      {' · '}
                      <time dateTime={r.created_at}>{formatDateTime(r.created_at)}</time>
                    </>
                  ) : null}
                </p>
                <p>{r.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState icon="inbox">
            Nothing has been posted on the receipt yet. The first reply you post shows here and on
            the customer&apos;s receipt.
          </EmptyState>
        )}
      </section>
      {canReply ? (
        <section aria-labelledby="mission-replies-write">
          <h4 id="mission-replies-write">Write to the customer</h4>
          <ReplyForm busy={busy} onSend={onSend} />
        </section>
      ) : (
        <p>Only an owner, admin or operator can post a reply on the receipt.</p>
      )}
      <section aria-labelledby="mission-replies-reports" className="mission-replies-delegation">
        <h4 id="mission-replies-reports">Delegation, sharing and reports</h4>
        <p>
          Delegation context, agenda, what is shared with the customer and billing are set under
          Reports, where you choose the programme and the mission.
        </p>
        <a className="text-link" href={reportsHref}>
          Open Reports
        </a>
      </section>
    </div>
  );
}
