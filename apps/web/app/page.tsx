import '../components/home-landing.css';
import '../components/home-routes.css';
import { HomeRoutes } from '../components/home-routes';
import { HomeV42Page } from '../components/home-v42-page';
import { HomeV43Page } from '../components/home-v43-page';
import { HomeV44Page } from '../components/home-v44-page';
import { LegacyHashRedirect } from '../components/legacy-hash-redirect';
import { PublicShell } from '../components/public-shell';
import { supportWhatsappHref } from '../lib/ux/support-whatsapp';
import { howTrustV43On } from '../lib/how-trust-v43';
import { uxSwitchOn } from '../lib/ux-switches';

// The home page as the owner's design board "Corridra Two Routes", revision 3c, in full (owner decisions of 17 and
// 18 November 2026; docs/revamp/specs/public-home.md). The words are keys in the message files
// (lib/i18n/home-words.ts); they show in the chosen language only while `CORRIDRA_LANGUAGES_PAGES` is on. The first
// action everywhere is Start a Request, to /plan or to a /plan?job=... link; the examples are labelled and send
// nothing. "Talk to a Person" and WhatsApp appear only when the owner's support number is set, as in the Help menus.
// Home page v4.2 (owner, 25 Nov 2026: "lock this v4.2", "Add a switch, off by default"): only while
// CORRIDRA_UX_HOME_V42 is exactly "true" the page is the v4.2 composition (docs/revamp/specs/ui-ux-v4-2.md), loaded
// by HomeV42Page only then. The switch is read when the page is built, so a change needs a redeploy.
// Home page v4.3 (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly"): only while
// CORRIDRA_UX_HOME_V43 is exactly "true" the page is the v4.3 composition (docs/revamp/specs/ui-ux-v4-3.md), loaded by
// HomeV43Page only then. With CORRIDRA_UX_HOW_TRUST_V43 also on (owner, 26 Nov 2026, first hand to Guardian G66: "yes to
// all three, build it") the home keeps summaries of the process and of trust. Home page v4.4 (owner, 27 Nov 2026): only while CORRIDRA_UX_HOME_V44 is also exactly "true" the v4.3 page gets the
// redesign hero and the route map (HomeV44Page). It wins over V42; with it off the page is the V42 or the legacy home, byte for byte.
export default function Home() {
  return (
    <PublicShell className="ux-guide-home ac1-home tr-home" translated>
      <LegacyHashRedirect {...(howTrustV43On() ? { deepPages: true } : {})} />
      {uxSwitchOn('CORRIDRA_UX_HOME_V43') ? (
        uxSwitchOn('CORRIDRA_UX_HOME_V44') ? (
          <HomeV44Page
            whatsapp={supportWhatsappHref()}
            {...(howTrustV43On() ? { summaries: true } : {})}
          />
        ) : (
          <HomeV43Page
            whatsapp={supportWhatsappHref()}
            {...(howTrustV43On() ? { summaries: true } : {})}
          />
        )
      ) : uxSwitchOn('CORRIDRA_UX_HOME_V42') ? (
        <HomeV42Page whatsapp={supportWhatsappHref()} />
      ) : (
        <HomeRoutes whatsapp={supportWhatsappHref()} />
      )}
    </PublicShell>
  );
}
