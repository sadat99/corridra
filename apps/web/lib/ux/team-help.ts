// The team header's Help and accessibility groups: the shared groups, plus the old phone Help sheet's "Start a Request"
// (the public request form), so nothing the team reached from the corner Help is lost. Owner: S4.
import { customerHelpGroups, reportProblemHref, type HelpGroup } from './customer-navigation';
import { workspaceQuery } from './shells';

export const teamProblemReportsPath = '/operator/problem-reports';

/** The team form's address: the page the person is on and, as every team address does, the chosen workspace. */
export function teamReportProblemHref(pathname: string, workspace = '') {
  return reportProblemHref(
    teamProblemReportsPath,
    pathname,
    workspaceQuery(workspace).replace('?', '&'),
  );
}

export function teamHelpGroups(
  whatsappHref?: string | null,
  reportProblemHref?: string | null,
): HelpGroup[] {
  return customerHelpGroups(whatsappHref, reportProblemHref).map((group) =>
    group.label === 'About Corridra'
      ? {
          ...group,
          items: [
            ...group.items,
            { kind: 'link' as const, label: 'Start a Request', href: '/plan' },
          ],
        }
      : group,
  );
}
