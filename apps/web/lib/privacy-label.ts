// Who can see it (PL1, owner decision 17 November 2026, "Two steps (Recommended)", step 1: behaviour only).
// One entry per customer share or send surface. A reader is `confirmed` only where the code or the database already
// decides that this reader can read what is shared, and its `sourceNote` names that fact. Every other reader the
// person may wonder about is `not_stated`: nothing in the code confirms it either way, so the page says "Not stated"
// and claims nothing. The label only informs. It never blocks, delays, disables or adds a step to a share or a send.
// The evidence reply (apps/web/app/delivery-view.tsx) joined in visual grammar PR 5 (V3-05-033), with its preview.
import type { MessageKey } from './i18n/messages';

export type PrivacyStatus = 'confirmed' | 'not_stated';
export type PrivacyReader = {
  reader: MessageKey;
  status: PrivacyStatus;
  /** The code fact behind a confirmed reader, as `path:function or line`. Null when nothing confirms it. */
  sourceNote: string | null;
};

const notStated = (reader: MessageKey): PrivacyReader => ({
  reader,
  status: 'not_stated',
  sourceNote: null,
});

const surfaces = {
  // The decision card share (apps/web/app/account/missions/decision-card-panel.tsx).
  decisionCard: [
    {
      // app.read_decision_card(h) reads a card by the SHA-256 of its link secret, with no sign-in, until it expires
      // (at most 168 hours after it was made) or is withdrawn (decision_card_withdrawal). The panel already says so.
      reader: 'privacy.reader.anyoneWithLink',
      status: 'confirmed',
      sourceNote:
        'packages/db/customer-decision-card-migrations/0001_decision_cards.sql:app.read_decision_card',
    },
    {
      // The creator previews the six fields before the card exists and lists and withdraws only cards whose
      // principal_id is the signed-in actor.
      reader: 'privacy.reader.youMadeLink',
      status: 'confirmed',
      sourceNote:
        'packages/db/customer-decision-card-migrations/0001_decision_cards.sql:decision_card.principal_id=actor',
    },
    // No code fact says whether other workspace members or admins, or Corridra staff, can read a card.
    notStated('privacy.reader.workspace'),
    notStated('privacy.reader.corridra'),
  ],
  // The saved commercial report (apps/web/app/account/missions/saved-commercial-report.tsx).
  savedReport: [
    {
      // customer.saved_mission_action reads the report only for the principal who saved it (principal_id=actor).
      reader: 'privacy.reader.youSaved',
      status: 'confirmed',
      sourceNote:
        'packages/db/customer-commercial-migrations/0001_saved_mission_invitations.sql:customer.saved_mission_action',
    },
    {
      // The saved report is the original private report link: app.delivery_authorized(h, audience) opens it for
      // whoever holds that link's token, until it expires (expires_at>now()) or is withdrawn (a delivery_revocation
      // row); real-use 0009 keeps both conditions.
      reader: 'privacy.reader.anyoneWithReportLink',
      status: 'confirmed',
      sourceNote: 'packages/db/migrations/0016_scoped_delivery.sql:app.delivery_authorized',
    },
    notStated('privacy.reader.workspace'),
    notStated('privacy.reader.corridra'),
  ],
  // The recipient's answer and reply (apps/web/app/buyer/recipient-response.tsx and reply-journey.tsx). The answer
  // phase sends app.buyer_decide into app.buyer_response, the message and quote go to recipient_detail_response; both
  // are read back by the link (app.buyer_view, app.recipient_detail_view) and by the sending workspace (0009:157-166
  // buyer_response read policy; 0025 recipient_detail_response read policy), so one list is true for both.
  recipientReply: [
    {
      // Bearer access: app.recipient_detail_view(h) returns the recorded reply to whoever holds the link, with no
      // sign-in (/api/buyer), and app.communication_allowed ends it once the message expires (c.expires_at>now()).
      reader: 'privacy.reader.anyoneWithReplyLink',
      status: 'confirmed',
      sourceNote:
        'packages/db/migrations/0025_scoped_product_experience.sql:app.recipient_detail_view',
    },
    {
      // Members of the workspace that sent the request read replies under the recipient_detail_response policy
      // (classification and purpose, through app.buyer_link_access), and its owner or admin reviews them
      // (recipient-reply-review 0001). Both reply forms already tell the person the team or operator reviews it.
      // The code does not say that workspace is Corridra's, so the reader is named as the page names it.
      reader: 'privacy.reader.sendingTeam',
      status: 'confirmed',
      sourceNote:
        'packages/db/migrations/0025_scoped_product_experience.sql:recipient_detail_response read policy',
    },
    // No code fact says whether the customer who asked for the introduction can read the reply.
    notStated('privacy.reader.requester'),
  ],
  // The evidence reply (apps/web/app/delivery-view.tsx, "Send response" on an evidence request). The response is
  // stored by app.delivery_respond and read back in app.delivery_report (the request's `response`) for whoever
  // holds the private link, with no sign-in, until the link expires or is withdrawn (delivery_authorized).
  evidenceReply: [
    {
      reader: 'privacy.reader.anyoneWithLink',
      status: 'confirmed',
      sourceNote:
        'packages/db/customer-real-use-migrations/0009_real_report_links.sql:app.delivery_authorized',
    },
    // No code fact says whether other people in the sender's workspace, or Corridra staff, can read the response.
    notStated('privacy.reader.workspace'),
    notStated('privacy.reader.corridra'),
  ],
} as const satisfies Record<string, readonly PrivacyReader[]>;

export type PrivacySurface = keyof typeof surfaces;
export const privacySurfaces = Object.keys(surfaces) as readonly PrivacySurface[];

export function privacyReaders(surface: PrivacySurface): readonly PrivacyReader[] {
  return surfaces[surface];
}
