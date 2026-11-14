// Where the Pocket button is not drawn: a form step, or a page that already has its own action at the bottom. The
// button would sit on top of that action, so these pages keep exactly the phone layout they have today (the header
// keeps New Request and Help there too, because the header only changes where the button is). Pure, so the list is
// tested without a browser.
const hidden: readonly RegExp[] = [
  // The guided request steps and the private request intake.
  /^\/account\/request(\/|$)/,
  /^\/account\/drafts(\/|$)/,
  /^\/plan(\/|$)/,
  // Forms that end in their own Save or Send.
  /^\/account\/service-requests\/new\/?$/,
  /^\/account\/problem-reports\/new\/?$/,
  /^\/account\/profile\/[^/]+/,
  /^\/account\/billing\/[^/]+/,
  // The programme first run and its editors live on the programme page; the chooser and the list keep the button.
  /^\/account\/delegations\/(?!organise(\/|$))[^/]+/,
];

export function pocketHiddenOn(pathname: string | null | undefined): boolean {
  const path = pathname ?? '';
  return hidden.some((pattern) => pattern.test(path));
}

/** The widest window the Pocket button and the short header are drawn in, in CSS px (the phone, and the installed app). */
export const pocketMaxWidth = 640;
