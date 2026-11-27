'use client';

import dynamic from 'next/dynamic';

// Home page v4.4 (owner, 27 Nov 2026, decision 4): app/page.tsx renders this only while CORRIDRA_UX_HOME_V44 and
// CORRIDRA_UX_HOME_V43 are both exactly "true". Same lazy boundary as the v4.3 one: the composition and its stylesheet
// are chunks loaded from here, so with the switch off the home page ships neither.
const HomeV44 = dynamic(() => import('./home-v44').then((m) => m.HomeV44));
const HomeV44Summarised = dynamic(() =>
  import('./home-v44-summarised').then((m) => m.HomeV44Summarised),
);

export function HomeV44Page({
  whatsapp,
  summaries,
}: {
  whatsapp: string | null;
  /** CORRIDRA_UX_HOW_TRUST_V43 (read by app/page.tsx): the home keeps summaries of the process and of trust. */
  summaries?: boolean;
}) {
  // The approved page is the summarised one (three process lines, three evidence lines); the plain composition stays for
  // a caller that asks for it explicitly.
  return summaries === false ? (
    <HomeV44 whatsapp={whatsapp} />
  ) : (
    <HomeV44Summarised whatsapp={whatsapp} />
  );
}
