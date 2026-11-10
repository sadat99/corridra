import { z } from 'zod';

// Problem reports (ADR-078, Help > Report a Problem). One copy of the plain-text rule, the words a report may hold and the
// path a report may name, shared by the services and by the delivery staff notes. The database repeats every rule here
// (customer_private.problem_report_plain from migration 0002, problem_report_path_ok and problem_report_parse), so a
// person never sees the database refuse what the form accepted.
export const problemReportCategories = [
  'did_not_work',
  'could_not_find',
  'words_wrong',
  'something_else',
] as const;
export type ProblemReportCategory = (typeof problemReportCategories)[number];
export const problemReportPageKinds = ['this_page', 'another_page'] as const;
export type ProblemReportPageKind = (typeof problemReportPageKinds)[number];
export const problemReportStatuses = ['received', 'in_review', 'resolved', 'closed'] as const;
export type ProblemReportStatus = (typeof problemReportStatuses)[number];
export type ProblemReporterKind = 'customer' | 'team';

export const problemReportLimits = {
  pageText: 120,
  path: 200,
  detail: 1000,
  somethingElseDetail: 10,
  note: { min: 10, max: 1000 },
  reference: 64,
} as const;

// Refused anywhere: the C0 controls (a line break, a tab, an escape code), DEL, the C1 controls, the line and paragraph
// separators, the bidirectional embedding, override and isolate characters. U+0000 and a lone surrogate are refused
// here too although the database never sees them (a jsonb value cannot hold them), the one place this set is stricter.
const refusedCharacters =
  /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}\ud800-\udfff]/u;
// Case sensitive, as in the database.
const linkMarkers = /(:\/\/|@|www\.)/;

/** True when the text holds no control or direction character and no web address or email marker. */
export function plainTextAllowed(value: string) {
  return !refusedCharacters.test(value) && !linkMarkers.test(value);
}
/** Plain text whose length in characters (code points, as the database counts) is between the two bounds. */
export function plainTextBetween(value: string, min: number, max: number) {
  const length = [...value].length;
  return length >= min && length <= max && plainTextAllowed(value);
}

const isEdge = (character: string) =>
  character === ' ' || character === '\t' || character === '\r' || character === '\n';
/** Removes spaces, tabs and line breaks at both ends, and nothing else (the database btrim of the same four). */
export function trimEdges(value: string) {
  let start = 0;
  let end = value.length;
  while (start < end && isEdge(value.charAt(start))) start++;
  while (end > start && isEdge(value.charAt(end - 1))) end--;
  return value.slice(start, end);
}
/** The normal form of free text: each run of line breaks becomes one space, then the ends are trimmed. */
export const oneLine = (value: string) => trimEdges(value.replace(/[\r\n]+/g, ' '));

const uuidText = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const hasUuid = new RegExp(uuidText, 'i');
const everyUuid = new RegExp(uuidText, 'gi');
const shells = { customer: /^\/account(\/|$)/, team: /^\/operator(\/|$)/ } as const;

