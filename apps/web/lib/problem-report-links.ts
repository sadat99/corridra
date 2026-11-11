import { signInPath } from './account-return';
import { failureWords } from './problem-report-words';
import { workspaceQuery } from './ux/shells';
import { operatorSignInPath } from './workspace-navigation';

// Where each side of the Report a Problem screens leads. The customer never reaches the team's addresses and the team
// never reaches /account (ADR-032): every link a screen draws comes from the one set of its own side.
export type ReportLinks = {
  signIn: string;
  home: string;
  homeLabel: string;
  list: string;
  form: string;
  detail: (reference: string) => string;
};

const customerBase = '/account/problem-reports';

export const customerReportLinks: ReportLinks = {
  signIn: signInPath(`${customerBase}/new`),
  home: '/account',
  homeLabel: failureWords.returnCustomer,
  list: customerBase,
  form: `${customerBase}/new`,
  detail: (reference) => `${customerBase}/${encodeURIComponent(reference)}`,
};

const teamBase = '/operator/problem-reports';

/**
 * The team's set. The chosen workspace rides on every address the way it does everywhere in the team shell, and nothing
 * here leads to /account: a team member has no customer screen (ADR-032).
 */
export function teamReportLinks(tenant: string): ReportLinks {
  const query = workspaceQuery(tenant);
  return {
    signIn: operatorSignInPath(tenant),
    home: `/operator${query}`,
    homeLabel: failureWords.returnTeam,
    list: teamBase + query,
    form: `${teamBase}/new${query}`,
    detail: (reference) => `${teamBase}/${encodeURIComponent(reference)}${query}`,
  };
}
