import { realUseEnabled } from './customer-production';

// Two independent owner switches for shared commercial reports that belong to real workspaces. They change
// nothing for sample workspaces.
//
// Public link: anyone holding an unexpired, unrevoked report link can read that report without signing in.
// Off unless the owner sets CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED to exactly "true" (and real use is on).
//
// Signed-in: a verified real customer can save a shared report, open it, see its decisions and company
// continuity, and accept an assigned report. On unless the owner sets CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED
// to exactly "false".
//
// The database side (app.delivery_purpose) honours a transaction setting that only the application sets from
// these two switches, so turning one off cannot be bypassed by calling a different service.
export function realReportPublicLinkEnabled(env: NodeJS.ProcessEnv = process.env) {
  return realUseEnabled(env) && env.CORRIDRA_REAL_REPORT_PUBLIC_LINK_ENABLED === 'true';
}
export function realReportSignedInEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED !== 'false';
}
export const realReportsOffMessage = 'Shared reports are switched off for now';
