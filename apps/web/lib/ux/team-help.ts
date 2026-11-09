// The team header's Help and accessibility groups: the shared groups, plus the old phone Help sheet's "Start a Request"
// (the public request form), so nothing the team reached from the corner Help is lost. Owner: S4.
import { customerHelpGroups, type HelpGroup } from './customer-navigation';

export function teamHelpGroups(): HelpGroup[] {
  return customerHelpGroups().map((group) =>
    group.label === 'About Corridra'
      ? {
          ...group,
          items: [
            ...group.items,
            { kind: 'link' as const, label: 'Start a Request', href: '/plan' },
          ],
        }
      : group,
  );
}
