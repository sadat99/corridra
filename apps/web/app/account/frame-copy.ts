// Words for the page frame (components/ux/page-frame.tsx) that a page and its section component both need. A section
// drawn on its own, as the fixture specs do, still shows its own back link and helper line; with `framed` set the page
// frame shows them once, above and under the title, and the section leaves them out. Safe in server and client code.
import { realCustomerInput } from '@corridra/domain/customer-input-mode';

export const registrationsBack = { label: 'Back to my account', href: '/account' };

export function registrationsHelper(): string {
  return realCustomerInput()
    ? 'An invitation gives no access to the organiser’s workspace or private commercial details. Organisers see only the display name you agree to share.'
    : 'Fictional sample registration only. An invitation grants no organiser workspace membership or private commercial access. Only the display name you consent to share is visible to programme organisers.';
}

export const savedRequestBack = {
  label: 'Back to my saved requests',
  href: '/account#customer-requests',
};

export const savedRequestHelper =
  'Your submitted information. A request is not an accepted engagement, confirmed meeting or deal.';

// Home, Requests and All Tools (UI/UX.v3 audit, screens batch A): one helper line under the page title.
export const homeHelper = 'Start a request, or pick up where you left off.';
export const requestsHelper = 'Everything you sent, and the workspaces it belongs to.';
export const allToolsHelper = 'Search by name, or pick a group. Every page you can open is here.';

export const profileBack = registrationsBack;

export function profileHelper(): string {
  return realCustomerInput()
    ? 'Company details, kept private to this workspace. Everything here is self-reported and unverified, and it is not linked to any company record.'
    : 'Sample details only, kept private to this workspace. Everything here is self-reported and unverified, and it is not linked to any company record.';
}

// Programmes (UI/UX.v3 audit, unit A3d part 2): the programme pages. The chooser keeps its own description line, so
// its frame has the back link only. A helper line would make the page longer than before at 768 and 1440 px, and the
// closing paragraph beside Reload (what programme administration never grants) already says it, so neither page has one.
export const programmesChooserBack = registrationsBack;
export const programmeBack = {
  label: 'Back to my workspaces',
  href: '/account#customer-workspaces',
};
