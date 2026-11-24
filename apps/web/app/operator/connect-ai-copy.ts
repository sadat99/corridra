// ADR-089. Every line the guided Connect AI screen shows, in one place, so a test can read the exact words and scan them for
// claims the screen must never make (where a provider processes data, legal status, a key, or AI being on). English only:
// the screen is staff-facing and no translation is added. Lines that hold a number or a name are functions.
import type { TaskId } from '@corridra/intelligence/registry';

export type AdapterChoice = 'openai' | 'anthropic' | 'google';

export const providerNames: Record<AdapterChoice, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
};

/** A provider's name for any adapter id the server returns; an unknown id is shown as it is. */
export const providerName = (adapter: string) =>
  (providerNames as Record<string, string>)[adapter] ?? adapter;

/** A source record's kind in words, such as "Public record" for public_record. */
export const kindLabel = (kind: string) => {
  const text = kind
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : kind;
};

export const stepNames = [
  'Provider',
  'Model',
  'Countries',
  'Sources',
  'Prices',
  'Limits',
  'Tasks',
  'Review',
  'Save',
] as const;

// The question each step asks, shown as the step heading.
export const stepQuestions: readonly string[] = [
  'Which provider do you want to connect?',
  'Which model will you use?',
  'Which countries does this connection list?',
  'Which source records support it?',
  'What does the provider charge?',
  'What are the limits?',
  'What may this connection be used for?',
  'Check your answers',
  'Save this version',
];

export const progressLine = (step: number) =>
  step === stepNames.length - 1
    ? `Step ${step + 1} of ${stepNames.length}: ${stepNames[step]}`
    : `Step ${step + 1} of ${stepNames.length}: ${stepNames[step]} · Next: ${stepNames[step + 1]}`;

export const taskLabels: Record<TaskId, string> = {
  commercial_intent: 'Read the goal of a request',
  requirement_structuring: 'Organise request details',
  counterparty_research: 'Research a company',
  entity_duplicate_suggestions: 'Spot duplicate companies',
  buyer_supplier_fit: 'Review buyer and supplier fit',
  machinery_specification: 'Draft machinery specifications',
  quotation_comparison: 'Compare price quotes',
  meeting_preparation: 'Prepare for a meeting',
  translation: 'Translate text',
  evidence_gaps: 'Find missing evidence',
  post_meeting_followup: 'Write meeting follow-ups',
  opportunity_outcome_summary: 'Summarise an outcome',
};

