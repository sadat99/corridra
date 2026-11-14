// Words a customer reads for stored status codes on the saved report page. Fixed tables, written in Title Case in the
// text (never CSS). The stored codes never change; only the capitals do. An unknown code is shown as its words
// in Title Case, never as a raw code and never in lower case.

const titleCase = (code: string) =>
  code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');

// Each word is the stored word in Title Case, so a person reads the same word as before, never new wording.
const missionStatus: Record<string, string> = {
  DRAFT: 'Draft',
  QUALIFICATION: 'Qualification',
  ACTIVE: 'Active',
  TARGETING: 'Targeting',
  OUTREACH: 'Outreach',
  MEETINGS: 'Meetings',
  FOLLOW_UP: 'Follow Up',
  COMMERCIAL_PIPELINE: 'Commercial Pipeline',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
};

const meetingStatus: Record<string, string> = {
  PROPOSED: 'Proposed',
  ACCEPTED: 'Accepted',
  SCHEDULED: 'Scheduled',
  HELD: 'Held',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No Show',
  RESCHEDULE_REQUIRED: 'Reschedule Required',
};

const evidenceRequestStatus: Record<string, string> = {
  OPEN: 'Open',
  RESPONDED: 'Responded',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const missionStatusWords = (code: string) => missionStatus[code] ?? titleCase(code);
export const meetingStatusWords = (code: string) => meetingStatus[code] ?? titleCase(code);
export const evidenceRequestStatusWords = (code: string) =>
  evidenceRequestStatus[code] ?? titleCase(code);
