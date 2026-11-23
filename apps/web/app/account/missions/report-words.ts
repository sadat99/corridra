// Words a customer reads on a saved commercial report and its reviewed decisions (unit B3a, D-035). Customers read
// "the Corridra team" and "what you can see"; they never read operator, scope, disclosure or Synthetic. A sample
// workspace is marked once by the page's own mode label, so no line here repeats it.

/** The line under the report's back link: what the report is, and what it is not. */
export function reportIntro(real: boolean): string {
  return (
    (real ? 'Your submitted information.' : 'Sample data only.') +
    ' This is what the Corridra team has approved you to see. It is not automatic access to every company, contact, offer or participant record.'
  );
}

/** Above the reviewed decisions, in every workspace: who reviewed them and which revision this is. */
export function reviewedLine(version: number): string {
  return `Reviewed by the Corridra team · version ${version}.`;
}

export const decisionsNotApproved =
  'The Corridra team has not approved any decision for you to see yet. This does not mean no decisions exist.';
export const decisionsSourceUnavailable =
  'Approved decision sources are unavailable. Ask the Corridra team to review what you can see.';
export const selfDeclaredResponse =
  'This is my self-declared response. Supporting documents must follow the Corridra team’s review process.';
