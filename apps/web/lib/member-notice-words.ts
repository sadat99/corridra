// ADR-087 U4, decision 4b. The member notice words, exactly as the owner decided them, and the one place [date and time] is
// filled. Safe to import in the browser: no data access here. The time is the workspace's opens_at (delivery plus 24 hours,
// decision 4d), written with the app's absolute date and time helper, which names the time zone.
import { formatDateTime, type DateTimeOptions } from './ux/format';

export const memberNoticeWords =
  'Owners and admins of this workspace can read the reports you save and the decision cards you make here, and download the Trip Book and Supplier Book of your saved reports. This includes items you saved before today. They cannot remove or withdraw them. If there is anything you do not want them to see, you can remove it before [date and time].';

/** The decision 4b words with [date and time] replaced by opens_at, in the viewer's time zone (named). */
export function memberNoticeText(opensAt: string, options: DateTimeOptions = {}): string {
  const when = formatDateTime(opensAt, options);
  if (!when) throw new Error('Member notice time is invalid');
  return memberNoticeWords.replace('[date and time]', when);
}

/**
 * The inbox item's words: the decided 4b words (the row carries the same text, tested equal) with the row's opensAt in the
 * reader's time zone. Without a valid time it shows nothing beyond the title.
 */
export function memberNoticeInboxText(payload: {
  words?: unknown;
  opensAt?: unknown;
}): string | null {
  if (typeof payload.opensAt !== 'string' || !Number.isFinite(Date.parse(payload.opensAt)))
    return null;
  return memberNoticeText(payload.opensAt);
}

/** The short inbox title and where the inbox item leads: the saved reports on /account. */
export const memberNoticeInboxTitle = 'Who can read your saved reports';
export const memberNoticeHref = '/account?view=results&tab=saved';

export type MemberNotice = {
  workspaceId: string;
  workspaceName: string;
  deliveredAt: string;
  opensAt: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts only a well-formed list from the server; anything else shows nothing. */
export function memberNoticeList(value: unknown): MemberNotice[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { notices?: unknown }).notices)
  )
    return [];
  return (value as { notices: unknown[] }).notices.filter(
    (row): row is MemberNotice =>
      !!row &&
      typeof row === 'object' &&
      uuid.test(String((row as MemberNotice).workspaceId)) &&
      typeof (row as MemberNotice).workspaceName === 'string' &&
      Number.isFinite(Date.parse(String((row as MemberNotice).deliveredAt))) &&
      Number.isFinite(Date.parse(String((row as MemberNotice).opensAt))),
  );
}
