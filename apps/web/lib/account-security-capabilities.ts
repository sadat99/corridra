// ADR-086. Which account security controls a person may use. Each one ships switched off and is turned on only by
// changing this constant after the Guardian's preview probe has proven it against the pinned sign-in SDK; the probe record
// names the revision it ran on, when, and the SHA-256 of its report. A control that is false is hidden on the screen and
// its route answers 404 as if it did not exist. This is code, not an environment switch, so it changes only by review.
export type AccountSecurityProbe = {
  revision: string;
  ranAt: string;
  reportSha256: string;
};
export type AccountSecurityCapabilities = {
  readonly updateName: boolean;
  readonly changePassword: boolean;
  readonly listSessions: boolean;
  readonly revokeSession: boolean;
  readonly probe: AccountSecurityProbe | null;
};
export const accountSecurityCapabilities: AccountSecurityCapabilities = Object.freeze({
  updateName: false,
  changePassword: false,
  listSessions: false,
  revokeSession: false,
  probe: null,
});
