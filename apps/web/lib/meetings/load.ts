// Reads, for one signed-in person, the meetings and visits of the reports they have saved (docs/revamp/specs/
// workflow-intelligence.md, W8). Server only and read only. It reads nothing the Room does not already read: the
// person's own assignments, then the saved report of each of the person's own requests through the same
// session-checked service and the same report check the saved report page uses. It keeps the itinerary alone
// (ADR 0076), drops every old detail of a changed schedule here, and never throws: whatever could not be read is
// reported as `partial`, so the page never says there are no meetings when it did not read them.
import { customerDeliveryEnabled } from '@corridra/auth/customer-assigned-missions';
import { customerSavedMissionsEnabled } from '@corridra/auth/customer-saved-missions';
import { foundations } from '../foundations';
import { followPages } from '../move-pages';
import { assignmentPageCap, roomLinkFromPages } from '../room';
import { report } from '../saved-report-check';
import { isChangedMeeting } from '../trip';
import type { WorkItem } from '../work-items/types';

/** At most this many saved reports are read in one page load. */
export const meetingReportCap = 12;

/** One saved report read that has not answered after this long counts as a read that failed. */
export const meetingReadTimeoutMs = 8000;

/**
 * One meeting or visit of one of the person's requests. A changed schedule carries its name alone: the old status,
 * time, zone and place are never kept.
 */
export type MeetingRow = {
  requestId: string;
  requestTitle: string | null;
  savedResourceId: string;
  label: string;
  changed: boolean;
  status?: string;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  location?: string;
};

export type MeetingsRead = {
  rows: MeetingRow[];
  /** Requests whose report is delivered but not saved to the Library, so it was not read. */
  notSaved: number;
  /** Something could not be read: a report, the assignment list, or the services. Never say "no meetings". */
  partial: boolean;
  /** More saved reports exist than the cap reads. */
  capped: boolean;
  /** The delivery or saved-missions module is off, so no report was read. */
  reportsOff: boolean;
};

type Assignment = { requestId?: unknown; available?: unknown; savedResourceId?: unknown };

// A read that fails, or has not answered in `meetingReadTimeoutMs`, is null, which the loader reports as `partial`.
// The pending call cannot be cancelled: the pool call finishes in the background, and the cap of 12 reads bounds
// how many can be waiting. The timer is always cleared, so a fast read leaves nothing running.
async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), meetingReadTimeoutMs);
  });
  try {
    return await Promise.race([read(), timedOut]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadMeetings(
  subject: string,
  issuer: string,
  requests: readonly WorkItem[],
): Promise<MeetingsRead> {
  const none: MeetingsRead = {
    rows: [],
    notSaved: 0,
    partial: false,
    capped: false,
    reportsOff: false,
  };
  if (requests.length === 0) return none;
  if (!customerDeliveryEnabled() || !customerSavedMissionsEnabled())
    return { ...none, reportsOff: true };
  const services = foundations();
  if (!services) return { ...none, partial: true };
  try {
    await services.ready;
  } catch {
    return { ...none, partial: true };
  }

  // Each item is one page of assignments, so the pages stay apart and the report is chosen as the Room chooses it. The
  // walk is as long as the Room's, so a report the Room finds is found here; no report is read until it ends.
  const assignments = await followPages(async (after) => {
    const page = (await services.customerAssignedMissions.list(
      { pageSize: 25, ...(after ? { after } : {}) },
      subject,
      issuer,
    )) as { assignments?: Assignment[]; nextAfter?: string | null };
    return { items: [page.assignments ?? []], nextAfter: page.nextAfter };
  }, assignmentPageCap);
  // A list that failed or was cut short cannot prove that a report is missing, so no request is called unsaved.
  const proven = !assignments.failed && assignments.complete;

  // One saved report per request, from this person's own request list only.
  const saved: { request: WorkItem; savedResourceId: string }[] = [];
  let notSaved = 0;
  for (const request of requests) {
    const link = roomLinkFromPages(request.id, assignments.items);
    if (link.savedResourceId) saved.push({ request, savedResourceId: link.savedResourceId });
    else if (link.reportAvailable && proven) notSaved += 1;
  }
  const reads = saved.slice(0, meetingReportCap);

  // The reads do not spend `delivery.budget`, as Home does not. That budget allows 60 a hour per client address and
  // per resource, so 12 reads a load would lock a person out of every delivery action from that address after five
  // loads; it also counts replays and reads, so it can refuse a retry whose first try had committed. On the HTTP
  // route it guards guessing of bearer links; this read needs the person's own session proof and is capped at 12.
  const results = await Promise.all(
    reads.map(async ({ request, savedResourceId }) => {
      const value = await attempt(() =>
        services.customerSavedMissions.command(
          { action: 'view', resourceId: savedResourceId, audience: 'CLIENT_PROGRESS' },
          subject,
          issuer,
        ),
      );
      if (value === null) return null;
      try {
        return report(value, savedResourceId).missions[0]?.itinerary.map((meeting): MeetingRow => ({
          requestId: request.id,
          requestTitle: request.title,
          savedResourceId,
          label: meeting.label,
          ...(isChangedMeeting(meeting)
            ? { changed: true }
            : {
                changed: false,
                status: meeting.status,
                ...(meeting.startsAt ? { startsAt: meeting.startsAt } : {}),
                ...(meeting.endsAt ? { endsAt: meeting.endsAt } : {}),
                ...(meeting.timezone ? { timezone: meeting.timezone } : {}),
                ...(meeting.location ? { location: meeting.location } : {}),
              }),
        }));
      } catch {
        return null;
      }
    }),
  );

  return {
    rows: results.flatMap((rows) => rows ?? []),
    notSaved,
    partial: !proven || results.some((rows) => rows === null),
    capped: saved.length > meetingReportCap,
    reportsOff: false,
  };
}
