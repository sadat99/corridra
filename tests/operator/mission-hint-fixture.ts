// What the mission list and the commercial report answer in the W5 browser tests. Shared by the component
// fixture (w5-mission-context.spec.ts) and the real route (zz-mission-hint.spec.ts).
export const MISSION_A = '11111111-1111-4111-8111-111111111111';
export const MISSION_B = '22222222-2222-4222-8222-222222222222';
export const UNLISTED = '33333333-3333-4333-8333-333333333333';
export const NOTE =
  'This mission is not in the list shown here. Choose a mission from the list, or open the mission page again.';

export const listed = [
  { id: MISSION_A, status: 'OPEN', brief: { company: 'Acme Textiles' } },
  { id: MISSION_B, status: 'OPEN', brief: { company: 'Borealis Trading' } },
];

export const commercial = {
  role: 'owner',
  freshMfa: true,
  enabled: true,
  opportunities: [],
  total: 0,
  records: [],
  recordsTruncated: false,
  recordCounts: [],
  confirmations: [],
  owners: [],
  meetings: [],
  origins: [],
  missions: [
    { id: MISSION_A, label: 'Acme Textiles' },
    { id: MISSION_B, label: 'Borealis Trading' },
  ],
  sources: [],
  evidence: [],
  history: [],
  metrics: {},
  activity: {},
  totals: [],
  overdue: [],
  meetingFollowups: [],
};
