// Words a customer reads for stored status codes on the saved report page. Fixed tables, written in Title Case in the
// text (never CSS). The stored codes never change; only what a person reads does. An unknown code is shown as its words
// in Title Case, never as a raw code and never in lower case.

const titleCase = (code: string) =>
  code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');

const missionStatus: Record<string, string> = {
  DRAFT: 'Received',
  QUALIFICATION: 'Qualifying',
  ACTIVE: 'Active',
  TARGETING: 'Finding Companies',
  OUTREACH: 'Introductions',
  MEETINGS: 'Meetings',
  FOLLOW_UP: 'Follow-Up',
  COMMERCIAL_PIPELINE: 'Commercial Follow-Through',
  ON_HOLD: 'Paused',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
};

const meetingStatus: Record<string, string> = {
  PROPOSED: 'Suggested',
  ACCEPTED: 'Accepted',
  SCHEDULED: 'Time Confirmed',
  HELD: 'Done',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'Missed',
  RESCHEDULE_REQUIRED: 'New Time Needed',
};

const evidenceRequestStatus: Record<string, string> = {
  OPEN: 'Open',
  RESPONDED: 'Answered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const missionStatusWords = (code: string) => missionStatus[code] ?? titleCase(code);
export const meetingStatusWords = (code: string) => meetingStatus[code] ?? titleCase(code);
export const evidenceRequestStatusWords = (code: string) =>
  evidenceRequestStatus[code] ?? titleCase(code);