/** What the database accepts as a stored path: the pathname of the reporter's own shell, 200 characters at most. */
export function problemReportPathOk(path: string, reporter: ProblemReporterKind) {
  return (
    plainTextBetween(path, 1, problemReportLimits.path) &&
    !/[?#]/.test(path) &&
    !hasUuid.test(path) &&
    shells[reporter].test(path)
  );
}

/**
 * The pathname to store for a page address, or null when the report must be filed as Another page: the address is not a
 * path of the reporter's own shell (/account for a customer, /operator for the team) or is too long. The query and
 * fragment are dropped, dot segments are resolved and every uuid becomes :id. The result never holds a ? or a #.
 */
export function sanitiseProblemPath(raw: string, reporter: ProblemReporterKind) {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  const cut = raw.search(/[?#]/);
  let pathname: string;
  try {
    pathname = new URL(cut < 0 ? raw : raw.slice(0, cut), 'https://path.invalid').pathname;
  } catch {
    return null;
  }
  const path = pathname.replace(everyUuid, ':id');
  return problemReportPathOk(path, reporter) ? path : null;
}

type FileFields = {
  category: ProblemReportCategory;
  pageKind: ProblemReportPageKind;
  page: string;
  detail?: string | undefined;
};
function fileProblems(value: FileFields, reporter: ProblemReporterKind) {
  const problems: { path: string; message: string }[] = [];
  if (value.pageKind === 'this_page' && !problemReportPathOk(value.page, reporter))
    problems.push({ path: 'page', message: 'That page address cannot be reported' });
  if (
    value.pageKind === 'another_page' &&
    !plainTextBetween(value.page, 1, problemReportLimits.pageText)
  )
    problems.push({ path: 'page', message: 'Write which page or screen, in plain text' });
  if (value.detail !== undefined && !plainTextBetween(value.detail, 1, problemReportLimits.detail))
    problems.push({ path: 'detail', message: 'Write what happened in plain text' });
  if (
    value.category === 'something_else' &&
    (value.detail === undefined ||
      [...value.detail].length < problemReportLimits.somethingElseDetail)
  )
    problems.push({ path: 'detail', message: 'Write at least 10 characters about what happened' });
  return problems;
}
// Free text is read in its normal form, so a replay with other line breaks or spacing is the same command.
const freeText = z
  .string()
  .transform(oneLine)
  .nullish()
  .transform((value) => value || undefined);
const fileShape = {
  commandId: z.uuid(),
  category: z.enum(problemReportCategories),
  pageKind: z.enum(problemReportPageKinds),
  // A page address or a page name is never joined onto one line: a line break there is refused.
  page: z.string().transform(trimEdges),
  detail: freeText,
};
const refineFile =
  (reporter: ProblemReporterKind) => (value: FileFields, context: z.core.$RefinementCtx) => {
    for (const problem of fileProblems(value, reporter))
      context.addIssue({ code: 'custom', path: [problem.path], message: problem.message });
  };
// Self only: there is no person id, name, side or reporter in any input, and any extra key is refused.
export const customerProblemReportInput = z
  .object(fileShape)
  .strict()
  .superRefine(refineFile('customer'));
export type CustomerProblemReportInput = z.infer<typeof customerProblemReportInput>;

const note = z
  .string()
  .transform(oneLine)
  .nullish()
  .transform((value) => value || undefined);
// What the database reads of a staff move: received to in_review or closed, in_review to resolved or closed. Resolved and
// closed carry a note of 10 to 1000 plain characters that the reporter reads; in_review may have one.
export const problemReportTransitionInput = z
  .object({
    action: z.literal('transition'),
    commandId: z.uuid(),
    reportId: z.uuid(),
    expectedState: z.enum(['received', 'in_review']),
    toState: z.enum(['in_review', 'resolved', 'closed']),
    note,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.note === undefined) {
      if (value.toState !== 'in_review')
        context.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'A note is required to resolve or close a problem report',
        });
    } else if (
      !plainTextBetween(value.note, problemReportLimits.note.min, problemReportLimits.note.max)
    )
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'A note must be 10 to 1000 characters of plain text',
      });
  });
export const problemReportRemoveWordsInput = z
  .object({
    action: z.literal('remove_words'),
    commandId: z.uuid(),
    erasureRequestId: z.uuid(),
  })
  .strict();
export const teamProblemReportFileInput = z
  .object({ action: z.literal('file'), ...fileShape })
  .strict()
  .superRefine(refineFile('team'));
export const teamProblemReportAction = z.discriminatedUnion('action', [
  teamProblemReportFileInput,
  problemReportTransitionInput,
  problemReportRemoveWordsInput,
]);
export type TeamProblemReportAction = z.infer<typeof teamProblemReportAction>;

const pageSize = z.coerce.number().int().min(1).max(100).default(25);
const counter = (minimum: number) =>
  z.coerce.number().int().min(minimum).max(Number.MAX_SAFE_INTEGER).optional();
// The reporter's own list, newest first, paged by number.
export const problemReportListQuery = z.object({ beforeNumber: counter(1), pageSize }).strict();
// The staff queue, oldest first, paged by number, optionally one status.
export const problemReportQueueQuery = z
  .object({ afterNumber: counter(0), pageSize, status: z.enum(problemReportStatuses).optional() })
  .strict();
/** A reference is read by the database only when it could be one: 1 to 64 characters and no NUL. */
export const problemReportReference = z
  .string()
  .min(1)
  .max(problemReportLimits.reference)
  .refine((value) => !value.includes('\u0000'));
