// ADR-088. The addresses and the page event the profile picture screens share. No data and no secrets: the picture
// itself is read only by the signed-in person through the session-checked route.
export const pictureEndpoint = '/api/account/picture';
// Parts of the page that draw the picture (the avatar menu) listen for this; the detail is the new version, or null.
export const pictureChangedEvent = 'corridra:profile-picture';
export const pictureSource = (version: number, size: 'large' | 'small') =>
  `${pictureEndpoint}?size=${size}&v=${version}`;
