'use client';

import dynamic from 'next/dynamic';

// Home page v4.3 (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly"): app/page.tsx
// renders this only while CORRIDRA_UX_HOME_V43 is exactly "true". Same lazy boundary as the v4.2 one: the composition
// and its stylesheet are a chunk loaded from here, so with the switch off the home page ships neither. The page stays
// a plain function so fixtures that render the home outside Next.js keep working. With CORRIDRA_UX_HOW_TRUST_V43 also
// on, app/page.tsx passes `summaries` and the page is the summarised composition, a chunk of its own.
const HomeV43 = dynamic(() => import('./home-v43').then((m) => m.HomeV43));
const HomeV43Summarised = dynamic(() =>
  import('./home-v43-summarised').then((m) => m.HomeV43Summarised),
);

export function HomeV43Page({
  whatsapp,
  summaries = false,
}: {
  whatsapp: string | null;
  /** CORRIDRA_UX_HOW_TRUST_V43 (read by app/page.tsx): the home keeps summaries of the process and of trust. */
  summaries?: boolean;
}) {
  return summaries ? <HomeV43Summarised whatsapp={whatsapp} /> : <HomeV43 whatsapp={whatsapp} />;
}
