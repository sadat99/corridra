import { SegmentLinks } from './sub-tabs';

export type MyWorkTab = 'requests' | 'meetings' | 'results';

/**
 * My Work (customer account v18): Requests, Meetings and Results as one place. Each tab is the page that always
 * held it, so every address, filter and read stays as it was; only the way between them is one row. Navigation
 * only: it grants and removes no access, and each page still checks on the server.
 */
export function MyWorkTabs({ current, meetings }: { current: MyWorkTab; meetings: boolean }) {
  return (
    <SegmentLinks
      label="My Work sections"
      segments={[
        {
          id: 'requests',
          label: 'Requests',
          href: '/account?view=work',
          current: current === 'requests',
        },
        ...(meetings
          ? [
              {
                id: 'meetings',
                label: 'Meetings',
                href: '/account/meetings',
                current: current === 'meetings',
              },
            ]
          : []),
        {
          id: 'results',
          label: 'Results',
          href: '/account?view=results',
          current: current === 'results',
        },
      ]}
    />
  );
}
