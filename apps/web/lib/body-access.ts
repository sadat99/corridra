// ADR-087 U1: staff viewers see that a reply or an evidence answer exists, never the words a third party typed.
// The service sends the body as null; every screen that would show it says this instead.
export const bodyNotAvailable = 'Not available for your role';
