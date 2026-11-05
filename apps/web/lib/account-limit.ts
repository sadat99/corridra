// The one line every signed-in account action shows when the server says too many requests (HTTP 429).
// It says what happened and that waiting is the way forward, so nobody presses the button again at once.
export const limitWords = 'The request limit was reached. Try again later.';

// What a person reads when a request could not finish at all (offline, dropped, or an answer that was not
// the interface's own). Never a browser or parser message.
export const notReachedWords =
  'Your choices were not saved. Check your connection, then try again.';
