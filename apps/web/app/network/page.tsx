import { PublicPage } from '../../components/public-page';
import { publicPages } from '../../content/public-pages';
const content =
  process.env.CORRIDRA_NETWORK_ENABLED === 'true'
    ? {
        ...publicPages['network'],
        title: 'Invited tasks. Clear work and review.',
        description:
          'Scoped contributor work with reviewed eligibility, explicit task instructions and independent evidence review.',
        introduction: {
          title: 'Use your local knowledge for a defined task.',
          text: 'An operator reviews eligibility and assigns a specific piece of work. Your access covers that task, not the whole mission or team workspace.',
        },
        sections: [
          {
            title: 'Accept your reviewed invitation',
            text: 'Verify your account email, set a separate contributor password and enroll your authenticator. An existing work identity keeps its credentials.',
          },
          {
            title: 'Review the task before accepting',
            text: 'Read the location, timing, instructions, evidence and any conditional reward terms. Only explicitly assigned work appears in your task view.',
          },
          {
            title: 'Submit evidence and follow its review',
            text: 'Keep your submission and review history together. Evidence review and any reward approval are separate decisions; a task does not guarantee payment.',
          },
        ],
        closing: {
          title: 'Only your assigned work.',
          text: 'Participation is by reviewed invitation. Eligibility, scope and rewards depend on the disclosed task. This is not a public marketplace or an automatic payout service.',
        },
        cta: 'Open assigned-task access',
        ctaHref: '/contributor',
      }
    : publicPages['network'];
export const metadata = {
  title: `${content.label.toLowerCase().replace(/^./, (c) => c.toUpperCase())} | Corridra`,
  description: content.description,
  openGraph: { title: content.title, description: content.description },
};
export default function Page() {
  return (
    <PublicPage
      content={{
        ...content,
        related:
          process.env.CORRIDRA_NETWORK_ENABLED === 'true'
            ? { href: '/contributor/setup', label: 'First invitation? Set up contributor access' }
            : { href: '/contributor', label: 'Already invited? Open assigned-task access' },
      }}
    />
  );
}
