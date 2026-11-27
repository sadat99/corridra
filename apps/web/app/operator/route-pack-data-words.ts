import { becomes, packWords, readinessWarning } from './route-pack-pack-words';

// ADR-093 Phase 3, PR 4: the words of Import Route Data (spec 12.1), Export Route Data (12.2) and the History
// disclosure (16). Pure and free of value imports from packages, so the browser tests can load it. English only:
// the native language review is open. Strings that carry a count are built here; the pack words are reused, not copied.
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const num = (count: number) => new Intl.NumberFormat('en').format(count);
const routes = (count: number) => `${num(count)} ${plural(count, 'route', 'routes')}`;
const facts = (count: number) => `${num(count)} ${plural(count, 'fact', 'facts')}`;
const rowsWord = (count: number) => `${num(count)} ${plural(count, 'row', 'rows')}`;

export const importWords = {
  title: 'Import Route Data',
  stepNames: ['Choose a file', 'Check', 'Review', 'Save'],
  stepLine: (step: number, name: string) => `Step ${step} of 4: ${name}`,
  // Step 1
  intro:
    'Use a CSV file saved in UTF-8: the template, or an export you changed. Up to 1 MB, 5000 rows and 20 routes.',
  helpCopy: 'To copy one route to another, export it, change the route column and import it.',
  helpSeveral:
    'To give one row to several routes, write them in the route cell with | between, for example BD-CN | CN-BD.',
  chooseFile: 'Choose File',
  blankTemplate: 'Download Blank Template',
  notCsv: 'That file is not a CSV.',
  tooBig: 'That file is over 1 MB.',
  // Step 2
  checkingOnly: 'Checking only. Nothing is saved.',
  checking: 'Checking the file…',
  checkFailed: 'The check did not finish. Your file was not used. Try again.',
  tryAgain: 'Try Again',
  chooseAnother: 'Choose Another File',
  downloadProblems: 'Download Problem List',
  // Step 3
  willBeAdded: 'Will be added',
  showChanges: 'Show the changes',
  statusKept: 'A file never changes a pack status. Every route keeps its status.',
  newRouteDraft: 'A new route starts as Draft, not used yet.',
  // Step 4
  saveAll: 'Save All Routes',
  adminLock: 'Only the owner can save a route file. You can check it here and nothing is saved.',
  // Outcomes
  tryRest: 'Try the Rest Again',
  notSaved: 'Not saved. Your file is still here. Try again.',
  changedNoRoute:
    'A route changed while you were checking. Nothing was saved. Choose the file again to check it against the current state.',
  // Shared with the pack dialogs, one copy
  next: packWords.next,
  back: packWords.back,
  cancel: packWords.cancel,
  close: packWords.close,
  onePerson: packWords.onePerson,
  // Builders
  problemsHeading: (problems: number, rows: number) =>
    rows > 0
      ? `${num(problems)} ${plural(problems, 'problem', 'problems')} in ${rowsWord(rows)}. Nothing is saved while any problem remains.`
      : `${num(problems)} ${plural(problems, 'problem', 'problems')}. Nothing is saved while any problem remains.`,
  showAllProblems: (count: number) => `Show all ${num(count)} problems`,
  /** One problem: "Row 14, BD-CN, Working languages: use language tags such as en or bn." Parts that are absent are left out. */
  problemItem: (
    row: number | null,
    route: string | null,
    label: string | null,
    message: string,
  ) => {
    const parts = [row === null ? null : `Row ${num(row)}`, route, label].filter(
      (part): part is string => part !== null && part !== '',
    );
    return parts.length === 0 ? message : `${parts.join(', ')}: ${message}`;
  },
  ready: (count: number) => `Ready to save ${routes(count)}.`,
  packSettings: (labels: string[]) => `Pack settings: ${labels.join(', ')}`,
  readinessWarning,
  becomes,
  skippedPending: (count: number) =>
    `${rowsWord(count)} skipped: new custom fields that are still Pending.`,
  skippedMixed: (count: number) => `${rowsWord(count)} skipped.`,
  saving: (count: number) => `Saving ${routes(count)}…`,
  saved: (routeCount: number, factCount: number) =>
    factCount === 0
      ? `Saved ${routes(routeCount)}. No fact changed.`
      : `Saved ${routes(routeCount)}, ${facts(factCount)}.`,
  openRoute: (name: string) => `Open ${name}`,
  partWay: (saved: number, total: number, notSaved: string[]) =>
    `Saved ${num(saved)} of ${routes(total)}. Not saved: ${notSaved.join(', ')}.`,
  routeReason: (route: string, reason: string) => `${route}: ${reason}`,
  notTried: (route: string) => `${route}: Not tried, because the save stopped before it.`,
  routeChanged: (route: string) =>
    `${route} changed while you were checking. It was not saved. Choose the file again to check it against the current state.`,
} as const;

export const exportWords = {
  title: 'Export Route Data',
  intro:
    'One CSV file in UTF-8, which any spreadsheet opens. Every standard field is listed, including the ones still Pending, so the gaps show. Each fact has its source and date.',
  legend: 'Routes',
  download: 'Download CSV',
  preparing: 'Preparing the file…',
  chooseOne: 'Choose at least one route.',
  tooMany: 'Export at most 20 routes at a time.',
  failed: 'The file could not be made. Nothing was changed. Try again.',
  tryAgain: 'Try Again',
  cancel: packWords.cancel,
  downloaded: (name: string, count: number) => `Downloaded ${name} with ${routes(count)}.`,
} as const;

export const historyWords = {
  summary: 'History',
  factsHeading: 'Route facts',
  packsHeading: 'Pack versions',
  empty: 'No history yet.',
  factsFailed: 'History is not available.',
  packsFailed: 'Pack history is not available.',
  noReason: 'No reason recorded.',
  by: {
    you: 'you',
    teammate: 'a teammate',
    split: 'one team member, published by another',
  },
  factRow: (version: number, dateText: string, whoText: string) =>
    `Version ${num(version)}, ${dateText}, by ${whoText}`,
  packRow: (version: number, dateText: string, whoText: string) =>
    `Pack version ${num(version)}, effective ${dateText}, by ${whoText}`,
} as const;
