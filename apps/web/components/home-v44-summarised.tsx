'use client';

import { HomeV43 } from './home-v43';
import { HomeV43ProcessSummary, HomeV43TrustSummary } from './home-v43-summaries';
import { HomeV44Choice } from './home-v44-choice';
import { HomeV44Closing } from './home-v44-closing';
import { HomeV44Footer } from './home-v44-footer';
import { HomeV44Hero } from './home-v44-hero';
import { HomeV44Map } from './home-v44-map';
import { HomeV44Status } from './home-v44-status';
import { HomeV44Strip } from './home-v44-strip';
import './home-v44.css';
import './how-trust-v43.css';

// The home page v4.4 with CORRIDRA_UX_HOW_TRUST_V43 also on: the same page with the process and trust bands as
// summaries, as HomeV43Summarised does. A lazy chunk loaded from home-v44-page.tsx only then.
export function HomeV44Summarised({ whatsapp }: { whatsapp: string | null }) {
  return (
    <HomeV43
      whatsapp={whatsapp}
      summaries={{ process: <HomeV43ProcessSummary />, trust: <HomeV43TrustSummary /> }}
      v44={{
        hero: <HomeV44Hero whatsapp={whatsapp} />,
        choice: (props) => <HomeV44Choice {...props} />,
        strip: <HomeV44Strip />,
        status: <HomeV44Status />,
        footer: <HomeV44Footer />,
        closing: (props) => <HomeV44Closing {...props} />,
        map: (route) => <HomeV44Map {...route} />,
      }}
    />
  );
}
