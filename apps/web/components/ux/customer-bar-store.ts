// A client-only holder for the one quiet line the customer header shows in its account menu: the privacy
// line on the live service, or the made-up-details line on the preview. The customer page (a server
// component) cannot hand it to the header directly, so it registers it here from a small client component.
// It holds one short line of words: no identity, role, tenant or token.
let note = '';
const listeners = new Set<() => void>();

export function setCustomerNote(next: string) {
  if (next === note) return;
  note = next;
  for (const listener of listeners) listener();
}
export function readCustomerNote() {
  return note;
}
/** The server always sees no line, so the first render is the same on the server and in the browser. */
export function readServerCustomerNote() {
  return '';
}
export function subscribeCustomerNote(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Whether customer billing is on, so the avatar menu can link Plan and Billing or say Coming soon. A flag only.
let billing = false;
export function setCustomerBilling(next: boolean) {
  if (next === billing) return;
  billing = next;
  for (const listener of listeners) listener();
}
export function readCustomerBilling() {
  return billing;
}
export function readServerCustomerBilling() {
  return false;
}

// Whether the email choices page exists, so the avatar menu links Notification Settings or says Coming soon. A flag only.
let notificationSettings = false;
export function setCustomerNotificationSettings(next: boolean) {
  if (next === notificationSettings) return;
  notificationSettings = next;
  for (const listener of listeners) listener();
}
export function readCustomerNotificationSettings() {
  return notificationSettings;
}
export function readServerCustomerNotificationSettings() {
  return false;
}

// Whether the organisation profiles module is on, so the avatar menu links Company Profile or says Coming soon. A flag only.
let organisationProfiles = false;
export function setCustomerOrganisationProfiles(next: boolean) {
  if (next === organisationProfiles) return;
  organisationProfiles = next;
  for (const listener of listeners) listener();
}
export function readCustomerOrganisationProfiles() {
  return organisationProfiles;
}
export function readServerCustomerOrganisationProfiles() {
  return false;
}

// Whether Report a Problem is installed with the customer's own word removal, so the help menu links it or says Coming soon. A flag only.
let problemReports = false;
export function setCustomerProblemReports(next: boolean) {
  if (next === problemReports) return;
  problemReports = next;
  for (const listener of listeners) listener();
}
export function readCustomerProblemReports() {
  return problemReports;
}
export function readServerCustomerProblemReports() {
  return false;
}

// Whether the approved-companies module is on, and whether Home is Your Move, so the Search dialog lists the same pages
// as the tabs. Flags only: they decide nothing about access.
let companies = false;
export function setCustomerCompanies(next: boolean) {
  if (next === companies) return;
  companies = next;
  for (const listener of listeners) listener();
}
export function readCustomerCompanies() {
  return companies;
}
export function readServerCustomerCompanies() {
  return false;
}

let move = false;
export function setCustomerMove(next: boolean) {
  if (next === move) return;
  move = next;
  for (const listener of listeners) listener();
}
export function readCustomerMove() {
  return move;
}
export function readServerCustomerMove() {
  return false;
}
