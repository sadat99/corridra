// ADR-088. Whether the profile picture is offered. It ships switched off and is turned on only by changing this constant in
// a reviewed change, after the Guardian's preview probe has proven upload, read, replace and remove against the private
// store; the probe record names the revision it ran on, when, and the SHA-256 of its report. While it is false the picture
// controls are hidden, the avatar shows initials only and every picture route answers 404 as if it did not exist. This is
// code, not an environment switch, so it changes only by review (the same pattern as account-security-capabilities.ts).
export type ProfilePictureProbe = {
  revision: string;
  ranAt: string;
  reportSha256: string;
};
export type ProfilePictureCapability = {
  readonly profilePicture: boolean;
  readonly probe: ProfilePictureProbe | null;
};
export const profilePictureCapability: ProfilePictureCapability = Object.freeze({
  profilePicture: false,
  probe: null,
});
