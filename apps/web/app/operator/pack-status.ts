// The five states of a route pack in the words the team desk uses, and the tone of each. One copy: the Routes list, the guided
// pack form and the route pack editor all read it.
export const packStatuses = [
  ['DRAFT', 'Draft, not used yet'],
  ['TESTING', 'Testing'],
  ['LIMITED', 'Limited use'],
  ['ACTIVE', 'Active'],
  ['PAUSED', 'Paused'],
] as const;
export const packTones = {
  DRAFT: 'neutral',
  TESTING: 'info',
  LIMITED: 'info',
  ACTIVE: 'positive',
  PAUSED: 'caution',
} as const;
export const packStatusWords = (status: string) =>
  packStatuses.find(([value]) => value === status)?.[1] ?? status;
