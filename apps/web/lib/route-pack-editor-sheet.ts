import type { SheetIssue, SheetReport, SheetRoutePlan } from '@corridra/missions/route-pack-sheet';

// ADR-093 Phase 3, PR 4: the page's side of route-pack-import and route-pack-export (spec 12.1, 12.2). Pure and free of value
// imports (types only come from other files, and they are erased), so the browser tests in tests/operator can load it. It
// refuses a file before upload, builds the bodies of a check (dry run) and of a save, keeps one save id per file, and says what
// an answer means.

/** The largest file the server takes (sheetLimits.octets, pinned by a test). */
export const sheetFileLimit = 1048576;
/** The most routes one export may name (sheetLimits.routes, pinned by a test). */
export const sheetRouteLimit = 20;
/** The server's words for a Pending row of a new custom field (sheetWords.pendingCustom, pinned by a test). */
export const pendingCustomWords = 'Skipped: a Pending row does not create a custom field.';

export type FileRefusal = 'type' | 'size';
/** Why a chosen file is refused before any request: not a CSV by name or type, or over the size limit. */
export function fileRefusal(file: {
  name: string;
  type: string;
  size: number;
}): FileRefusal | null {
  const csv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  if (!csv) return 'type';
  if (file.size > sheetFileLimit) return 'size';
  return null;
}

export type SheetBody =
  | { mode: 'dry-run'; csv: string }
  | { mode: 'save'; csv: string; saveId: string; reason: string; planFingerprint: string };
/** The body of a check: the file text only. A check writes nothing and carries no save id. */
export const dryRunBody = (csv: string): Extract<SheetBody, { mode: 'dry-run' }> => ({
  mode: 'dry-run',
  csv,
});
export type SaveCommand = { id: string; csv: string };
/**
 * The save id of the next save. The same file text keeps its id (Try the Rest Again and a send after the authenticator check
 * finish the same save, so nothing is written twice); another file, or no earlier save, makes a new id. `makeId` is
 * `crypto.randomUUID`.
 */
export function nextSaveCommand(
  previous: SaveCommand | null,
  csv: string,
  makeId: () => string,
): SaveCommand {
  return previous && previous.csv === csv ? previous : { id: makeId(), csv };
}
/**
 * The body of a save, under the id kept for this file and the reason as typed (trimmed, as the server keeps it), with the plan
 * fingerprint of the check the person saw (follow-up per G73): the first send of a save id is refused if the plan changed.
 */
export const saveBody = (
  csv: string,
  command: SaveCommand,
  reason: string,
  planFingerprint: string,
): Extract<SheetBody, { mode: 'save' }> => ({
  mode: 'save',
  csv,
  saveId: command.id,
  reason: reason.trim(),
  planFingerprint,
});

