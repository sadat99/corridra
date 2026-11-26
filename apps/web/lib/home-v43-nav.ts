import { solutionIcons, v43 } from './home-v43-data';
import type { IconName } from '../components/corridra-icon';
import type { MessageKey } from './i18n/messages';

// The Solutions rows of the home page v4.3, shared by the header menu, the footer and the hero so the four anchors
// are written once. Each address is a home anchor (`/#id`): on the home page the header scrolls and focuses the
// section, from another page the link navigates and the home focuses it on arrival.
export type SolutionRow = {
  id: 'service-source' | 'service-sell' | 'service-delegation' | 'inbound';
  href: string;
  icon: IconName;
  title: MessageKey;
  line: MessageKey;
};

const row = (
  id: SolutionRow['id'],
  name: 'source' | 'sell' | 'delegation' | 'inbound',
): SolutionRow => ({
  id,
  href: `/#${id}`,
  icon: solutionIcons[name],
  title: v43(`menu.sol.${name}.title`),
  line: v43(`menu.sol.${name}.line`),
});

export const solutionRows: readonly SolutionRow[] = [
  row('service-source', 'source'),
  row('service-sell', 'sell'),
  row('service-delegation', 'delegation'),
  row('inbound', 'inbound'),
];

/** The FAQs row of the phone drawer and the footer's Explore group. */
export const faqRow = { id: 'questions', href: '/#questions', title: v43('menu.faqs') } as const;