export const words = {
  open: 'Connect an AI Provider',
  formLabel: 'Connect AI',
  stepsLabel: 'Steps',
  next: 'Next',
  back: 'Back',
  pickProvider: 'Pick a Provider to Continue',
  reassurance: 'Nothing is saved until the last step.',
  loading: 'Loading your AI connection settings.',
  readFailed: 'Corridra could not load your AI connection settings. Nothing has changed.',
  tryAgain: 'Try Again',
  backToSettings: 'Back to AI Settings',
  notAvailable: 'Not available yet',
  blocked: {
    MODULE_NOT_INSTALLED:
      'Connecting an AI provider is not available for this workspace yet. Ask the owner to install the AI connection module.',
    REAL_USE_OFF:
      'Connecting an AI provider is not available while real use is switched off for this workspace. Ask the owner to switch real use on.',
  },
  deniedHeading: 'Only owners and admins can do this',
  denied: 'Only owners and admins can connect an AI provider. Ask an owner to do this for you.',
  firstEver: 'No provider has a saved version yet. This will be version 1.',
  provider: { legend: 'Provider', error: 'Choose a provider.' },
  model: {
    label: 'Model name',
    helper: 'Write it exactly as your provider names it.',
    blank: 'Enter the model name.',
    invalid: 'Use letters, numbers and . _ : / - only, starting with a letter or number.',
  },
  evaluation: {
    legend: 'Evaluation status',
    error: 'Choose an evaluation status.',
    SYNTHETIC_ONLY: {
      label: 'Sample data only',
      line: 'You tested this model on sample data only.',
    },
    APPROVED_PROVIDER: {
      label: 'Approved provider',
      line: 'This is your own claim that the provider is approved. Corridra does not verify it.',
    },
  },
  countries: {
    legend: 'Countries for this connection',
    helper:
      'These are the countries Corridra records with this connection. Corridra does not check where your provider processes data.',
    oneByOne: 'Choose countries one by one',
    euLabel: 'EU member countries (list Corridra records)',
    euEmpty: 'Corridra has no EU list recorded yet. Choose the countries one by one.',
    showCountries: 'Show the Countries',
    find: 'Find a country',
    findHint: 'Type a country name.',
    noMatch: 'No country matches that name. Check the spelling.',
    atCap: 'You have chosen the most this connection can list. Remove one to add another.',
    showAll: 'Show All',
    none: 'Choose at least one country.',
  },
  sources: {
    terms: 'Provider terms source',
    evaluation: 'Evaluation record source',
    helper: 'Choose a current source record.',
    choose: 'Choose a source',
    blank: 'Choose a source.',
    none: 'No current source records are available to you. Add one first, then come back.',
    capped: 'Showing the 50 most recent source records.',
    refused: 'This source is expired or not available to you. Choose a current source.',
    banner: 'Not saved. Fix the source on step 4.',
  },
  prices: {
    input: 'Input rate per million tokens',
    output: 'Output rate per million tokens',
    cap: 'Cost cap for one call',
    helper: 'Enter the rate your provider publishes. Corridra does not look it up.',
  },
  limits: {
    budget: 'Daily budget',
    budgetHelper: 'Up to 1,000.00 USD a day.',
    budgetOver: 'The daily budget can be at most 1,000.00 USD.',
    validUntil: 'Valid until',
    validHelper: 'This connection stops being usable at the end of this date, UTC.',
    validError: 'Choose a date after today.',
  },
  money: {
    aboveZero: 'Enter an amount above 0.',
    decimals: 'Use at most 2 decimal places.',
    notNumber: 'Enter a number.',
  },
  tasks: {
    legend: 'Tasks this connection may be used for',
    error: 'Choose at least one task.',
  },
  fallback: {
    label: 'Fallback connection (optional)',
    none: 'No fallback',
    helper: 'Optional. Choose another connection that is current.',
    empty: 'There is no other current connection to choose.',
    FALLBACK_SELF:
      'A connection cannot be its own fallback. Choose another connection or save without one.',
    FALLBACK_NOT_CURRENT:
      'This fallback is no longer a current connection. Choose another or save without one.',
  },
  scopeRefused: {
    EU_UNAVAILABLE: 'EU member countries are not available yet. Choose the countries one by one.',
    EU_UNUSABLE: 'The EU member list could not be used. Choose the countries one by one.',
    COUNTRY_LIMIT: 'Choose at most 20 countries until the AI connection module is installed.',
  },
  save: {
    reason: 'Why are you saving this version?',
    reasonError: 'Write at least 3 characters.',
    confirm: 'I have read the facts above and want to save this version.',
    confirmError: 'Tick this to save.',
    action: 'Save Connection',
    busy: 'Saving',
    busyStatus: 'Saving this version. Please wait.',
    failed:
      'Corridra could not save this version. Nothing is confirmed as saved. Your answers are still here.',
    versionChanged:
      'This connection changed after you started. Another version was saved, and it may have been yours a moment ago. Your answers are kept.',
    loadLatest: 'Load Latest Version',
  },
  beforeSave: {
    heading: 'Before you save',
    change: 'What changes?',
    money: 'Does money move?',
    run: 'Can anything run?',
    moneyFact: 'No. This saves settings only. No money moves.',
    runRealOff:
      'No. This save runs no AI and does not switch it on. AI is off for this workspace, so no AI run can start here.',
    runRealOn:
      'No. This save runs no AI and does not switch it on. AI is already on for this workspace. A later run can use this connection only if the route pack of the request names it and the evaluation status is Approved provider. A run is refused if a cited statement holds an email address or a phone number. The cost cap and the daily budget still apply. A person must review every result.',
    runSample: 'No. This save runs no AI and does not switch it on.',
    recorded: 'The save is recorded with your name and your reason.',
  },
  success: {
    heading: 'Saved, not switched on',
    headingOn: 'Saved, AI was already on',
    another: 'Connect Another Provider',
    refreshFailed:
      'Corridra could not refresh the connection list just now. Your saved version is not affected.',
  },
} as const;

