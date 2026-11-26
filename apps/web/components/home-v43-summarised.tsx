'use client';

import { HomeV43 } from './home-v43';
import { HomeV43ProcessSummary, HomeV43TrustSummary } from './home-v43-summaries';
import './how-trust-v43.css';

// The home page v4.3 with CORRIDRA_UX_HOW_TRUST_V43 on (owner, 26 Nov 2026, first hand to Guardian G66: "yes to all
// three, build it"): the same page with the process and trust bands as summaries. A lazy chunk loaded from
// home-v43-page.tsx only then, so the home with the switch off ships neither the summaries nor their stylesheet.
export function HomeV43Summarised({ whatsapp }: { whatsapp: string | null }) {
  return (
    <HomeV43
      whatsapp={whatsapp}
      summaries={{ process: <HomeV43ProcessSummary />, trust: <HomeV43TrustSummary /> }}
    />
  );
}