// ---- What an answer means -----------------------------------------------------------------------------------------------
const recordOf = (json: unknown) =>
  (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
const textOf = (value: unknown) => (typeof value === 'string' ? value : null);
/** A report this page can draw, or null (then nothing is claimed from it). */
export function readReport(json: unknown): SheetReport | null {
  const r = recordOf(json);
  if (!Array.isArray(r.errors) || !Array.isArray(r.routes) || !Array.isArray(r.warnings))
    return null;
  if (r.saved !== undefined && !Array.isArray(r.saved)) return null;
  return r as unknown as SheetReport;
}

export type CheckOutcome =
  | { kind: 'report'; report: SheetReport }
  /** The server refused the file as a whole (400 or 413), in its own words. */
  | { kind: 'fileProblem'; message: string | null }
  /** The check itself did not finish: the file was not used. */
  | { kind: 'failed' };
export function checkOutcome(status: number, json: unknown): CheckOutcome {
  if (status === 200) {
    const report = readReport(json);
    // A check without its plan fingerprint cannot be saved, so it is not claimed.
    return report && typeof report.planFingerprint === 'string'
      ? { kind: 'report', report }
      : { kind: 'failed' };
  }
  if (status === 400 || status === 413)
    return { kind: 'fileProblem', message: textOf(recordOf(json).error) };
  return { kind: 'failed' };
}

/** The codes of a save step refused because its route changed after the plan (a pack or the facts). */
export const changedCodes = ['ROUTE_PACK_PACK_CHANGED', 'ROUTE_PACK_CONTENT_CHANGED'] as const;
export type SaveOutcome =
  | { kind: 'saved'; report: SheetReport }
  /** The save planned again and found errors: nothing was written. */
  | { kind: 'problems'; report: SheetReport }
  /** A route changed after the check. `route` is null when the server named none (nothing was written). */
  | { kind: 'routeChanged'; route: string | null; report: SheetReport | null }
  /** The save id belonged to another file: the next save is a new one. */
  | { kind: 'reused'; report: SheetReport | null }
  /** Some steps are written and some are not: the same file and save id finish it. */
  | { kind: 'partWay'; report: SheetReport }
  /** 401 STEP_UP_REQUIRED still standing: the person closed the authenticator check. */
  | { kind: 'stepUp' }
  | { kind: 'signedOut' }
  | { kind: 'denied' }
  | { kind: 'notFound' }
  /** The server refused the request as sent (400 or 413), in its own words. */
  | { kind: 'refused'; message: string | null }
  /** A network failure, a server error or an answer this page cannot read: nothing is claimed saved. */
  | { kind: 'offline' };
export function sheetOutcome(status: number, json: unknown): SaveOutcome {
  const r = recordOf(json);
  const code = textOf(r.code);
  if (status === 201) {
    const report = readReport(json);
    return report && report.saved ? { kind: 'saved', report } : { kind: 'offline' };
  }
  if (status === 409) {
    const report = readReport(r.report);
    if (!report) {
      if (
        code === 'ROUTE_PACK_CONTENT_CHANGED' ||
        code === 'ROUTE_PACK_PACK_CHANGED' ||
        code === 'ROUTE_PACK_PLAN_CHANGED'
      )
        return { kind: 'routeChanged', route: null, report: null };
      if (code === 'ROUTE_PACK_COMMAND_REUSED') return { kind: 'reused', report: null };
      return { kind: 'offline' };
    }
    if (report.saved === undefined) return { kind: 'problems', report };
    const first = report.errors[0];
    if (first?.code && (changedCodes as readonly string[]).includes(first.code))
      return { kind: 'routeChanged', route: first.route, report };
    if (first?.code === 'ROUTE_PACK_COMMAND_REUSED') return { kind: 'reused', report };
    return { kind: 'partWay', report };
  }
  if (status === 401)
    return code === 'STEP_UP_REQUIRED' ? { kind: 'stepUp' } : { kind: 'signedOut' };
  if (status === 403) return { kind: 'denied' };
  if (status === 404) return { kind: 'notFound' };
  if (status === 400 || status === 413) return { kind: 'refused', message: textOf(r.error) };
  return { kind: 'offline' };
}

// ---- Reading a report ---------------------------------------------------------------------------------------------------
type Saved = NonNullable<SheetReport['saved']>[number];
/**
 * Whether a route is done after a save answer: each step it needs is written. The save plans against the state it finds, so on
 * a second send a step written by the first is no longer needed.
 */
export function routeDone(plan: SheetRoutePlan, saved: Saved | undefined): boolean {
  const content = !plan.content.changed || (saved?.contentVersion ?? null) !== null;
  const pack = !plan.pack.changed || (saved?.packVersion ?? null) !== null;
  return content && pack;
}
const savedOf = (report: SheetReport, route: string) =>
  report.saved?.find((item) => item.route === route);
/** The routes of a report that are done. */
export const doneRoutes = (report: SheetReport) =>
  report.routes.filter((plan) => routeDone(plan, savedOf(report, plan.route))).map((p) => p.route);
/**
 * What one route got from a save answer that did not finish (PR 4 per G72). The save writes every route's facts before any pack
 * step, so a route may have its facts and not its pack. `why` says what stopped the rest: its route changed after the check, the
 * server refused its step (`reason` holds the server's words), or the save stopped before it (not tried).
 */
export type RouteResult =
  | { route: string; kind: 'done' }
  | {
      route: string;
      kind: 'factsOnly' | 'nothing';
      why: 'changed' | 'refused' | 'notTried';
      reason: string | null;
    };
export function routeResults(report: SheetReport): RouteResult[] {
  const stopped = report.errors[0];
  return report.routes.map((plan): RouteResult => {
    const saved = savedOf(report, plan.route);
    if (routeDone(plan, saved)) return { route: plan.route, kind: 'done' };
    // Follow-up per G73: a route named with a facts version has its facts saved, by this answer or an earlier one of the save.
    const facts = (saved?.contentVersion ?? null) !== null;
    const here = !!stopped && stopped.route === plan.route;
    const changed =
      here && !!stopped.code && (changedCodes as readonly string[]).includes(stopped.code);
    return {
      route: plan.route,
      kind: facts ? 'factsOnly' : 'nothing',
      why: changed ? 'changed' : here ? 'refused' : 'notTried',
      reason: here ? stopped.message : null,
    };
  });
}
/** True when the answer names a changed route without saying which (then the page names none). */
export const changedUnnamed = (report: SheetReport) => {
  const first = report.errors[0];
  return (
    !!first?.code &&
    (changedCodes as readonly string[]).includes(first.code) &&
    first.route === null
  );
};
/**
 * The success line of a finished save: how many routes and facts, counting facts written by earlier answers of the same save
 * id; or `nothingLeft` when no answer of this save wrote anything (a second send of a save that had already finished).
 */
export function savedSummary(
  report: SheetReport,
  factsSoFar: number,
  wroteBefore: boolean,
): { kind: 'saved'; routes: number; facts: number } | { kind: 'nothingLeft' } {
  if (!wroteBefore && (report.saved?.length ?? 0) === 0) return { kind: 'nothingLeft' };
  return {
    kind: 'saved',
    routes: report.routes.length,
    facts: factsSoFar + savedFactCount(report),
  };
}
/** The text of a chosen file, or null when its bytes are not UTF-8 (then it is refused before any upload). */
export function decodeSheet(bytes: ArrayBuffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
/** The facts a save wrote: added, changed and removed, over the routes whose facts were written by this answer. */
export function savedFactCount(report: SheetReport): number {
  return report.routes.reduce((sum, plan) => {
    const saved = savedOf(report, plan.route);
    if (!saved || saved.contentVersion === null) return sum;
    return (
      sum + plan.content.added.length + plan.content.updated.length + plan.content.removed.length
    );
  }, 0);
}

export type ProblemItem = {
  row: number | null;
  route: string | null;
  label: string | null;
  message: string;
};
/**
 * The problems in the order the list draws them: those of the whole file first, then by row (a stable order, so problems of one
 * row keep the server's order). `rows` counts the distinct rows that have a problem.
 */
export function problemItems(
  errors: readonly SheetIssue[],
  labelOf: (key: string) => string,
): { items: ProblemItem[]; rows: number } {
  const items = errors
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => (a.issue.row ?? -1) - (b.issue.row ?? -1) || a.index - b.index)
    .map(({ issue }) => ({
      row: issue.row,
      route: issue.route,
      label: issue.key ? labelOf(issue.key) : null,
      message: issue.message,
    }));
  const rows = new Set(items.flatMap((item) => (item.row === null ? [] : [item.row]))).size;
  return { items, rows };
}

/** The rows of a report that were skipped, over every route, by row. */
export function skippedRows(report: SheetReport) {
  return report.routes
    .flatMap((plan) => plan.skipped.map((skip) => ({ ...skip, route: plan.route })))
    .sort((a, b) => a.row - b.row);
}
/** True when every skipped row is a Pending row of a new custom field, so one line says it. */
export const onlyPendingCustom = (skipped: readonly { message: string }[]) =>
  skipped.every((skip) => skip.message === pendingCustomWords);

/** The labels of the pack settings a route's plan changes. `fields` is the domain dictionary, given by the caller. */
export function packFieldLabels(
  changedFields: readonly string[],
  fields: readonly { key: string; label: string; configurationKey?: string }[],
): string[] {
  return changedFields.map(
    (name) =>
      fields.find((field) => field.configurationKey === name)?.label ??
      fields.find((field) => field.key === name)?.label ??
      name,
  );
}

/** The file name of an export, from its Content-Disposition, or null. */
export function exportFileName(disposition: string | null): string | null {
  const found = disposition ? /filename="?([^";]+)/.exec(disposition) : null;
  return found ? found[1]!.trim() : null;
}
/** The query word of an export: the route keys joined by |. */
export const exportRoutes = (keys: readonly string[]) => keys.join('|');