export const fromVersion = (version: number) => `From version ${version}`;

export const euHelper = (count: number, recordedOn: string) =>
  `Corridra saves the countries it lists as EU members today (${count} countries, recorded ${recordedOn}). This is a list of countries, not a check of where your provider processes data. Later changes to the list do not alter what you save.`;

export const euConsequence = (adapter: AdapterChoice) =>
  `To use this list, the owner must set CORRIDRA_${adapter.toUpperCase()}_PROCESSING_LOCATIONS and each cited source's rights review to include every country.`;

export const chosenCount = (count: number, limit: number) =>
  `${count} of ${limit} countries chosen`;

export const countryAdded = (name: string, count: number, limit: number) =>
  `${name} added. ${count} of ${limit} chosen.`;

export const countryRemoved = (name: string, count: number, limit: number) =>
  `${name} removed. ${count} of ${limit} chosen.`;

/** The twelve tasks in three closed groups, so the step stays short. Every task is in exactly one group. */
export const taskGroups: readonly { name: string; tasks: readonly TaskId[] }[] = [
  {
    name: 'Requests and companies',
    tasks: [
      'commercial_intent',
      'requirement_structuring',
      'counterparty_research',
      'entity_duplicate_suggestions',
      'buyer_supplier_fit',
    ],
  },
  {
    name: 'Documents and quotes',
    tasks: ['machinery_specification', 'quotation_comparison', 'translation', 'evidence_gaps'],
  },
  {
    name: 'Meetings and outcomes',
    tasks: ['meeting_preparation', 'post_meeting_followup', 'opportunity_outcome_summary'],
  },
];

export const groupSummary = (name: string, count: number, total: number) =>
  `${name} (${count} of ${total} chosen)`;

/** How many countries match the search, and how many of them are shown. */
export const matchesLine = (shown: number, total: number) =>
  total > shown
    ? `${shown} of ${total} shown. Keep typing to narrow.`
    : `${total} ${total === 1 ? 'country matches' : 'countries match'}.`;

export const tasksChosen = (count: number, total: number) => `${count} of ${total} chosen`;

export const showTasks = (count: number, total: number) => `Show the Tasks (${count} of ${total})`;

export const reasonCount = (count: number) => `${count} of 500`;

export const fallbackOption = (provider: string, model: string, version: number) =>
  `${provider} ${model}, version ${version}`;

export const changeLabel = (section: string) => `Change ${section}`;

export const reviewSummary = (provider: string, model: string, version: number) =>
  `You are saving version ${version} of the ${provider} connection, for the model ${model}.`;

export const changeFact = (provider: string, latest: number) =>
  latest === 0
    ? `This is the first version of the ${provider} connection. No route pack is pinned to an earlier version.`
    : `Saving makes version ${latest + 1} of the ${provider} connection. It replaces version ${latest}, so route packs pinned to version ${latest} stop using AI.`;

// aiOn: AI was already on for this workspace when the form was read (ADR-091). The save itself never switches it.
export const savedText = (provider: string, version: number, aiOn = false) =>
  `Version ${version} of the ${provider} connection is saved. ${
    aiOn
      ? 'AI was already on for this workspace, and this save did not change that. This save ran no AI and moved no money. A run starts only when a person starts one, and it must pass the checks.'
      : 'AI is not switched on. This save ran no AI and moved no money.'
  }${version === 1 ? '' : ` Route packs pinned to version ${version - 1} no longer use AI.`}`;
